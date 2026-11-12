import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ROOM_CLIENT_TIMING,
  TALK_CLOSE,
  type LanguageCode,
  type TalkClientEvent,
  type TalkSegment,
  type TalkServerEvent,
} from '@lingua-bridge/shared';
import { socketUrl } from '../lib/config';
import { networkMonitor } from '../lib/network-monitor';
import { initialTalkState, talkReducer } from '../lib/talk-state';

const { reconnectBackoffMs: BACKOFF, pingEveryMs, silenceLimitMs } = ROOM_CLIENT_TIMING;

const FATAL: Record<number, 'TALK_NOT_FOUND' | 'TALK_FULL' | 'FORBIDDEN' | 'ENDED'> = {
  [TALK_CLOSE.TALK_NOT_FOUND]: 'TALK_NOT_FOUND',
  [TALK_CLOSE.TALK_FULL]: 'TALK_FULL',
  [TALK_CLOSE.FORBIDDEN]: 'FORBIDDEN',
  [TALK_CLOSE.ENDED]: 'ENDED',
};

/**
 * The talk's WebSocket for either role: hello, keepalive pings that also time the round
 * trip, reconnect with backoff, and replay of captions missed while away.
 */
export function useTalkConnection({
  talkId,
  presenterKey,
  language,
  onSegment,
}: {
  talkId: string;
  presenterKey?: string;
  language?: LanguageCode;
  /** Called for each new caption that arrives live (not on replay or re-translation). */
  onSegment?: (segment: TalkSegment) => void;
}) {
  const [state, dispatch] = useReducer(talkReducer, initialTalkState);
  const socketRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const seenRef = useRef(new Set<string>());
  const languageRef = useRef(language);
  const onSegmentRef = useRef(onSegment);
  useEffect(() => {
    onSegmentRef.current = onSegment;
  }, [onSegment]);

  const send = useCallback((event: TalkClientEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }, []);

  useEffect(() => {
    if (!language || languageRef.current === language) return;
    languageRef.current = language;
    send({ type: 'language', language });
  }, [language, send]);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;

    const handle = (event: TalkServerEvent) => {
      if (event.type === 'pong' && event.t !== undefined) {
        networkMonitor.addRtt(performance.now() - event.t);
      }
      if (event.type === 'welcome') {
        attempt = 0;
        for (const segment of event.segments) {
          seenRef.current.add(segment.id);
          lastSeqRef.current = Math.max(lastSeqRef.current, segment.seq);
        }
      }
      if (event.type === 'segment') {
        const { segment } = event;
        lastSeqRef.current = Math.max(lastSeqRef.current, segment.seq);
        // A translation can arrive after its original; only the first text counts as new.
        const fresh = !seenRef.current.has(segment.id);
        if (segment.text !== null || segment.language === segment.sourceLanguage) {
          seenRef.current.add(segment.id);
          if (fresh) onSegmentRef.current?.(segment);
        }
      }
      dispatch({ type: 'server', event });
    };

    function connect() {
      if (stopped) return;
      const socket = new WebSocket(socketUrl('/api/talks/ws'));
      socketRef.current = socket;
      let lastHeard = Date.now();
      const ping = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({ type: 'ping', t: performance.now() } satisfies TalkClientEvent),
          );
        }
      };

      socket.onopen = () => {
        lastHeard = Date.now();
        socket.send(
          JSON.stringify({
            type: 'hello',
            talkId,
            presenterKey,
            language: languageRef.current,
            lastSeq: lastSeqRef.current,
          } satisfies TalkClientEvent),
        );
        window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (Date.now() - lastHeard > silenceLimitMs) socket.close(3000, 'silent');
          else ping();
        }, pingEveryMs);
        ping();
      };
      socket.onmessage = (message) => {
        lastHeard = Date.now();
        try {
          handle(JSON.parse(String(message.data)) as TalkServerEvent);
        } catch {
          // Ignore malformed frames.
        }
      };
      socket.onclose = (close) => {
        window.clearInterval(pingTimer);
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        const fatal = FATAL[close.code];
        if (fatal) {
          stopped = true;
          dispatch({ type: 'fatal', code: fatal, message: '' });
          return;
        }
        dispatch({ type: 'status', status: 'reconnecting' });
        const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)] ?? 15_000;
        attempt++;
        retryTimer = window.setTimeout(connect, delay);
      };
    }

    const reconnectNow = () => {
      if (stopped || socketRef.current) return;
      window.clearTimeout(retryTimer);
      attempt = 0;
      connect();
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
      socket?.close(1000, 'unmount');
    };
  }, [talkId, presenterKey]);

  /** Adds a caption returned by an HTTP send, in case the socket is down at that moment. */
  const receive = useCallback((segment: TalkSegment) => {
    lastSeqRef.current = Math.max(lastSeqRef.current, segment.seq);
    seenRef.current.add(segment.id);
    dispatch({ type: 'local', segment });
  }, []);

  return { state, send, receive };
}
