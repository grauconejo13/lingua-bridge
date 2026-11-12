import { useId, useState, type FormEvent } from 'react';
import {
  LANGUAGES,
  TALK_MAX_TITLE_CHARS,
  isLanguageCode,
  languageLabel,
  type LanguageCode,
} from '@lingua-bridge/shared';
import { AppShell } from './components/AppShell';
import { useHealth } from './hooks/useHealth';
import { useOnline } from './hooks/useOnline';
import { usePreferences } from './hooks/usePreferences';
import { ApiClientError } from './lib/api';
import { readPreference } from './lib/storage';
import { createTalk, presenterLink } from './lib/talks-api';

/** Starts a presentation and hands the presenter their private control link. */
export function CreateTalkPage() {
  const online = useOnline();
  const { health, checkHealth } = useHealth();
  const prefs = usePreferences();
  const [language, setLanguage] = useState<LanguageCode>(() =>
    readPreference<LanguageCode>('source', 'en', isLanguageCode),
  );
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const languageId = useId();
  const titleId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const talk = await createTalk({ language, title: title.trim() || undefined });
      window.location.assign(presenterLink(talk.talkId, talk.presenterKey));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't start the presentation.");
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
      offlineMessage="You're offline. Reconnect to start a presentation."
      actions={
        <a className="status-pill mode-link" href="/">
          One device
        </a>
      }
    >
      <main className="page">
        <section className="panel">
          <h2>Present to a room in many languages</h2>
          <p className="lede">
            You speak normally. Everyone in the audience scans a QR code and reads live captions in
            their own language on their phone.
          </p>
          <ol className="steps">
            <li>Choose the language you'll present in.</li>
            <li>Show the QR code on your slides or screen.</li>
            <li>Go live. Captions are cut at your natural pauses; no tapping per sentence.</li>
          </ol>

          <form className="form" onSubmit={(e) => void submit(e)}>
            <div className="language-field">
              <label htmlFor={languageId}>I'm presenting in</label>
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
              <label htmlFor={titleId}>Title (optional)</label>
              <input
                id={titleId}
                type="text"
                value={title}
                maxLength={TALK_MAX_TITLE_CHARS}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Shown to the audience"
              />
            </div>
            {error && (
              <p className="caption-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button primary large" disabled={busy || !online}>
              {busy ? 'Starting…' : 'Create presentation'}
            </button>
            <p className="fine-print">
              No accounts. The presentation lives only in the server's memory and nothing is
              recorded. Translation runs once per language in use, so a bigger audience doesn't cost
              more.
            </p>
          </form>
        </section>
      </main>
    </AppShell>
  );
}
