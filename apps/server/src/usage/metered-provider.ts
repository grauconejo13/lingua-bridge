import type { ProviderOperation } from '@lingua-bridge/shared';
import type {
  SpeechProvider,
  SynthesizeInput,
  SynthesizedAudio,
  TranscribeInput,
  TranslateInput,
} from '../providers/types';
import type { UsageMeter } from './meter';

/** Without a client-reported duration, assume this bitrate (the middle Opus tier). */
const FALLBACK_BITS_PER_SECOND = 20_000;
/** A reported duration can't exceed the longest recording the clients make, plus slack. */
const MAX_REPORTED_MINUTES = 1;

export function audioMinutes(input: TranscribeInput): number {
  if (input.durationMs !== undefined && Number.isFinite(input.durationMs) && input.durationMs > 0) {
    return Math.min(input.durationMs / 60_000, MAX_REPORTED_MINUTES);
  }
  return (input.audio.byteLength * 8) / FALLBACK_BITS_PER_SECOND / 60;
}

/**
 * Wraps a provider so every call is checked against the budget, timed, and counted. Every
 * feature (solo, conversations, presentations) goes through it, so the cap can't be bypassed
 * by using a different screen.
 */
export class MeteredProvider implements SpeechProvider {
  readonly id: SpeechProvider['id'];
  readonly demoMode: boolean;

  constructor(
    private readonly inner: SpeechProvider,
    private readonly meter: UsageMeter,
  ) {
    this.id = inner.id;
    this.demoMode = inner.demoMode;
  }

  private async run<T>(
    op: ProviderOperation,
    call: () => Promise<T>,
    measure: (result: T | undefined) => { units: number; costUsd: number },
  ): Promise<T> {
    this.meter.check(op);
    const started = performance.now();
    try {
      const result = await call();
      this.meter.record(op, {
        ok: true,
        ms: Math.round(performance.now() - started),
        ...measure(result),
      });
      return result;
    } catch (error) {
      // Failed calls are usually not billed; count them, cost nothing.
      this.meter.record(op, {
        ok: false,
        ms: Math.round(performance.now() - started),
        units: 0,
        costUsd: 0,
      });
      throw error;
    }
  }

  transcribe(input: TranscribeInput): Promise<{ text: string }> {
    const minutes = audioMinutes(input);
    return this.run(
      'transcribe',
      () => this.inner.transcribe(input),
      () => ({
        units: minutes,
        costUsd: this.inner.demoMode ? 0 : this.meter.estimate('transcribe', { minutes }),
      }),
    );
  }

  translate(input: TranslateInput): Promise<{ text: string }> {
    return this.run(
      'translate',
      () => this.inner.translate(input),
      (result) => ({
        units: input.text.length,
        costUsd: this.inner.demoMode
          ? 0
          : this.meter.estimate('translate', {
              inChars: input.text.length,
              outChars: result?.text.length ?? 0,
            }),
      }),
    );
  }

  synthesize(input: SynthesizeInput): Promise<SynthesizedAudio> {
    return this.run(
      'synthesize',
      () => this.inner.synthesize(input),
      () => ({
        units: input.text.length,
        costUsd: this.inner.demoMode
          ? 0
          : this.meter.estimate('synthesize', { inChars: input.text.length }),
      }),
    );
  }
}
