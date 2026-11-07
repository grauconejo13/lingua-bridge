import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  LANGUAGES,
  getLanguage,
  isLanguageCode,
  languageLabel,
  type LanguageCode,
  type TalkSegment,
} from '@lingua-bridge/shared';
import { AppShell } from './components/AppShell';
import { Notices } from './components/Notices';
import { useCaptionAudio } from './hooks/useCaptionAudio';
import { useHealth } from './hooks/useHealth';
import { useOnline } from './hooks/useOnline';
import { usePreferences } from './hooks/usePreferences';
import { useTalkConnection } from './hooks/useTalkConnection';
import { readPreference, writePreference } from './lib/storage';
import { captionText } from './lib/talk-state';
import { talkSpeechUrl } from './lib/talks-api';

const FATAL: Record<string, string> = {
  TALK_NOT_FOUND: 'This presentation has ended or the link is wrong.',
  TALK_FULL: 'This presentation has reached its audience limit. Try again in a moment.',
};

function initialLanguage(): LanguageCode {
  const browser = navigator.language?.slice(0, 2).toLowerCase();
  return readPreference<LanguageCode>(
    'talkLanguage',
    isLanguageCode(browser) ? browser : 'en',
    isLanguageCode,
  );
}

/** /t/:talkId — follow a presentation in your own language. Listen-only. */
export function AudiencePage({ talkId }: { talkId: string }) {
  const online = useOnline();
  const { health, checkHealth, demoMode } = useHealth();
  const prefs = usePreferences();
  const [language, setLanguageState] = useState<LanguageCode>(initialLanguage);
  const [showOriginal, setShowOriginal] = useState(() =>
    readPreference('talkShowOriginal', false, (v) => typeof v === 'boolean'),
  );
  const [announcement, setAnnouncement] = useState('');
  const [atLive, setAtLive] = useState(true);
  const languageId = useId();
  const feedRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const audio = useCaptionAudio({ enabled: prefs.autoplay });
  const { enqueue } = audio;

  const onSegment = useCallback(
    (segment: TalkSegment) => {
      const { text } = captionText(segment);
      setAnnouncement(text);
      if (segment.text !== null)
        enqueue(segment.id, talkSpeechUrl(talkId, segment.id, segment.language));
    },
    [enqueue, talkId],
  );

  const { state } = useTalkConnection({ talkId, language, onSegment });

  const setLanguage = (next: LanguageCode) => {
    setLanguageState(next);
    writePreference('talkLanguage', next);
    audio.stop();
  };

  // Follow the newest caption unless the listener has scrolled back to reread.
  useEffect(() => {
    const feed = feedRef.current;
    const end = endRef.current;
    if (!feed || !end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setAtLive(Boolean(entry?.isIntersecting)),
      {
        root: null,
        threshold: 0,
      },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (atLive) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [state.segments, atLive]);

  const talk = state.talk;
  const ended = talk?.status === 'ended' || state.fatal?.code === 'ENDED';
  const fatalMessage =
    state.fatal && state.fatal.code !== 'ENDED'
      ? (FATAL[state.fatal.code] ?? state.fatal.message)
      : null;
  const latestId = state.segments.at(-1)?.id;

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
      offlineMessage="You're offline. Captions will catch up when you reconnect."
    >
      <section className="talk-head" aria-label="Presentation">
        <div>
          <p className="talk-title">
            {talk?.title ?? (fatalMessage ? 'Presentation' : 'Joining…')}
          </p>
          {talk && (
            <p className="fine-print">Presented in {languageLabel(getLanguage(talk.language))}</p>
          )}
        </div>
        {talk && !ended && (
          <span className={`live-badge ${talk.status === 'live' ? 'is-live' : ''}`}>
            {talk.status === 'live' ? 'Live' : 'Paused'}
          </span>
        )}
      </section>

      <section className="language-bar" aria-label="Your language">
        <div className="language-field">
          <label htmlFor={languageId}>Read in</label>
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
        <label className="toggle">
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(e) => {
              setShowOriginal(e.target.checked);
              writePreference('talkShowOriginal', e.target.checked);
            }}
          />
          Show original
        </label>
      </section>

      <Notices label="Presentation status">
        {fatalMessage && (
          <p className="banner error" role="alert">
            {fatalMessage}
          </p>
        )}
        {ended && (
          <p className="banner" role="status">
            The presentation has ended. Captions stay on this screen until you close it.
          </p>
        )}
        {state.status === 'reconnecting' && !ended && (
          <p className="banner warning" role="status">
            Reconnecting… You won't miss anything; captions catch up when the connection is back.
          </p>
        )}
        {state.languageUnavailable && talk && !ended && (
          <p className="banner warning" role="status">
            This presentation is already translating into its limit of {talk.maxLanguages}{' '}
            languages, so you're reading the original {getLanguage(talk.language).englishName}.
            Translation starts automatically if a slot frees up.
          </p>
        )}
        {audio.error && (
          <p className="banner warning" role="status">
            {audio.error}
          </p>
        )}
      </Notices>

      <main className="feed talk-feed" aria-label="Captions" ref={feedRef}>
        {state.segments.length === 0 && talk && !ended && (
          <div className="empty">
            <p className="empty-title">
              {talk.status === 'live'
                ? 'Listening for the presenter…'
                : 'Waiting for the presenter to start.'}
            </p>
            <p>Captions appear here in your language as the presenter speaks.</p>
          </div>
        )}
        {state.segments.map((segment) => {
          const { text, language: shownLanguage, fallback } = captionText(segment);
          const pending =
            segment.text === null &&
            segment.language !== segment.sourceLanguage &&
            !state.languageUnavailable;
          return (
            <article
              key={segment.id}
              className={`talk-caption ${segment.id === latestId ? 'is-latest' : ''}`}
            >
              <p lang={shownLanguage} dir={getLanguage(shownLanguage).dir}>
                {text}
              </p>
              {(fallback || pending) && (
                <p className="fine-print">
                  {pending
                    ? 'Translation unavailable for this line; showing the original.'
                    : 'Original'}
                </p>
              )}
              {showOriginal && !fallback && segment.language !== segment.sourceLanguage && (
                <p
                  className="caption-source"
                  lang={segment.sourceLanguage}
                  dir={getLanguage(segment.sourceLanguage).dir}
                >
                  {segment.sourceText}
                </p>
              )}
              {segment.text !== null && !ended && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    audio.playingId === segment.id
                      ? audio.stop()
                      : audio.playNow(
                          segment.id,
                          talkSpeechUrl(talkId, segment.id, segment.language),
                        )
                  }
                >
                  {audio.playingId === segment.id ? 'Stop' : 'Listen'}
                </button>
              )}
            </article>
          );
        })}
        {demoMode && state.segments.length > 0 && (
          <p className="fine-print">
            Demo mode: captions are placeholder text, not real translation.
          </p>
        )}
        <div ref={endRef} />
      </main>

      {!atLive && state.segments.length > 0 && (
        <button
          type="button"
          className="button primary jump-live"
          onClick={() => endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })}
        >
          Jump to latest
        </button>
      )}

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </AppShell>
  );
}
