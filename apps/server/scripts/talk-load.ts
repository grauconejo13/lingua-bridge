/**
 * Audience fan-out load test for presentations.
 *
 *   npm run talk-load -- --listeners 300 --languages 6 --segments 20
 *
 * Starts the server in-process with the mock provider (simulated provider latency), opens
 * one presenter and N listener WebSockets spread across L languages, sends text segments
 * as the presenter, and measures how long each listener waits for each caption. It also
 * counts provider translation calls, which should equal segments × translated languages
 * whatever the audience size.
 *
 * This measures the server's fan-out on one machine (clients and server share the CPU), not
 * translation quality or real network conditions.
 */
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import {
  LANGUAGES,
  median,
  type CreateTalkResponse,
  type TalkServerEvent,
} from '@lingua-bridge/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MockProvider } from '../src/providers/mock';

const { values } = parseArgs({
  options: {
    listeners: { type: 'string', default: '300' },
    languages: { type: 'string', default: '6' },
    segments: { type: 'string', default: '20' },
    'interval-ms': { type: 'string', default: '1500' },
    'mock-latency-ms': { type: 'string', default: '300' },
  },
});
const LISTENERS = Number(values.listeners);
const LANGUAGE_COUNT = Number(values.languages);
const SEGMENTS = Number(values.segments);
const INTERVAL_MS = Number(values['interval-ms']);
const MOCK_LATENCY_MS = Number(values['mock-latency-ms']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const percentile = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};

const provider = new MockProvider({ latencyMs: MOCK_LATENCY_MS });
let translateCalls = 0;
const translate = provider.translate.bind(provider);
provider.translate = (input) => {
  translateCalls++;
  return translate(input);
};

const app = await buildApp({
  config: loadConfig({
    PROVIDER: 'mock',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '100000',
    TALK_MAX_LISTENERS: String(LISTENERS + 10),
    TALK_MAX_LANGUAGES: String(LANGUAGE_COUNT),
  }),
  provider,
  logger: false,
});
await app.listen({ port: 0, host: '127.0.0.1' });
const { port } = app.server.address() as { port: number };
const base = `127.0.0.1:${port}`;

const talk = (await (
  await fetch(`http://${base}/api/talks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language: 'en', title: 'Load test' }),
  })
).json()) as CreateTalkResponse;

// The presenter's language plus LANGUAGE_COUNT others.
const languages = LANGUAGES.map((l) => l.code)
  .filter((c) => c !== 'en')
  .slice(0, LANGUAGE_COUNT);
const sentAt = new Map<string, number>();
const delays: number[] = [];
const byLanguage = new Map<string, number[]>();
let received = 0;
const sockets: WebSocket[] = [];

const joinStarted = performance.now();
await Promise.all(
  Array.from({ length: LISTENERS }, (_, i) => {
    const language = i % (LANGUAGE_COUNT + 1) === 0 ? 'en' : languages[i % LANGUAGE_COUNT]!;
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://${base}/api/talks/ws`);
      sockets.push(socket);
      socket.on('open', () =>
        socket.send(JSON.stringify({ type: 'hello', talkId: talk.talkId, language })),
      );
      socket.on('message', (data) => {
        const event = JSON.parse(String(data)) as TalkServerEvent;
        if (event.type === 'welcome') resolve();
        if (event.type === 'segment' && event.segment.text !== null) {
          const started = sentAt.get(event.segment.sourceText);
          if (started === undefined) return;
          const delay = performance.now() - started;
          delays.push(delay);
          byLanguage.set(language, [...(byLanguage.get(language) ?? []), delay]);
          received++;
        }
      });
      socket.on('error', reject);
    });
  }),
);
const joinMs = performance.now() - joinStarted;

for (let i = 0; i < SEGMENTS; i++) {
  const text = `Segment number ${i + 1} of the load test.`;
  sentAt.set(text, performance.now());
  await fetch(`http://${base}/api/talks/${talk.talkId}/text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${talk.presenterKey}` },
    body: JSON.stringify({ clientSegmentId: `load-${String(i).padStart(6, '0')}`, text }),
  });
  await sleep(INTERVAL_MS);
}
await sleep(2000);

const expected = LISTENERS * SEGMENTS;
console.log(
  `${LISTENERS} listeners in ${LANGUAGE_COUNT + 1} languages joined in ${(joinMs / 1000).toFixed(1)} s`,
);
console.log(`Captions delivered: ${received}/${expected}`);
console.log(
  `Delay from send to listener: median ${Math.round(median(delays) ?? 0)} ms, ` +
    `p95 ${Math.round(percentile(delays, 95))} ms, max ${Math.round(Math.max(...delays))} ms ` +
    `(includes ${MOCK_LATENCY_MS / 2} ms simulated translation)`,
);
const original = byLanguage.get('en') ?? [];
console.log(`  original-language listeners: median ${Math.round(median(original) ?? 0)} ms`);
console.log(
  `Translation calls: ${translateCalls} (= ${SEGMENTS} segments × ${LANGUAGE_COUNT} languages: ` +
    `${translateCalls === SEGMENTS * LANGUAGE_COUNT ? 'yes' : 'NO'})`,
);

sockets.forEach((s) => s.terminate());
await app.close();
