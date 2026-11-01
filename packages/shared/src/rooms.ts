import type { LanguageCode } from './languages';

/**
 * Two-person conversation rooms.
 *
 * Reliability model:
 * - Sending (speech or text) is an idempotent HTTP POST carrying a client-generated
 *   `clientMessageId`. Retrying after a timeout never creates a duplicate.
 * - The WebSocket only pushes: presence, new messages, and delivery receipts.
 * - Every message has a room-wide `seq`. A reconnecting client sends the last `seq` it
 *   has seen and receives everything after it.
 * - "Delivered" means the other device rendered the message and acknowledged it, never
 *   merely that the server accepted it.
 */

export const ROOM_MAX_PARTICIPANTS = 2;
export const ROOM_MAX_TEXT_CHARS = 500;
export const ROOM_MAX_NAME_CHARS = 40;

export interface CreateRoomResponse {
  roomId: string;
  /** Unguessable join secret. Shared via the link's #fragment, which browsers never send to servers. */
  secret: string;
  idleMinutes: number;
}

export interface Participant {
  id: string;
  name: string;
  language: LanguageCode;
  connected: boolean;
  speaking: boolean;
}

export interface RoomMessage {
  id: string;
  /** Room-wide order, starting at 1. */
  seq: number;
  clientMessageId: string;
  senderId: string;
  kind: 'speech' | 'text';
  sourceLanguage: LanguageCode;
  sourceText: string;
  /** Translations keyed by language. Contains at least the language of every current participant. */
  translations: Partial<Record<LanguageCode, string>>;
  createdAt: string;
  /** Participant ids that have acknowledged rendering this message. */
  deliveredTo: string[];
  timings?: { transcribeMs: number; translateMs: number };
}

/** Body of POST /api/rooms/:roomId/messages (Authorization: Bearer <resumeToken>). */
export interface SendTextRequest {
  clientMessageId: string;
  text: string;
}

// ---------- WebSocket: client → server ----------

export interface HelloMessage {
  type: 'hello';
  roomId: string;
  secret: string;
  language: LanguageCode;
  name?: string;
  /** Present when rejoining as the same participant after a refresh or dropped connection. */
  resumeToken?: string;
  /** Highest `seq` this client already has; the server replays anything newer. */
  lastSeq?: number;
}

export type ClientEvent =
  | HelloMessage
  | { type: 'speaking'; speaking: boolean }
  | { type: 'language'; language: LanguageCode }
  | { type: 'ack'; messageId: string }
  | { type: 'ping' }
  | { type: 'leave' };

// ---------- WebSocket: server → client ----------

export type RoomErrorCode =
  'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'FORBIDDEN' | 'BAD_MESSAGE' | 'RATE_LIMITED' | 'REPLACED';

export type ServerEvent =
  | {
      type: 'welcome';
      participantId: string;
      resumeToken: string;
      participants: Participant[];
      /** Messages after the client's `lastSeq`, translated into its language. */
      messages: RoomMessage[];
    }
  | { type: 'presence'; participants: Participant[] }
  /** A new message, or an update to one already sent (same id), such as a new translation. */
  | { type: 'message'; message: RoomMessage }
  | { type: 'delivered'; messageId: string; participantId: string }
  | { type: 'error'; code: RoomErrorCode; message: string }
  | { type: 'pong' };

/** WebSocket close codes in the application range. */
export const ROOM_CLOSE = {
  ROOM_NOT_FOUND: 4404,
  ROOM_FULL: 4409,
  FORBIDDEN: 4403,
  REPLACED: 4410,
  LEFT: 4000,
  RATE_LIMITED: 4429,
} as const;
