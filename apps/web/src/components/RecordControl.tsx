import type { CSSProperties } from 'react';
import type { MicState } from '../hooks/useRecorder';
import { formatClock } from '../lib/format';

interface Props {
  state: MicState;
  elapsedMs: number;
  maxMs: number;
  level: number;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onStart: () => void;
  onStop: () => void;
}

export function RecordControl({
  state,
  elapsedMs,
  maxMs,
  level,
  busy,
  onEnable,
  onDisable,
  onStart,
  onStop,
}: Props) {
  if (state === 'unsupported') {
    return (
      <p className="dock-message" role="status">
        This browser can't record audio. Try a recent version of Chrome, Edge, Firefox or Safari.
      </p>
    );
  }

  if (state === 'off' || state === 'requesting' || state === 'denied' || state === 'error') {
    return (
      <div className="consent">
        {state === 'denied' && (
          <p className="dock-message is-warning" role="alert">
            Microphone access is blocked. Allow it in your browser's site settings, then try again.
          </p>
        )}
        {state === 'error' && (
          <p className="dock-message is-warning" role="alert">
            Couldn't start the microphone. Check that one is connected and not in use.
          </p>
        )}
        <button
          type="button"
          className="button primary large"
          onClick={onEnable}
          disabled={state === 'requesting'}
        >
          <MicIcon />
          {state === 'requesting'
            ? 'Waiting for permission…'
            : state === 'off'
              ? 'Turn on microphone'
              : 'Try again'}
        </button>
        <p className="fine-print">
          Your browser will ask first. Nothing is recorded until you tap to speak. Each recording is
          sent once for translation and isn't stored.
        </p>
      </div>
    );
  }

  const recording = state === 'recording';
  const remaining = Math.max(0, maxMs - elapsedMs);

  return (
    <div className="recorder">
      <button
        type="button"
        className={`record-button${recording ? ' is-recording' : ''}`}
        style={{ '--level': level } as CSSProperties}
        onClick={recording ? onStop : onStart}
        aria-pressed={recording}
        aria-label={recording ? 'Stop and translate' : 'Start speaking'}
      >
        <span className="record-ring" aria-hidden="true" />
        {recording ? <StopSquare /> : <MicIcon size={30} />}
      </button>

      <div className="recorder-text" aria-live="polite">
        {recording ? (
          <>
            <strong>Listening · {formatClock(elapsedMs)}</strong>
            <span>
              Tap to stop and translate
              {remaining < 10_000 && ` · stops in ${Math.ceil(remaining / 1000)} s`}
            </span>
          </>
        ) : (
          <>
            <strong>{busy ? 'Translating…' : 'Tap to speak'}</strong>
            <span>Up to {Math.round(maxMs / 1000)} seconds per turn</span>
          </>
        )}
      </div>

      <button
        type="button"
        className="button ghost mic-off"
        onClick={onDisable}
        disabled={recording}
      >
        Turn off mic
      </button>
    </div>
  );
}

function MicIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopSquare() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" />
    </svg>
  );
}
