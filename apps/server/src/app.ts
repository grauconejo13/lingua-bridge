import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  LANGUAGES,
  getLanguage,
  isAcceptedAudioType,
  isLanguageCode,
  type ApiError,
  type ApiErrorCode,
  type HealthResponse,
  type LanguageCode,
  type LanguagesResponse,
} from '@lingua-bridge/shared';
import type { AppConfig } from './config';
import { AppError, ProviderError } from './errors';
import { translateUtterance } from './pipeline';
import type { SpeechProvider } from './providers';

export interface BuildAppOptions {
  config: AppConfig;
  provider: SpeechProvider;
  logger?: boolean;
}

function requireLanguage(value: unknown, field: string): LanguageCode {
  if (!isLanguageCode(value)) {
    throw new AppError('UNSUPPORTED_LANGUAGE', `Unsupported or missing ${field}.`, 400);
  }
  return value;
}

export async function buildApp({
  config,
  provider,
  logger = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  // Fastify's request log records method, URL and status only. Bodies (speech and
  // transcripts) are never logged anywhere in this server.
  const app = Fastify({ logger: logger ? { level: config.logLevel } : false });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // HTTPS is the host's job; upgrading would break plain-http local runs.
        upgradeInsecureRequests: null,
      },
    },
  });

  if (config.corsOrigin) {
    await app.register(cors, { origin: config.corsOrigin.split(',').map((o) => o.trim()) });
  }

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      code: 'RATE_LIMITED',
      message: `Too many requests. Try again in ${context.after}.`,
    }),
  });

  await app.register(multipart, {
    limits: { fileSize: config.maxAudioBytes, files: 1, fields: 4, fieldSize: 64 },
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof ProviderError) {
      // Upstream detail goes to logs only. It never includes the transcript.
      request.log.error(
        { operation: error.operation, upstreamStatus: error.upstreamStatus, detail: error.detail },
        'provider request failed',
      );
    }

    let status = error.statusCode ?? 500;
    let code: ApiErrorCode;
    let message: string;

    if (error instanceof AppError) {
      code = error.code;
      message = error.message;
    } else if (status === 429) {
      code = 'RATE_LIMITED';
      message = error.message;
    } else if (status === 413 || error.code === 'FST_REQ_FILE_TOO_LARGE') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = `Recording is too large. The limit is ${Math.round(config.maxAudioBytes / 1024 / 1024)} MB; try a shorter recording.`;
    } else if (status >= 400 && status < 500) {
      code = 'BAD_REQUEST';
      message = error.message;
    } else {
      request.log.error({ err: error }, 'unhandled error');
      status = 500;
      code = 'INTERNAL';
      message = 'Something went wrong. Please try again.';
    }

    const body: ApiError = { error: { code, message } };
    return reply.status(status).send(body);
  });

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    provider: provider.id,
    demoMode: provider.demoMode,
    limits: { maxAudioBytes: config.maxAudioBytes, maxTtsChars: config.maxTtsChars },
  }));

  app.get('/api/languages', async (): Promise<LanguagesResponse> => ({
    languages: [...LANGUAGES],
  }));

  app.post('/api/utterances', async (request) => {
    if (!request.isMultipart()) {
      throw new AppError('BAD_REQUEST', 'Expected multipart/form-data.', 400);
    }

    const fields: Record<string, string> = {};
    let audio: Buffer | undefined;
    let mimeType = '';

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio') {
          await part.toBuffer();
          continue;
        }
        mimeType = part.mimetype;
        if (!isAcceptedAudioType(mimeType)) {
          throw new AppError(
            'UNSUPPORTED_AUDIO',
            `Unsupported audio format (${mimeType || 'unknown'}).`,
            415,
          );
        }
        audio = await part.toBuffer();
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }

    const sourceLanguage = requireLanguage(fields.sourceLanguage, 'sourceLanguage');
    const targetLanguage = requireLanguage(fields.targetLanguage, 'targetLanguage');
    if (!audio || audio.byteLength === 0) {
      throw new AppError('BAD_REQUEST', 'Missing audio recording.', 400);
    }

    const result = await translateUtterance(provider, {
      audio,
      mimeType,
      sourceLanguage,
      targetLanguage,
    });

    // Timings and languages only — no audio, no text.
    request.log.info(
      { sourceLanguage, targetLanguage, audioBytes: audio.byteLength, ...result.timings },
      'utterance translated',
    );
    return result;
  });

  app.post<{ Body: { text?: unknown; language?: unknown } }>(
    '/api/speech',
    {
      schema: {
        body: {
          type: 'object',
          required: ['text', 'language'],
          properties: { text: { type: 'string' }, language: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const language = requireLanguage(request.body.language, 'language');
      const text = typeof request.body.text === 'string' ? request.body.text.trim() : '';
      if (!text) throw new AppError('BAD_REQUEST', 'Text is required.', 400);
      if (text.length > config.maxTtsChars) {
        throw new AppError(
          'PAYLOAD_TOO_LARGE',
          `Text is too long to speak (limit ${config.maxTtsChars} characters).`,
          413,
        );
      }

      const started = performance.now();
      const speech = await provider.synthesize({ text, language: getLanguage(language) });
      request.log.info(
        { language, chars: text.length, synthesizeMs: Math.round(performance.now() - started) },
        'speech synthesized',
      );
      return reply.header('Cache-Control', 'no-store').type(speech.mimeType).send(speech.audio);
    },
  );

  app.all('/api/*', async () => {
    throw new AppError('BAD_REQUEST', 'Unknown API route.', 404);
  });

  if (config.webDistDir && existsSync(join(config.webDistDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      // Client-side routes get the app shell; missing files (anything with an extension) 404.
      const path = request.url.split('?')[0] ?? '';
      if (request.method === 'GET' && !/\.[a-z0-9]+$/i.test(path)) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: { code: 'BAD_REQUEST', message: 'Not found.' } });
    });
  }

  return app;
}
