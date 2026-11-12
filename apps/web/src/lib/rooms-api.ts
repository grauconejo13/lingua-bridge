import type { CreateRoomResponse, RoomMessage } from '@lingua-bridge/shared';
import { request } from './api';
import { appendDuration } from './recording-durations';
import { networkMonitor } from './network-monitor';

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
  /** Time this send for the network monitor. Only first attempts are timed (see below). */
  measure = true,
): Promise<RoomMessage> {
  const form = new FormData();
  form.append('clientMessageId', body.clientMessageId);
  form.append('audio', body.audio, 'utterance');
  appendDuration(form, body.audio);
  const startedAt = performance.now();
  const response = await request(`/api/rooms/${encodeURIComponent(roomId)}/utterances`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const message = (await response.json()) as RoomMessage;
  // A retry of a send the server already handled returns the stored message with its old
  // timings and no new work, which would overstate throughput. Callers pass measure=false.
  if (measure && message.timings) {
    networkMonitor.addUpload(
      body.audio.size,
      performance.now() - startedAt,
      message.timings.transcribeMs + message.timings.translateMs,
    );
  }
  return message;
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
