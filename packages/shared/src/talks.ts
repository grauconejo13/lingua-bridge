import type { LanguageCode } from './languages';

/**
 * Presentations ("talks"): one presenter, many listeners, each reading in their own language.
 *
 * - The presenter's link carries a presenter key in its #fragment; the audience link has no
 *   secret, because anyone in the room should be able to scan the QR code and follow along.
 *   Audience sockets are listen-only.
 * - Each segment is transcribed once. Translation runs once per *language in use*, never
 *   per listener, so cost grows with the number of languages, not the size of the audience.
 *   The number of languages per talk is capped.
 * - Every listener receives only its own language, which keeps fan-out small for people on
 *   weak connections.
 * - Segments have a talk-wide `seq`; a reconnecting client sends the last one it has and
 *   receives everything newer, as in conversations.
 */

export const TALK_MAX_TITLE_CHARS = 80;
export const TALK_MAX_TEXT_CHARS = 500;
/** Recent segments a listener receives on joining, or re-translated after switching language. */
export const TALK_CATCH_UP_SEGMENTS = 20;

export interface CreateTalkRequest {
  language: LanguageCode;
  title?: string;
}

export interface CreateTalkResponse {
  talkId: string;
  /** Shared only in the presenter's own link (#fragment). Authorizes sending and ending. */
  presenterKey: string;
  idleMinutes: number;
}

export type TalkStatus = 'live' | 'paused' | 'ended';

export interface TalkInfo {
  id: string;
  title: string;
  /** The presenter's language. */
  language: LanguageCode;
  status: TalkStatus;
  /** How many languages translation can run in at once; listeners past it read the original. */
  maxLanguages: number;
}

/** One caption, as seen by one listener. */
export interface TalkSegment {
  id: string;
  seq: number;
  sourceLanguage: LanguageCode;
  sourceText: string;
  /** The language of `text`. */
  language: LanguageCode;
  /** The caption in `language`, or null when the translation failed or isn't available. */
  text: string | null;
  createdAt: string;
}

/** Bodies for the presenter's HTTP sends (Authorization: Bearer <presenterKey>). */
export interface TalkTextRequest {
  clientSegmentId: string;
  text: string;
}

export interface TalkStats {
  listeners: number;
  /** Listener counts by language, including the presenter's language. */
  byLanguage: Partial<Record<LanguageCode, number>>;
  /** Languages being translated into right now (excludes the presenter's language). */
  translating: LanguageCode[];
}

// ---------- WebSocket ----------

export type TalkClientEvent =
  | {
      type: 'hello';
      talkId: string;
      /** Present only for the presenter. */
      presenterKey?: string;
      /** The listener's reading language; ignored for the presenter. */
      language?: LanguageCode;
      lastSeq?: number;
    }
  | { type: 'language'; language: LanguageCode }
  /** Presenter only: show listeners that the presenter has paused or resumed. */
  | { type: 'status'; status: 'live' | 'paused' }
  | { type: 'ping'; t?: number };

export type TalkErrorCode =
  'TALK_NOT_FOUND' | 'TALK_FULL' | 'FORBIDDEN' | 'BAD_MESSAGE' | 'RATE_LIMITED';

export type TalkServerEvent =
  | {
      type: 'welcome';
      role: 'presenter' | 'listener';
      talk: TalkInfo;
      /** Segments after `lastSeq` (up to the catch-up limit) in this client's language. */
      segments: TalkSegment[];
      /** True when this listener's language is over the talk's language limit. */
      languageUnavailable?: boolean;
    }
  | { type: 'segment'; segment: TalkSegment }
  | { type: 'status'; status: TalkStatus }
  /** Presenter only. */
  | { type: 'stats'; stats: TalkStats }
  | { type: 'language'; language: LanguageCode; unavailable: boolean }
  | { type: 'error'; code: TalkErrorCode; message: string }
  | { type: 'pong'; t?: number };

export const TALK_CLOSE = {
  TALK_NOT_FOUND: 4404,
  TALK_FULL: 4409,
  FORBIDDEN: 4403,
  ENDED: 4001,
  RATE_LIMITED: 4429,
} as const;
