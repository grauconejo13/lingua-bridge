import type { CreateRoomResponse, RoomMessage } from '@lingua-bridge/shared';
import { request } from './api';

export async function createRoom(): Promise<CreateRoomResponse> {
  return (await request('/api/rooms', { method: 'POST' })).json() as Promise<CreateRoomResponse>;
}

export async function sendRoomText(
  roomId: string,
  token: string,
  body: { clientMessageId: string; text: string },
): Promise<RoomMessage> {
  const response = await request(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<RoomMessage>;
}

export async function sendRoomSpeech(
  roomId: string,
  token: string,
  body: { clientMessageId: string; audio: Blob },
): Promise<RoomMessage> {
  const form = new FormData();
  form.append('clientMessageId', body.clientMessageId);
  form.append('audio', body.audio, 'utterance');
  const response = await request(`/api/rooms/${encodeURIComponent(roomId)}/utterances`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return response.json() as Promise<RoomMessage>;
}

/** Ids for idempotent sends: unique per message, stable across retries. */
export function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The shareable link. The secret rides in the #fragment so it never reaches server logs. */
export function roomLink(roomId: string, secret: string): string {
  return `${window.location.origin}/r/${encodeURIComponent(roomId)}#${secret}`;
}
