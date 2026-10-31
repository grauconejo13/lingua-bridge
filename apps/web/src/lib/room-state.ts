import type { Participant, RoomErrorCode, RoomMessage, ServerEvent } from '@lingua-bridge/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomState {
  status: ConnectionStatus;
  /** Set when the server refused us for good (room gone, full, bad link, replaced). */
  fatal: { code: RoomErrorCode; message: string } | undefined;
  participantId: string | undefined;
  participants: Participant[];
  /** Ordered by seq. */
  messages: RoomMessage[];
  /** Highest seq received, sent on reconnect so the server can replay what was missed. */
  lastSeq: number;
  /** Messages at or below this seq were cleared from this screen and are not shown again. */
  hiddenThroughSeq: number;
}

export const initialRoomState: RoomState = {
  status: 'connecting',
  fatal: undefined,
  participantId: undefined,
  participants: [],
  messages: [],
  lastSeq: 0,
  hiddenThroughSeq: 0,
};

export type RoomAction =
  | { type: 'server'; event: ServerEvent }
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'fatal'; code: RoomErrorCode; message: string }
  | { type: 'clear' };

const FATAL_CODES: RoomErrorCode[] = ['ROOM_NOT_FOUND', 'ROOM_FULL', 'FORBIDDEN', 'REPLACED'];

export function isFatal(code: RoomErrorCode): boolean {
  return FATAL_CODES.includes(code);
}

/**
 * Inserts by seq, or merges into an existing copy. Copies can arrive out of order (the
 * HTTP response and the WebSocket push race), so translations and receipts are unioned
 * rather than overwritten.
 */
export function upsertMessage(messages: RoomMessage[], message: RoomMessage): RoomMessage[] {
  const index = messages.findIndex((m) => m.id === message.id);
  if (index >= 0) {
    const existing = messages[index]!;
    const next = messages.slice();
    next[index] = {
      ...existing,
      ...message,
      translations: { ...existing.translations, ...message.translations },
      deliveredTo: [...new Set([...existing.deliveredTo, ...message.deliveredTo])],
    };
    return next;
  }
  const next = [...messages, message];
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'status':
      return state.status === 'closed' ? state : { ...state, status: action.status };
    case 'fatal':
      // Keep the server's own explanation if an error event already arrived.
      return {
        ...state,
        status: 'closed',
        fatal: state.fatal ?? { code: action.code, message: action.message },
      };
    case 'clear':
      return { ...state, messages: [], hiddenThroughSeq: state.lastSeq };
    case 'server': {
      const event = action.event;
      switch (event.type) {
        case 'welcome': {
          let messages = state.messages;
          for (const message of event.messages) {
            if (message.seq > state.hiddenThroughSeq) messages = upsertMessage(messages, message);
          }
          return {
            ...state,
            status: 'open',
            fatal: undefined,
            participantId: event.participantId,
            participants: event.participants,
            messages,
            lastSeq: Math.max(state.lastSeq, ...event.messages.map((m) => m.seq)),
          };
        }
        case 'presence':
          return { ...state, participants: event.participants };
        case 'message': {
          if (event.message.seq <= state.hiddenThroughSeq) return state;
          return {
            ...state,
            messages: upsertMessage(state.messages, event.message),
            lastSeq: Math.max(state.lastSeq, event.message.seq),
          };
        }
        case 'delivered':
          return {
            ...state,
            messages: state.messages.map((m) =>
              m.id === event.messageId && !m.deliveredTo.includes(event.participantId)
                ? { ...m, deliveredTo: [...m.deliveredTo, event.participantId] }
                : m,
            ),
          };
        case 'error':
          return isFatal(event.code)
            ? { ...state, status: 'closed', fatal: { code: event.code, message: event.message } }
            : state;
        case 'pong':
          return state;
      }
    }
  }
  return state;
}
