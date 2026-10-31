import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ROOM_CLOSE,
  type ClientEvent,
  type LanguageCode,
  type RoomMessage,
  type ServerEvent,
} from '@lingua-bridge/shared';
import { readRoomSession, writeRoomSession } from '../lib/room-session';
import { initialRoomState, isFatal, roomReducer } from '../lib/room-state';

/** Reconnect delays in ms; the last value repeats. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];
const PING_EVERY_MS = 15_000;
/** No traffic for this long means the connection is dead even if the browser hasn't noticed. */
const SILENCE_LIMIT_MS = 35_000;

const FATAL_CLOSE_CODES: number[] = [
  ROOM_CLOSE.ROOM_NOT_FOUND,
  ROOM_CLOSE.ROOM_FULL,
  ROOM_CLOSE.FORBIDDEN,
  ROOM_CLOSE.REPLACED,
  ROOM_CLOSE.LEFT,
];

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/rooms/ws`;
}

interface Options {
  roomId: string;
  secret: string;
  language: LanguageCode;
  name: string;
  enabled: boolean;
  /** Called once per message from the other person that arrives live (not on replay). */
  onIncoming?: (message: RoomMessage) => void;
}

/**
 * The room's WebSocket: connects, says hello (or resumes), keeps itself alive, reconnects
 * with backoff, and acknowledges messages from the other person as they arrive.
 */
export function useRoomConnection({
  roomId,
  secret,
  language,
  name,
  enabled,
  onIncoming,
}: Options) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);

  const socketRef = useRef<WebSocket | null>(null);
  const participantIdRef = useRef<string | undefined>(undefined);
  const lastSeqRef = useRef(0);
  const knownIdsRef = useRef(new Set<string>());
  const languageRef = useRef(language);
  const nameRef = useRef(name);
  const onIncomingRef = useRef(onIncoming);

  useEffect(() => {
    onIncomingRef.current = onIncoming;
  }, [onIncoming]);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const send = useCallback((event: ClientEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }, []);

  // Tell the server about language changes on an open connection; new hellos use the ref.
  useEffect(() => {
    if (languageRef.current === language) return;
    languageRef.current = language;
    send({ type: 'language', language });
  }, [language, send]);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let lastHeard = Date.now();

    const ackIfNeeded = (message: RoomMessage) => {
      const me = participantIdRef.current;
      if (me && message.senderId !== me && !message.deliveredTo.includes(me)) {
        send({ type: 'ack', messageId: message.id });
      }
    };

    const handle = (event: ServerEvent) => {
      if (event.type === 'welcome') {
        participantIdRef.current = event.participantId;
        attempt = 0;
        const session = readRoomSession(roomId);
        writeRoomSession(roomId, {
          language: languageRef.current,
          name: session?.name ?? nameRef.current,
          resumeToken: event.resumeToken,
        });
        for (const message of event.messages) {
          knownIdsRef.current.add(message.id);
          lastSeqRef.current = Math.max(lastSeqRef.current, message.seq);
        }
      }

      dispatch({ type: 'server', event });

      if (event.type === 'welcome') {
        event.messages.forEach(ackIfNeeded);
      } else if (event.type === 'message') {
        const { message } = event;
        lastSeqRef.current = Math.max(lastSeqRef.current, message.seq);
        const isNew = !knownIdsRef.current.has(message.id);
        knownIdsRef.current.add(message.id);
        if (isNew && message.senderId !== participantIdRef.current) {
          onIncomingRef.current?.(message);
        }
        ackIfNeeded(message);
      }
    };

    const schedule = () => {
      if (stopped) return;
      const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)] ?? 15000;
      attempt++;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, delay);
    };

    function connect() {
      if (stopped) return;
      window.clearTimeout(retryTimer);
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        lastHeard = Date.now();
        const session = readRoomSession(roomId);
        socket.send(
          JSON.stringify({
            type: 'hello',
            roomId,
            secret,
            language: languageRef.current,
            name: nameRef.current || undefined,
            resumeToken: session?.resumeToken,
            lastSeq: lastSeqRef.current,
          } satisfies ClientEvent),
        );
        window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (Date.now() - lastHeard > SILENCE_LIMIT_MS) {
            socket.close(3000, 'silent');
            return;
          }
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        }, PING_EVERY_MS);
      };

      socket.onmessage = (message) => {
        lastHeard = Date.now();
        try {
          handle(JSON.parse(String(message.data)) as ServerEvent);
        } catch {
          // Ignore malformed frames.
        }
      };

      socket.onclose = (close) => {
        window.clearInterval(pingTimer);
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        if (FATAL_CLOSE_CODES.includes(close.code)) {
          if (close.code !== ROOM_CLOSE.LEFT) {
            const code =
              close.code === ROOM_CLOSE.ROOM_NOT_FOUND
                ? 'ROOM_NOT_FOUND'
                : close.code === ROOM_CLOSE.ROOM_FULL
                  ? 'ROOM_FULL'
                  : close.code === ROOM_CLOSE.REPLACED
                    ? 'REPLACED'
                    : 'FORBIDDEN';
            // The error event that preceded the close usually carried a better message.
            dispatch({ type: 'fatal', code, message: '' });
          }
          stopped = true;
          return;
        }
        dispatch({ type: 'status', status: 'reconnecting' });
        schedule();
      };
    }

    const reconnectNow = () => {
      if (stopped) return;
      if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) {
        attempt = 0;
        connect();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconnectNow();
    };

    window.addEventListener('online', reconnectNow);
    document.addEventListener('visibilitychange', onVisible);
    connect();

    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(pingTimer);
      window.removeEventListener('online', reconnectNow);
      document.removeEventListener('visibilitychange', onVisible);
      const socket = socketRef.current;
      socketRef.current = null;
      // Closing while still connecting means the server never sees a hello, so React's
      // development double-mount doesn't take up a seat.
      socket?.close(1000, 'unmount');
    };
  }, [enabled, roomId, secret, send]);

  const leave = useCallback(() => {
    send({ type: 'leave' });
  }, [send]);

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  /**
   * Adds a message returned by an HTTP send. Normally the WebSocket delivers it too, but
   * this keeps the sender's screen correct if the socket is down at that moment.
   */
  const receive = useCallback((message: RoomMessage) => {
    knownIdsRef.current.add(message.id);
    lastSeqRef.current = Math.max(lastSeqRef.current, message.seq);
    dispatch({ type: 'server', event: { type: 'message', message } });
  }, []);

  return { state, send, leave, clear, receive, isFatal };
}
