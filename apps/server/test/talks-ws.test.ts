import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type {
  CreateTalkResponse,
  TalkClientEvent,
  TalkSegment,
  TalkServerEvent,
} from '@lingua-bridge/shared';
import { fakeAudio, multipart, testApp } from './helpers';

let app: FastifyInstance;
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.forEach((s) => s.terminate());
  sockets.length = 0;
  await app?.close();
});

class Client {
  events: TalkServerEvent[] = [];
  closeCode: number | undefined;
  private waiters: {
    match: (e: TalkServerEvent) => boolean;
    resolve: (e: TalkServerEvent) => void;
  }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as TalkServerEvent;
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

  send(event: TalkClientEvent) {
    this.socket.send(JSON.stringify(event));
  }

  next<T extends TalkServerEvent['type']>(
    type: T,
    where: (e: Extract<TalkServerEvent, { type: T }>) => boolean = () => true,
  ): Promise<Extract<TalkServerEvent, { type: T }>> {
    const match = (e: TalkServerEvent) =>
      e.type === type && where(e as Extract<TalkServerEvent, { type: T }>);
    const seen = this.events.find(match);
    if (seen) return Promise.resolve(seen as Extract<TalkServerEvent, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000);
      this.waiters.push({
        match,
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e as Extract<TalkServerEvent, { type: T }>);
        },
      });
    });
  }

  closed(): Promise<number> {
    if (this.closeCode !== undefined) return Promise.resolve(this.closeCode);
    return new Promise((resolve) => this.socket.once('close', (code) => resolve(code)));
  }
}

async function start(env?: Record<string, string>) {
  app = await testApp({ env });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `127.0.0.1:${address.port}`;
}

async function connect(host: string): Promise<Client> {
  const socket = new WebSocket(`ws://${host}/api/talks/ws`);
  sockets.push(socket);
  const client = new Client(socket);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return client;
}

async function createTalk(): Promise<CreateTalkResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/talks',
    payload: { language: 'en', title: 'Demo day' },
  });
  expect(res.statusCode).toBe(200);
  return res.json<CreateTalkResponse>();
}

describe('talks over HTTP and WebSocket', () => {
  it('runs a talk: presenter speaks, listeners read in their language, audio is shared', async () => {
    const host = await start();
    const talk = await createTalk();

    const presenter = await connect(host);
    presenter.send({ type: 'hello', talkId: talk.talkId, presenterKey: talk.presenterKey });
    expect((await presenter.next('welcome')).role).toBe('presenter');

    const listener = await connect(host);
    listener.send({ type: 'hello', talkId: talk.talkId, language: 'es' });
    const welcome = await listener.next('welcome');
    expect(welcome).toMatchObject({
      role: 'listener',
      talk: { title: 'Demo day', language: 'en' },
    });

    presenter.send({ type: 'status', status: 'live' });
    expect((await listener.next('status')).status).toBe('live');

    const { payload, headers } = multipart(
      { clientSegmentId: 'seg-000001' },
      { type: 'audio/webm', data: fakeAudio() },
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/talks/${talk.talkId}/segments`,
      payload,
      headers: { ...headers, authorization: `Bearer ${talk.presenterKey}` },
    });
    expect(res.statusCode).toBe(200);
    const sent = res.json<TalkSegment>();
    expect(sent.language).toBe('en');

    const received = (await listener.next('segment')).segment;
    expect(received).toMatchObject({ id: sent.id, language: 'es', sourceText: sent.sourceText });
    expect(received.text).toBeTruthy();

    const speech = await app.inject({
      method: 'GET',
      url: `/api/talks/${talk.talkId}/segments/${sent.id}/speech?language=es`,
    });
    expect(speech.statusCode).toBe(200);
    expect(speech.headers['content-type']).toContain('audio/');

    expect(
      (await presenter.next('stats', (e) => e.stats.listeners === 1)).stats.byLanguage,
    ).toEqual({
      es: 1,
    });

    const end = await app.inject({
      method: 'POST',
      url: `/api/talks/${talk.talkId}/end`,
      headers: { authorization: `Bearer ${talk.presenterKey}` },
    });
    expect(end.statusCode).toBe(200);
    expect((await listener.next('status', (e) => e.status === 'ended')).status).toBe('ended');
    expect(await listener.closed()).toBe(4001);
  });

  it('only the presenter can send or end', async () => {
    await start();
    const talk = await createTalk();
    const text = await app.inject({
      method: 'POST',
      url: `/api/talks/${talk.talkId}/text`,
      payload: { clientSegmentId: 'seg-000002', text: 'Hi' },
      headers: { authorization: 'Bearer wrong' },
    });
    expect(text.statusCode).toBe(403);
    const end = await app.inject({ method: 'POST', url: `/api/talks/${talk.talkId}/end` });
    expect(end.statusCode).toBe(403);
  });

  it('listeners cannot change the talk status', async () => {
    const host = await start();
    const talk = await createTalk();
    const listener = await connect(host);
    listener.send({ type: 'hello', talkId: talk.talkId, language: 'fr' });
    await listener.next('welcome');
    listener.send({ type: 'status', status: 'live' });
    listener.send({ type: 'ping', t: 5 });
    expect((await listener.next('pong')).t).toBe(5);
    expect(listener.events.some((e) => e.type === 'status')).toBe(false);
  });

  it('tells a late visitor that the talk has ended', async () => {
    const host = await start();
    const talk = await createTalk();
    await app.inject({
      method: 'POST',
      url: `/api/talks/${talk.talkId}/end`,
      headers: { authorization: `Bearer ${talk.presenterKey}` },
    });
    const late = await connect(host);
    late.send({ type: 'hello', talkId: talk.talkId, language: 'es' });
    expect((await late.next('welcome')).talk.status).toBe('ended');
    expect(await late.closed()).toBe(4001);
  });

  it('lets a whole audience behind one address join past the API rate limit', async () => {
    const host = await start({ RATE_LIMIT_MAX: '3' });
    const talk = await createTalk();
    const clients = await Promise.all(Array.from({ length: 8 }, () => connect(host)));
    clients.forEach((c) => c.send({ type: 'hello', talkId: talk.talkId, language: 'es' }));
    await Promise.all(clients.map((c) => c.next('welcome')));
  });
});
