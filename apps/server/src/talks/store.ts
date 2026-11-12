import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { LanguageCode, TalkInfo, TalkStats, TalkStatus } from '@lingua-bridge/shared';
import type { Connection } from '../rooms/store';

const MAX_HISTORY = 200;

const randomToken = (bytes: number) => randomBytes(bytes).toString('base64url');

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A stored segment, with every translation made so far. */
export interface SegmentRecord {
  id: string;
  seq: number;
  clientSegmentId: string;
  sourceLanguage: LanguageCode;
  sourceText: string;
  translations: Partial<Record<LanguageCode, string>>;
  /** Languages whose translation failed, so listeners get the original instead of waiting. */
  failed: Set<LanguageCode>;
  createdAt: string;
}

export interface Listener {
  connection: Connection;
  language: LanguageCode;
}

export class Talk {
  readonly segments: SegmentRecord[] = [];
  readonly listeners = new Set<Listener>();
  readonly presenters = new Set<Connection>();
  status: TalkStatus = 'paused';
  lastActivity: number;
  private nextSeq = 1;

  constructor(
    readonly id: string,
    readonly title: string,
    readonly language: LanguageCode,
    private readonly presenterKey: string,
    readonly maxLanguages: number,
    private readonly now: () => number,
  ) {
    this.lastActivity = now();
  }

  checkKey(candidate: string | undefined): boolean {
    return candidate !== undefined && safeEqual(candidate, this.presenterKey);
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  info(): TalkInfo {
    return {
      id: this.id,
      title: this.title,
      language: this.language,
      status: this.status,
      maxLanguages: this.maxLanguages,
    };
  }

  /**
   * Languages being translated into: the first `maxLanguages` distinct listener languages
   * other than the presenter's, in order of first use, so a newcomer never bumps an
   * existing language.
   */
  translatedLanguages(): LanguageCode[] {
    const result: LanguageCode[] = [];
    for (const language of this.languageOrder) {
      if (result.length >= this.maxLanguages) break;
      if (language !== this.language && this.inUse(language)) result.push(language);
    }
    return result;
  }

  /** Whether a listener reading `language` gets translations (or reads the original). */
  isServed(language: LanguageCode): boolean {
    return language === this.language || this.translatedLanguages().includes(language);
  }

  private languageOrder: LanguageCode[] = [];

  addListener(listener: Listener): void {
    this.listeners.add(listener);
    this.noteLanguage(listener.language);
    this.touch();
  }

  setListenerLanguage(listener: Listener, language: LanguageCode): void {
    listener.language = language;
    this.noteLanguage(language);
    this.touch();
  }

  private noteLanguage(language: LanguageCode): void {
    // Drop languages nobody reads any more, so their slot frees up for others.
    this.languageOrder = this.languageOrder.filter((l) => this.inUse(l));
    if (!this.languageOrder.includes(language)) this.languageOrder.push(language);
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
    this.languageOrder = this.languageOrder.filter((l) => this.inUse(l));
  }

  private inUse(language: LanguageCode): boolean {
    for (const listener of this.listeners) if (listener.language === language) return true;
    return false;
  }

  stats(): TalkStats {
    const byLanguage: TalkStats['byLanguage'] = {};
    for (const { language } of this.listeners) {
      byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    }
    return {
      listeners: this.listeners.size,
      byLanguage,
      translating: this.translatedLanguages(),
    };
  }

  findByClientId(clientSegmentId: string): SegmentRecord | undefined {
    return this.segments.find((s) => s.clientSegmentId === clientSegmentId);
  }

  addSegment(input: { clientSegmentId: string; sourceText: string }): SegmentRecord {
    const segment: SegmentRecord = {
      id: randomToken(9),
      seq: this.nextSeq++,
      clientSegmentId: input.clientSegmentId,
      sourceLanguage: this.language,
      sourceText: input.sourceText,
      translations: { [this.language]: input.sourceText },
      failed: new Set(),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.segments.push(segment);
    if (this.segments.length > MAX_HISTORY) this.segments.shift();
    this.touch();
    return segment;
  }

  hasConnections(): boolean {
    return this.listeners.size > 0 || this.presenters.size > 0;
  }
}

export interface TalkStoreOptions {
  maxTalks: number;
  idleMs: number;
  maxLanguages: number;
  now?: () => number;
}

/** In-memory talks. Nothing is written to disk; a restart ends every talk. */
export class TalkStore {
  private readonly talks = new Map<string, Talk>();
  private readonly now: () => number;

  constructor(private readonly options: TalkStoreOptions) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.talks.size;
  }

  create(input: {
    title: string;
    language: LanguageCode;
  }): { talk: Talk; key: string } | undefined {
    if (this.talks.size >= this.options.maxTalks) this.sweep();
    if (this.talks.size >= this.options.maxTalks) return undefined;
    let id = randomToken(8);
    while (this.talks.has(id)) id = randomToken(8);
    const key = randomToken(18);
    const talk = new Talk(
      id,
      input.title,
      input.language,
      key,
      this.options.maxLanguages,
      this.now,
    );
    this.talks.set(id, talk);
    return { talk, key };
  }

  get(id: string): Talk | undefined {
    return this.talks.get(id);
  }

  delete(id: string): void {
    this.talks.delete(id);
  }

  /** Removes talks with nobody connected and no activity for `idleMs`. */
  sweep(): number {
    const cutoff = this.now() - this.options.idleMs;
    let removed = 0;
    for (const [id, talk] of this.talks) {
      if (!talk.hasConnections() && talk.lastActivity < cutoff) {
        this.talks.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
