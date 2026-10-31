import type { SpeechProvider, SynthesizeInput, TranscribeInput, TranslateInput } from './types';

/**
 * A provider that makes no network calls and needs no API key.
 *
 * It cannot understand audio. It cycles through a few sample sentences so the full
 * UI flow can be demonstrated and tested; the server reports `demoMode: true` and the
 * client labels every result as a demo. Never present mock output as real translation.
 */

/** Index-aligned sample sentences, so a "translation" between these languages is consistent. */
const SAMPLES: Record<string, readonly string[]> = {
  en: [
    'Can everyone hear me clearly?',
    "Let's start with a quick overview.",
    'Could you repeat the last part, please?',
  ],
  es: [
    '¿Todos me escuchan bien?',
    'Empecemos con un resumen rápido.',
    '¿Podrías repetir la última parte, por favor?',
  ],
  fr: [
    "Est-ce que tout le monde m'entend bien ?",
    'Commençons par un bref aperçu.',
    'Pourriez-vous répéter la dernière partie, s’il vous plaît ?',
  ],
  ja: [
    '皆さん、はっきり聞こえますか？',
    'まず簡単な概要から始めましょう。',
    '最後の部分をもう一度言っていただけますか？',
  ],
};

const SAMPLE_COUNT = 3;

/** Recordings smaller than this are treated as an accidental tap with no speech. */
export const MOCK_MIN_AUDIO_BYTES = 512;

export class MockProvider implements SpeechProvider {
  readonly id = 'mock' as const;
  readonly demoMode = true;
  private next = 0;

  async transcribe({ audio, language }: TranscribeInput): Promise<{ text: string }> {
    if (audio.byteLength < MOCK_MIN_AUDIO_BYTES) return { text: '' };
    const index = this.next;
    this.next = (this.next + 1) % SAMPLE_COUNT;
    const samples = SAMPLES[language.code];
    if (samples?.[index]) return { text: samples[index] };
    return { text: `[demo ${language.code}] ${SAMPLES.en?.[index] ?? ''}` };
  }

  async translate({ text, from, to }: TranslateInput): Promise<{ text: string }> {
    const index = SAMPLES[from.code]?.indexOf(text) ?? -1;
    const target = index >= 0 ? SAMPLES[to.code]?.[index] : undefined;
    return { text: target ?? `[demo ${from.code}→${to.code}] ${text}` };
  }

  async synthesize({ text }: SynthesizeInput): Promise<{ audio: Buffer; mimeType: string }> {
    // A soft two-note chime whose length loosely tracks the text, so playback is audible.
    const seconds = Math.min(1.6, 0.4 + text.length * 0.01);
    return { audio: chimeWav(seconds), mimeType: 'audio/wav' };
  }
}

/** 16-bit mono PCM WAV containing a gentle two-tone chime with fade in/out. */
export function chimeWav(seconds: number, sampleRate = 16000): Buffer {
  const sampleCount = Math.max(1, Math.round(seconds * sampleRate));
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  const fade = Math.min(sampleCount / 4, sampleRate * 0.05);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const frequency = i < sampleCount / 2 ? 660 : 880;
    const envelope = Math.min(1, i / fade, (sampleCount - i) / fade);
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.2 * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}
