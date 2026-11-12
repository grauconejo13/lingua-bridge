import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderOperation, UsageSnapshot } from '@lingua-bridge/shared';
import { AppError } from '../errors';

/**
 * Prices used to *estimate* spend. They are configuration, not a bill: real charges depend
 * on the provider's token counts. Defaults follow OpenAI's published launch prices for the
 * default models (see docs/DEPLOYMENT.md).
 */
export interface Prices {
  transcribePerMinute: number;
  /** Per million tokens; tokens are estimated as characters / 4 plus prompt overhead. */
  translateInputPerMillion: number;
  translateOutputPerMillion: number;
  synthesizePer1kChars: number;
}

export const FREE: Prices = {
  transcribePerMinute: 0,
  translateInputPerMillion: 0,
  translateOutputPerMillion: 0,
  synthesizePer1kChars: 0,
};

/** Instructions sent with every translation request, in estimated tokens. */
const TRANSLATE_PROMPT_TOKENS = 80;
const LATENCY_SAMPLES = 200;

interface OperationTotals {
  calls: number;
  errors: number;
  refused: number;
  /** Minutes for transcription, characters for translation and speech. */
  units: number;
  costUsd: number;
  latencies: number[];
}

interface Persisted {
  day: string;
  costUsd: number;
  paused: boolean;
}

const OPERATIONS: ProviderOperation[] = ['transcribe', 'translate', 'synthesize'];

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * Counts provider usage, estimates its cost, and refuses new paid work once the daily budget
 * is spent or an operator has paused the service. Only aggregate numbers are kept: no audio,
 * no text, no user identifiers.
 *
 * The day rolls over at midnight UTC. With `file` set, the day's spend and the pause switch
 * survive restarts, so restarting the server can't be used to reset the budget.
 */
export class UsageMeter {
  private day: string;
  private costUsd = 0;
  private totals = new Map<ProviderOperation, OperationTotals>();
  private saveTimer: NodeJS.Timeout | undefined;
  readonly startedAt: number;
  paused = false;

  constructor(
    private readonly options: {
      budgetUsd: number;
      prices: Prices;
      file?: string;
      now?: () => number;
    },
  ) {
    this.startedAt = this.now();
    this.day = today(this.now());
    this.resetTotals();
    this.load();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private resetTotals(): void {
    for (const op of OPERATIONS) {
      this.totals.set(op, { calls: 0, errors: 0, refused: 0, units: 0, costUsd: 0, latencies: [] });
    }
  }

  private rollover(): void {
    const current = today(this.now());
    if (current === this.day) return;
    this.day = current;
    this.costUsd = 0;
    this.resetTotals();
    this.scheduleSave();
  }

  get budgetUsd(): number {
    return this.options.budgetUsd;
  }

  /** Why new paid work is refused right now, or undefined if it is allowed. */
  unavailableReason(): 'paused' | 'budget' | undefined {
    this.rollover();
    if (this.paused) return 'paused';
    if (this.options.budgetUsd > 0 && this.costUsd >= this.options.budgetUsd) return 'budget';
    return undefined;
  }

  /** Throws a user-facing error when paid work is not allowed. */
  check(op: ProviderOperation): void {
    const reason = this.unavailableReason();
    if (!reason) return;
    this.totals.get(op)!.refused++;
    throw new AppError(
      'UNAVAILABLE',
      reason === 'paused'
        ? 'Translation is paused on this server right now. Please try again later.'
        : 'This demo has reached its translation limit for today. It resets at midnight UTC.',
      503,
    );
  }

  estimate(
    op: ProviderOperation,
    input: { minutes?: number; inChars?: number; outChars?: number },
  ): number {
    const p = this.options.prices;
    switch (op) {
      case 'transcribe':
        return (input.minutes ?? 0) * p.transcribePerMinute;
      case 'translate': {
        const inTokens = Math.ceil((input.inChars ?? 0) / 4) + TRANSLATE_PROMPT_TOKENS;
        const outTokens = Math.ceil((input.outChars ?? 0) / 4);
        return (
          (inTokens * p.translateInputPerMillion + outTokens * p.translateOutputPerMillion) / 1e6
        );
      }
      case 'synthesize':
        return ((input.inChars ?? 0) / 1000) * p.synthesizePer1kChars;
    }
  }

  record(
    op: ProviderOperation,
    result: { ok: boolean; ms: number; units: number; costUsd: number },
  ): void {
    this.rollover();
    const totals = this.totals.get(op)!;
    totals.calls++;
    if (!result.ok) totals.errors++;
    totals.units += result.units;
    totals.costUsd += result.costUsd;
    totals.latencies.push(result.ms);
    if (totals.latencies.length > LATENCY_SAMPLES) totals.latencies.shift();
    if (result.costUsd > 0) {
      this.costUsd += result.costUsd;
      this.scheduleSave();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.scheduleSave();
  }

  snapshot(): UsageSnapshot {
    this.rollover();
    const reason = this.unavailableReason();
    return {
      day: this.day,
      costUsd: round(this.costUsd),
      budgetUsd: this.options.budgetUsd,
      paused: this.paused,
      available: !reason,
      unavailableReason: reason,
      operations: Object.fromEntries(
        OPERATIONS.map((op) => {
          const t = this.totals.get(op)!;
          return [
            op,
            {
              calls: t.calls,
              errors: t.errors,
              refused: t.refused,
              units: round(t.units),
              costUsd: round(t.costUsd),
              p50Ms: percentile(t.latencies, 50),
              p95Ms: percentile(t.latencies, 95),
            },
          ];
        }),
      ) as UsageSnapshot['operations'],
    };
  }

  private load(): void {
    const { file } = this.options;
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Persisted>;
      this.paused = saved.paused === true;
      if (saved.day === this.day && typeof saved.costUsd === 'number') this.costUsd = saved.costUsd;
    } catch {
      // No file yet, or unreadable: start fresh.
    }
  }

  private scheduleSave(): void {
    if (!this.options.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 2000);
    this.saveTimer.unref?.();
  }

  /** Writes the day's spend and the pause switch. Atomic, so a crash can't leave half a file. */
  save(): void {
    const { file } = this.options;
    if (!file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const data: Persisted = { day: this.day, costUsd: this.costUsd, paused: this.paused };
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(data));
      renameSync(`${file}.tmp`, file);
    } catch {
      // Best effort: the in-memory budget still applies.
    }
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
