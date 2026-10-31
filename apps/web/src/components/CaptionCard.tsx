import { getLanguage } from '@lingua-bridge/shared';
import { formatSeconds } from '../lib/format';
import type { Caption } from '../types';

interface Props {
  caption: Caption;
  playing: boolean;
  loadingSpeech: boolean;
  speechError?: string;
  onPlay: () => void;
  onStop: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

export function CaptionCard({
  caption,
  playing,
  loadingSpeech,
  speechError,
  onPlay,
  onStop,
  onRetry,
  onDiscard,
}: Props) {
  const from = getLanguage(caption.sourceLanguage);
  const to = getLanguage(caption.targetLanguage);
  const pair = (
    <span className="pair">
      <abbr title={from.englishName}>{from.code.toUpperCase()}</abbr>
      <span aria-hidden="true"> → </span>
      <span className="visually-hidden"> to </span>
      <abbr title={to.englishName}>{to.code.toUpperCase()}</abbr>
    </span>
  );

  if (caption.status === 'pending') {
    return (
      <article className="caption is-pending" aria-busy="true">
        <header className="caption-meta">
          {pair}
          <span className="status-text">Translating…</span>
        </header>
        <div className="skeleton" aria-hidden="true">
          <span />
          <span />
        </div>
      </article>
    );
  }

  if (caption.status === 'failed') {
    return (
      <article className="caption is-failed" role="group" aria-label="Failed translation">
        <header className="caption-meta">
          {pair}
          <span className="status-text">Not translated</span>
        </header>
        <p className="caption-error">{caption.message}</p>
        <div className="caption-actions">
          {caption.retryable && (
            <button type="button" className="button" onClick={onRetry}>
              Retry
            </button>
          )}
          <button type="button" className="button ghost" onClick={onDiscard}>
            Discard
          </button>
        </div>
      </article>
    );
  }

  const { timings, clientMs } = caption;
  return (
    <article className="caption">
      <header className="caption-meta">
        {pair}
        {caption.demo && (
          <span className="chip demo" title="Placeholder text from the demo provider">
            Demo
          </span>
        )}
        <span
          className="latency"
          title={`Transcribe ${timings.transcribeMs} ms · Translate ${timings.translateMs} ms · Server ${timings.totalMs} ms · Including upload ${clientMs} ms`}
        >
          <span className="visually-hidden">Took </span>
          {formatSeconds(clientMs)}
        </span>
      </header>

      <p className="caption-source" lang={from.code} dir="auto">
        {caption.sourceText}
      </p>
      {caption.sourceLanguage !== caption.targetLanguage && (
        <p className="caption-translation" lang={to.code} dir="auto">
          {caption.translatedText}
        </p>
      )}

      <div className="caption-actions">
        {playing ? (
          <button type="button" className="button" onClick={onStop} aria-label="Stop speech">
            <StopIcon /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="button"
            onClick={onPlay}
            disabled={loadingSpeech}
            aria-label={`Play ${to.englishName} speech`}
          >
            <PlayIcon /> {loadingSpeech ? 'Loading…' : 'Play'}
          </button>
        )}
        {speechError && (
          <span className="speech-error" role="status">
            {speechError}
          </span>
        )}
      </div>
    </article>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}
