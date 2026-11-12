import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getLanguage, languageLabel, type LanguageCode } from '@lingua-bridge/shared';
import { AppShell } from './components/AppShell';
import { Composer } from './components/Composer';
import { Notices } from './components/Notices';
import { SharePanel } from './components/SharePanel';
import { useHealth } from './hooks/useHealth';
import { useNetwork } from './hooks/useNetwork';
import { useOnline } from './hooks/useOnline';
import { usePreferences } from './hooks/usePreferences';
import { useSegmentedRecorder } from './hooks/useSegmentedRecorder';
import { useTalkConnection } from './hooks/useTalkConnection';
import { useTalkOutbox } from './hooks/useTalkOutbox';
import { ApiClientError } from './lib/api';
import { audienceLink, endTalk } from './lib/talks-api';
import { BigQr } from './components/BigQr';

const FATAL: Record<string, string> = {
  TALK_NOT_FOUND: 'This presentation has ended or the link is wrong.',
  FORBIDDEN: 'This presenter link is incomplete. Open the full link you were given.',
  ENDED: 'This presentation has ended.',
};

/** /present/:talkId#presenterKey — the presenter's controls. */
export function PresenterPage({ talkId, presenterKey }: { talkId: string; presenterKey: string }) {
  const online = useOnline();
  const { health, checkHealth } = useHealth();
  const prefs = usePreferences();
  const network = useNetwork();
  const { state, send, receive } = useTalkConnection({ talkId, presenterKey });
  const [showQr, setShowQr] = useState(false);
  const [ending, setEnding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const outbox = useTalkOutbox({
    talkId,
    presenterKey,
    onSent: receive,
    enabled: state.status === 'open',
  });

  const onSegment = useCallback(
    ({ blob }: { blob: Blob }) => {
      if (blob.size > 0) outbox.add({ kind: 'speech', audio: blob });
    },
    [outbox],
  );
  const mic = useSegmentedRecorder({ onSegment, audioBitsPerSecond: network.audioBitrate });
  const live = mic.state === 'recording';

  // Tell the audience whether captions are flowing.
  useEffect(() => {
    if (state.status === 'open') send({ type: 'status', status: live ? 'live' : 'paused' });
  }, [live, send, state.status]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [state.segments.length, outbox.items.length]);

  const link = audienceLink(talkId);
  const talk = state.talk;
  const stats = state.stats;

  const end = async () => {
    if (!window.confirm('End the presentation for everyone? This cannot be undone.')) return;
    setEnding(true);
    mic.disable();
    try {
      await endTalk(talkId, presenterKey);
    } catch (error) {
      setNotice(error instanceof ApiClientError ? error.message : "Couldn't end the presentation.");
      setEnding(false);
    }
  };

  const shell = (children: React.ReactNode) => (
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
      offlineMessage="You're offline. Keep talking: captions are kept and sent when you reconnect."
      actions={
        talk && talk.status !== 'ended' ? (
          <button
            type="button"
            className="status-pill mode-link"
            disabled={ending}
            onClick={() => void end()}
          >
            End
          </button>
        ) : undefined
      }
    >
      {children}
    </AppShell>
  );

  if (state.fatal || talk?.status === 'ended') {
    const code = state.fatal?.code ?? 'ENDED';
    return shell(
      <main className="page">
        <section className="panel">
          <h2>{code === 'ENDED' ? 'Presentation ended' : "Can't open this presentation"}</h2>
          <p className="lede">{FATAL[code] ?? state.fatal?.message}</p>
          {state.segments.length > 0 && (
            <p className="fine-print">
              {state.segments.length} captions were shown. They are gone from the server.
            </p>
          )}
          <a className="button primary" href="/present">
            Start a new presentation
          </a>
        </section>
      </main>,
    );
  }

  const presenterLanguage = talk ? getLanguage(talk.language) : undefined;
  const waiting = outbox.items.filter((i) => i.status !== 'failed');
  const failed = outbox.items.filter((i) => i.status === 'failed');
  const listenerLanguages = Object.entries(stats?.byLanguage ?? {}).sort((a, b) => b[1] - a[1]) as [
    LanguageCode,
    number,
  ][];

  return shell(
    <>
      <section className="talk-head" aria-label="Presentation">
        <div>
          <p className="talk-title">{talk?.title ?? 'Presentation'}</p>
          <p className="fine-print">
            {presenterLanguage
              ? `Presenting in ${languageLabel(presenterLanguage)}`
              : 'Connecting…'}
          </p>
        </div>
        <span className={`live-badge ${live ? 'is-live' : ''}`} role="status">
          {live ? 'Live' : 'Paused'}
        </span>
      </section>

      <section className="audience-stats" aria-label="Audience">
        <p>
          <strong>{stats?.listeners ?? 0}</strong>{' '}
          {stats?.listeners === 1 ? 'person is' : 'people are'} following
        </p>
        {listenerLanguages.length > 0 && (
          <ul className="language-counts">
            {listenerLanguages.map(([code, count]) => {
              const translated = code === talk?.language || stats?.translating.includes(code);
              return (
                <li key={code} className={translated ? '' : 'is-untranslated'}>
                  {getLanguage(code).nativeName} · {count}
                  {!translated && (
                    <span className="visually-hidden"> (over the language limit)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {talk && stats && stats.translating.length >= talk.maxLanguages && (
          <p className="fine-print">
            Translating into the maximum of {talk.maxLanguages} languages. Anyone choosing another
            language reads your original words.
          </p>
        )}
      </section>

      <Notices label="Presentation status">
        {state.status === 'reconnecting' && (
          <p className="banner warning" role="status">
            Reconnecting… Keep talking. Captions are queued and sent in order once you're back.
          </p>
        )}
      </Notices>

      <main className="feed" aria-label="Your captions">
        <SharePanel
          link={link}
          title="Audience link"
          shareTitle={talk?.title ?? 'Lingua Bridge presentation'}
          qrLabel="QR code for the audience link"
          note="Put this QR code on screen. Anyone who scans it can follow along in their own language; they can't speak or send anything."
        />
        <button type="button" className="button" onClick={() => setShowQr(true)}>
          Show QR code full screen
        </button>

        {state.segments.length === 0 && waiting.length === 0 && (
          <div className="empty">
            <p className="empty-title">Your captions will appear here.</p>
            <p>
              Turn on the microphone and go live. Speak normally; each pause sends a caption. You
              can also type a line, for example a name or a correction.
            </p>
          </div>
        )}

        {state.segments.map((segment) => (
          <p key={segment.id} className="talk-caption" lang={segment.sourceLanguage}>
            {segment.sourceText}
          </p>
        ))}
        {waiting.length > 0 && (
          <p className="talk-caption is-pending" role="status">
            {waiting.some((i) => i.status === 'retrying')
              ? `Waiting to send ${waiting.length} caption${waiting.length > 1 ? 's' : ''}…`
              : 'Transcribing…'}
          </p>
        )}
        {failed.map((item) => (
          <div key={item.clientSegmentId} className="talk-caption is-failed">
            <p className="caption-error">{item.error ?? "Couldn't send this caption."}</p>
            <div className="share-actions">
              <button
                type="button"
                className="button"
                onClick={() => outbox.retry(item.clientSegmentId)}
              >
                Retry
              </button>
              <button
                type="button"
                className="button"
                onClick={() => outbox.discard(item.clientSegmentId)}
              >
                Discard
              </button>
            </div>
          </div>
        ))}
        <div ref={feedEndRef} />
      </main>

      <footer className="dock">
        {notice && (
          <p className="dock-message" role="status">
            {notice}
          </p>
        )}
        <Composer
          disabled={state.status !== 'open'}
          onSend={(text) => outbox.add({ kind: 'text', text })}
        />
        <LiveControl
          state={mic.state}
          level={mic.level}
          hearingSpeech={mic.hearingSpeech}
          onEnable={() => void mic.enable()}
          onStart={mic.start}
          onPause={mic.pause}
          onDisable={mic.disable}
        />
      </footer>

      {showQr && <BigQr link={link} title={talk?.title} onClose={() => setShowQr(false)} />}
    </>,
  );
}

function LiveControl({
  state,
  level,
  hearingSpeech,
  onEnable,
  onStart,
  onPause,
  onDisable,
}: {
  state: ReturnType<typeof useSegmentedRecorder>['state'];
  level: number;
  hearingSpeech: boolean;
  onEnable: () => void;
  onStart: () => void;
  onPause: () => void;
  onDisable: () => void;
}) {
  if (state === 'unsupported') {
    return (
      <p className="dock-message" role="status">
        This browser can't record audio. You can still type captions.
      </p>
    );
  }
  if (state === 'off' || state === 'requesting' || state === 'denied' || state === 'error') {
    return (
      <div className="consent">
        {state === 'denied' && (
          <p className="dock-message is-warning" role="alert">
            Microphone access is blocked. Allow it in your browser's site settings, or type captions
            instead.
          </p>
        )}
        {state === 'error' && (
          <p className="dock-message is-warning" role="alert">
            Couldn't start the microphone. Check that one is connected.
          </p>
        )}
        <button
          type="button"
          className="button primary large"
          onClick={onEnable}
          disabled={state === 'requesting'}
        >
          {state === 'requesting' ? 'Waiting for permission…' : 'Turn on microphone'}
        </button>
        <p className="fine-print">
          Once live, the microphone stays on and listens continuously until you pause.
        </p>
      </div>
    );
  }
  const live = state === 'recording';
  return (
    <div className="live-control">
      <div className="meter" aria-hidden="true">
        <span style={{ '--level': live ? level : 0 } as CSSProperties} />
      </div>
      <p className="recorder-text" role="status">
        {live ? (hearingSpeech ? 'Hearing you…' : 'Listening') : 'Microphone on, paused'}
      </p>
      <div className="share-actions">
        {live ? (
          <button type="button" className="button primary large" onClick={onPause}>
            Pause
          </button>
        ) : (
          <button type="button" className="button primary large" onClick={onStart}>
            Go live
          </button>
        )}
        <button type="button" className="button" onClick={onDisable}>
          Turn off mic
        </button>
      </div>
    </div>
  );
}
