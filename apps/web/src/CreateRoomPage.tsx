import { useId, useState, type FormEvent } from 'react';
import {
  LANGUAGES,
  ROOM_MAX_NAME_CHARS,
  isLanguageCode,
  languageLabel,
  type LanguageCode,
} from '@lingua-bridge/shared';
import { AppShell } from './components/AppShell';
import { useHealth } from './hooks/useHealth';
import { useOnline } from './hooks/useOnline';
import { usePreferences } from './hooks/usePreferences';
import { ApiClientError } from './lib/api';
import { writeRoomSession } from './lib/room-session';
import { createRoom } from './lib/rooms-api';
import { readPreference } from './lib/storage';

/** Starts a two-device conversation and hands the creator into the room. */
export function CreateRoomPage() {
  const online = useOnline();
  const { health, checkHealth } = useHealth();
  const prefs = usePreferences();
  const [language, setLanguage] = useState<LanguageCode>(() =>
    readPreference<LanguageCode>('source', 'en', isLanguageCode),
  );
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const languageId = useId();
  const nameId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom();
      writeRoomSession(room.roomId, { language, name: name.trim() });
      window.location.assign(`/r/${encodeURIComponent(room.roomId)}#${room.secret}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't start a conversation.");
      setBusy(false);
    }
  };

  return (
    <AppShell
      online={online}
      health={health}
      onCheckHealth={checkHealth}
      textSize={prefs.textSize}
      autoplay={prefs.autoplay}
      onTextSize={prefs.setTextSize}
      onAutoplay={prefs.setAutoplay}
      canClear={false}
      onClear={() => undefined}
      offlineMessage="You're offline. Reconnect to start a conversation."
      actions={
        <a className="status-pill mode-link" href="/">
          One device
        </a>
      }
    >
      <main className="page">
        <section className="panel">
          <h2>Talk with someone on their own phone</h2>
          <p className="lede">
            Each of you speaks your own language and reads (or hears) the other in yours.
          </p>
          <ol className="steps">
            <li>Choose the language you'll speak.</li>
            <li>Share the link or QR code with the other person.</li>
            <li>They open it, pick their language, and you can start talking.</li>
          </ol>

          <form className="form" onSubmit={(e) => void submit(e)}>
            <div className="language-field">
              <label htmlFor={languageId}>I speak</label>
              <select
                id={languageId}
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {languageLabel(l)}
                  </option>
                ))}
              </select>
            </div>
            <div className="language-field">
              <label htmlFor={nameId}>Your name (optional)</label>
              <input
                id={nameId}
                type="text"
                value={name}
                maxLength={ROOM_MAX_NAME_CHARS}
                onChange={(e) => setName(e.target.value)}
                placeholder="Shown to the other person"
                autoComplete="given-name"
              />
            </div>
            {error && (
              <p className="caption-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button primary large" disabled={busy || !online}>
              {busy ? 'Starting…' : 'Start conversation'}
            </button>
            <p className="fine-print">
              No account needed. Conversations live only in the server's memory and end after a
              period of inactivity. Nothing is recorded.
            </p>
          </form>
        </section>
      </main>
    </AppShell>
  );
}
