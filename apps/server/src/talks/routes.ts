import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import {
  LANGUAGES,
  TALK_CLOSE,
  isLanguageCode,
  type CreateTalkResponse,
  type TalkClientEvent,
} from '@lingua-bridge/shared';
import type { AppConfig } from '../config';
import { AppError } from '../errors';
import type { SpeechProvider } from '../providers';
import type { Connection } from '../rooms/store';
import { readAudioUpload } from '../upload';
import { TalkError, TalkService, cleanTitle, type TalkMember } from './service';
import { TalkStore } from './store';

const languageCode = z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]);
const clientSegmentId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const talkId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const CreateSchema = z.object({ language: languageCode, title: z.string().max(400).optional() });
const TextSchema = z.object({ clientSegmentId, text: z.string().max(4000) });

const ClientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    talkId,
    presenterKey: z.string().min(1).max(128).optional(),
    language: languageCode.optional(),
    lastSeq: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('language'), language: languageCode }),
  z.object({ type: z.literal('status'), status: z.enum(['live', 'paused']) }),
  z.object({ type: z.literal('ping'), t: z.number().finite().optional() }),
]);

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const EVENT_BUDGET = { max: 60, windowMs: 10_000 };

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

function parseEvent(raw: string): TalkClientEvent | undefined {
  try {
    const result = ClientEventSchema.safeParse(JSON.parse(raw));
    return result.success ? (result.data as TalkClientEvent) : undefined;
  } catch {
    return undefined;
  }
}

/** Presentation endpoints. Expects @fastify/websocket to be registered already. */
export async function registerTalks(
  app: FastifyInstance,
  { config, provider }: { config: AppConfig; provider: SpeechProvider },
): Promise<TalkService> {
  const store = new TalkStore(config.talks);
  const service = new TalkService(store, provider, { maxListeners: config.talks.maxListeners });

  const sweeper = setInterval(() => store.sweep(), 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));

  app.post('/api/talks', async (request): Promise<CreateTalkResponse> => {
    const body = CreateSchema.safeParse(request.body);
    if (!body.success)
      throw new AppError('BAD_REQUEST', 'Choose the language you will present in.', 400);
    const language = body.data.language;
    if (!isLanguageCode(language))
      throw new AppError('UNSUPPORTED_LANGUAGE', 'Unsupported language.', 400);
    const created = store.create({ title: cleanTitle(body.data.title), language });
    if (!created) {
      throw new AppError(
        'UNAVAILABLE',
        'The server is busy right now. Try again in a few minutes.',
        503,
      );
    }
    return {
      talkId: created.talk.id,
      presenterKey: created.key,
      idleMinutes: Math.round(config.talks.idleMs / 60_000),
    };
  });

  app.post<{ Params: { talkId: string } }>('/api/talks/:talkId/text', async (request) => {
    const talk = service.authorize(request.params.talkId, bearer(request));
    const body = TextSchema.safeParse(request.body);
    if (!body.success) throw new AppError('BAD_REQUEST', 'Invalid caption.', 400);
    const segment = await service.addText(talk, body.data);
    request.log.info(
      { talk: talk.id, kind: 'text', chars: segment.sourceText.length },
      'talk segment',
    );
    return segment;
  });

  app.post<{ Params: { talkId: string } }>('/api/talks/:talkId/segments', async (request) => {
    const talk = service.authorize(request.params.talkId, bearer(request));
    const { fields, audio, mimeType } = await readAudioUpload(request);
    const id = clientSegmentId.safeParse(fields.clientSegmentId);
    if (!id.success) throw new AppError('BAD_REQUEST', 'Missing or invalid clientSegmentId.', 400);
    const segment = await service.addSpeech(talk, { clientSegmentId: id.data, audio, mimeType });
    request.log.info(
      {
        talk: talk.id,
        kind: 'speech',
        audioBytes: audio.byteLength,
        transcribeMs: segment.transcribeMs,
      },
      'talk segment',
    );
    return segment;
  });

  app.post<{ Params: { talkId: string } }>('/api/talks/:talkId/end', async (request) => {
    const talk = store.get(request.params.talkId);
    if (!talk) throw new AppError('BAD_REQUEST', 'This talk has ended.', 404);
    if (!talk.checkKey(bearer(request))) {
      throw new AppError('BAD_REQUEST', 'Not the presenter of this talk.', 403);
    }
    service.end(talk);
    request.log.info({ talk: talk.id, segments: talk.segments.length }, 'talk ended');
    return { ok: true };
  });

  app.get<{ Params: { talkId: string; segmentId: string }; Querystring: { language?: string } }>(
    '/api/talks/:talkId/segments/:segmentId/speech',
    async (request, reply) => {
      const talk = store.get(request.params.talkId);
      if (!talk) throw new AppError('BAD_REQUEST', 'This talk has ended.', 404);
      const language = request.query.language;
      if (!isLanguageCode(language)) {
        throw new AppError('UNSUPPORTED_LANGUAGE', 'Unsupported language.', 400);
      }
      const speech = await service.speechFor(talk, request.params.segmentId, language);
      // Each listener's browser may cache it; the content never changes for this URL.
      return reply
        .header('Cache-Control', 'private, max-age=3600')
        .type(speech.mimeType)
        .send(speech.audio);
    },
  );

  app.get('/api/talks/ws', { websocket: true }, (socket: WebSocket, request) => {
    const connection: Connection = {
      send: (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
      close: (code, reason) => socket.close(code, reason),
    };

    let member: TalkMember | undefined;
    let joining = false;
    let alive = true;
    let budget = EVENT_BUDGET.max;
    let windowStart = Date.now();

    const fail = (error: TalkError) => {
      service.send(connection, { type: 'error', code: error.code, message: error.message });
      socket.close(error.closeCode, error.code);
    };

    const helloTimer = setTimeout(() => {
      if (!member) fail(new TalkError('BAD_MESSAGE', 'Expected hello.', TALK_CLOSE.FORBIDDEN));
    }, HELLO_TIMEOUT_MS);

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on('pong', () => {
      alive = true;
    });

    socket.on('message', (data, isBinary) => {
      alive = true;
      const now = Date.now();
      if (now - windowStart > EVENT_BUDGET.windowMs) {
        windowStart = now;
        budget = EVENT_BUDGET.max;
      }
      if (--budget < 0) {
        fail(new TalkError('RATE_LIMITED', 'Too many events.', TALK_CLOSE.RATE_LIMITED));
        return;
      }

      const event = isBinary ? undefined : parseEvent(data.toString());
      if (!event) {
        service.send(connection, { type: 'error', code: 'BAD_MESSAGE', message: 'Bad message.' });
        return;
      }

      if (event.type === 'ping') {
        service.send(
          connection,
          event.t === undefined ? { type: 'pong' } : { type: 'pong', t: event.t },
        );
        return;
      }

      if (event.type === 'hello') {
        if (member || joining) return;
        joining = true;
        clearTimeout(helloTimer);
        service
          .hello(connection, event)
          .then((result) => {
            member = result;
            // A talk that already ended still says so, then closes.
            if (result.talk.status === 'ended') socket.close(TALK_CLOSE.ENDED, 'ended');
            // The socket may have closed while the welcome was being translated.
            else if (socket.readyState !== socket.OPEN) service.disconnect(result, connection);
          })
          .catch((error: unknown) => {
            if (error instanceof TalkError) fail(error);
            else {
              request.log.error({ err: error }, 'talk hello failed');
              socket.close(1011, 'error');
            }
          })
          .finally(() => {
            joining = false;
          });
        return;
      }

      if (!member) return;
      if (event.type === 'language' && member.role === 'listener') {
        if (isLanguageCode(event.language)) {
          void service.setLanguage(member.talk, member.listener, event.language);
        }
      } else if (event.type === 'status' && member.role === 'presenter') {
        service.setStatus(member.talk, event.status);
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      if (member) service.disconnect(member, connection);
    });
  });

  return service;
}
