import { useCallback, useEffect, useRef, useState } from 'react';
import type { LanguageCode } from '@lingua-bridge/shared';
import { ApiClientError, fetchSpeech } from '../lib/api';

export interface SpeechTarget {
  id: string;
  text: string;
  language: LanguageCode;
}

/**
 * Plays translated speech one caption at a time.
 * Audio is cached per caption for this tab only and released on unmount.
 */
export function useSpeechPlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef(new Map<string, string>());
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
    }
    setPlayingId(null);
    setLoadingId(null);
  }, []);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      stop();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, [stop]);

  const play = useCallback(
    async ({ id, text, language }: SpeechTarget) => {
      stop();
      setError(null);
      let url = urlsRef.current.get(id);
      if (!url) {
        const controller = new AbortController();
        abortRef.current = controller;
        setLoadingId(id);
        try {
          const blob = await fetchSpeech({ text, language }, controller.signal);
          url = URL.createObjectURL(blob);
          urlsRef.current.set(id, url);
        } catch (err) {
          if (controller.signal.aborted) return;
          setLoadingId(null);
          setError({
            id,
            message: err instanceof ApiClientError ? err.message : "Couldn't load speech.",
          });
          return;
        }
        if (controller.signal.aborted) return;
        abortRef.current = null;
        setLoadingId(null);
      }

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPlayingId(null);
        }
      };
      setPlayingId(id);
      try {
        await audio.play();
      } catch {
        // Usually autoplay blocked: playback needs a direct tap on this device.
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPlayingId(null);
          setError({ id, message: 'Tap Play to hear this translation.' });
        }
      }
    },
    [stop],
  );

  const forget = useCallback(() => {
    stop();
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current.clear();
    setError(null);
  }, [stop]);

  return { play, stop, forget, playingId, loadingId, error };
}
