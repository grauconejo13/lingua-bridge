import type { Language, LanguageCode } from './languages';

/** Provider ids the server can run with. `mock` never calls a paid API. */
export type ProviderId = 'mock' | 'openai';

export interface HealthResponse {
  status: 'ok';
  provider: ProviderId;
  /** True when output is placeholder text rather than real translation. */
  demoMode: boolean;
  limits: {
    maxAudioBytes: number;
    maxTtsChars: number;
  };
}

export interface LanguagesResponse {
  languages: Language[];
}

/** Server-side timings for one utterance, in milliseconds. */
export interface UtteranceTimings {
  transcribeMs: number;
  translateMs: number;
  totalMs: number;
}

/**
 * Result of POST /api/utterances.
 * Sent as multipart/form-data with fields `sourceLanguage`, `targetLanguage` and a file `audio`.
 */
export interface UtteranceResponse {
  id: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sourceText: string;
  translatedText: string;
  timings: UtteranceTimings;
}

/** Body of POST /api/speech. The response is audio bytes. */
export interface SpeechRequest {
  text: string;
  language: LanguageCode;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNSUPPORTED_LANGUAGE'
  | 'UNSUPPORTED_AUDIO'
  | 'PAYLOAD_TOO_LARGE'
  | 'NO_SPEECH'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'INTERNAL';

export interface ApiError {
  error: {
    code: ApiErrorCode;
    /** Safe to show to users. Never contains provider credentials or raw upstream errors. */
    message: string;
  };
}

/** Audio container types the server accepts. Codec parameters are stripped before checking. */
export const ACCEPTED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
] as const;

/** "audio/webm;codecs=opus" → "audio/webm" */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isAcceptedAudioType(mimeType: string): boolean {
  return (ACCEPTED_AUDIO_TYPES as readonly string[]).includes(baseMimeType(mimeType));
}
