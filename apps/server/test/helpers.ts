import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MockProvider } from '../src/providers/mock';
import type { SpeechProvider } from '../src/providers';

export async function testApp(
  overrides: { env?: Record<string, string>; provider?: SpeechProvider; webDistDir?: string } = {},
): Promise<FastifyInstance> {
  const config = loadConfig(
    { PROVIDER: 'mock', LOG_LEVEL: 'silent', ...overrides.env },
    overrides.webDistDir,
  );
  const app = await buildApp({
    config,
    provider: overrides.provider ?? new MockProvider(),
    logger: false,
  });
  await app.ready();
  return app;
}

/** Build a multipart/form-data body by hand so tests don't need a form library. */
export function multipart(
  fields: Record<string, string>,
  file?: { name?: string; filename?: string; type: string; data: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----linguabridgetest';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name ?? 'audio'}"; filename="${file.filename ?? 'clip.webm'}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Bytes that stand in for a recording. The mock provider only looks at the size. */
export const fakeAudio = (bytes = 4096) => Buffer.alloc(bytes, 1);
