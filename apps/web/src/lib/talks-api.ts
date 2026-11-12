import type { CreateTalkResponse, LanguageCode, TalkSegment } from '@lingua-bridge/shared';
import { request } from './api';
import { apiUrl } from './config';
import { networkMonitor } from './network-monitor';

export async function createTalk(body: {
  language: LanguageCode;
  title?: string;
}): Promise<CreateTalkResponse> {
  const response = await request('/api/talks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<CreateTalkResponse>;
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

export async function sendTalkSpeech(
  talkId: string,
  key: string,
  body: { clientSegmentId: string; audio: Blob },
  measure = true,
): Promise<TalkSegment> {
  const form = new FormData();
  form.append('clientSegmentId', body.clientSegmentId);
  form.append('audio', body.audio, 'segment');
  const startedAt = performance.now();
  const response = await request(`/api/talks/${encodeURIComponent(talkId)}/segments`, {
    method: 'POST',
    headers: auth(key),
    body: form,
  });
  const segment = (await response.json()) as TalkSegment & { transcribeMs?: number };
  // Retries are answered from memory without transcription, so only first tries are timed.
  if (measure && segment.transcribeMs !== undefined) {
    networkMonitor.addUpload(body.audio.size, performance.now() - startedAt, segment.transcribeMs);
  }
  return segment;
}

export async function sendTalkText(
  talkId: string,
  key: string,
  body: { clientSegmentId: string; text: string },
): Promise<TalkSegment> {
  const response = await request(`/api/talks/${encodeURIComponent(talkId)}/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(key) },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<TalkSegment>;
}

export async function endTalk(talkId: string, key: string): Promise<void> {
  await request(`/api/talks/${encodeURIComponent(talkId)}/end`, {
    method: 'POST',
    headers: auth(key),
  });
}

/** Audio for one caption, synthesized once on the server and shared by its language's listeners. */
export function talkSpeechUrl(talkId: string, segmentId: string, language: LanguageCode): string {
  return apiUrl(
    `/api/talks/${encodeURIComponent(talkId)}/segments/${encodeURIComponent(segmentId)}/speech?language=${language}`,
  );
}

/** The audience link has no secret: anyone in the room may follow along. */
export function audienceLink(talkId: string): string {
  return `${window.location.origin}/t/${encodeURIComponent(talkId)}`;
}

/** The presenter's own link. The key rides in the #fragment, which never reaches servers. */
export function presenterLink(talkId: string, key: string): string {
  return `${window.location.origin}/present/${encodeURIComponent(talkId)}#${key}`;
}
