import { useCallback, useEffect, useRef, useState } from 'react';
import { rememberDuration } from '../lib/recording-durations';
import { Segmenter } from '../lib/segmenter';
import { createRecorder, isRecordingSupported, pickMimeType, type MicState } from './useRecorder';

export interface Segment {
  blob: Blob;
  durationMs: number;
}

const TICK_MS = 50;

/**
 * Continuous microphone capture for presenting: once live, it records without tapping and
 * hands over one self-contained recording per spoken segment, cut at natural pauses.
 *
 * Each segment comes from its own MediaRecorder, so every blob is a complete file the
 * server can transcribe on its own. The next recorder starts the moment the previous one
 * stops, at a pause, so no speech falls between segments.
 *
 * Limitation: browsers slow timers in background tabs to about once a second. Recording
 * continues, but pause detection gets coarser, so segments run closer to the length limit.
 */
export function useSegmentedRecorder({
  onSegment,
  audioBitsPerSecond,
}: {
  onSegment: (segment: Segment) => void;
  audioBitsPerSecond?: number;
}) {
  const [state, setState] = useState<MicState>(() =>
    isRecordingSupported() ? 'off' : 'unsupported',
  );
  const [level, setLevel] = useState(0);
  const [hearingSpeech, setHearingSpeech] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const tickRef = useRef<number>(0);
  const segmenterRef = useRef(new Segmenter());
  const onSegmentRef = useRef(onSegment);
  const bitrateRef = useRef(audioBitsPerSecond);
  useEffect(() => {
    onSegmentRef.current = onSegment;
  }, [onSegment]);
  useEffect(() => {
    bitrateRef.current = audioBitsPerSecond;
  }, [audioBitsPerSecond]);

  /** Starts a recorder for the next segment. `keep` decides at stop time whether to emit it. */
  const startSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    const recorder = createRecorder(stream, mimeType, bitrateRef.current);
    const chunks: Blob[] = [];
    const startedAt = performance.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if ((recorder as MediaRecorder & { keep?: boolean }).keep) {
        const durationMs = Math.round(performance.now() - startedAt);
        onSegmentRef.current({
          blob: rememberDuration(
            new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }),
            durationMs,
          ),
          durationMs,
        });
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    segmenterRef.current.reset(performance.now());
  }, []);

  /** Ends the current segment, emitting it if `keep`, and optionally starts the next. */
  const endSegment = useCallback(
    (keep: boolean, next: boolean) => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        (recorder as MediaRecorder & { keep?: boolean }).keep = keep;
        recorder.stop();
      }
      if (next) startSegment();
    },
    [startSegment],
  );

  const stopTicking = useCallback(() => {
    window.clearInterval(tickRef.current);
    setLevel(0);
    setHearingSpeech(false);
  }, []);

  const release = useCallback(() => {
    stopTicking();
    endSegment(false, false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    analyserRef.current = null;
  }, [endSegment, stopTicking]);

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
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      contextRef.current = context;
      analyserRef.current = analyser;
      setState('ready');
    } catch (error) {
      release();
      const name = error instanceof DOMException ? error.name : '';
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  }, [release]);

  /** Go live: record continuously and cut at pauses. */
  const start = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || recorderRef.current) return;
    void contextRef.current?.resume().catch(() => undefined);
    startSegment();
    setState('recording');
    const data = new Uint8Array(analyser.fftSize);
    tickRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const current = Math.min(1, Math.sqrt(sum / data.length) * 4);
      setLevel(current);
      const segmenter = segmenterRef.current;
      const decision = segmenter.feed(current, performance.now());
      setHearingSpeech(segmenter.hasSpeech);
      if (decision === 'cut') endSegment(true, true);
      else if (decision === 'discard') endSegment(false, true);
    }, TICK_MS);
  }, [endSegment, startSegment]);

  /** Pause: send whatever speech is in progress, then stop recording (mic stays on). */
  const pause = useCallback(() => {
    if (!recorderRef.current) return;
    stopTicking();
    endSegment(segmenterRef.current.hasSpeech, false);
    setState('ready');
  }, [endSegment, stopTicking]);

  const disable = useCallback(() => {
    if (recorderRef.current) endSegment(segmenterRef.current.hasSpeech, false);
    release();
    setState(isRecordingSupported() ? 'off' : 'unsupported');
  }, [endSegment, release]);

  return { state, level, hearingSpeech, enable, start, pause, disable };
}
