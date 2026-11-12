/**
 * Conversation resilience under simulated bad networks.
 *
 *   npm run resilience                          # every profile, 20 messages each
 *   npm run resilience -- --profile worst --messages 40 --seed 7
 *
 * Starts the server in-process with the keyless mock provider, puts an impaired TCP proxy
 * (scripts/netsim/impaired-proxy.ts) in front of it, and has two simulated people talk
 * through the proxy: Alice sends text and speech, Bo receives and acknowledges. Both use
 * the same reliability rules as the web app (ROOM_CLIENT_TIMING): idempotent sends with
 * retries, reconnect with backoff, replay from the last seq, and silence detection.
 *
 * It reports, per profile: how many messages reached Bo, duplicates (must be 0), how many
 * delivery receipts made it back to Alice, end-to-end delay, retries, reconnects, and the
 * round-trip time and quality tier the client would have measured.
 *
 * Results are written to bench-results/ (git-ignored). The mock provider's text is
 * placeholder content, so this measures delivery, not translation quality.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import {
  ROOM_CLIENT_TIMING,
  classifyNetwork,
  median,
  type ClientEvent,
  type CreateRoomResponse,
  type RoomMessage,
  type ServerEvent,
} from '@lingua-bridge/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MockProvider } from '../src/providers/mock';
import {
  PROFILES,
  seededRandom,
  startImpairedProxy,
  type LinkProfile,
} from './netsim/impaired-proxy';

const { values } = parseArgs({
  options: {
    profile: { type: 'string' },
    messages: { type: 'string', default: '20' },
    'interval-ms': { type: 'string', default: '2000' },
    /** After the last send, how long to wait for stragglers. */
    'drain-ms': { type: 'string', default: '60000' },
    'speech-every': { type: 'string', default: '3' },
    /** Bytes per simulated recording: 24 KB is about 16 s at the poor tier's 12 kbit/s. */
    'speech-bytes': { type: 'string', default: '24000' },
    'mock-latency-ms': { type: 'string', default: '300' },
    seed: { type: 'string', default: '1' },
  },
});

const MESSAGES = Number(values.messages);
const INTERVAL_MS = Number(values['interval-ms']);
const DRAIN_MS = Number(values['drain-ms']);
const SPEECH_EVERY = Number(values['speech-every']);
const SPEECH_BYTES = Number(values['speech-bytes']);
const MOCK_LATENCY_MS = Number(values['mock-latency-ms']);
const SEED = Number(values.seed);
/** Per-request timeout, like a browser giving up on a hung upload. */
const REQUEST_TIMEOUT_MS = 20_000;

const profiles = values.profile ? PROFILES.filter((p) => p.name === values.profile) : PROFILES;
if (profiles.length === 0) {
  throw new Error(`Unknown profile. Choose from: ${PROFILES.map((p) => p.name).join(', ')}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** A simulated participant with the web client's connection behavior. */
class SimClient {
  token?: string;
  participantId?: string;
  /** Reconnect attempts, including ones refused during an outage. */
  reconnects = 0;
  rttSamples: number[] = [];
  /** First time each server message id was seen, and by clientMessageId to catch duplicates. */
  seenAt = new Map<string, number>();
  idsByClientId = new Map<string, Set<string>>();
  deliveredAt = new Map<string, number>();
  private lastSeq = 0;
  private socket?: WebSocket;
  private stopped = false;
  private attempt = 0;
  private welcomed: Promise<void>;
  private resolveWelcome!: () => void;

  constructor(
    private readonly base: string,
    private readonly room: CreateRoomResponse,
    private readonly language: 'en' | 'es',
    private readonly name: string,
  ) {
    this.welcomed = new Promise((resolve) => (this.resolveWelcome = resolve));
  }

  start(): Promise<void> {
    this.connect();
    return this.welcomed;
  }

  stop(): void {
    this.stopped = true;
    this.socket?.terminate();
  }

  private send(event: ClientEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(`${this.base.replace('http', 'ws')}/api/rooms/ws`);
    this.socket = socket;
    let lastHeard = Date.now();
    let pingTimer: NodeJS.Timeout | undefined;
    const ping = () => this.send({ type: 'ping', t: performance.now() });

    socket.on('open', () => {
      lastHeard = Date.now();
      this.send({
        type: 'hello',
        roomId: this.room.roomId,
        secret: this.room.secret,
        language: this.language,
        name: this.name,
        resumeToken: this.token,
        lastSeq: this.lastSeq,
      });
      pingTimer = setInterval(() => {
        if (Date.now() - lastHeard > ROOM_CLIENT_TIMING.silenceLimitMs) {
          socket.terminate();
          return;
        }
        ping();
      }, ROOM_CLIENT_TIMING.pingEveryMs);
      ping();
    });

    socket.on('message', (data) => {
      lastHeard = Date.now();
      let event: ServerEvent;
      try {
        event = JSON.parse(String(data)) as ServerEvent;
      } catch {
        return;
      }
      this.handle(event);
    });

    const onGone = () => {
      clearInterval(pingTimer);
      if (this.socket !== socket || this.stopped) return;
      this.socket = undefined;
      const backoff = ROOM_CLIENT_TIMING.reconnectBackoffMs;
      const delay = backoff[Math.min(this.attempt, backoff.length - 1)]!;
      this.attempt++;
      this.reconnects++;
      setTimeout(() => this.connect(), delay);
    };
    socket.on('close', onGone);
    socket.on('error', () => socket.terminate());
  }

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'pong':
        if (event.t !== undefined) this.rttSamples.push(performance.now() - event.t);
        break;
      case 'welcome':
        this.token = event.resumeToken;
        this.participantId = event.participantId;
        this.attempt = 0;
        event.messages.forEach((m) => this.receive(m));
        this.resolveWelcome();
        break;
      case 'message':
        this.receive(event.message);
        break;
      case 'delivered':
        if (!this.deliveredAt.has(event.messageId))
          this.deliveredAt.set(event.messageId, Date.now());
        break;
    }
  }

  private receive(message: RoomMessage): void {
    this.lastSeq = Math.max(this.lastSeq, message.seq);
    if (!this.seenAt.has(message.id)) this.seenAt.set(message.id, Date.now());
    const ids = this.idsByClientId.get(message.clientMessageId) ?? new Set<string>();
    ids.add(message.id);
    this.idsByClientId.set(message.clientMessageId, ids);
    if (
      message.senderId !== this.participantId &&
      !message.deliveredTo.includes(this.participantId!)
    ) {
      this.send({ type: 'ack', messageId: message.id });
    }
  }
}

interface SendRecord {
  clientMessageId: string;
  kind: 'text' | 'speech';
  startedAt: number;
  attempts: number;
  serverId?: string;
  failed?: string;
}

/** Send with the web app's retry rules; sends are idempotent so retries are safe. */
async function sendWithRetries(
  base: string,
  roomId: string,
  alice: SimClient,
  record: SendRecord,
  deadline: number,
): Promise<void> {
  const retries = ROOM_CLIENT_TIMING.sendRetryMs;
  while (Date.now() < deadline) {
    record.attempts++;
    try {
      const url =
        record.kind === 'text'
          ? `${base}/api/rooms/${roomId}/messages`
          : `${base}/api/rooms/${roomId}/utterances`;
      let body: string | FormData;
      const headers: Record<string, string> = { authorization: `Bearer ${alice.token}` };
      if (record.kind === 'text') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify({
          clientMessageId: record.clientMessageId,
          text: `Message ${record.clientMessageId}`,
        });
      } else {
        const form = new FormData();
        form.append('clientMessageId', record.clientMessageId);
        form.append(
          'audio',
          new Blob([new Uint8Array(SPEECH_BYTES).fill(1)], { type: 'audio/webm' }),
          'utterance',
        );
        body = form;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        record.serverId = ((await response.json()) as RoomMessage).id;
        return;
      }
      // 4xx other than rate limiting won't get better by retrying.
      if (response.status < 500 && response.status !== 429) {
        record.failed = `HTTP ${response.status}`;
        return;
      }
    } catch {
      // Network error or timeout: retry.
    }
    const delay = retries[Math.min(record.attempts - 1, retries.length - 1)]!;
    await sleep(delay);
  }
  record.failed = 'gave up';
}

async function runProfile(profile: LinkProfile, serverPort: number) {
  const proxy = await startImpairedProxy({ targetPort: serverPort, profile, seed: SEED });
  const base = `http://127.0.0.1:${proxy.port}`;
  const startedAt = Date.now();

  // Room creation is setup, not under test, so it goes straight to the server.
  const room = (await (
    await fetch(`http://127.0.0.1:${serverPort}/api/rooms`, { method: 'POST' })
  ).json()) as CreateRoomResponse;

  const alice = new SimClient(base, room, 'en', 'Alice');
  const bo = new SimClient(base, room, 'es', 'Bo');
  await Promise.all([alice.start(), bo.start()]);

  const random = seededRandom(SEED + 1000);
  const records: SendRecord[] = [];
  const sends: Promise<void>[] = [];
  const sendDeadline = Date.now() + MESSAGES * INTERVAL_MS + DRAIN_MS;
  for (let i = 0; i < MESSAGES; i++) {
    const record: SendRecord = {
      clientMessageId: `sim-${profile.name}-${String(i).padStart(4, '0')}-${Math.floor(random() * 1e6)}`,
      kind: SPEECH_EVERY > 0 && i % SPEECH_EVERY === SPEECH_EVERY - 1 ? 'speech' : 'text',
      startedAt: Date.now(),
      attempts: 0,
    };
    records.push(record);
    sends.push(sendWithRetries(base, room.roomId, alice, record, sendDeadline));
    await sleep(INTERVAL_MS);
  }
  await Promise.all(sends);

  // Wait for Bo to receive, and for receipts to come back, up to the drain limit.
  const drainUntil = Date.now() + DRAIN_MS;
  const done = () =>
    records.every(
      (r) => !r.serverId || (bo.seenAt.has(r.serverId) && alice.deliveredAt.has(r.serverId)),
    );
  while (!done() && Date.now() < drainUntil) await sleep(250);

  alice.stop();
  bo.stop();
  await proxy.close();

  const accepted = records.filter((r) => r.serverId);
  const received = accepted.filter((r) => bo.seenAt.has(r.serverId!));
  const receipted = accepted.filter((r) => alice.deliveredAt.has(r.serverId!));
  const duplicates = [...bo.idsByClientId.values()].filter((ids) => ids.size > 1).length;
  const toBo = received.map((r) => bo.seenAt.get(r.serverId!)! - r.startedAt);
  const toReceipt = receipted.map((r) => alice.deliveredAt.get(r.serverId!)! - r.startedAt);
  const rtt = median([...alice.rttSamples, ...bo.rttSamples]);

  return {
    profile: profile.name,
    description: profile.description,
    sent: records.length,
    accepted: accepted.length,
    received: received.length,
    receipted: receipted.length,
    duplicates,
    failed: records.filter((r) => r.failed).map((r) => `${r.clientMessageId}: ${r.failed}`),
    retries: records.reduce((n, r) => n + r.attempts - 1, 0),
    reconnects: alice.reconnects + bo.reconnects,
    toBoMs: { median: median(toBo), p95: percentile(toBo, 95), max: Math.max(0, ...toBo) },
    toReceiptMs: { median: median(toReceipt), p95: percentile(toReceipt, 95) },
    measuredRttMs: rtt === undefined ? undefined : Math.round(rtt),
    tier: classifyNetwork({ online: true, rttMs: rtt }),
    proxy: { ...proxy.stats },
    durationS: Math.round((Date.now() - startedAt) / 1000),
  };
}

const config = loadConfig({
  PROVIDER: 'mock',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_MAX: '100000',
  MOCK_LATENCY_MS: String(MOCK_LATENCY_MS),
});
const app = await buildApp({
  config,
  provider: new MockProvider({ latencyMs: MOCK_LATENCY_MS }),
  logger: false,
});
await app.listen({ port: 0, host: '127.0.0.1' });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('server failed to bind');

console.log(
  `Resilience run: ${MESSAGES} messages per profile, one every ${INTERVAL_MS} ms, ` +
    `speech every ${SPEECH_EVERY} (${SPEECH_BYTES} B), seed ${SEED}\n`,
);

const results = [];
for (const profile of profiles) {
  process.stdout.write(`${profile.name.padEnd(9)} ${profile.description}… `);
  const result = await runProfile(profile, address.port);
  results.push(result);
  const fmt = (ms: number | undefined) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`);
  console.log(
    `received ${result.received}/${result.sent}, receipts ${result.receipted}, ` +
      `dupes ${result.duplicates}, median ${fmt(result.toBoMs.median)}, p95 ${fmt(result.toBoMs.p95)}, ` +
      `retries ${result.retries}, reconnect attempts ${result.reconnects}, ` +
      `RTT ${result.measuredRttMs ?? '–'} ms → ${result.tier}`,
  );
  for (const failure of result.failed) console.log(`  failed: ${failure}`);
}

await app.close();

mkdirSync('bench-results', { recursive: true });
const file = `bench-results/resilience-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(
  file,
  JSON.stringify(
    {
      settings: {
        messages: MESSAGES,
        intervalMs: INTERVAL_MS,
        drainMs: DRAIN_MS,
        speechEvery: SPEECH_EVERY,
        speechBytes: SPEECH_BYTES,
        mockLatencyMs: MOCK_LATENCY_MS,
        seed: SEED,
        node: process.version,
      },
      results,
    },
    null,
    2,
  ),
);
console.log(`\nSaved ${file}`);
