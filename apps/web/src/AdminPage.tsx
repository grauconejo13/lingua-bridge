import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import type { AdminStatus, ProviderOperation } from '@lingua-bridge/shared';
import { ApiClientError } from './lib/api';
import { getAdminStatus, setPaused } from './lib/admin-api';

const TOKEN_KEY = 'lingua-bridge:admin-token';
const REFRESH_MS = 10_000;

const OPERATIONS: { op: ProviderOperation; label: string; unit: (n: number) => string }[] = [
  { op: 'transcribe', label: 'Transcription', unit: (n) => `${n.toFixed(1)} min` },
  { op: 'translate', label: 'Translation', unit: (n) => `${Math.round(n).toLocaleString()} chars` },
  { op: 'synthesize', label: 'Speech', unit: (n) => `${Math.round(n).toLocaleString()} chars` },
];

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const money = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

function uptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * /admin — the operator's view: today's estimated spend against the budget, live counts,
 * provider health, and a switch to pause translation. The token is kept for this tab only.
 */
export function AdminPage() {
  const [token, setToken] = useState(readToken);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tokenId = useId();

  const load = useCallback(async (value: string) => {
    try {
      setStatus(await getAdminStatus(value));
      setError(null);
    } catch (err) {
      const apiError = err instanceof ApiClientError ? err : undefined;
      if (apiError?.status === 401 || apiError?.status === 404) {
        try {
          sessionStorage.removeItem(TOKEN_KEY);
        } catch {
          // ignore
        }
        setToken('');
        setStatus(null);
        setError(
          apiError.status === 404
            ? 'The admin page is turned off on this server. Set ADMIN_TOKEN to enable it.'
            : 'That token was not accepted.',
        );
      } else {
        setError(apiError?.message ?? "Couldn't load the server status.");
      }
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const tick = () => {
      if (active && document.visibilityState === 'visible') void load(token);
    };
    tick();
    const timer = window.setInterval(tick, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token, load]);

  const signIn = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      // Works for this page load even without storage.
    }
    setDraft('');
    setToken(value);
  };

  const togglePause = async () => {
    if (!status) return;
    const next = !status.usage.paused;
    if (
      next &&
      !window.confirm('Pause translation for everyone? Screens stay open; new translations wait.')
    )
      return;
    setBusy(true);
    try {
      setStatus(await setPaused(token, next));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't change the pause switch.");
    } finally {
      setBusy(false);
    }
  };

  const usage = status?.usage;
  const share = usage && usage.budgetUsd > 0 ? Math.min(1, usage.costUsd / usage.budgetUsd) : 0;

  return (
    <div className="app" data-text-size="m">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Lingua Bridge home">
          <h1>Lingua Bridge admin</h1>
        </a>
        {token && (
          <div className="topbar-right">
            <button
              type="button"
              className="status-pill mode-link"
              onClick={() => {
                try {
                  sessionStorage.removeItem(TOKEN_KEY);
                } catch {
                  // ignore
                }
                setToken('');
                setStatus(null);
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <main className="page">
        {!token ? (
          <section className="panel">
            <h2>Server status</h2>
            <form className="form" onSubmit={signIn}>
              <div className="language-field">
                <label htmlFor={tokenId}>Admin token</label>
                <input
                  id={tokenId}
                  type="password"
                  autoComplete="current-password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>
              {error && (
                <p className="caption-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="button primary large">
                Open
              </button>
              <p className="fine-print">
                The token is the server's ADMIN_TOKEN. It is kept only for this browser tab.
              </p>
            </form>
          </section>
        ) : !status ? (
          <p className="banner" role="status">
            {error ?? 'Loading…'}
          </p>
        ) : (
          <>
            {error && (
              <p className="banner warning" role="status">
                {error}
              </p>
            )}
            <section className="panel" aria-labelledby="spend-heading">
              <h2 id="spend-heading">Today ({usage!.day}, UTC)</h2>
              <p className="admin-big">
                {money(usage!.costUsd)}
                <span className="fine-print">
                  {' '}
                  of {usage!.budgetUsd > 0 ? money(usage!.budgetUsd) : 'no'} daily budget
                </span>
              </p>
              {usage!.budgetUsd > 0 && (
                <div
                  className="meter admin-meter"
                  role="meter"
                  aria-label="Share of today's budget used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share * 100)}
                >
                  <span style={{ '--level': share } as React.CSSProperties} />
                </div>
              )}
              <p className="fine-print">
                {status.demoMode
                  ? 'Demo provider: no paid calls, so nothing is charged.'
                  : 'Estimated from configured prices; check your provider dashboard for the actual bill.'}
              </p>
              <p role="status">
                {usage!.available
                  ? 'Translation is available.'
                  : usage!.unavailableReason === 'paused'
                    ? 'Translation is paused.'
                    : "Today's budget is used up. Translation resumes at midnight UTC."}
              </p>
              <button
                type="button"
                className={`button large ${usage!.paused ? 'primary' : ''}`}
                disabled={busy}
                onClick={() => void togglePause()}
              >
                {usage!.paused ? 'Resume translation' : 'Pause translation'}
              </button>
            </section>

            <section className="panel" aria-labelledby="live-heading">
              <h2 id="live-heading">Right now</h2>
              <dl className="admin-stats">
                <div>
                  <dt>Conversations</dt>
                  <dd>{status.live.rooms}</dd>
                </div>
                <div>
                  <dt>Presentations</dt>
                  <dd>{status.live.talks}</dd>
                </div>
                <div>
                  <dt>Listeners</dt>
                  <dd>{status.live.listeners}</dd>
                </div>
                <div>
                  <dt>Up for</dt>
                  <dd>{uptime(status.uptimeSeconds)}</dd>
                </div>
              </dl>
            </section>

            <section className="panel" aria-labelledby="ops-heading">
              <h2 id="ops-heading">Provider calls today</h2>
              {/* Focusable so keyboard users can scroll the table sideways on a phone. */}
              <div
                className="admin-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Provider call details, scrolls sideways"
              >
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Calls</th>
                      <th scope="col">Usage</th>
                      <th scope="col">Cost</th>
                      <th scope="col">p50 / p95</th>
                      <th scope="col">Failed</th>
                      <th scope="col">Refused</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPERATIONS.map(({ op, label, unit }) => {
                      const o = usage!.operations[op];
                      return (
                        <tr key={op}>
                          <th scope="row">{label}</th>
                          <td>{o.calls}</td>
                          <td>{unit(o.units)}</td>
                          <td>{money(o.costUsd)}</td>
                          <td>{o.p50Ms === undefined ? '–' : `${o.p50Ms} / ${o.p95Ms} ms`}</td>
                          <td>{o.errors}</td>
                          <td>{o.refused}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="fine-print">
                Counts only. The server never stores what was said. Provider: {status.provider}.
                Refreshes every 10 seconds.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
