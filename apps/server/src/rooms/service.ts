import {
  ROOM_CLOSE,
  ROOM_MAX_NAME_CHARS,
  ROOM_MAX_TEXT_CHARS,
  getLanguage,
  type HelloMessage,
  type LanguageCode,
  type RoomErrorCode,
  type RoomMessage,
  type ServerEvent,
} from '@lingua-bridge/shared';
import { AppError } from '../errors';
import type { SpeechProvider } from '../providers';
import type { Connection, ParticipantRecord, Room, RoomStore } from './store';

/** A WebSocket-level failure: sent as an error event, then the socket is closed. */
export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
    readonly closeCode: number,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

/** How many recent messages to re-translate when someone switches language mid-conversation. */
const RETRANSLATE_ON_LANGUAGE_CHANGE = 10;

export function cleanName(name: string | undefined): string {
  // Strip control characters and collapse whitespace; names are display-only.
  const cleaned = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, ROOM_MAX_NAME_CHARS) || 'Guest';
}

export interface RoomServiceOptions {
  /** A disconnected participant's seat can be reused after this long. */
  staleMs: number;
}

/**
 * Conversation logic, independent of HTTP and WebSocket plumbing so it can be tested
 * with stub connections.
 */
export class RoomService {
  private readonly translating = new Map<string, Promise<void>>();
  private readonly sending = new Map<string, Promise<RoomMessage>>();

  constructor(
    readonly store: RoomStore,
    private readonly provider: SpeechProvider,
    private readonly options: RoomServiceOptions,
  ) {}

  // ---------- connection lifecycle ----------

  async hello(
    connection: Connection,
    hello: HelloMessage,
  ): Promise<{ room: Room; participant: ParticipantRecord }> {
    const room = this.store.get(hello.roomId);
    if (!room) {
      throw new RoomError(
        'ROOM_NOT_FOUND',
        'This conversation has ended or the link is wrong. Start a new one.',
        ROOM_CLOSE.ROOM_NOT_FOUND,
      );
    }
    if (!room.checkSecret(hello.secret)) {
      throw new RoomError(
        'FORBIDDEN',
        'This link is incomplete. Ask for the full link again.',
        ROOM_CLOSE.FORBIDDEN,
      );
    }

    let participant = hello.resumeToken ? room.byToken(hello.resumeToken) : undefined;
    if (participant) {
      if (participant.connection && participant.connection !== connection) {
        this.send(participant.connection, {
          type: 'error',
          code: 'REPLACED',
          message: 'This conversation was opened in another tab or window.',
        });
        participant.connection.close(ROOM_CLOSE.REPLACED, 'replaced');
      }
      participant.language = hello.language;
      if (hello.name) participant.name = cleanName(hello.name);
    } else {
      participant = room.join(
        { name: cleanName(hello.name), language: hello.language },
        this.options.staleMs,
      );
      if (!participant) {
        throw new RoomError(
          'ROOM_FULL',
          'This conversation already has two people in it.',
          ROOM_CLOSE.ROOM_FULL,
        );
      }
    }

    participant.connection = connection;
    participant.disconnectedAt = undefined;
    participant.speaking = false;
    room.touch();

    const missed = room.messagesAfter(hello.lastSeq ?? 0);
    // A failed translation here shouldn't block joining; those messages show the original.
    await Promise.allSettled(missed.map((m) => this.ensureTranslation(m, participant.language)));

    this.send(connection, {
      type: 'welcome',
      participantId: participant.id,
      resumeToken: participant.token,
      participants: room.publicParticipants(),
      messages: missed,
    });
    this.broadcast(room, { type: 'presence', participants: room.publicParticipants() });
    return { room, participant };
  }

  disconnect(room: Room, participant: ParticipantRecord, connection: Connection): void {
    // A replaced socket closing late must not mark the new one as gone.
    if (participant.connection !== connection) return;
    participant.connection = undefined;
    participant.speaking = false;
    participant.disconnectedAt = Date.now();
    room.touch();
    this.broadcast(room, { type: 'presence', participants: room.publicParticipants() });
  }

  leave(room: Room, participant: ParticipantRecord): void {
    participant.connection?.close(ROOM_CLOSE.LEFT, 'left');
    room.participants.delete(participant.id);
    room.touch();
    this.broadcast(room, { type: 'presence', participants: room.publicParticipants() });
  }

  setSpeaking(room: Room, participant: ParticipantRecord, speaking: boolean): void {
    if (participant.speaking === speaking) return;
    participant.speaking = speaking;
    this.broadcast(room, { type: 'presence', participants: room.publicParticipants() });
  }

  async setLanguage(
    room: Room,
    participant: ParticipantRecord,
    language: LanguageCode,
  ): Promise<void> {
    if (participant.language === language) return;
    participant.language = language;
    room.touch();
    this.broadcast(room, { type: 'presence', participants: room.publicParticipants() });

    // Make recent history readable in the new language, oldest first.
    const recent = room.messages.slice(-RETRANSLATE_ON_LANGUAGE_CHANGE);
    for (const message of recent) {
      if (message.translations[language] !== undefined) continue;
      try {
        await this.ensureTranslation(message, language);
        if (participant.connection) this.send(participant.connection, { type: 'message', message });
      } catch {
        // Older messages stay in their original language; new ones will translate normally.
        break;
      }
    }
  }

  ack(room: Room, participant: ParticipantRecord, messageId: string): void {
    const message = room.messages.find((m) => m.id === messageId);
    if (!message || message.senderId === participant.id) return;
    if (message.deliveredTo.includes(participant.id)) return;
    message.deliveredTo.push(participant.id);
    this.broadcast(room, { type: 'delivered', messageId, participantId: participant.id });
  }

  // ---------- sending (HTTP, idempotent) ----------

  authorize(
    roomId: string,
    token: string | undefined,
  ): { room: Room; participant: ParticipantRecord } {
    const room = this.store.get(roomId);
    if (!room) throw new AppError('BAD_REQUEST', 'This conversation has ended.', 404);
    const participant = token ? room.byToken(token) : undefined;
    if (!participant) throw new AppError('BAD_REQUEST', 'Not a member of this conversation.', 403);
    return { room, participant };
  }

  sendText(
    room: Room,
    participant: ParticipantRecord,
    input: { clientMessageId: string; text: string },
  ): Promise<RoomMessage> {
    const text = input.text.trim();
    if (!text) throw new AppError('BAD_REQUEST', 'Message is empty.', 400);
    if (text.length > ROOM_MAX_TEXT_CHARS) {
      throw new AppError(
        'PAYLOAD_TOO_LARGE',
        `Messages can be up to ${ROOM_MAX_TEXT_CHARS} characters.`,
        413,
      );
    }
    return this.once(room, participant, input.clientMessageId, async () => {
      const sourceLanguage = participant.language;
      const { translations, translateMs } = await this.translateForRoom(room, text, sourceLanguage);
      return this.publish(room, {
        clientMessageId: input.clientMessageId,
        senderId: participant.id,
        kind: 'text',
        sourceLanguage,
        sourceText: text,
        translations,
        timings: { transcribeMs: 0, translateMs },
      });
    });
  }

  sendSpeech(
    room: Room,
    participant: ParticipantRecord,
    input: { clientMessageId: string; audio: Buffer; mimeType: string },
  ): Promise<RoomMessage> {
    return this.once(room, participant, input.clientMessageId, async () => {
      const sourceLanguage = participant.language;
      const started = performance.now();
      const { text } = await this.provider.transcribe({
        audio: input.audio,
        mimeType: input.mimeType,
        language: getLanguage(sourceLanguage),
      });
      const transcribeMs = Math.round(performance.now() - started);
      if (!text) {
        throw new AppError(
          'NO_SPEECH',
          "Didn't catch any speech. Try speaking a little longer.",
          422,
        );
      }
      const { translations, translateMs } = await this.translateForRoom(room, text, sourceLanguage);
      return this.publish(room, {
        clientMessageId: input.clientMessageId,
        senderId: participant.id,
        kind: 'speech',
        sourceLanguage,
        sourceText: text,
        translations,
        timings: { transcribeMs, translateMs },
      });
    });
  }

  // ---------- helpers ----------

  /** Runs `create` once per (participant, clientMessageId); retries get the same result. */
  private async once(
    room: Room,
    participant: ParticipantRecord,
    clientMessageId: string,
    create: () => Promise<RoomMessage>,
  ): Promise<RoomMessage> {
    const existing = room.findByClientId(participant.id, clientMessageId);
    if (existing) return existing;
    const key = `${room.id}:${participant.id}:${clientMessageId}`;
    const inFlight = this.sending.get(key);
    if (inFlight) return inFlight;
    const promise = create().finally(() => this.sending.delete(key));
    this.sending.set(key, promise);
    return promise;
  }

  private publish(room: Room, input: Parameters<Room['addMessage']>[0]): RoomMessage {
    const message = room.addMessage(input);
    this.broadcast(room, { type: 'message', message });
    void this.fillMissingTranslations(room, message);
    return message;
  }

  /** Someone may have joined or switched language while this message was being translated. */
  private async fillMissingTranslations(room: Room, message: RoomMessage): Promise<void> {
    const missing = [...room.languages()].filter((l) => message.translations[l] === undefined);
    if (missing.length === 0) return;
    const results = await Promise.allSettled(
      missing.map((l) => this.ensureTranslation(message, l)),
    );
    if (results.some((r) => r.status === 'fulfilled')) {
      this.broadcast(room, { type: 'message', message });
    }
  }

  private async translateForRoom(
    room: Room,
    text: string,
    from: LanguageCode,
  ): Promise<{ translations: RoomMessage['translations']; translateMs: number }> {
    const started = performance.now();
    const translations: RoomMessage['translations'] = { [from]: text };
    const targets = [...room.languages()].filter((language) => language !== from);
    await Promise.all(
      targets.map(async (to) => {
        const result = await this.provider.translate({
          text,
          from: getLanguage(from),
          to: getLanguage(to),
        });
        translations[to] = result.text;
      }),
    );
    return { translations, translateMs: Math.round(performance.now() - started) };
  }

  /** Adds a translation to a stored message if it is missing (for late joiners or language switches). */
  async ensureTranslation(message: RoomMessage, language: LanguageCode): Promise<void> {
    if (message.translations[language] !== undefined) return;
    if (language === message.sourceLanguage) {
      message.translations[language] = message.sourceText;
      return;
    }
    const key = `${message.id}:${language}`;
    let pending = this.translating.get(key);
    if (!pending) {
      pending = this.provider
        .translate({
          text: message.sourceText,
          from: getLanguage(message.sourceLanguage),
          to: getLanguage(language),
        })
        .then((result) => {
          message.translations[language] = result.text;
        })
        .finally(() => this.translating.delete(key));
      this.translating.set(key, pending);
    }
    await pending;
  }

  broadcast(room: Room, event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const participant of room.participants.values()) {
      participant.connection?.send(data);
    }
  }

  send(connection: Connection, event: ServerEvent): void {
    connection.send(JSON.stringify(event));
  }
}
