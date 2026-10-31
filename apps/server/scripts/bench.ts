/**
 * Latency benchmark for a running Lingua Bridge server.
 *
 *   npm run bench -- --from en --to ja --runs 10 --url http://127.0.0.1:8787
 *
 * Each run synthesizes a phrase in the source language with /api/speech, then sends that
 * audio to /api/utterances, so no recorded fixtures are needed. Results go to
 * bench-results/ (git-ignored, because they include transcripts).
 *
 * Caveat: synthetic speech is cleaner than a real microphone, so treat these numbers as a
 * best case and pair them with manual device tests (see docs/BENCHMARKS.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { isLanguageCode, type HealthResponse, type UtteranceResponse } from '@lingua-bridge/shared';

const PHRASES: Record<string, string[]> = {
  en: [
    'Can everyone hear me clearly?',
    'The deployment finished, but the database migration failed on the second step.',
    'Could you share your screen and walk us through the error message?',
    'Our next meeting is on Thursday at three thirty.',
    'I think the latency is acceptable, but we should test it on a slower network.',
  ],
};

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8787' },
    from: { type: 'string', default: 'en' },
    to: { type: 'string', default: 'es' },
    runs: { type: 'string', default: '5' },
  },
});

const from = values.from;
const to = values.to;
const runs = Number(values.runs);
if (!isLanguageCode(from) || !isLanguageCode(to)) {
  throw new Error('--from and --to must be language codes from the registry');
}
const phrasesForSource = PHRASES[from];
if (!phrasesForSource) {
  throw new Error(`No benchmark phrases for "${from}" yet. Add some to scripts/bench.ts.`);
}
const phrases: string[] = phrasesForSource;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function main() {
  const health = (await (await fetch(`${values.url}/api/health`)).json()) as HealthResponse;
  console.log(`Provider: ${health.provider}${health.demoMode ? ' (demo mode)' : ''}`);
  console.log(`Pair: ${from} → ${to}, ${runs} runs\n`);

  const rows: {
    phrase: string;
    sourceText: string;
    translatedText: string;
    roundTripMs: number;
    timings: UtteranceResponse['timings'];
  }[] = [];

  for (let i = 0; i < runs; i++) {
    const phrase = phrases[i % phrases.length]!;
    const speech = await fetch(`${values.url}/api/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: phrase, language: from }),
    });
    if (!speech.ok) throw new Error(`speech failed: ${speech.status} ${await speech.text()}`);
    const audio = new Blob([await speech.arrayBuffer()], {
      type: speech.headers.get('content-type') ?? 'audio/mpeg',
    });

    const form = new FormData();
    form.append('sourceLanguage', from);
    form.append('targetLanguage', to);
    form.append('audio', audio, 'bench-audio');

    const started = performance.now();
    const res = await fetch(`${values.url}/api/utterances`, { method: 'POST', body: form });
    const roundTripMs = Math.round(performance.now() - started);
    if (!res.ok) throw new Error(`utterance failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as UtteranceResponse;

    rows.push({
      phrase,
      sourceText: body.sourceText,
      translatedText: body.translatedText,
      roundTripMs,
      timings: body.timings,
    });
    console.log(`#${i + 1} ${roundTripMs} ms  ${body.translatedText}`);
  }

  const summarize = (pick: (row: (typeof rows)[number]) => number) => {
    const series = rows.map(pick);
    return { median: percentile(series, 50), p95: percentile(series, 95) };
  };
  const summary = {
    provider: health.provider,
    demoMode: health.demoMode,
    from,
    to,
    runs,
    roundTripMs: summarize((r) => r.roundTripMs),
    transcribeMs: summarize((r) => r.timings.transcribeMs),
    translateMs: summarize((r) => r.timings.translateMs),
  };

  console.log('\n', summary);
  mkdirSync('bench-results', { recursive: true });
  const file = `bench-results/${new Date().toISOString().replace(/[:.]/g, '-')}-${from}-${to}.json`;
  writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
  console.log(`\nSaved ${file}`);
}

await main();
