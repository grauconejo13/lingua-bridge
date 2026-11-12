import { describe, expect, it } from 'vitest';
import type { TalkInfo, TalkSegment } from '@lingua-bridge/shared';
import { captionText, initialTalkState, talkReducer, type TalkState } from './talk-state';

const talk: TalkInfo = { id: 't1', title: 'Demo', language: 'en', status: 'live', maxLanguages: 6 };
const seg = (seq: number, patch: Partial<TalkSegment> = {}): TalkSegment => ({
  id: `s${seq}`,
  seq,
  sourceLanguage: 'en',
  sourceText: `Line ${seq}`,
  language: 'es',
  text: `Línea ${seq}`,
  createdAt: new Date(0).toISOString(),
  ...patch,
});

const welcome = (segments: TalkSegment[], extra: Partial<{ languageUnavailable: boolean }> = {}) =>
  talkReducer(initialTalkState, {
    type: 'server',
    event: { type: 'welcome', role: 'listener', talk, segments, ...extra },
  });

describe('talkReducer', () => {
  it('opens on welcome with the replayed captions', () => {
    const state = welcome([seg(1), seg(2)]);
    expect(state.status).toBe('open');
    expect(state.segments.map((s) => s.seq)).toEqual([1, 2]);
  });

  it('replaces a caption when its translation arrives, without duplicating it', () => {
    let state = welcome([]);
    state = talkReducer(state, {
      type: 'server',
      event: { type: 'segment', segment: seg(1, { text: null }) },
    });
    state = talkReducer(state, { type: 'server', event: { type: 'segment', segment: seg(1) } });
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]!.text).toBe('Línea 1');
  });

  it('keeps captions in spoken order when translations finish out of order', () => {
    let state: TalkState = welcome([seg(1)]);
    state = talkReducer(state, { type: 'server', event: { type: 'segment', segment: seg(3) } });
    state = talkReducer(state, { type: 'server', event: { type: 'segment', segment: seg(2) } });
    expect(state.segments.map((s) => s.seq)).toEqual([1, 2, 3]);
  });

  it('merges a replay after reconnecting', () => {
    let state = welcome([seg(1), seg(2)]);
    state = talkReducer(state, { type: 'status', status: 'reconnecting' });
    state = talkReducer(state, {
      type: 'server',
      event: { type: 'welcome', role: 'listener', talk, segments: [seg(2), seg(3)] },
    });
    expect(state.status).toBe('open');
    expect(state.segments.map((s) => s.seq)).toEqual([1, 2, 3]);
  });

  it('tracks status, stats and the language limit', () => {
    let state = welcome([], { languageUnavailable: true });
    expect(state.languageUnavailable).toBe(true);
    state = talkReducer(state, {
      type: 'server',
      event: { type: 'language', language: 'fr', unavailable: false },
    });
    expect(state.languageUnavailable).toBe(false);
    state = talkReducer(state, { type: 'server', event: { type: 'status', status: 'paused' } });
    expect(state.talk?.status).toBe('paused');
  });

  it('keeps a fatal state once closed', () => {
    let state = talkReducer(welcome([]), { type: 'fatal', code: 'ENDED', message: '' });
    state = talkReducer(state, { type: 'status', status: 'reconnecting' });
    expect(state.status).toBe('closed');
    expect(state.fatal?.code).toBe('ENDED');
  });
});

describe('captionText', () => {
  it('shows the translation, or the original marked as a fallback', () => {
    expect(captionText(seg(1))).toEqual({ text: 'Línea 1', language: 'es', fallback: false });
    expect(captionText(seg(1, { text: null }))).toEqual({
      text: 'Line 1',
      language: 'en',
      fallback: true,
    });
    expect(captionText(seg(1, { language: 'en', text: 'Line 1' })).fallback).toBe(false);
  });
});
