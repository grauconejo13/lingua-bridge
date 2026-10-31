import { randomUUID } from 'node:crypto';
import { getLanguage, type LanguageCode, type UtteranceResponse } from '@lingua-bridge/shared';
import { AppError } from './errors';
import type { SpeechProvider } from './providers';

export interface UtteranceInput {
  audio: Buffer;
  mimeType: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

/**
 * Speech → source text → translated text, with per-step timings.
 *
 * Audio and text exist only in memory for the duration of the request; nothing is
 * written to disk or logged.
 */
export async function translateUtterance(
  provider: SpeechProvider,
  input: UtteranceInput,
  now: () => number = () => performance.now(),
): Promise<UtteranceResponse> {
  const from = getLanguage(input.sourceLanguage);
  const to = getLanguage(input.targetLanguage);
  const started = now();

  const { text: sourceText } = await provider.transcribe({
    audio: input.audio,
    mimeType: input.mimeType,
    language: from,
  });
  const transcribeMs = Math.round(now() - started);

  if (!sourceText) {
    throw new AppError('NO_SPEECH', "Didn't catch any speech. Try speaking a little longer.", 422);
  }

  const translateStarted = now();
  const translatedText =
    from.code === to.code
      ? sourceText
      : (await provider.translate({ text: sourceText, from, to })).text;
  const translateMs = Math.round(now() - translateStarted);

  return {
    id: randomUUID(),
    sourceLanguage: from.code as LanguageCode,
    targetLanguage: to.code as LanguageCode,
    sourceText,
    translatedText,
    timings: { transcribeMs, translateMs, totalMs: Math.round(now() - started) },
  };
}
