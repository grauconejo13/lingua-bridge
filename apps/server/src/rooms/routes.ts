import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import {
  LANGUAGES,
  ROOM_CLOSE,
  ROOM_MAX_NAME_CHARS,
  type ClientEvent,
  type CreateRoomResponse,
  type HelloMessage,
} from '@lingua-bridge/shared';
import type { AppConfig } from '../config';
import { AppError } from '../errors';
import type { SpeechProvider } from '../providers';
import { readAudioUpload } from '../upload';
import { RoomError, RoomService } from './service';
import { RoomStore, type Connection, type ParticipantRecord, type Room } from './store';

const languageCode = z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]);
const clientMessageId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const HelloSchema = z.object({
  type: z.literal('hello'),
  roomId: z.string().min(1).max(64),
  secret: z.string().min(1).max(128),
  language: languageCode,
  name: z
    .string()
    .max(ROOM_MAX_NAME_CHARS * 2)
    .optional(),
  resumeToken: z.string().max(128).optional(),
  lastSeq: z.number().int().min(0).optional(),
});

const ClientEventSchema = z.discriminatedUnion('type', [
  HelloSchema,
  z.object({ type: z.literal('speaking'), speaking: z.boolean() }),
  z.object({ type: z.literal('language'), language: languageCode }),
  z.object({ type: z.literal('ack'), messageId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('leave') }),
]);

const SendTextSchema = z.object({ clientMessageId, text: z.string().max(4000) });

/** A participant has this long after connecting to say hello. */
const HELLO_TIMEOUT_MS = 10_000;
/** Server-side heartbeat that clears half-open TCP connections. */
const HEARTBEAT_MS = 30_000;
/** Per-socket event budget: generous for presence/acks, low enough to stop floods. */
const EVENT_BUDGET = { max: 60, windowMs: 10_000 };

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

function parseEvent(raw: string): ClientEvent | undefined {
  try {
    const result = ClientEventSchema.safeParse(JSON.parse(raw));
    return result.success ? (result.data as ClientEvent) : undefined;
  } catch {
    return undefined;
  }
}

export async function registerRooms(
  app: FastifyInstance,
  { config, provider }: { config: AppConfig; provider: SpeechProvider },
): Promise<RoomService> {
  const store = new RoomStore(config.rooms);
  const service = new RoomService(store, provider, { staleMs: 5 * 60_000 });

  const sweeper = setInterval(() => store.sweep(), 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));

  await app.register(websocket, {
    options: { maxPayload: 16 * 1024 },
  });

  app.post('/api/rooms', async (): Promise<CreateRoomResponse> => {
    const created = store.create();
    if (!created) {
      throw new AppError(
        'UNAVAILABLE',
        'The server is busy right now. Try again in a few minutes.',
        503,
      );
    }
    return {
      roomId: created.room.id,
      secret: created.secret,
      idleMinutes: Math.round(config.rooms.idleMs / 60_000),
    };
  });

  app.post<{ Params: { roomId: string } }>('/api/rooms/:roomId/messages', async (request) => {
    const { room, participant } = service.authorize(request.params.roomId, bearer(request));
    const body = SendTextSchema.safeParse(request.body);
    if (!body.success) throw new AppError('BAD_REQUEST', 'Invalid message.', 400);
    const message = await service.sendText(room, participant, body.data);
    request.log.info(
      { room: room.id, kind: 'text', chars: message.sourceText.length, ...message.timings },
      'room message',
    );
    return message;
  });

  app.post<{ Params: { roomId: string } }>('/api/rooms/:roomId/utterances', async (request) => {
    const { room, participant } = service.authorize(request.params.roomId, bearer(request));
    const { fields, audio, mimeType } = await readAudioUpload(request);
    const id = clientMessageId.safeParse(fields.clientMessageId);
    if (!id.success) throw new AppError('BAD_REQUEST', 'Missing or invalid clientMessageId.', 400);
    const message = await service.sendSpeech(room, participant, {
      clientMessageId: id.data,
      audio,
      mimeType,
    });
    request.log.info(
      { room: room.id, kind: 'speech', audioBytes: audio.byteLength, ...message.timings },
      'room message',
    );
    return message;
  });

  app.get('/api/rooms/ws', { websocket: true }, (socket: WebSocket, request) => {
    const connection: Connection = {
      send: (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
      close: (code, reason) => socket.close(code, reason),
    };

    let joined: { room: Room; participant: ParticipantRecord } | undefined;
    let joining = false;
    let alive = true;
    let budget = EVENT_BUDGET.max;
    let windowStart = Date.now();

    const fail = (error: RoomError) => {
      service.send(connection, { type: 'error', code: error.code, message: error.message });
      socket.close(error.closeCode, error.code);
    };

    const helloTimer = setTimeout(() => {
      if (!joined) fail(new RoomError('BAD_MESSAGE', 'Expected hello.', ROOM_CLOSE.FORBIDDEN));
    }, HELLO_TIMEOUT_MS);

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on('pong', () => {
      alive = true;
    });

    socket.on('message', (data, isBinary) => {
      alive = true;
      const now = Date.now();
      if (now - windowStart > EVENT_BUDGET.windowMs) {
        windowStart = now;
        budget = EVENT_BUDGET.max;
      }
      if (--budget < 0) {
        fail(new RoomError('RATE_LIMITED', 'Too many events.', ROOM_CLOSE.RATE_LIMITED));
        return;
      }

      const event = isBinary ? undefined : parseEvent(data.toString());
      if (!event) {
        service.send(connection, { type: 'error', code: 'BAD_MESSAGE', message: 'Bad message.' });
        return;
      }

      if (event.type === 'ping') {
        service.send(connection, { type: 'pong' });
        return;
      }

      if (event.type === 'hello') {
        if (joined || joining) return;
        joining = true;
        clearTimeout(helloTimer);
        service
          .hello(connection, event as HelloMessage)
          .then((result) => {
            joined = result;
            request.log.info({ room: result.room.id }, 'participant connected');
          })
          .catch((error: unknown) => {
            if (error instanceof RoomError) fail(error);
            else {
              request.log.error({ err: error }, 'room hello failed');
              socket.close(1011, 'error');
            }
          })
          .finally(() => {
            joining = false;
          });
        return;
      }

      if (!joined) return;
      const { room, participant } = joined;
      switch (event.type) {
        case 'speaking':
          service.setSpeaking(room, participant, event.speaking);
          break;
        case 'language':
          void service.setLanguage(room, participant, event.language);
          break;
        case 'ack':
          service.ack(room, participant, event.messageId);
          break;
        case 'leave':
          service.leave(room, participant);
          joined = undefined;
          break;
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      if (joined) service.disconnect(joined.room, joined.participant, connection);
    });
  });

  return service;
}
