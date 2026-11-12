import type {
  LanguageCode,
  TalkErrorCode,
  TalkInfo,
  TalkSegment,
  TalkServerEvent,
  TalkStats,
} from '@lingua-bridge/shared';

export type TalkConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TalkState {
  status: TalkConnectionStatus;
  talk?: TalkInfo;
  role?: 'presenter' | 'listener';
  /** Captions in order of `seq`, at most one per id. */
  segments: TalkSegment[];
  stats?: TalkStats;
  /** The listener's language is over the talk's limit, so captions arrive untranslated. */
  languageUnavailable: boolean;
  fatal?: { code: TalkErrorCode | 'ENDED'; message: string };
}

export const initialTalkState: TalkState = {
  status: 'connecting',
  segments: [],
  languageUnavailable: false,
};

/** Keep this many captions on screen; older ones scroll away. */
const MAX_SEGMENTS = 300;

export type TalkAction =
  | { type: 'server'; event: TalkServerEvent }
  | { type: 'status'; status: TalkConnectionStatus }
  | { type: 'fatal'; code: TalkErrorCode | 'ENDED'; message: string }
  | { type: 'local'; segment: TalkSegment };

function upsert(segments: TalkSegment[], segment: TalkSegment): TalkSegment[] {
  const index = segments.findIndex((s) => s.id === segment.id);
  if (index >= 0) {
    const next = [...segments];
    next[index] = segment;
    return next;
  }
  const next = [...segments, segment];
  // Arrival order can differ from seq order when translations finish at different times.
  if (segments.length > 0 && segment.seq < segments[segments.length - 1]!.seq) {
    next.sort((a, b) => a.seq - b.seq);
  }
  return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
}

export function talkReducer(state: TalkState, action: TalkAction): TalkState {
  switch (action.type) {
    case 'status':
      return state.fatal ? state : { ...state, status: action.status };
    case 'fatal':
      return {
        ...state,
        status: 'closed',
        fatal: { code: action.code, message: action.message || state.fatal?.message || '' },
      };
    case 'local':
      return { ...state, segments: upsert(state.segments, action.segment) };
    case 'server': {
      const { event } = action;
      switch (event.type) {
        case 'welcome': {
          let segments = state.segments;
          for (const segment of event.segments) segments = upsert(segments, segment);
          return {
            ...state,
            status: event.talk.status === 'ended' ? 'closed' : 'open',
            talk: event.talk,
            role: event.role,
            segments,
            languageUnavailable: Boolean(event.languageUnavailable),
          };
        }
        case 'segment':
          return { ...state, segments: upsert(state.segments, event.segment) };
        case 'status':
          return state.talk ? { ...state, talk: { ...state.talk, status: event.status } } : state;
        case 'stats':
          return { ...state, stats: event.stats };
        case 'language':
          return { ...state, languageUnavailable: event.unavailable };
        case 'error':
          return { ...state, fatal: { code: event.code, message: event.message } };
        default:
          return state;
      }
    }
  }
}

/** The text to show for a caption: the translation, or the original when there is none. */
export function captionText(segment: TalkSegment): {
  text: string;
  language: LanguageCode;
  fallback: boolean;
} {
  if (segment.text !== null)
    return { text: segment.text, language: segment.language, fallback: false };
  return {
    text: segment.sourceText,
    language: segment.sourceLanguage,
    fallback: segment.language !== segment.sourceLanguage,
  };
}
