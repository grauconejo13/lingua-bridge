import { describe, expect, it, vi } from 'vitest';
import type { LanguageCode, TalkServerEvent } from '@lingua-bridge/shared';
import { MockProvider } from '../src/providers/mock';
import type { Connection } from '../src/rooms/store';
import { TalkService, cleanTitle, type TalkMember } from '../src/talks/service';
import { TalkStore } from '../src/talks/store';
import { fakeAudio } from './helpers';

class StubConnection implements Connection {
  events: TalkServerEvent[] = [];
  closed: number | undefined;
  send(data: string) {
    this.events.push(JSON.parse(data) as TalkServerEvent);
  }
  close(code: number) {
    this.closed = code;
  }
  of<T extends TalkServerEvent['type']>(type: T) {
    return this.events.filter((e) => e.type === type) as Extract<TalkServerEvent, { type: T }>[];
  }
  last<T extends TalkServerEvent['type']>(type: T) {
    return this.of(type).at(-1);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  options: { maxListeners?: number; maxLanguages?: number; provider?: MockProvider } = {},
) {
  const store = new TalkStore({
    maxTalks: 5,
    idleMs: 60_000,
    maxLanguages: options.maxLanguages ?? 3,
  });
  const provider = options.provider ?? new MockProvider();
  const service = new TalkService(store, provider, {
    maxListeners: options.maxListeners ?? 50,
    statsIntervalMs: 0,
  });
  const { talk, key } = store.create({ title: 'Quarterly review', language: 'en' })!;
  return { store, service, talk, key, provider };
}

async function listen(
  ctx: ReturnType<typeof setup>,
  language: LanguageCode,
  lastSeq?: number,
): Promise<{ conn: StubConnection; member: TalkMember }> {
  const conn = new StubConnection();
  const member = await ctx.service.hello(conn, {
    type: 'hello',
    talkId: ctx.talk.id,
    language,
    lastSeq,
  });
  return { conn, member };
}

async function present(ctx: ReturnType<typeof setup>) {
  const conn = new StubConnection();
  const member = await ctx.service.hello(conn, {
    type: 'hello',
    talkId: ctx.talk.id,
    presenterKey: ctx.key,
  });
  return { conn, member };
}

describe('TalkStore', () => {
  it('gives each talk an id and a separate presenter key', () => {
    const store = new TalkStore({ maxTalks: 2, idleMs: 1000, maxLanguages: 3 });
    const a = store.create({ title: 'A', language: 'en' })!;
    const b = store.create({ title: 'B', language: 'en' })!;
    expect(a.talk.id).not.toBe(b.talk.id);
    expect(a.key.length).toBeGreaterThanOrEqual(20);
    expect(a.talk.checkKey(a.key)).toBe(true);
    expect(a.talk.checkKey(b.key)).toBe(false);
    expect(a.talk.checkKey(undefined)).toBe(false);
    expect(store.create({ title: 'C', language: 'en' })).toBeUndefined();
  });

  it('cleans titles', () => {
    expect(cleanTitle('  Hello\u0007   world ')).toBe('Hello world');
    expect(cleanTitle('')).toBe('Untitled talk');
    expect(cleanTitle('x'.repeat(200))).toHaveLength(80);
  });
});

describe('TalkService', () => {
  it('rejects a wrong presenter key and unknown talks', async () => {
    const ctx = setup();
    await expect(
      ctx.service.hello(new StubConnection(), {
        type: 'hello',
        talkId: ctx.talk.id,
        presenterKey: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      ctx.service.hello(new StubConnection(), { type: 'hello', talkId: 'missing', language: 'es' }),
    ).rejects.toMatchObject({ code: 'TALK_NOT_FOUND' });
  });

  it('caps the audience', async () => {
    const ctx = setup({ maxListeners: 1 });
    await listen(ctx, 'es');
    await expect(listen(ctx, 'fr')).rejects.toMatchObject({ code: 'TALK_FULL' });
  });

  it('sends each listener only its own language', async () => {
    const ctx = setup();
    const presenter = await present(ctx);
    const es = await listen(ctx, 'es');
    const fr = await listen(ctx, 'fr');
    const en = await listen(ctx, 'en');

    const result = await ctx.service.addText(ctx.talk, {
      clientSegmentId: 'seg-000001',
      text: 'Hello',
    });
    await flush();

    expect(result).toMatchObject({ language: 'en', text: 'Hello' });
    expect(presenter.conn.last('segment')!.segment.text).toBe('Hello');
    expect(en.conn.last('segment')!.segment).toMatchObject({ language: 'en', text: 'Hello' });
    expect(es.conn.last('segment')!.segment).toMatchObject({
      language: 'es',
      text: '[demo en→es] Hello',
      sourceText: 'Hello',
    });
    expect(fr.conn.last('segment')!.segment.language).toBe('fr');
  });

  it('translates once per language, not once per listener', async () => {
    const provider = new MockProvider();
    const translate = vi.spyOn(provider, 'translate');
    const ctx = setup({ provider });
    for (let i = 0; i < 10; i++) await listen(ctx, 'es');
    for (let i = 0; i < 5; i++) await listen(ctx, 'ja');
    await ctx.service.addText(ctx.talk, { clientSegmentId: 'seg-000002', text: 'Welcome' });
    await flush();
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('serves the original once the language limit is reached, and frees slots', async () => {
    const ctx = setup({ maxLanguages: 2 });
    await listen(ctx, 'es');
    await listen(ctx, 'fr');
    const ja = await listen(ctx, 'ja');
    expect(ja.conn.last('welcome')!.languageUnavailable).toBe(true);
    expect(ctx.talk.stats().translating).toEqual(['es', 'fr']);

    await ctx.service.addText(ctx.talk, { clientSegmentId: 'seg-000003', text: 'Hi' });
    await flush();
    expect(ja.conn.last('segment')!.segment).toMatchObject({ language: 'ja', text: null });

    // The French listener switches to English, which frees a slot for Japanese.
    const fr = [...ctx.talk.listeners].find((l) => l.language === 'fr')!;
    await ctx.service.setLanguage(ctx.talk, fr, 'en');
    expect(ctx.talk.isServed('ja')).toBe(true);
  });

  it('never duplicates a retried segment', async () => {
    const ctx = setup();
    const es = await listen(ctx, 'es');
    const [a, b] = await Promise.all([
      ctx.service.addSpeech(ctx.talk, {
        clientSegmentId: 'seg-000004',
        audio: fakeAudio(),
        mimeType: 'audio/webm',
      }),
      ctx.service.addSpeech(ctx.talk, {
        clientSegmentId: 'seg-000004',
        audio: fakeAudio(),
        mimeType: 'audio/webm',
      }),
    ]);
    const again = await ctx.service.addSpeech(ctx.talk, {
      clientSegmentId: 'seg-000004',
      audio: fakeAudio(),
      mimeType: 'audio/webm',
    });
    await flush();
    expect(a.id).toBe(b.id);
    expect(again.id).toBe(a.id);
    expect(ctx.talk.segments).toHaveLength(1);
    expect(es.conn.of('segment')).toHaveLength(1);
  });

  it('reports silence without storing a segment', async () => {
    const ctx = setup();
    await expect(
      ctx.service.addSpeech(ctx.talk, {
        clientSegmentId: 'seg-000005',
        audio: fakeAudio(100),
        mimeType: 'audio/webm',
      }),
    ).rejects.toMatchObject({ code: 'NO_SPEECH' });
    expect(ctx.talk.segments).toHaveLength(0);
  });

  it('catches up late joiners and reconnecting listeners in their language', async () => {
    const ctx = setup();
    for (let i = 1; i <= 3; i++) {
      await ctx.service.addText(ctx.talk, { clientSegmentId: `seg-00001${i}`, text: `Line ${i}` });
    }
    const late = await listen(ctx, 'es');
    expect(late.conn.last('welcome')!.segments.map((s) => s.text)).toEqual([
      '[demo en→es] Line 1',
      '[demo en→es] Line 2',
      '[demo en→es] Line 3',
    ]);
    const back = await listen(ctx, 'es', 2);
    expect(back.conn.last('welcome')!.segments.map((s) => s.seq)).toEqual([3]);
  });

  it('re-sends recent captions after a language switch', async () => {
    const ctx = setup();
    const { conn, member } = await listen(ctx, 'es');
    await ctx.service.addText(ctx.talk, { clientSegmentId: 'seg-000020', text: 'Thanks' });
    await flush();
    if (member.role !== 'listener') throw new Error('expected listener');
    await ctx.service.setLanguage(ctx.talk, member.listener, 'fr');
    expect(conn.last('language')).toEqual({ type: 'language', language: 'fr', unavailable: false });
    expect(conn.last('segment')!.segment).toMatchObject({
      language: 'fr',
      text: '[demo en→fr] Thanks',
    });
  });

  it('falls back to the original when a translation fails', async () => {
    const provider = new MockProvider();
    vi.spyOn(provider, 'translate').mockRejectedValue(new Error('down'));
    const ctx = setup({ provider });
    const es = await listen(ctx, 'es');
    await ctx.service.addText(ctx.talk, { clientSegmentId: 'seg-000030', text: 'Hello' });
    await flush();
    await flush();
    expect(es.conn.last('segment')!.segment).toMatchObject({ text: null, sourceText: 'Hello' });
  });

  it('tells the presenter how many people listen in which language', async () => {
    const ctx = setup();
    const presenter = await present(ctx);
    await listen(ctx, 'es');
    await listen(ctx, 'es');
    await listen(ctx, 'en');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(presenter.conn.last('stats')!.stats).toEqual({
      listeners: 3,
      byLanguage: { es: 2, en: 1 },
      translating: ['es'],
    });
  });

  it('broadcasts pause and resume, and closes everyone when the talk ends', async () => {
    const ctx = setup();
    const presenter = await present(ctx);
    const es = await listen(ctx, 'es');
    ctx.service.setStatus(ctx.talk, 'live');
    expect(es.conn.last('status')!.status).toBe('live');
    ctx.service.end(ctx.talk);
    expect(es.conn.last('status')!.status).toBe('ended');
    expect(es.conn.closed).toBe(4001);
    expect(presenter.conn.closed).toBe(4001);
    expect(() => ctx.service.authorize(ctx.talk.id, ctx.key)).toThrow(/ended/);
  });

  it('synthesizes caption audio once per segment and language', async () => {
    const provider = new MockProvider();
    const synthesize = vi.spyOn(provider, 'synthesize');
    const ctx = setup({ provider });
    await listen(ctx, 'es');
    const segment = await ctx.service.addText(ctx.talk, {
      clientSegmentId: 'seg-000040',
      text: 'Hi',
    });
    const [a, b] = await Promise.all([
      ctx.service.speechFor(ctx.talk, segment.id, 'es'),
      ctx.service.speechFor(ctx.talk, segment.id, 'es'),
    ]);
    expect(a.audio).toBe(b.audio);
    expect(synthesize).toHaveBeenCalledTimes(1);
    // Nobody reads Korean, so nobody can make the server synthesize it.
    expect(() => ctx.service.speechFor(ctx.talk, segment.id, 'ko')).toThrow();
  });
});
