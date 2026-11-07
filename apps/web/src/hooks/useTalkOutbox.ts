import { useCallback, useEffect, useRef, useState } from 'react';
import { ROOM_CLIENT_TIMING, type TalkSegment } from '@lingua-bridge/shared';
import { ApiClientError } from '../lib/api';
import { newClientMessageId } from '../lib/rooms-api';
import { sendTalkSpeech, sendTalkText } from '../lib/talks-api';

export interface OutgoingSegment {
  clientSegmentId: string;
  kind: 'speech' | 'text';
  audio?: Blob;
  text?: string;
  status: 'waiting' | 'sending' | 'retrying' | 'failed';
  error?: string;
}

/**
 * The presenter's send queue. Segments go one at a time, in order, so captions reach the
 * audience in the order they were spoken. A retryable failure keeps its place at the front
 * and retries with backoff (sends are idempotent, so nothing duplicates); a permanent one is
 * set aside so it doesn't block the rest.
 */
export function useTalkOutbox({
  talkId,
  presenterKey,
  onSent,
  enabled,
}: {
  talkId: string;
  presenterKey: string;
  onSent: (segment: TalkSegment) => void;
  enabled: boolean;
}) {
  const [items, setItems] = useState<OutgoingSegment[]>([]);
  const itemsRef = useRef(items);
  const busyRef = useRef(false);
  const attemptsRef = useRef(new Map<string, number>());
  const timerRef = useRef<number | undefined>(undefined);
  const onSentRef = useRef(onSent);
  useEffect(() => {
    onSentRef.current = onSent;
  }, [onSent]);

  const update = useCallback((next: OutgoingSegment[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const patch = useCallback(
    (id: string, change: Partial<OutgoingSegment> | null) => {
      update(
        change === null
          ? itemsRef.current.filter((i) => i.clientSegmentId !== id)
          : itemsRef.current.map((i) => (i.clientSegmentId === id ? { ...i, ...change } : i)),
      );
    },
    [update],
  );

  const pumpRef = useRef<() => Promise<void>>(async () => undefined);
  const pump = useCallback(async () => {
    if (busyRef.current || !enabled) return;
    const item = itemsRef.current.find((i) => i.status === 'waiting' || i.status === 'retrying');
    if (!item) return;
    busyRef.current = true;
    const attempts = attemptsRef.current.get(item.clientSegmentId) ?? 0;
    attemptsRef.current.set(item.clientSegmentId, attempts + 1);
    patch(item.clientSegmentId, { status: 'sending', error: undefined });
    try {
      const segment =
        item.kind === 'text'
          ? await sendTalkText(talkId, presenterKey, {
              clientSegmentId: item.clientSegmentId,
              text: item.text ?? '',
            })
          : await sendTalkSpeech(
              talkId,
              presenterKey,
              { clientSegmentId: item.clientSegmentId, audio: item.audio! },
              attempts === 0,
            );
      attemptsRef.current.delete(item.clientSegmentId);
      patch(item.clientSegmentId, null);
      onSentRef.current(segment);
    } catch (error) {
      const apiError =
        error instanceof ApiClientError ? error : new ApiClientError('INTERNAL', 'Send failed.');
      if (apiError.code === 'NO_SPEECH') {
        // Background noise that looked like speech. Nothing to show.
        patch(item.clientSegmentId, null);
      } else if (apiError.retryable) {
        patch(item.clientSegmentId, { status: 'retrying', error: apiError.message });
        const delays = ROOM_CLIENT_TIMING.sendRetryMs;
        const delay = delays[Math.min(attempts, delays.length - 1)]!;
        busyRef.current = false;
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void pumpRef.current(), delay);
        return;
      } else {
        patch(item.clientSegmentId, { status: 'failed', error: apiError.message });
      }
    }
    busyRef.current = false;
    void pumpRef.current();
  }, [enabled, patch, presenterKey, talkId]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  useEffect(() => {
    void pump();
  }, [items.length, pump]);

  // Back online: don't wait out the backoff.
  useEffect(() => {
    const onOnline = () => {
      window.clearTimeout(timerRef.current);
      void pump();
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearTimeout(timerRef.current);
    };
  }, [pump]);

  const add = useCallback(
    (item: { kind: 'speech'; audio: Blob } | { kind: 'text'; text: string }) => {
      update([
        ...itemsRef.current,
        { ...item, clientSegmentId: newClientMessageId(), status: 'waiting' },
      ]);
    },
    [update],
  );

  const retry = useCallback(
    (id: string) => patch(id, { status: 'waiting', error: undefined }),
    [patch],
  );
  const discard = useCallback((id: string) => patch(id, null), [patch]);

  return { items, add, retry, discard };
}
