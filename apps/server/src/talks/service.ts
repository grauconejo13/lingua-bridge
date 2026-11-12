import {
  TALK_CATCH_UP_SEGMENTS,
  TALK_CLOSE,
  TALK_MAX_TEXT_CHARS,
  TALK_MAX_TITLE_CHARS,
  getLanguage,
  type LanguageCode,
  type TalkClientEvent,
  type TalkErrorCode,
  type TalkSegment,
  type TalkServerEvent,
} from '@lingua-bridge/shared';
import { AppError } from '../errors';
import type { SpeechProvider } from '../providers';
import type { Connection } from '../rooms/store';
import type { Listener, SegmentRecord, Talk, TalkStore } from './store';

/** A WebSocket-level failure: sent as an error event, then the socket is closed. */
export class TalkError extends Error {
  constructor(
    readonly code: TalkErrorCode,
    message: string,
    readonly closeCode: number,
  ) {
    super(message);
    this.name = 'TalkError';
  }
}

export type TalkMember =
  { talk: Talk; role: 'presenter' } | { talk: Talk; role: 'listener'; listener: Listener };

export interface TalkServiceOptions {
  maxListeners: number;
  /** Minimum gap between listener-count updates to the presenter. */
  statsIntervalMs?: number;
}

export function cleanTitle(title: string | undefined): string {
  const cleaned = (title ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, TALK_MAX_TITLE_CHARS) || 'Untitled talk';
}

/**
 * Presentation logic, independent of HTTP and WebSocket plumbing so it can be tested with
 * stub connections.
 */
export class TalkService {
  private readonly translating = new Map<string, Promise<void>>();
  private readonly sending = new Map<string, Promise<SegmentRecord>>();
  private readonly statsTimers = new Map<string, NodeJS.Timeout>();
  private readonly statsSentAt = new Map<string, number>();
  /** Synthesized caption audio by segment and language; insertion-ordered for eviction. */
  private readonly speech = new Map<string, Promise<{ audio: Buffer; mimeType: string }>>();
  private static readonly MAX_CACHED_SPEECH = 400;

  constructor(
    readonly store: TalkStore,
    private readonly provider: SpeechProvider,
    private readonly options: TalkServiceOptions,
  ) {}

  // ---------- connections ----------

  async hello(
    connection: Connection,
    hello: Extract<TalkClientEvent, { type: 'hello' }>,
  ): Promise<TalkMember> {
    const talk = this.store.get(hello.talkId);
    if (!talk) {
      throw new TalkError(
        'TALK_NOT_FOUND',
        'This talk has ended or the link is wrong.',
        TALK_CLOSE.TALK_NOT_FOUND,
      );
    }

    if (hello.presenterKey !== undefined) {
      if (!talk.checkKey(hello.presenterKey)) {
        throw new TalkError(
          'FORBIDDEN',
          'This presenter link is incomplete.',
          TALK_CLOSE.FORBIDDEN,
        );
      }
      talk.presenters.add(connection);
      talk.touch();
      this.send(connection, {
        type: 'welcome',
        role: 'presenter',
        talk: talk.info(),
        segments: this.catchUp(talk, hello.lastSeq).map((s) => render(s, talk.language)),
      });
      this.send(connection, { type: 'stats', stats: talk.stats() });
      return { talk, role: 'presenter' };
    }

    if (talk.listeners.size >= this.options.maxListeners) {
      throw new TalkError(
        'TALK_FULL',
        'This talk has reached its audience limit.',
        TALK_CLOSE.TALK_FULL,
      );
    }
    const listener: Listener = { connection, language: hello.language ?? talk.language };
    talk.addListener(listener);
    const segments = await this.prepare(talk, listener.language, this.catchUp(talk, hello.lastSeq));
    // The talk may have ended or the socket closed while translating.
    if (!talk.listeners.has(listener)) return { talk, role: 'listener', listener };
    this.send(connection, {
      type: 'welcome',
      role: 'listener',
      talk: talk.info(),
      segments,
      languageUnavailable: !talk.isServed(listener.language) || undefined,
    });
    this.queueStats(talk);
    return { talk, role: 'listener', listener };
  }

  disconnect(member: TalkMember, connection: Connection): void {
    const { talk } = member;
    if (member.role === 'presenter') {
      talk.presenters.delete(connection);
    } else {
      talk.removeListener(member.listener);
      this.queueStats(talk);
    }
    talk.touch();
  }

  async setLanguage(talk: Talk, listener: Listener, language: LanguageCode): Promise<void> {
    if (listener.language === language) return;
    talk.setListenerLanguage(listener, language);
    this.queueStats(talk);
    this.send(listener.connection, {
      type: 'language',
      language,
      unavailable: !talk.isServed(language),
    });
    // Re-send recent captions in the new language so the screen doesn't mix languages.
    const segments = await this.prepare(
      talk,
      language,
      talk.segments.slice(-TALK_CATCH_UP_SEGMENTS),
    );
    if (listener.language !== language) return; // switched again meanwhile
    for (const segment of segments) this.send(listener.connection, { type: 'segment', segment });
  }

  setStatus(talk: Talk, status: 'live' | 'paused'): void {
    if (talk.status === 'ended' || talk.status === status) return;
    talk.status = status;
    talk.touch();
    this.broadcastAll(talk, { type: 'status', status });
  }

  end(talk: Talk): void {
    if (talk.status === 'ended') return;
    talk.status = 'ended';
    talk.touch();
    this.broadcastAll(talk, { type: 'status', status: 'ended' });
    for (const { connection } of talk.listeners) connection.close(TALK_CLOSE.ENDED, 'ended');
    for (const connection of talk.presenters) connection.close(TALK_CLOSE.ENDED, 'ended');
    talk.listeners.clear();
    talk.presenters.clear();
    clearTimeout(this.statsTimers.get(talk.id));
    this.statsTimers.delete(talk.id);
  }

  // ---------- presenter sends (HTTP, idempotent) ----------

  authorize(talkId: string, key: string | undefined): Talk {
    const talk = this.store.get(talkId);
    if (!talk) throw new AppError('BAD_REQUEST', 'This talk has ended.', 404);
    if (!talk.checkKey(key))
      throw new AppError('BAD_REQUEST', 'Not the presenter of this talk.', 403);
    if (talk.status === 'ended') throw new AppError('BAD_REQUEST', 'This talk has ended.', 410);
    return talk;
  }

  async addText(
    talk: Talk,
    input: { clientSegmentId: string; text: string },
  ): Promise<TalkSegment> {
    const text = input.text.trim();
    if (!text) throw new AppError('BAD_REQUEST', 'Type something first.', 400);
    if (text.length > TALK_MAX_TEXT_CHARS) {
      throw new AppError('BAD_REQUEST', `Keep it under ${TALK_MAX_TEXT_CHARS} characters.`, 400);
    }
    const segment = await this.once(talk, input.clientSegmentId, async () =>
      this.publish(
        talk,
        talk.addSegment({ clientSegmentId: input.clientSegmentId, sourceText: text }),
      ),
    );
    return render(segment, talk.language);
  }

  async addSpeech(
    talk: Talk,
    input: { clientSegmentId: string; audio: Buffer; mimeType: string; durationMs?: number },
  ): Promise<TalkSegment & { transcribeMs?: number }> {
    let transcribeMs: number | undefined;
    const segment = await this.once(talk, input.clientSegmentId, async () => {
      const started = performance.now();
      const { text } = await this.provider.transcribe({
        audio: input.audio,
        mimeType: input.mimeType,
        durationMs: input.durationMs,
        language: getLanguage(talk.language),
      });
      transcribeMs = Math.round(performance.now() - started);
      if (!text) {
        throw new AppError('NO_SPEECH', 'No speech in that segment.', 422);
      }
      return this.publish(
        talk,
        talk.addSegment({ clientSegmentId: input.clientSegmentId, sourceText: text }),
      );
    });
    return { ...render(segment, talk.language), transcribeMs };
  }

  /**
   * Caption audio for one segment in one language. Synthesized once and shared by every
   * listener of that language, so playback cost doesn't grow with the audience.
   */
  speechFor(
    talk: Talk,
    segmentId: string,
    language: LanguageCode,
  ): Promise<{ audio: Buffer; mimeType: string }> {
    const segment = talk.segments.find((s) => s.id === segmentId);
    if (!segment) throw new AppError('BAD_REQUEST', 'That caption is no longer available.', 404);
    if (!talk.isServed(language)) {
      throw new AppError('UNSUPPORTED_LANGUAGE', 'Nobody in this talk reads that language.', 404);
    }
    const key = `${talk.id}:${segment.id}:${language}`;
    let pending = this.speech.get(key);
    if (!pending) {
      pending = this.ensureTranslation(segment, language).then(() => {
        const text = segment.translations[language];
        if (text === undefined) throw new AppError('BAD_REQUEST', 'No caption to speak yet.', 404);
        return this.provider.synthesize({ text, language: getLanguage(language) });
      });
      // A failure shouldn't be cached; the next listener can try again.
      pending.catch(() => this.speech.delete(key));
      this.speech.set(key, pending);
      while (this.speech.size > TalkService.MAX_CACHED_SPEECH) {
        const oldest = this.speech.keys().next().value;
        if (oldest === undefined) break;
        this.speech.delete(oldest);
      }
    }
    return pending;
  }

  // ---------- helpers ----------

  private once(
    talk: Talk,
    clientSegmentId: string,
    create: () => Promise<SegmentRecord>,
  ): Promise<SegmentRecord> {
    const existing = talk.findByClientId(clientSegmentId);
    if (existing) return Promise.resolve(existing);
    const key = `${talk.id}:${clientSegmentId}`;
    const inFlight = this.sending.get(key);
    if (inFlight) return inFlight;
    const promise = create().finally(() => this.sending.delete(key));
    this.sending.set(key, promise);
    return promise;
  }

  /**
   * Sends a new segment to everyone. The presenter and listeners reading the original get it
   * immediately; each translated language goes out as soon as its own translation is done,
   * so one slow language never holds up the others.
   */
  private publish(talk: Talk, segment: SegmentRecord): SegmentRecord {
    for (const connection of talk.presenters) {
      this.send(connection, { type: 'segment', segment: render(segment, talk.language) });
    }
    const served = new Set(talk.translatedLanguages());
    for (const listener of talk.listeners) {
      if (listener.language === talk.language || !served.has(listener.language)) {
        this.send(listener.connection, {
          type: 'segment',
          segment: render(segment, listener.language),
        });
      }
    }
    for (const language of served) {
      void this.ensureTranslation(segment, language)
        .catch(() => segment.failed.add(language))
        .then(() => {
          for (const listener of talk.listeners) {
            if (listener.language === language) {
              this.send(listener.connection, {
                type: 'segment',
                segment: render(segment, language),
              });
            }
          }
        });
    }
    return segment;
  }

  private catchUp(talk: Talk, lastSeq = 0): SegmentRecord[] {
    return talk.segments.filter((s) => s.seq > lastSeq).slice(-TALK_CATCH_UP_SEGMENTS);
  }

  /** Renders segments for one language, translating first when that language is served. */
  private async prepare(
    talk: Talk,
    language: LanguageCode,
    segments: SegmentRecord[],
  ): Promise<TalkSegment[]> {
    if (talk.isServed(language)) {
      await Promise.allSettled(
        segments.map((s) =>
          this.ensureTranslation(s, language).catch(() => s.failed.add(language)),
        ),
      );
    }
    return segments.map((s) => render(s, language));
  }

  async ensureTranslation(segment: SegmentRecord, language: LanguageCode): Promise<void> {
    if (segment.translations[language] !== undefined || segment.failed.has(language)) return;
    const key = `${segment.id}:${language}`;
    let pending = this.translating.get(key);
    if (!pending) {
      pending = this.provider
        .translate({
          text: segment.sourceText,
          from: getLanguage(segment.sourceLanguage),
          to: getLanguage(language),
        })
        .then((result) => {
          segment.translations[language] = result.text;
        })
        .finally(() => this.translating.delete(key));
      this.translating.set(key, pending);
    }
    await pending;
  }

  /** Listener counts change in bursts (a room scanning a QR code); throttle updates. */
  private queueStats(talk: Talk): void {
    if (talk.presenters.size === 0 || this.statsTimers.has(talk.id)) return;
    const interval = this.options.statsIntervalMs ?? 1000;
    const since = Date.now() - (this.statsSentAt.get(talk.id) ?? 0);
    const timer = setTimeout(
      () => {
        this.statsTimers.delete(talk.id);
        this.statsSentAt.set(talk.id, Date.now());
        for (const connection of talk.presenters) {
          this.send(connection, { type: 'stats', stats: talk.stats() });
        }
      },
      Math.max(0, interval - since),
    );
    timer.unref?.();
    this.statsTimers.set(talk.id, timer);
  }

  private broadcastAll(talk: Talk, event: TalkServerEvent): void {
    const data = JSON.stringify(event);
    for (const connection of talk.presenters) connection.send(data);
    for (const { connection } of talk.listeners) connection.send(data);
  }

  send(connection: Connection, event: TalkServerEvent): void {
    connection.send(JSON.stringify(event));
  }
}

export function render(segment: SegmentRecord, language: LanguageCode): TalkSegment {
  return {
    id: segment.id,
    seq: segment.seq,
    sourceLanguage: segment.sourceLanguage,
    sourceText: segment.sourceText,
    language,
    text: segment.translations[language] ?? null,
    createdAt: segment.createdAt,
  };
}
