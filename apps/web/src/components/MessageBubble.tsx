import { getLanguage, type LanguageCode, type RoomMessage } from '@lingua-bridge/shared';

export interface OutgoingItem {
  clientMessageId: string;
  kind: 'speech' | 'text';
  /** Typed text, or undefined for speech that hasn't been transcribed yet. */
  text?: string;
  audio?: Blob;
  status: 'sending' | 'failed';
  error?: string;
  retryable?: boolean;
}

interface Props {
  myLanguage: LanguageCode;
  partnerName: string | undefined;
  partnerLanguage: LanguageCode | undefined;
  partnerId: string | undefined;
  partnerConnected: boolean;
  demo: boolean;
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A message from the other person: shown big in my language, with the original underneath. */
export function IncomingBubble({
  message,
  myLanguage,
  partnerName,
  demo,
  playing,
  loadingSpeech,
  speechError,
  onPlay,
  onStop,
}: Pick<Props, 'myLanguage' | 'partnerName' | 'demo'> & {
  message: RoomMessage;
  playing: boolean;
  loadingSpeech: boolean;
  speechError?: string;
  onPlay: () => void;
  onStop: () => void;
}) {
  const from = getLanguage(message.sourceLanguage);
  const mine = getLanguage(myLanguage);
  const translated = message.translations[myLanguage];
  const sameLanguage = message.sourceLanguage === myLanguage;

  return (
    <article className="bubble incoming" aria-label={`${partnerName ?? 'Them'} said`}>
      <header className="caption-meta">
        <span className="who">{partnerName ?? 'Them'}</span>
        {message.kind === 'text' && <span className="chip">Typed</span>}
        {demo && <span className="chip demo">Demo</span>}
        <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
      </header>

      {translated !== undefined ? (
        <p className="caption-translation" lang={mine.code} dir="auto">
          {translated}
        </p>
      ) : (
        <p className="caption-pending">Translating into {mine.englishName}…</p>
      )}
      {!sameLanguage && (
        <p className="caption-source" lang={from.code} dir="auto">
          <span className="visually-hidden">Original in {from.englishName}: </span>
          {message.sourceText}
        </p>
      )}

      {translated !== undefined && (
        <div className="caption-actions">
          {playing ? (
            <button type="button" className="button" onClick={onStop} aria-label="Stop speech">
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="button"
              onClick={onPlay}
              disabled={loadingSpeech}
              aria-label={`Play in ${mine.englishName}`}
            >
              {loadingSpeech ? 'Loading…' : 'Play'}
            </button>
          )}
          {speechError && (
            <span className="speech-error" role="status">
              {speechError}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

/** My own message: what I said, what the other person sees, and whether it reached them. */
export function OutgoingBubble({
  message,
  partnerName,
  partnerLanguage,
  partnerId,
  partnerConnected,
  demo,
}: Omit<Props, 'myLanguage'> & { message: RoomMessage }) {
  const from = getLanguage(message.sourceLanguage);
  const theirs = partnerLanguage ? message.translations[partnerLanguage] : undefined;
  const delivered = partnerId ? message.deliveredTo.includes(partnerId) : false;
  const name = partnerName ?? 'the other person';

  let status: string;
  if (delivered) status = 'Delivered';
  else if (!partnerId) status = `Sent · waiting for someone to join`;
  else if (!partnerConnected) status = `Sent · ${name} will get it when they reconnect`;
  else status = 'Sent';

  return (
    <article className="bubble outgoing" aria-label="You said">
      <header className="caption-meta">
        <span className="who">You</span>
        {message.kind === 'text' && <span className="chip">Typed</span>}
        {demo && <span className="chip demo">Demo</span>}
        <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
      </header>
      <p className="caption-own" lang={from.code} dir="auto">
        {message.sourceText}
      </p>
      {theirs !== undefined && partnerLanguage && partnerLanguage !== message.sourceLanguage && (
        <p className="caption-source" lang={partnerLanguage} dir="auto">
          <span className="they-see">{name} sees: </span>
          {theirs}
        </p>
      )}
      <p className={`delivery${delivered ? ' is-delivered' : ''}`}>
        <DeliveryIcon delivered={delivered} /> {status}
      </p>
    </article>
  );
}

/** A message still on its way to the server, or one that failed to send. */
export function PendingBubble({
  item,
  onRetry,
  onDiscard,
}: {
  item: OutgoingItem;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const failed = item.status === 'failed';
  return (
    <article
      className={`bubble outgoing${failed ? ' is-failed' : ' is-pending'}`}
      aria-busy={!failed}
      aria-label={failed ? 'Not sent' : 'Sending'}
    >
      <header className="caption-meta">
        <span className="who">You</span>
        {item.kind === 'text' && <span className="chip">Typed</span>}
      </header>
      {item.text ? (
        <p className="caption-own" dir="auto">
          {item.text}
        </p>
      ) : (
        <div className="skeleton" aria-hidden="true">
          <span />
        </div>
      )}
      {failed ? (
        <>
          <p className="caption-error">{item.error}</p>
          <div className="caption-actions">
            {item.retryable && (
              <button type="button" className="button" onClick={onRetry}>
                Retry
              </button>
            )}
            <button type="button" className="button ghost" onClick={onDiscard}>
              Discard
            </button>
          </div>
        </>
      ) : (
        <p className="delivery">{item.kind === 'speech' ? 'Translating…' : 'Sending…'}</p>
      )}
    </article>
  );
}

function DeliveryIcon({ delivered }: { delivered: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d={delivered ? 'M2 13l4 4L16 7M9 15l2 2L22 7' : 'M5 13l4 4L19 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
