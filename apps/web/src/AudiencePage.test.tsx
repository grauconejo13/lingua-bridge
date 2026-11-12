import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkClientEvent, TalkSegment, TalkServerEvent } from '@lingua-bridge/shared';
import { App } from './App';

/** A WebSocket stand-in the test can push server events through. */
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeSocket | undefined;
  readyState = 0;
  sent: TalkClientEvent[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((c: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as TalkClientEvent);
  }
  close() {
    this.readyState = 3;
  }
  push(event: TalkServerEvent) {
    act(() => this.onmessage?.({ data: JSON.stringify(event) }));
  }
  drop(code: number) {
    act(() => this.onclose?.({ code }));
  }
}

const talk = {
  id: 'talk1',
  title: 'Board meeting',
  language: 'en' as const,
  status: 'live' as const,
  maxLanguages: 6,
};
const segment = (seq: number, patch: Partial<TalkSegment> = {}): TalkSegment => ({
  id: `s${seq}`,
  seq,
  sourceLanguage: 'en',
  sourceText: `Hello ${seq}`,
  language: 'es',
  text: `Hola ${seq}`,
  createdAt: new Date(0).toISOString(),
  ...patch,
});

beforeEach(() => {
  localStorage.setItem('lingua-bridge:talkLanguage', JSON.stringify('es'));
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        status: 'ok',
        provider: 'openai',
        demoMode: false,
        limits: { maxAudioBytes: 1, maxTtsChars: 1 },
      }),
    ),
  );
  window.history.pushState({}, '', '/t/talk1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

async function open() {
  render(<App />);
  await act(async () => undefined);
  return FakeSocket.last!;
}

describe('audience page', () => {
  it('joins as a listener in the saved language, with no presenter key', async () => {
    const socket = await open();
    expect(socket.url).toMatch(/\/api\/talks\/ws$/);
    expect(socket.sent[0]).toEqual({ type: 'hello', talkId: 'talk1', language: 'es', lastSeq: 0 });
  });

  it('shows captions in the listener language and announces new ones', async () => {
    const socket = await open();
    socket.push({ type: 'welcome', role: 'listener', talk, segments: [segment(1)] });
    expect(screen.getByText('Board meeting')).toBeInTheDocument();
    expect(screen.getByText('Hola 1')).toHaveAttribute('lang', 'es');

    socket.push({ type: 'segment', segment: segment(2) });
    expect(screen.getByText('Hola 2', { selector: '.talk-caption p' })).toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Hola 2');
  });

  it('falls back to the original and says so', async () => {
    const socket = await open();
    socket.push({
      type: 'welcome',
      role: 'listener',
      talk,
      segments: [segment(1, { text: null })],
    });
    expect(screen.getByText('Hello 1')).toHaveAttribute('lang', 'en');
    expect(screen.getByText(/translation unavailable/i)).toBeInTheDocument();
  });

  it('explains the language limit', async () => {
    const socket = await open();
    socket.push({
      type: 'welcome',
      role: 'listener',
      talk,
      segments: [],
      languageUnavailable: true,
    });
    expect(screen.getByText(/limit of 6/)).toBeInTheDocument();
  });

  it('switches language over the open socket', async () => {
    const socket = await open();
    socket.push({ type: 'welcome', role: 'listener', talk, segments: [] });
    await userEvent.selectOptions(screen.getByLabelText('Read in'), 'fr');
    expect(socket.sent.at(-1)).toEqual({ type: 'language', language: 'fr' });
  });

  it('keeps captions on screen after the talk ends', async () => {
    const socket = await open();
    socket.push({ type: 'welcome', role: 'listener', talk, segments: [segment(1)] });
    socket.push({ type: 'status', status: 'ended' });
    socket.drop(4001);
    expect(screen.getByText(/presentation has ended/i)).toBeInTheDocument();
    expect(screen.getByText('Hola 1')).toBeInTheDocument();
  });
});
