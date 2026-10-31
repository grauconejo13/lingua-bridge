import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, sendUtterance } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendUtterance', () => {
  it('posts languages and audio as multipart form data', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ id: '1', sourceText: 'hi', translatedText: 'hola' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendUtterance({
      audio: new Blob(['x'], { type: 'audio/webm' }),
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });

    expect(result.translatedText).toBe('hola');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/utterances');
    const form = init?.body as FormData;
    expect(form.get('sourceLanguage')).toBe('en');
    expect(form.get('targetLanguage')).toBe('es');
    expect(form.get('audio')).toBeInstanceOf(Blob);
  });

  it('surfaces the server error message and code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'PROVIDER_ERROR', message: 'Service unavailable.' } },
          { status: 502 },
        ),
      ),
    );
    const error = await sendUtterance({
      audio: new Blob(['x']),
      sourceLanguage: 'en',
      targetLanguage: 'es',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe('PROVIDER_ERROR');
    expect((error as ApiClientError).message).toBe('Service unavailable.');
    expect((error as ApiClientError).retryable).toBe(true);
  });

  it('turns network failures into a retryable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const error = (await sendUtterance({
      audio: new Blob(['x']),
      sourceLanguage: 'en',
      targetLanguage: 'es',
    }).catch((e: unknown) => e)) as ApiClientError;

    expect(error.code).toBe('NETWORK');
    expect(error.retryable).toBe(true);
  });

  it('does not offer retry for invalid requests', () => {
    expect(new ApiClientError('UNSUPPORTED_AUDIO', 'nope', 415).retryable).toBe(false);
    expect(new ApiClientError('NO_SPEECH', 'nope', 422).retryable).toBe(false);
  });
});
