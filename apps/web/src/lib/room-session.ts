import { isLanguageCode, type LanguageCode } from '@lingua-bridge/shared';

/**
 * This device's seat in a conversation, so a refresh, a closed tab or a brief network drop
 * rejoins as the same person instead of taking a new seat.
 *
 * Holds only the chosen language, display name and resume token, never messages, and
 * expires on its own well after the server would have ended the room.
 */
export interface RoomSession {
  language: LanguageCode;
  name: string;
  resumeToken?: string;
}

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const key = (roomId: string) => `lingua-bridge:room:${roomId}`;

export function readRoomSession(roomId: string): RoomSession | undefined {
  try {
    const raw = localStorage.getItem(key(roomId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<RoomSession> & { savedAt?: number };
    if (!isLanguageCode(value.language)) return undefined;
    if (typeof value.savedAt !== 'number' || Date.now() - value.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key(roomId));
      return undefined;
    }
    return {
      language: value.language,
      name: typeof value.name === 'string' ? value.name : '',
      resumeToken: typeof value.resumeToken === 'string' ? value.resumeToken : undefined,
    };
  } catch {
    return undefined;
  }
}

export function writeRoomSession(roomId: string, session: RoomSession): void {
  try {
    localStorage.setItem(key(roomId), JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {
    // Without storage a reload joins as a new participant; the room still works.
  }
}

export function clearRoomSession(roomId: string): void {
  try {
    localStorage.removeItem(key(roomId));
  } catch {
    // Ignore.
  }
}
