import { describe, expect, it } from 'vitest';
import type { RoomMessage, ServerEvent } from '@lingua-bridge/shared';
import { MockProvider } from '../src/providers/mock';
import type { RoomError } from '../src/rooms/service';
import { RoomService, cleanName } from '../src/rooms/service';
import { RoomStore, type Connection } from '../src/rooms/store';
import { fakeAudio } from './helpers';

class StubConnection implements Connection {
  events: ServerEvent[] = [];
  closed: { code: number; reason: string } | undefined;
  send(data: string) {
    this.events.push(JSON.parse(data) as ServerEvent);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  last<T extends ServerEvent['type']>(type: T) {
    return this.events.filter((e) => e.type === type).at(-1) as
      Extract<ServerEvent, { type: T }> | undefined;
  }
}

function setup(options: { now?: () => number; maxRooms?: number } = {}) {
  const store = new RoomStore({
    maxRooms: options.maxRooms ?? 10,
    idleMs: 60_000,
    now: options.now,
  });
  const service = new RoomService(store, new MockProvider(), { staleMs: 300_000 });
  const created = store.create()!;
  return { store, service, roomId: created.room.id, secret: created.secret };
}

async function twoPeople() {
  const ctx = setup();
  const a = new StubConnection();
  const b = new StubConnection();
  const alice = await ctx.service.hello(a, {
    type: 'hello',
    roomId: ctx.roomId,
    secret: ctx.secret,
    language: 'en',
    name: 'Alice',
  });
  const bo = await ctx.service.hello(b, {
    type: 'hello',
    roomId: ctx.roomId,
    secret: ctx.secret,
    language: 'ja',
    name: 'Bo',
  });
  return { ...ctx, a, b, alice, bo, room: alice.room };
}

describe('RoomStore', () => {
  it('creates rooms with unguessable secrets', () => {
    const store = new RoomStore({ maxRooms: 5, idleMs: 1000 });
    const one = store.create()!;
    const two = store.create()!;
    expect(one.room.id).not.toBe(two.room.id);
    expect(one.secret.length).toBeGreaterThanOrEqual(20);
    expect(one.room.checkSecret(one.secret)).toBe(true);
    expect(one.room.checkSecret(two.secret)).toBe(false);
    expect(one.room.checkSecret('')).toBe(false);
  });

  it('refuses new rooms at the limit', () => {
    const store = new RoomStore({ maxRooms: 1, idleMs: 60_000 });
    expect(store.create()).toBeDefined();
    expect(store.create()).toBeUndefined();
  });

  it('sweeps idle rooms nobody is connected to', () => {
    let now = 0;
    const store = new RoomStore({ maxRooms: 5, idleMs: 1000, now: () => now });
    store.create();
    now = 500;
    expect(store.sweep()).toBe(0);
    now = 2000;
    expect(store.sweep()).toBe(1);
    expect(store.size).toBe(0);
  });
});

describe('RoomService joining', () => {
  it('lets two people join and tells each about the other', async () => {
    const { a, b } = await twoPeople();
    const welcome = b.last('welcome')!;
    expect(welcome.participants.map((p) => p.name)).toEqual(['Alice', 'Bo']);
    expect(welcome.resumeToken).toBeTruthy();
    const presence = a.last('presence')!;
    expect(presence.participants).toHaveLength(2);
    expect(JSON.stringify(a.events)).not.toContain(welcome.resumeToken);
  });

  it('rejects a wrong secret', async () => {
    const { service, roomId } = setup();
    await expect(
      service.hello(new StubConnection(), {
        type: 'hello',
        roomId,
        secret: 'nope',
        language: 'en',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' } satisfies Partial<RoomError>);
  });

  it('rejects unknown rooms', async () => {
    const { service, secret } = setup();
    await expect(
      service.hello(new StubConnection(), { type: 'hello', roomId: 'x', secret, language: 'en' }),
    ).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
  });

  it('keeps out a third person', async () => {
    const { service, roomId, secret } = await twoPeople();
    await expect(
      service.hello(new StubConnection(), { type: 'hello', roomId, secret, language: 'fr' }),
    ).rejects.toMatchObject({ code: 'ROOM_FULL' });
  });

  it('resumes the same seat with a resume token and replays missed messages', async () => {
    const { service, room, alice, bo, b, roomId, secret } = await twoPeople();
    const token = b.last('welcome')!.resumeToken;
    service.disconnect(room, bo.participant, b);
    expect(room.publicParticipants().find((p) => p.name === 'Bo')!.connected).toBe(false);

    await service.sendText(room, alice.participant, { clientMessageId: 'msg-00001', text: 'Hi' });

    const b2 = new StubConnection();
    const again = await service.hello(b2, {
      type: 'hello',
      roomId,
      secret,
      language: 'ja',
      resumeToken: token,
      lastSeq: 0,
    });
    expect(again.participant.id).toBe(bo.participant.id);
    const welcome = b2.last('welcome')!;
    expect(welcome.messages).toHaveLength(1);
    expect(welcome.messages[0]!.translations.ja).toBe('[demo en→ja] Hi');
  });

  it('closes the older tab when the same person connects twice', async () => {
    const { service, b, roomId, secret } = await twoPeople();
    const token = b.last('welcome')!.resumeToken;
    await service.hello(new StubConnection(), {
      type: 'hello',
      roomId,
      secret,
      language: 'ja',
      resumeToken: token,
    });
    expect(b.closed?.reason).toBe('replaced');
  });
});

describe('RoomService messages', () => {
  it('translates for the other person and broadcasts once', async () => {
    const { service, room, alice, a, b } = await twoPeople();
    const message = await service.sendText(room, alice.participant, {
      clientMessageId: 'msg-00001',
      text: 'Can everyone hear me clearly?',
    });
    expect(message.translations).toEqual({
      en: 'Can everyone hear me clearly?',
      ja: '皆さん、はっきり聞こえますか？',
    });
    expect(message.seq).toBe(1);
    expect(b.last('message')!.message.id).toBe(message.id);
    expect(a.last('message')!.message.id).toBe(message.id);
  });

  it('never duplicates a retried message', async () => {
    const { service, room, alice } = await twoPeople();
    const input = { clientMessageId: 'retry-0001', text: 'Hello' };
    const [first, concurrent] = await Promise.all([
      service.sendText(room, alice.participant, input),
      service.sendText(room, alice.participant, input),
    ]);
    const later = await service.sendText(room, alice.participant, input);
    expect(concurrent.id).toBe(first.id);
    expect(later.id).toBe(first.id);
    expect(room.messages).toHaveLength(1);
  });

  it('transcribes speech in the speaker language', async () => {
    const { service, room, bo } = await twoPeople();
    const message = await service.sendSpeech(room, bo.participant, {
      clientMessageId: 'speech-001',
      audio: fakeAudio(),
      mimeType: 'audio/webm',
    });
    expect(message.kind).toBe('speech');
    expect(message.sourceLanguage).toBe('ja');
    expect(message.translations.en).toBe('Can everyone hear me clearly?');
  });

  it('reports no speech without storing anything', async () => {
    const { service, room, bo } = await twoPeople();
    await expect(
      service.sendSpeech(room, bo.participant, {
        clientMessageId: 'speech-002',
        audio: fakeAudio(10),
        mimeType: 'audio/webm',
      }),
    ).rejects.toMatchObject({ code: 'NO_SPEECH' });
    expect(room.messages).toHaveLength(0);
  });

  it('marks delivered only when the other person acknowledges', async () => {
    const { service, room, alice, bo, a } = await twoPeople();
    const message = await service.sendText(room, alice.participant, {
      clientMessageId: 'msg-00002',
      text: 'Hi',
    });
    expect(message.deliveredTo).toEqual([]);

    service.ack(room, alice.participant, message.id); // the sender's own ack is ignored
    expect(message.deliveredTo).toEqual([]);

    service.ack(room, bo.participant, message.id);
    expect(message.deliveredTo).toEqual([bo.participant.id]);
    expect(a.last('delivered')).toEqual({
      type: 'delivered',
      messageId: message.id,
      participantId: bo.participant.id,
    });
  });

  it('re-translates recent history when someone switches language', async () => {
    const { service, room, alice, bo, b } = await twoPeople();
    await service.sendText(room, alice.participant, { clientMessageId: 'msg-00003', text: 'Hi' });
    await service.setLanguage(room, bo.participant, 'fr');
    const update = b.last('message')!.message as RoomMessage;
    expect(update.translations.fr).toBe('[demo en→fr] Hi');
    expect(b.last('presence')!.participants.find((p) => p.id === bo.participant.id)!.language).toBe(
      'fr',
    );
  });

  it('shares who is speaking', async () => {
    const { service, room, bo, a } = await twoPeople();
    service.setSpeaking(room, bo.participant, true);
    expect(a.last('presence')!.participants.find((p) => p.name === 'Bo')!.speaking).toBe(true);
  });

  it('rejects empty and oversized text', async () => {
    const { service, room, alice } = await twoPeople();
    expect(() =>
      service.sendText(room, alice.participant, { clientMessageId: 'msg-00004', text: '   ' }),
    ).toThrow(/empty/);
    expect(() =>
      service.sendText(room, alice.participant, {
        clientMessageId: 'msg-00005',
        text: 'x'.repeat(501),
      }),
    ).toThrow(/500/);
  });
});

describe('cleanName', () => {
  it('strips control characters and limits length', () => {
    expect(cleanName('  Ana\u0000\n  María ')).toBe('Ana María');
    expect(cleanName('')).toBe('Guest');
    expect(cleanName('x'.repeat(100))).toHaveLength(40);
  });
});
