import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechTarget } from './useSpeechPlayer';

interface Player {
  play: (target: SpeechTarget) => Promise<void>;
  playingId: string | null;
  loadingId: string | null;
}

/** Older items are dropped so a backlog never turns into minutes of catch-up audio. */
const MAX_QUEUED = 3;

/**
 * Plays translations automatically, one at a time, and only when it is safe.
 *
 * While `blocked` is true (this device is recording, or the other person is speaking),
 * items wait. Playing through the speaker during a recording would be picked up by the
 * microphone and end up in the next transcript.
 */
export function useAutoplayQueue({ player, blocked }: { player: Player; blocked: boolean }) {
  const queueRef = useRef<SpeechTarget[]>([]);
  // Bumped on enqueue so the effect below re-runs; the queue itself lives in the ref.
  const [version, setVersion] = useState(0);

  const enqueue = useCallback((target: SpeechTarget) => {
    queueRef.current = [...queueRef.current, target].slice(-MAX_QUEUED);
    setVersion((v) => v + 1);
  }, []);

  const clear = useCallback(() => {
    queueRef.current = [];
  }, []);

  const { play, playingId, loadingId } = player;
  useEffect(() => {
    if (blocked || playingId || loadingId) return;
    const next = queueRef.current[0];
    if (!next) return;
    queueRef.current = queueRef.current.slice(1);
    void play(next);
  }, [blocked, playingId, loadingId, play, version]);

  return { enqueue, clear };
}
