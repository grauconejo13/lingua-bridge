/**
 * Splits continuous speech into caption-sized segments at natural pauses.
 *
 * Fed the microphone level (0–1) about 20 times a second, it says when to end the current
 * segment. A presenter shouldn't have to tap for every sentence, and listeners should see
 * captions arrive every few seconds rather than once a minute.
 *
 * - A segment ends after a pause of `pauseMs`, once it holds enough speech to be worth
 *   transcribing.
 * - Long run-on speech is cut at a shorter pause after `softMaxMs`, and unconditionally at
 *   `hardMaxMs`, so captions keep flowing.
 * - Stretches with no speech are discarded instead of uploaded, which saves bandwidth and
 *   transcription cost while the presenter is quiet.
 *
 * The voice threshold adapts to background noise. The noise floor follows the quietest
 * level of the last few seconds: speech has gaps between words and steady noise (a fan,
 * a projector) doesn't, so the minimum tracks the room, not the voice.
 */

export interface SegmenterOptions {
  minThreshold: number;
  /** How far above the noise floor counts as voice. */
  noiseMargin: number;
  pauseMs: number;
  /** After this long, a shorter pause (`softPauseMs`) is enough to cut. */
  softMaxMs: number;
  softPauseMs: number;
  hardMaxMs: number;
  /** Minimum voiced time for a segment to be sent at all. */
  minVoiceMs: number;
  /** Minimum segment length before a pause can end it. */
  minSegmentMs: number;
  /** Silent stretches are thrown away after this long. */
  discardSilenceMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  minThreshold: 0.08,
  noiseMargin: 0.06,
  pauseMs: 700,
  softMaxMs: 10_000,
  softPauseMs: 250,
  hardMaxMs: 15_000,
  minVoiceMs: 400,
  minSegmentMs: 1_200,
  discardSilenceMs: 20_000,
};

export type SegmenterDecision = 'continue' | 'cut' | 'discard';

export class Segmenter {
  private readonly options: SegmenterOptions;
  private segmentStart = 0;
  private lastTick = 0;
  private lastVoiceAt = 0;
  private voicedMs = 0;
  private noiseFloor = 0.02;
  /** Recent levels for the windowed minimum (about 3 s at 20 Hz). */
  private recent: number[] = [];
  private static readonly FLOOR_WINDOW = 60;
  /** Noise louder than this would drown speech anyway; capping keeps loud talkers voiced. */
  private static readonly MAX_FLOOR = 0.3;
  private started = false;

  constructor(options: Partial<SegmenterOptions> = {}) {
    this.options = { ...DEFAULT_SEGMENTER, ...options };
  }

  get threshold(): number {
    return Math.max(this.options.minThreshold, this.noiseFloor + this.options.noiseMargin);
  }

  /** Whether the current segment has enough speech to send. */
  get hasSpeech(): boolean {
    return this.voicedMs >= this.options.minVoiceMs;
  }

  /** Start a new segment at `now`, keeping the learned noise floor. */
  reset(now: number): void {
    this.segmentStart = now;
    this.lastTick = now;
    this.lastVoiceAt = now;
    this.voicedMs = 0;
    this.started = true;
  }

  feed(level: number, now: number): SegmenterDecision {
    if (!this.started) this.reset(now);
    const dt = Math.max(0, Math.min(now - this.lastTick, 500));
    this.lastTick = now;

    this.recent.push(level);
    if (this.recent.length > Segmenter.FLOOR_WINDOW) this.recent.shift();
    const windowMin = Math.min(...this.recent);
    // Drop to a quieter room at once; rise over about ten seconds, so a long unbroken
    // sentence can't lift it far.
    this.noiseFloor = Math.min(
      Segmenter.MAX_FLOOR,
      windowMin < this.noiseFloor
        ? windowMin
        : this.noiseFloor + (windowMin - this.noiseFloor) * 0.005,
    );

    const voiced = level >= this.threshold;
    if (voiced) {
      this.voicedMs += dt;
      this.lastVoiceAt = now;
    }

    const o = this.options;
    const length = now - this.segmentStart;
    const silentFor = now - this.lastVoiceAt;

    if (!this.hasSpeech) {
      return length >= o.discardSilenceMs ? 'discard' : 'continue';
    }
    if (length >= o.hardMaxMs) return 'cut';
    if (length >= o.minSegmentMs && silentFor >= o.pauseMs) return 'cut';
    if (length >= o.softMaxMs && silentFor >= o.softPauseMs) return 'cut';
    return 'continue';
  }
}
