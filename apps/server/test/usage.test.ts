import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AdminStatus, HealthResponse } from '@lingua-bridge/shared';
import { getLanguage } from '@lingua-bridge/shared';
import { MockProvider } from '../src/providers/mock';
import type { SpeechProvider } from '../src/providers';
import { FREE, UsageMeter, type Prices } from '../src/usage/meter';
import { MeteredProvider, audioMinutes } from '../src/usage/metered-provider';
import { fakeAudio, testApp } from './helpers';

const PRICES: Prices = {
  transcribePerMinute: 0.006,
  translateInputPerMillion: 1,
  translateOutputPerMillion: 2,
  synthesizePer1kChars: 0.02,
};

/** A provider that claims to be real, so the meter charges for it. */
class PaidProvider extends MockProvider {
  override readonly demoMode = false as unknown as true;
}

const en = getLanguage('en');
const es = getLanguage('es');

describe('UsageMeter', () => {
  it('estimates cost per operation', () => {
    const meter = new UsageMeter({ budgetUsd: 0, prices: PRICES });
    expect(meter.estimate('transcribe', { minutes: 2 })).toBeCloseTo(0.012);
    // 400 chars in → 100 + 80 prompt tokens; 400 out → 100 tokens.
    expect(meter.estimate('translate', { inChars: 400, outChars: 400 })).toBeCloseTo(
      (180 * 1 + 100 * 2) / 1e6,
    );
    expect(meter.estimate('synthesize', { inChars: 500 })).toBeCloseTo(0.01);
  });

  it('refuses paid work once the budget is spent, and resets the next UTC day', () => {
    let now = Date.parse('2026-11-07T12:00:00Z');
    const meter = new UsageMeter({ budgetUsd: 0.01, prices: PRICES, now: () => now });
    meter.record('transcribe', { ok: true, ms: 100, units: 2, costUsd: 0.012 });
    expect(() => meter.check('translate')).toThrow(/limit for today/);
    expect(meter.snapshot()).toMatchObject({ available: false, unavailableReason: 'budget' });
    expect(meter.snapshot().operations.translate.refused).toBe(1);

    now = Date.parse('2026-11-08T00:00:01Z');
    expect(() => meter.check('translate')).not.toThrow();
    expect(meter.snapshot()).toMatchObject({ day: '2026-11-08', costUsd: 0, available: true });
  });

  it('treats a zero budget as no cap', () => {
    const meter = new UsageMeter({ budgetUsd: 0, prices: PRICES });
    meter.record('transcribe', { ok: true, ms: 1, units: 100, costUsd: 99 });
    expect(() => meter.check('transcribe')).not.toThrow();
  });

  it('pauses on request', () => {
    const meter = new UsageMeter({ budgetUsd: 5, prices: FREE });
    meter.setPaused(true);
    expect(() => meter.check('synthesize')).toThrow(/paused/);
    meter.setPaused(false);
    expect(() => meter.check('synthesize')).not.toThrow();
  });

  it('keeps the day’s spend and the pause switch across restarts', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lb-usage-')), 'usage.json');
    const first = new UsageMeter({ budgetUsd: 1, prices: PRICES, file });
    first.record('transcribe', { ok: true, ms: 1, units: 1, costUsd: 0.5 });
    first.setPaused(true);
    first.save();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      day: first.snapshot().day,
      costUsd: 0.5,
      paused: true,
    });
    const second = new UsageMeter({ budgetUsd: 1, prices: PRICES, file });
    expect(second.snapshot()).toMatchObject({ costUsd: 0.5, paused: true });
  });

  it('reports latency percentiles', () => {
    const meter = new UsageMeter({ budgetUsd: 0, prices: FREE });
    for (let ms = 1; ms <= 100; ms++)
      meter.record('translate', { ok: true, ms, units: 1, costUsd: 0 });
    expect(meter.snapshot().operations.translate).toMatchObject({
      calls: 100,
      p50Ms: 50,
      p95Ms: 95,
    });
  });
});

describe('MeteredProvider', () => {
  it('charges real providers and not the demo provider', async () => {
    const paidMeter = new UsageMeter({ budgetUsd: 0, prices: PRICES });
    const paid = new MeteredProvider(new PaidProvider(), paidMeter);
    await paid.transcribe({
      audio: fakeAudio(),
      mimeType: 'audio/webm',
      language: en,
      durationMs: 30_000,
    });
    expect(paidMeter.snapshot().operations.transcribe).toMatchObject({
      calls: 1,
      units: 0.5,
      costUsd: 0.003,
    });

    const demoMeter = new UsageMeter({ budgetUsd: 0, prices: PRICES });
    const demo = new MeteredProvider(new MockProvider(), demoMeter);
    await demo.translate({ text: 'Hello', from: en, to: es });
    expect(demoMeter.snapshot().operations.translate).toMatchObject({ calls: 1, costUsd: 0 });
  });

  it('counts failures without charging, and blocks calls over budget', async () => {
    const failing: SpeechProvider = Object.assign(new PaidProvider(), {
      translate: async () => {
        throw new Error('upstream down');
      },
    });
    const meter = new UsageMeter({ budgetUsd: 0.001, prices: PRICES });
    const provider = new MeteredProvider(failing, meter);
    await expect(provider.translate({ text: 'Hi', from: en, to: es })).rejects.toThrow(
      'upstream down',
    );
    expect(meter.snapshot().operations.translate).toMatchObject({
      calls: 1,
      errors: 1,
      costUsd: 0,
    });

    meter.record('transcribe', { ok: true, ms: 1, units: 1, costUsd: 0.002 });
    await expect(provider.translate({ text: 'Hi', from: en, to: es })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('caps client-reported durations and estimates when none is given', () => {
    const audio = fakeAudio(150_000); // 1.2 Mbit
    expect(
      audioMinutes({ audio, mimeType: 'audio/webm', language: en, durationMs: 10 * 60_000 }),
    ).toBe(1);
    expect(audioMinutes({ audio, mimeType: 'audio/webm', language: en })).toBeCloseTo(1);
  });
});

describe('budget and admin over HTTP', () => {
  let app: FastifyInstance;
  afterEach(async () => app?.close());
  const TOKEN = 'a-very-long-admin-token-123456';

  it('reports availability in health', async () => {
    app = await testApp({ env: { ADMIN_TOKEN: TOKEN } });
    const health = (await app.inject({ url: '/api/health' })).json<HealthResponse>();
    expect(health.available).toBe(true);
  });

  it('keeps admin routes absent without a token configured', async () => {
    app = await testApp();
    expect((await app.inject({ url: '/api/admin/status' })).statusCode).toBe(404);
  });

  it('requires the admin token', async () => {
    app = await testApp({ env: { ADMIN_TOKEN: TOKEN } });
    expect((await app.inject({ url: '/api/admin/status' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/admin/status', headers: { authorization: 'Bearer wrong' } }))
        .statusCode,
    ).toBe(401);
  });

  it('pauses translation everywhere and reports usage without any text', async () => {
    app = await testApp({ env: { ADMIN_TOKEN: TOKEN } });
    const auth = { authorization: `Bearer ${TOKEN}` };

    await app.inject({
      method: 'POST',
      url: '/api/speech',
      payload: { text: 'A private sentence', language: 'en' },
    });
    const status = (
      await app.inject({ url: '/api/admin/status', headers: auth })
    ).json<AdminStatus>();
    expect(status.usage.operations.synthesize.calls).toBe(1);
    expect(status.live).toEqual({ rooms: 0, talks: 0, listeners: 0 });
    expect(JSON.stringify(status)).not.toContain('private');

    const paused = await app.inject({
      method: 'POST',
      url: '/api/admin/pause',
      headers: auth,
      payload: { paused: true },
    });
    expect(paused.json<AdminStatus>().usage.paused).toBe(true);

    const refused = await app.inject({
      method: 'POST',
      url: '/api/speech',
      payload: { text: 'Hello', language: 'en' },
    });
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
    expect((await app.inject({ url: '/api/health' })).json<HealthResponse>()).toMatchObject({
      available: false,
      unavailableReason: 'paused',
    });
  });

  it('rejects a short admin token at startup', async () => {
    await expect(testApp({ env: { ADMIN_TOKEN: 'short' } })).rejects.toThrow(/24 characters/);
  });
});
