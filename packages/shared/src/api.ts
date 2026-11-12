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
  /** False when the operator paused translation or today's budget is spent. */
  available: boolean;
  unavailableReason?: 'paused' | 'budget';
}

export type ProviderOperation = 'transcribe' | 'translate' | 'synthesize';

export interface OperationUsage {
  calls: number;
  errors: number;
  /** Calls refused because of the budget or the pause switch. */
  refused: number;
  /** Minutes for transcription; characters for translation and speech. */
  units: number;
  /** Estimated from configured prices, not a bill. */
  costUsd: number;
  p50Ms?: number;
  p95Ms?: number;
}

/** Aggregate provider usage for the current UTC day. Contains no text, audio or identifiers. */
export interface UsageSnapshot {
  day: string;
  costUsd: number;
  /** 0 means no cap. */
  budgetUsd: number;
  paused: boolean;
  available: boolean;
  unavailableReason?: 'paused' | 'budget';
  operations: Record<ProviderOperation, OperationUsage>;
}

/** GET /api/admin/status (Authorization: Bearer <ADMIN_TOKEN>). */
export interface AdminStatus {
  usage: UsageSnapshot;
  live: { rooms: number; talks: number; listeners: number };
  uptimeSeconds: number;
  provider: ProviderId;
  demoMode: boolean;
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
  | 'UNAVAILABLE'
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
