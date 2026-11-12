import { useCallback, useEffect, useRef, useState } from 'react';

/** If more captions than this are waiting, skip ahead: a listener wants the present, not a backlog. */
const MAX_BACKLOG = 2;

/**
 * Plays caption audio one clip at a time from URLs. The server synthesizes each caption once
 * per language and every listener of that language fetches the same URL.
 */
export function useCaptionAudio({ enabled }: { enabled: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<{ id: string; url: string }[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(enabled);

  const stop = useCallback(() => {
    queueRef.current = [];
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }, []);

  const nextRef = useRef<() => void>(() => undefined);
  const next = useCallback(() => {
    const item = queueRef.current.shift();
    if (!item) {
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    const audio = new Audio(item.url);
    audioRef.current = audio;
    setPlayingId(item.id);
    audio.onended = () => nextRef.current();
    audio.onerror = () => {
      setError("Couldn't play a caption's audio.");
      nextRef.current();
    };
    audio.play().catch(() => {
      // Autoplay blocked until the listener interacts with the page.
      setError('Tap anywhere on the page to allow audio, then turn it on again.');
      stop();
    });
  }, [stop]);

  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      // Turning autoplay off stops the current clip; its ended handler clears the state.
      queueRef.current = [];
      const audio = audioRef.current;
      audio?.pause();
      audio?.dispatchEvent(new Event('ended'));
    }
  }, [enabled]);

  useEffect(() => stop, [stop]);

  const enqueue = useCallback(
    (id: string, url: string) => {
      if (!enabledRef.current) return;
      setError(null);
      queueRef.current.push({ id, url });
      if (queueRef.current.length > MAX_BACKLOG) {
        queueRef.current = queueRef.current.slice(-MAX_BACKLOG);
      }
      if (!audioRef.current) next();
    },
    [next],
  );

  /** Play one caption now, interrupting whatever is playing. */
  const playNow = useCallback(
    (id: string, url: string) => {
      stop();
      queueRef.current = [{ id, url }];
      next();
    },
    [next, stop],
  );

  return { enqueue, playNow, stop, playingId, error };
}
