import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../src/errors';
import { translateUtterance } from '../src/pipeline';
import { MockProvider } from '../src/providers/mock';
import { loadConfig } from '../src/config';
import { fakeAudio } from './helpers';

describe('translateUtterance', () => {
  it('records per-step timings from the injected clock', async () => {
    const ticks = [0, 120, 120, 300, 300];
    const now = () => ticks.shift() ?? 300;
    const result = await translateUtterance(
      new MockProvider(),
      { audio: fakeAudio(), mimeType: 'audio/webm', sourceLanguage: 'en', targetLanguage: 'fr' },
      now,
    );
    expect(result.timings).toEqual({ transcribeMs: 120, translateMs: 180, totalMs: 300 });
  });

  it('skips translation when both languages match', async () => {
    const provider = new MockProvider();
    const translate = vi.spyOn(provider, 'translate');
    const result = await translateUtterance(provider, {
      audio: fakeAudio(),
      mimeType: 'audio/webm',
      sourceLanguage: 'en',
      targetLanguage: 'en',
    });
    expect(translate).not.toHaveBeenCalled();
    expect(result.translatedText).toBe(result.sourceText);
  });

  it('raises NO_SPEECH for an empty transcript', async () => {
    await expect(
      translateUtterance(new MockProvider(), {
        audio: fakeAudio(1),
        mimeType: 'audio/webm',
        sourceLanguage: 'en',
        targetLanguage: 'es',
      }),
    ).rejects.toMatchObject({ code: 'NO_SPEECH' } satisfies Partial<AppError>);
  });
});

describe('loadConfig', () => {
  it('defaults to the keyless mock provider', () => {
    expect(loadConfig({}).provider).toBe('mock');
  });

  it('refuses to start the openai provider without a key', () => {
    expect(() => loadConfig({ PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });

  it('parses numeric limits', () => {
    const config = loadConfig({ MAX_AUDIO_BYTES: '1000', RATE_LIMIT_MAX: '5' });
    expect(config.maxAudioBytes).toBe(1000);
    expect(config.rateLimit.max).toBe(5);
  });
});
