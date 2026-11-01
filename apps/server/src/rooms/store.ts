import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ROOM_MAX_PARTICIPANTS,
  type LanguageCode,
  type Participant,
  type RoomMessage,
} from '@lingua-bridge/shared';

/** Anything that can receive server events; a WebSocket in production, a stub in tests. */
export interface Connection {
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface ParticipantRecord {
  id: string;
  /** Lets the same person rejoin after a refresh or dropped connection. Never broadcast. */
  token: string;
  name: string;
  language: LanguageCode;
  speaking: boolean;
  connection: Connection | undefined;
  /** When the participant last disconnected, for replacing abandoned seats. */
  disconnectedAt: number | undefined;
}

const MAX_HISTORY = 100;

export const randomToken = (bytes: number) => randomBytes(bytes).toString('base64url');

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class Room {
  readonly participants = new Map<string, ParticipantRecord>();
  readonly messages: RoomMessage[] = [];
  private nextSeq = 1;
  lastActivity: number;

  constructor(
    readonly id: string,
    private readonly secret: string,
    private readonly now: () => number,
  ) {
    this.lastActivity = now();
  }

  checkSecret(candidate: string): boolean {
    return safeEqual(candidate, this.secret);
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  byToken(token: string): ParticipantRecord | undefined {
    for (const participant of this.participants.values()) {
      if (safeEqual(participant.token, token)) return participant;
    }
    return undefined;
  }

  /**
   * Adds a participant, or returns undefined if both seats are taken by people who are
   * connected or left recently. A seat abandoned for longer than `staleMs` is reused, so a
   * person who lost their resume token (cleared storage) can still get back in.
   */
  join(
    input: { name: string; language: LanguageCode },
    staleMs: number,
  ): ParticipantRecord | undefined {
    if (this.participants.size >= ROOM_MAX_PARTICIPANTS) {
      const now = this.now();
      const stale = [...this.participants.values()].find(
        (p) => !p.connection && p.disconnectedAt !== undefined && now - p.disconnectedAt > staleMs,
      );
      if (!stale) return undefined;
      this.participants.delete(stale.id);
    }
    const participant: ParticipantRecord = {
      id: randomToken(6),
      token: randomToken(16),
      name: input.name,
      language: input.language,
      speaking: false,
      connection: undefined,
      disconnectedAt: undefined,
    };
    this.participants.set(participant.id, participant);
    this.touch();
    return participant;
  }

  publicParticipants(): Participant[] {
    return [...this.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      language: p.language,
      connected: Boolean(p.connection),
      speaking: p.speaking,
    }));
  }

  /** Languages that messages must be available in right now. */
  languages(): Set<LanguageCode> {
    return new Set([...this.participants.values()].map((p) => p.language));
  }

  findByClientId(senderId: string, clientMessageId: string): RoomMessage | undefined {
    return this.messages.find(
      (m) => m.senderId === senderId && m.clientMessageId === clientMessageId,
    );
  }

  addMessage(input: Omit<RoomMessage, 'id' | 'seq' | 'createdAt' | 'deliveredTo'>): RoomMessage {
    const message: RoomMessage = {
      ...input,
      id: randomToken(9),
      seq: this.nextSeq++,
      createdAt: new Date(this.now()).toISOString(),
      deliveredTo: [],
    };
    this.messages.push(message);
    if (this.messages.length > MAX_HISTORY) this.messages.shift();
    this.touch();
    return message;
  }

  messagesAfter(seq: number): RoomMessage[] {
    return this.messages.filter((m) => m.seq > seq);
  }

  hasConnections(): boolean {
    return [...this.participants.values()].some((p) => p.connection);
  }
}

export interface RoomStoreOptions {
  maxRooms: number;
  idleMs: number;
  now?: () => number;
}

/**
 * In-memory rooms. Nothing is written to disk: restarting the server ends every
 * conversation, which matches the no-retention default.
 */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly now: () => number;

  constructor(private readonly options: RoomStoreOptions) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Returns undefined when the server is at its room limit (after sweeping idle rooms). */
  create(): { room: Room; secret: string } | undefined {
    if (this.rooms.size >= this.options.maxRooms) this.sweep();
    if (this.rooms.size >= this.options.maxRooms) return undefined;
    let id = randomToken(8);
    while (this.rooms.has(id)) id = randomToken(8);
    const secret = randomToken(16);
    const room = new Room(id, secret, this.now);
    this.rooms.set(id, room);
    return { room, secret };
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Removes rooms with nobody connected and no activity for `idleMs`. Returns how many. */
  sweep(): number {
    const cutoff = this.now() - this.options.idleMs;
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (!room.hasConnections() && room.lastActivity < cutoff) {
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
