import { describe, expect, it } from 'vitest';
import type { RoomMessage } from '@lingua-bridge/shared';
import { initialRoomState, roomReducer, upsertMessage } from './room-state';

const message = (seq: number, patch: Partial<RoomMessage> = {}): RoomMessage => ({
  id: `m${seq}`,
  seq,
  clientMessageId: `client-${seq}`,
  senderId: 'a',
  kind: 'text',
  sourceLanguage: 'en',
  sourceText: `hello ${seq}`,
  translations: { en: `hello ${seq}` },
  createdAt: new Date(0).toISOString(),
  deliveredTo: [],
  ...patch,
});

describe('upsertMessage', () => {
  it('keeps messages in seq order even when they arrive out of order', () => {
    const list = upsertMessage(upsertMessage([], message(2)), message(1));
    expect(list.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('merges a late copy instead of losing receipts or translations', () => {
    const delivered = message(1, { deliveredTo: ['b'], translations: { en: 'hi', ja: 'やあ' } });
    const staleHttpCopy = message(1, { translations: { en: 'hi' } });
    const [merged] = upsertMessage([delivered], staleHttpCopy);
    expect(merged!.deliveredTo).toEqual(['b']);
    expect(merged!.translations.ja).toBe('やあ');
  });
});

describe('roomReducer', () => {
  it('becomes open on welcome and tracks the last seq', () => {
    const state = roomReducer(initialRoomState, {
      type: 'server',
      event: {
        type: 'welcome',
        participantId: 'b',
        resumeToken: 't',
        participants: [],
        messages: [message(1), message(3)],
      },
    });
    expect(state.status).toBe('open');
    expect(state.participantId).toBe('b');
    expect(state.lastSeq).toBe(3);
  });

  it('records delivery receipts once', () => {
    let state = roomReducer(initialRoomState, {
      type: 'server',
      event: { type: 'message', message: message(1) },
    });
    for (let i = 0; i < 2; i++) {
      state = roomReducer(state, {
        type: 'server',
        event: { type: 'delivered', messageId: 'm1', participantId: 'b' },
      });
    }
    expect(state.messages[0]!.deliveredTo).toEqual(['b']);
  });

  it('treats a full room as final and ignores later reconnect attempts', () => {
    let state = roomReducer(initialRoomState, {
      type: 'server',
      event: { type: 'error', code: 'ROOM_FULL', message: 'Full.' },
    });
    state = roomReducer(state, { type: 'status', status: 'reconnecting' });
    expect(state.status).toBe('closed');
    expect(state.fatal).toEqual({ code: 'ROOM_FULL', message: 'Full.' });
  });

  it('keeps the server message when the close event arrives after the error', () => {
    let state = roomReducer(initialRoomState, {
      type: 'server',
      event: { type: 'error', code: 'FORBIDDEN', message: 'Bad link.' },
    });
    state = roomReducer(state, { type: 'fatal', code: 'FORBIDDEN', message: '' });
    expect(state.fatal?.message).toBe('Bad link.');
  });

  it('does not bring cleared messages back on replay', () => {
    let state = roomReducer(initialRoomState, {
      type: 'server',
      event: { type: 'message', message: message(1) },
    });
    state = roomReducer(state, { type: 'clear' });
    state = roomReducer(state, {
      type: 'server',
      event: {
        type: 'welcome',
        participantId: 'b',
        resumeToken: 't',
        participants: [],
        messages: [message(1), message(2)],
      },
    });
    expect(state.messages.map((m) => m.seq)).toEqual([2]);
  });
});
