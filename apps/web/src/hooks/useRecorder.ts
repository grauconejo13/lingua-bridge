import { useCallback, useEffect, useRef, useState } from 'react';

export type MicState =
  'off' | 'requesting' | 'ready' | 'recording' | 'denied' | 'unsupported' | 'error';

export interface Recording {
  blob: Blob;
  durationMs: number;
}

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  );
}

/**
 * Explicit, user-initiated microphone access with tap-to-start / tap-to-stop recording.
 *
 * - The microphone is only requested when `enable()` is called from a user action.
 * - `disable()` stops every track so the browser's recording indicator turns off.
 * - Recordings auto-stop at `maxMs` to bound cost.
 * - `level` (0–1) drives a live input meter so people can see the mic is hearing them.
 */
export function useRecorder({
  maxMs,
  onRecorded,
}: {
  maxMs: number;
  onRecorded: (recording: Recording) => void;
}) {
  const [state, setState] = useState<MicState>(() =>
    isRecordingSupported() ? 'off' : 'unsupported',
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number>(0);
  const timerRef = useRef<number>(0);
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    setLevel(0);
  }, []);

  const startMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      // RMS, scaled so normal speech fills most of the meter.
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const release = useCallback(() => {
    window.clearInterval(timerRef.current);
    stopMeter();
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    analyserRef.current = null;
  }, [stopMeter]);

  useEffect(() => release, [release]);

  const enable = useCallback(async () => {
    if (!isRecordingSupported()) {
      setState('unsupported');
      return;
    }
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        audioContextRef.current = context;
        analyserRef.current = analyser;
      } catch {
        // The meter is optional; recording still works without it.
      }
      setState('ready');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  }, []);

  const disable = useCallback(() => {
    release();
    setElapsedMs(0);
    setState(isRecordingSupported() ? 'off' : 'unsupported');
  }, [release]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recorderRef.current?.state === 'recording') return;

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = performance.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      window.clearInterval(timerRef.current);
      stopMeter();
      recorderRef.current = null;
      setElapsedMs(0);
      setState(streamRef.current ? 'ready' : 'off');
      const type = recorder.mimeType || mimeType || 'audio/webm';
      onRecordedRef.current({
        blob: new Blob(chunks, { type }),
        durationMs: Math.round(performance.now() - startedAt),
      });
    };

    recorderRef.current = recorder;
    recorder.start();
    void audioContextRef.current?.resume().catch(() => undefined);
    startMeter();
    setState('recording');
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= maxMs) stop();
    }, 200);
  }, [maxMs, startMeter, stop, stopMeter]);

  return { state, elapsedMs, level, enable, disable, start, stop };
}
