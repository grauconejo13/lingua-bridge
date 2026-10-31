import type { LanguageCode, UtteranceTimings } from '@lingua-bridge/shared';

interface CaptionBase {
  /** Client-side id, stable across retries of the same recording. */
  id: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  /** When the recording stopped (ms since page load). */
  stoppedAt: number;
}

export interface PendingCaption extends CaptionBase {
  status: 'pending';
}

export interface DoneCaption extends CaptionBase {
  status: 'done';
  sourceText: string;
  translatedText: string;
  timings: UtteranceTimings;
  /** Stop-to-caption time measured in the browser, including upload. */
  clientMs: number;
  demo: boolean;
}

export interface FailedCaption extends CaptionBase {
  status: 'failed';
  message: string;
  retryable: boolean;
  /** Kept in memory only so the same recording can be retried. Discarded on success. */
  audio: Blob;
}

export type Caption = PendingCaption | DoneCaption | FailedCaption;

export type TextSize = 's' | 'm' | 'l' | 'xl';
