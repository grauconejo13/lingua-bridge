import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, HealthResponse, UtteranceResponse } from '@lingua-bridge/shared';
import { ProviderError } from '../src/errors';
import { MockProvider } from '../src/providers/mock';
import { fakeAudio, multipart, testApp } from './helpers';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

describe('GET /api/health', () => {
  it('reports the provider and demo mode honestly', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<HealthResponse>();
    expect(body).toMatchObject({ status: 'ok', provider: 'mock', demoMode: true });
    expect(body.limits.maxAudioBytes).toBeGreaterThan(0);
  });

  it('never exposes the API key', async () => {
    app = await testApp({ env: { OPENAI_API_KEY: 'sk-secret-value' } });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.body).not.toContain('sk-secret-value');
  });
});

describe('GET /api/languages', () => {
  it('returns the registry', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/languages' });
    const codes = res.json<{ languages: { code: string }[] }>().languages.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes.length).toBeGreaterThan(5);
  });
});

describe('POST /api/utterances', () => {
  it('transcribes and translates with timings', async () => {
    app = await testApp();
    const form = multipart(
      { sourceLanguage: 'en', targetLanguage: 'ja' },
      { type: 'audio/webm;codecs=opus', data: fakeAudio() },
    );
    const res = await app.inject({ method: 'POST', url: '/api/utterances', ...form });
    expect(res.statusCode).toBe(200);
    const body = res.json<UtteranceResponse>();
    expect(body.sourceText).toBe('Can everyone hear me clearly?');
    expect(body.translatedText).toBe('皆さん、はっきり聞こえますか？');
    expect(body.sourceLanguage).toBe('en');
    expect(body.targetLanguage).toBe('ja');
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
    expect(body.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts the file before the language fields', async () => {
    app = await testApp();
    const boundary = 'b';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.mp4"\r\nContent-Type: audio/mp4\r\n\r\n`,
      ),
      fakeAudio(),
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="sourceLanguage"\r\n\r\nes\r\n--${boundary}\r\nContent-Disposition: form-data; name="targetLanguage"\r\n\r\nen\r\n--${boundary}--\r\n`,
      ),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/utterances',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<UtteranceResponse>().translatedText).toBe('Can everyone hear me clearly?');
  });

  it('rejects unsupported languages', async () => {
    app = await testApp();
    const form = multipart(
      { sourceLanguage: 'en', targetLanguage: 'klingon' },
      { type: 'audio/webm', data: fakeAudio() },
    );
    const res = await app.inject({ method: 'POST', url: '/api/utterances', ...form });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.code).toBe('UNSUPPORTED_LANGUAGE');
  });

  it('rejects non-audio uploads', async () => {
    app = await testApp();
    const form = multipart(
      { sourceLanguage: 'en', targetLanguage: 'es' },
      { type: 'text/plain', data: Buffer.from('hello') },
    );
    const res = await app.inject({ method: 'POST', url: '/api/utterances', ...form });
    expect(res.statusCode).toBe(415);
    expect(res.json<ApiError>().error.code).toBe('UNSUPPORTED_AUDIO');
  });

  it('requires an audio file', async () => {
    app = await testApp();
    const form = multipart({ sourceLanguage: 'en', targetLanguage: 'es' });
    const res = await app.inject({ method: 'POST', url: '/api/utterances', ...form });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.code).toBe('BAD_REQUEST');
  });

  it('rejects recordings over the size limit', async () => {
    app = await testApp({ env: { MAX_AUDIO_BYTES: '2048' } });
    const form = multipart(
      { sourceLanguage: 'en', targetLanguage: 'es' },
      { type: 'audio/webm', data: fakeAudio(4096) },
    );
    const res = await app.inject({ method: 'POST', url: '/api/utterances', ...form });
    expect(res.statusCode).toBe(413);
    expect(res.json<ApiError>().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('reports when no speech was detected', async () => {
    app = await testApp();
    const form = multipart(
      { sourceLanguage: 'en', targetLanguage: 'es' },
      { type: 'audio/webm', data: fakeAudio(10) },
    );
    const res = await app.inject({ method: 'POST', url: '/api/utterances', ...form });
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiError>().error.code).toBe('NO_SPEECH');
  });

  it('hides upstream provider details from the client', async () => {
    const provider = new MockProvider();
    provider.translate = async () => {
      throw new ProviderError('translate', 'upstream said: invalid key sk-123', 401);
    };
    app = await testApp({ provider });
    const form = multipart(
      { sourceLanguage: 'en', targetLanguage: 'es' },
      { type: 'audio/webm', data: fakeAudio() },
    );
    const res = await app.inject({ method: 'POST', url: '/api/utterances', ...form });
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.code).toBe('PROVIDER_ERROR');
    expect(res.body).not.toContain('sk-123');
  });
});

describe('POST /api/speech', () => {
  it('returns playable audio', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/speech',
      payload: { text: 'Hola', language: 'es' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/wav');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('enforces the character limit', async () => {
    app = await testApp({ env: { MAX_TTS_CHARS: '10' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/speech',
      payload: { text: 'This sentence is too long', language: 'en' },
    });
    expect(res.statusCode).toBe(413);
  });

  it('validates the body', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'POST', url: '/api/speech', payload: { text: 'hi' } });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.code).toBe('BAD_REQUEST');
  });
});

describe('cost controls', () => {
  it('rate limits per client', async () => {
    app = await testApp({ env: { RATE_LIMIT_MAX: '2' } });
    for (let i = 0; i < 2; i++) {
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    }
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(429);
    expect(res.json<ApiError>().error.code).toBe('RATE_LIMITED');
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404 under /api', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiError>().error.code).toBe('BAD_REQUEST');
  });
});

describe('serving the built web app', () => {
  function fakeDist() {
    const dir = mkdtempSync(join(tmpdir(), 'lb-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Lingua Bridge</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    return dir;
  }

  it('serves assets and the app shell for client routes', async () => {
    app = await testApp({ webDistDir: fakeDist() });
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    const route = await app.inject({ method: 'GET', url: '/some/page' });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('Lingua Bridge');
  });

  it('does not count page loads against the API rate limit', async () => {
    app = await testApp({ webDistDir: fakeDist(), env: { RATE_LIMIT_MAX: '1' } });
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(429);
  });

  it('returns 404 for missing files instead of the app shell', async () => {
    app = await testApp({ webDistDir: fakeDist() });
    const res = await app.inject({ method: 'GET', url: '/assets/missing-abc123.js' });
    expect(res.statusCode).toBe(404);
  });

  it('sends a content security policy that allows blob audio', async () => {
    app = await testApp({ webDistDir: fakeDist() });
    const res = await app.inject({ method: 'GET', url: '/' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});
