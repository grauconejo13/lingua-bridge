import type { ReactNode } from 'react';
import type { HealthState } from '../hooks/useHealth';
import type { TextSize } from '../types';
import { SettingsMenu } from './SettingsMenu';

interface Props {
  online: boolean;
  health: HealthState;
  onCheckHealth: () => void;
  textSize: TextSize;
  autoplay: boolean;
  onTextSize: (size: TextSize) => void;
  onAutoplay: (value: boolean) => void;
  canClear: boolean;
  onClear: () => void;
  clearLabel?: string;
  offlineMessage: string;
  /** Extra controls on the right of the top bar (for example a mode link). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Top bar, status, settings and the standard banners shared by every screen. */
export function AppShell({
  online,
  health,
  onCheckHealth,
  textSize,
  autoplay,
  onTextSize,
  onAutoplay,
  canClear,
  onClear,
  clearLabel,
  offlineMessage,
  actions,
  children,
}: Props) {
  const demoMode = health.status === 'ok' && health.health.demoMode;

  return (
    <div className="app" data-text-size={textSize}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Lingua Bridge home">
          <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
            <path
              d="M8 40c8-14 16-14 24 0s16 14 24 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <circle cx="14" cy="20" r="6" fill="var(--ink)" />
            <circle cx="50" cy="20" r="6" fill="var(--amber)" />
          </svg>
          <h1>Lingua Bridge</h1>
        </a>
        <div className="topbar-right">
          {actions}
          <ConnectionStatus online={online} health={health} onRetry={onCheckHealth} />
          <SettingsMenu
            textSize={textSize}
            autoplay={autoplay}
            canClear={canClear}
            clearLabel={clearLabel}
            onTextSize={onTextSize}
            onAutoplay={onAutoplay}
            onClear={onClear}
          />
        </div>
      </header>

      {demoMode && (
        <p className="banner demo" role="note">
          <strong>Demo mode.</strong> The server is using placeholder text, not real translation.
          Set <code>PROVIDER=openai</code> to translate your actual speech.
        </p>
      )}
      {health.status === 'error' && (
        <p className="banner error" role="alert">
          {health.message}{' '}
          <button type="button" className="link-button" onClick={onCheckHealth}>
            Try again
          </button>
        </p>
      )}
      {!online && (
        <p className="banner warning" role="alert">
          {offlineMessage}
        </p>
      )}

      {children}
    </div>
  );
}

function ConnectionStatus({
  online,
  health,
  onRetry,
}: {
  online: boolean;
  health: HealthState;
  onRetry: () => void;
}) {
  let tone: 'ok' | 'warn' | 'bad';
  let label: string;
  if (!online) {
    tone = 'bad';
    label = 'Offline';
  } else if (health.status === 'loading') {
    tone = 'warn';
    label = 'Connecting';
  } else if (health.status === 'error') {
    tone = 'bad';
    label = 'Server unreachable';
  } else {
    tone = health.health.demoMode ? 'warn' : 'ok';
    label = health.health.demoMode ? 'Demo' : 'Connected';
  }
  return (
    <button
      type="button"
      className={`status-pill is-${tone}`}
      onClick={onRetry}
      title="Check connection"
    >
      <span className="dot" aria-hidden="true" />
      {label}
    </button>
  );
}
