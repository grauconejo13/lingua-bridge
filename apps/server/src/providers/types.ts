import type { Language, ProviderId } from '@lingua-bridge/shared';

export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  language: Language;
}

export interface TranslateInput {
  text: string;
  from: Language;
  to: Language;
}

export interface SynthesizeInput {
  text: string;
  language: Language;
}

export interface SynthesizedAudio {
  audio: Buffer;
  mimeType: string;
}

/**
 * A speech-to-text → translation → text-to-speech pipeline.
 *
 * Milestone 1 uses this three-step shape because each step can be measured and swapped
 * on its own. A direct speech-to-speech provider can be added later behind the same
 * pipeline service once both approaches are benchmarked (see docs/DECISIONS.md).
 */
export interface SpeechProvider {
  readonly id: ProviderId;
  /** True when output is placeholder text, not real translation. */
  readonly demoMode: boolean;
  transcribe(input: TranscribeInput): Promise<{ text: string }>;
  translate(input: TranslateInput): Promise<{ text: string }>;
  synthesize(input: SynthesizeInput): Promise<SynthesizedAudio>;
}
