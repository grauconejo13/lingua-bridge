import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type {
  ApiError,
  ClientEvent,
  CreateRoomResponse,
  RoomMessage,
  ServerEvent,
} from '@lingua-bridge/shared';
import { fakeAudio, multipart, testApp } from './helpers';

let app: FastifyInstance;
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.forEach((s) => s.terminate());
  sockets.length = 0;
  await app?.close();
});

/** A test client that records every event and can wait for a specific one. */
class Client {
  events: ServerEvent[] = [];
  closeCode: number | undefined;
  private waiters: { match: (e: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as ServerEvent;
      this.events.push(event);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(event)) return true;
        w.resolve(event);
        return false;
      });
    });
    socket.on('close', (code) => {
      this.closeCode = code;
    });
  }

  send(event: ClientEvent) {
    this.socket.send(JSON.stringify(event));
  }

  next<T extends ServerEvent['type']>(
    type: T,
    where: (e: Extract<ServerEvent, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerEvent, { type: T }>> {
    const seen = this.events.find(
      (e) => e.type === type && where(e as Extract<ServerEvent, { type: T }>),
    );
    if (seen) return Promise.resolve(seen as Extract<ServerEvent, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000);
      this.waiters.push({
        match: (e) => e.type === type && where(e as Extract<ServerEvent, { type: T }>),
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e as Extract<ServerEvent, { type: T }>);
        },
      });
    });
  }

  closed(): Promise<number> {
    if (this.closeCode !== undefined) return Promise.resolve(this.closeCode);
    return new Promise((resolve) => this.socket.once('close', (code) => resolve(code)));
  }
}

async function start() {
  app = await testApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `127.0.0.1:${address.port}`;
}

async function connect(host: string): Promise<Client> {
  const socket = new WebSocket(`ws://${host}/api/rooms/ws`);
  sockets.push(socket);
  const client = new Client(socket);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return client;
}

async function createRoom(): Promise<CreateRoomResponse> {
  const res = await app.inject({ method: 'POST', url: '/api/rooms' });
  expect(res.statusCode).toBe(200);
  return res.json<CreateRoomResponse>();
}

describe('rooms over HTTP and WebSocket', () => {
  it('runs a full exchange: join, speak, receive, acknowledge', async () => {
    const host = await start();
    const room = await createRoom();

    const alice = await connect(host);
    alice.send({ type: 'hello', roomId: room.roomId, secret: room.secret, language: 'en' });
    const aliceWelcome = await alice.next('welcome');

    const bo = await connect(host);
    bo.send({ type: 'hello', roomId: room.roomId, secret: room.secret, language: 'es' });
    const boWelcome = await bo.next('welcome');
    await alice.next('presence', (e) => e.participants.length === 2);

    // Alice speaks.
    const form = multipart(
      { clientMessageId: 'clip-000001' },
      { type: 'audio/webm', data: fakeAudio() },
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.roomId}/utterances`,
      payload: form.payload,
      headers: { ...form.headers, authorization: `Bearer ${aliceWelcome.resumeToken}` },
    });
    expect(res.statusCode).toBe(200);
    const sent = res.json<RoomMessage>();
    expect(sent.translations.es).toBe('¿Todos me escuchan bien?');

    // Bo receives it and acknowledges.
    const received = await bo.next('message');
    expect(received.message.id).toBe(sent.id);
    bo.send({ type: 'ack', messageId: sent.id });

    const delivered = await alice.next('delivered');
    expect(delivered).toEqual({
      type: 'delivered',
      messageId: sent.id,
      participantId: boWelcome.participantId,
    });
  });

  it('accepts typed messages and rejects non-members', async () => {
    const host = await start();
    const room = await createRoom();
    const alice = await connect(host);
    alice.send({ type: 'hello', roomId: room.roomId, secret: room.secret, language: 'en' });
    const welcome = await alice.next('welcome');

    const ok = await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.roomId}/messages`,
      payload: { clientMessageId: 'text-000001', text: 'Hello there' },
      headers: { authorization: `Bearer ${welcome.resumeToken}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<RoomMessage>().kind).toBe('text');

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.roomId}/messages`,
      payload: { clientMessageId: 'text-000002', text: 'Hi' },
      headers: { authorization: 'Bearer not-a-member' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<ApiError>().error.code).toBe('BAD_REQUEST');
  });

  it('replays messages missed while disconnected', async () => {
    const host = await start();
    const room = await createRoom();

    const alice = await connect(host);
    alice.send({ type: 'hello', roomId: room.roomId, secret: room.secret, language: 'en' });
    const aliceWelcome = await alice.next('welcome');

    let bo = await connect(host);
    bo.send({ type: 'hello', roomId: room.roomId, secret: room.secret, language: 'fr' });
    const boWelcome = await bo.next('welcome');

    bo.socket.close();
    await alice.next('presence', (e) => e.participants.some((p) => !p.connected));

    for (const [i, text] of ['one', 'two'].entries()) {
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.roomId}/messages`,
        payload: { clientMessageId: `text-00000${i}`, text },
        headers: { authorization: `Bearer ${aliceWelcome.resumeToken}` },
      });
    }

    bo = await connect(host);
    bo.send({
      type: 'hello',
      roomId: room.roomId,
      secret: room.secret,
      language: 'fr',
      resumeToken: boWelcome.resumeToken,
      lastSeq: 0,
    });
    const again = await bo.next('welcome');
    expect(again.participantId).toBe(boWelcome.participantId);
    expect(again.messages.map((m) => m.translations.fr)).toEqual([
      '[demo en→fr] one',
      '[demo en→fr] two',
    ]);
  });

  it('closes the socket for a wrong secret or a full room', async () => {
    const host = await start();
    const room = await createRoom();

    const intruder = await connect(host);
    intruder.send({ type: 'hello', roomId: room.roomId, secret: 'wrong', language: 'en' });
    expect((await intruder.next('error')).code).toBe('FORBIDDEN');
    expect(await intruder.closed()).toBe(4403);

    for (const language of ['en', 'es'] as const) {
      const c = await connect(host);
      c.send({ type: 'hello', roomId: room.roomId, secret: room.secret, language });
      await c.next('welcome');
    }
    const third = await connect(host);
    third.send({ type: 'hello', roomId: room.roomId, secret: room.secret, language: 'de' });
    expect((await third.next('error')).code).toBe('ROOM_FULL');
    expect(await third.closed()).toBe(4409);
  });

  it('answers pings and ignores malformed events', async () => {
    const host = await start();
    const client = await connect(host);
    client.socket.send('not json');
    expect((await client.next('error')).code).toBe('BAD_MESSAGE');
    client.send({ type: 'ping' });
    await client.next('pong');
  });

  it('returns 404 for messages to a room that no longer exists', async () => {
    await start();
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/missing/messages',
      payload: { clientMessageId: 'text-000001', text: 'Hi' },
      headers: { authorization: 'Bearer x' },
    });
    expect(res.statusCode).toBe(404);
  });
});
