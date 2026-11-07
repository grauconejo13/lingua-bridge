import { describe, expect, it } from 'vitest';
import { Segmenter, type SegmenterDecision } from './segmenter';

/** Feeds a level pattern at 20 Hz and returns the time of each non-continue decision. */
function run(
  segmenter: Segmenter,
  pattern: { level: number; ms: number }[],
): { at: number; decision: SegmenterDecision }[] {
  const events: { at: number; decision: SegmenterDecision }[] = [];
  let now = 0;
  segmenter.reset(now);
  for (const { level, ms } of pattern) {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      const decision = segmenter.feed(level, now);
      if (decision !== 'continue') {
        events.push({ at: now, decision });
        segmenter.reset(now);
      }
    }
  }
  return events;
}

const SPEECH = 0.5;
const QUIET = 0.02;

describe('Segmenter', () => {
  it('cuts at a pause after a sentence', () => {
    const events = run(new Segmenter(), [
      { level: SPEECH, ms: 2000 },
      { level: QUIET, ms: 1000 },
    ]);
    expect(events).toEqual([{ at: 2700, decision: 'cut' }]);
  });

  it('ignores short breaths between words', () => {
    const events = run(new Segmenter(), [
      { level: SPEECH, ms: 1000 },
      { level: QUIET, ms: 300 },
      { level: SPEECH, ms: 1000 },
      { level: QUIET, ms: 800 },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.at).toBe(3000);
  });

  it('does not send a tiny blip', () => {
    const events = run(new Segmenter(), [
      { level: SPEECH, ms: 200 },
      { level: QUIET, ms: 3000 },
    ]);
    expect(events).toEqual([]);
  });

  it('cuts run-on speech at a short pause after the soft limit, and always at the hard limit', () => {
    const soft = run(new Segmenter(), [
      { level: SPEECH, ms: 11_000 },
      { level: QUIET, ms: 300 },
    ]);
    expect(soft[0]).toEqual({ at: 11_250, decision: 'cut' });

    const hard = run(new Segmenter(), [{ level: SPEECH, ms: 16_000 }]);
    expect(hard[0]).toEqual({ at: 15_000, decision: 'cut' });
  });

  it('discards long silence instead of uploading it', () => {
    const events = run(new Segmenter(), [{ level: QUIET, ms: 21_000 }]);
    expect(events).toEqual([{ at: 20_000, decision: 'discard' }]);
  });

  it('raises its threshold in a noisy room', () => {
    const segmenter = new Segmenter();
    const quietThreshold = segmenter.threshold;
    // Steady fan noise at 0.15 counts as speech with the minimum threshold. Once the
    // floor has learned it (one junk segment at most, which transcription drops as
    // silence), the noise alone sends nothing.
    const events = run(segmenter, [{ level: 0.15, ms: 60_000 }]);
    expect(segmenter.threshold).toBeGreaterThan(0.15);
    expect(segmenter.threshold).toBeGreaterThan(quietThreshold);
    expect(events.filter((e) => e.decision === 'cut').length).toBeLessThanOrEqual(1);
    expect(events.filter((e) => e.at > 20_000).every((e) => e.decision === 'discard')).toBe(true);
  });

  it('still hears speech over that noise', () => {
    const segmenter = new Segmenter();
    run(segmenter, [{ level: 0.15, ms: 40_000 }]);
    let now = 40_000;
    segmenter.reset(now);
    const decisions: string[] = [];
    for (const [level, ms] of [
      [0.6, 2000],
      [0.15, 1000],
    ] as const) {
      for (let t = 0; t < ms; t += 50) decisions.push(segmenter.feed(level, (now += 50)));
    }
    expect(decisions).toContain('cut');
  });
});
