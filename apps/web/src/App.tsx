import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LANGUAGES,
  getLanguage,
  isLanguageCode,
  type HealthResponse,
  type LanguageCode,
} from '@lingua-bridge/shared';
import { CaptionCard } from './components/CaptionCard';
import { LanguageBar } from './components/LanguageBar';
import { RecordControl } from './components/RecordControl';
import { SettingsMenu } from './components/SettingsMenu';
import { useOnline } from './hooks/useOnline';
import { useRecorder, type Recording } from './hooks/useRecorder';
import { useSpeechPlayer } from './hooks/useSpeechPlayer';
import { ApiClientError, getHealth, sendUtterance } from './lib/api';
import { readPreference, writePreference } from './lib/storage';
import type { Caption, TextSize } from './types';

const MAX_RECORDING_MS = 30_000;
const MAX_CAPTIONS = 50;
const TEXT_SIZES: TextSize[] = ['s', 'm', 'l', 'xl'];

let nextId = 0;
const newId = () => `c${++nextId}`;

function defaultTarget(): LanguageCode {
  const browser = navigator.language?.slice(0, 2).toLowerCase();
  return isLanguageCode(browser) && browser !== 'en' ? browser : 'es';
}

type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; health: HealthResponse }
  | { status: 'error'; message: string };

async function loadHealthState(): Promise<HealthState> {
  try {
    return { status: 'ok', health: await getHealth() };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof ApiClientError ? error.message : "Couldn't reach the translation server.",
    };
  }
}

export function App() {
  const online = useOnline();
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [source, setSource] = useState<LanguageCode>(() =>
    readPreference<LanguageCode>('source', 'en', isLanguageCode),
  );
  const [target, setTarget] = useState<LanguageCode>(() =>
    readPreference<LanguageCode>('target', defaultTarget(), isLanguageCode),
  );
  const [textSize, setTextSize] = useState<TextSize>(() =>
    readPreference<TextSize>('textSize', 'm', (v) => TEXT_SIZES.includes(v as TextSize)),
  );
  const [autoplay, setAutoplay] = useState<boolean>(() =>
    readPreference('autoplay', false, (v) => typeof v === 'boolean'),
  );
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const speech = useSpeechPlayer();
  const feedEndRef = useRef<HTMLDivElement>(null);
  const autoplayRef = useRef(autoplay);
  useEffect(() => {
    autoplayRef.current = autoplay;
  }, [autoplay]);

  useEffect(() => {
    let active = true;
    void loadHealthState().then((state) => {
      if (active) setHealth(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const checkHealth = useCallback(() => {
    setHealth({ status: 'loading' });
    void loadHealthState().then(setHealth);
  }, []);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [captions.length]);

  const updateCaption = useCallback((id: string, next: Caption) => {
    setCaptions((list) => list.map((caption) => (caption.id === id ? next : caption)));
  }, []);

  const submit = useCallback(
    async (id: string, audio: Blob, sourceLanguage: LanguageCode, targetLanguage: LanguageCode) => {
      const stoppedAt = performance.now();
      updateCaption(id, { id, status: 'pending', sourceLanguage, targetLanguage, stoppedAt });
      try {
        const result = await sendUtterance({ audio, sourceLanguage, targetLanguage });
        const demo = health.status === 'ok' && health.health.demoMode;
        updateCaption(id, {
          id,
          status: 'done',
          sourceLanguage,
          targetLanguage,
          stoppedAt,
          sourceText: result.sourceText,
          translatedText: result.translatedText,
          timings: result.timings,
          clientMs: Math.round(performance.now() - stoppedAt),
          demo,
        });
        setAnnouncement(
          `${getLanguage(targetLanguage).englishName}${demo ? ' demo' : ''} translation: ${result.translatedText}`,
        );
        if (autoplayRef.current) {
          void speech.play({ id, text: result.translatedText, language: targetLanguage });
        }
      } catch (error) {
        const apiError =
          error instanceof ApiClientError
            ? error
            : new ApiClientError('INTERNAL', 'Something went wrong. Please try again.');
        updateCaption(id, {
          id,
          status: 'failed',
          sourceLanguage,
          targetLanguage,
          stoppedAt,
          message: apiError.message,
          retryable: apiError.retryable,
          audio,
        });
        setAnnouncement(`Translation failed. ${apiError.message}`);
      }
    },
    [health, speech, updateCaption],
  );

  const onRecorded = useCallback(
    ({ blob, durationMs }: Recording) => {
      if (blob.size === 0 || durationMs < 300) {
        setNotice('That was too short to translate. Tap, speak, then tap again.');
        return;
      }
      setNotice(null);
      const id = newId();
      setCaptions((list) =>
        [
          ...list,
          {
            id,
            status: 'pending' as const,
            sourceLanguage: source,
            targetLanguage: target,
            stoppedAt: performance.now(),
          },
        ].slice(-MAX_CAPTIONS),
      );
      void submit(id, blob, source, target);
    },
    [source, target, submit],
  );

  const recorder = useRecorder({ maxMs: MAX_RECORDING_MS, onRecorded });

  const changeLanguages = ({
    source: s,
    target: t,
  }: {
    source: LanguageCode;
    target: LanguageCode;
  }) => {
    setSource(s);
    setTarget(t);
    writePreference('source', s);
    writePreference('target', t);
  };

  const clearConversation = () => {
    speech.forget();
    setCaptions([]);
    setAnnouncement('Conversation cleared.');
  };

  const busy = captions.some((caption) => caption.status === 'pending');
  const demoMode = health.status === 'ok' && health.health.demoMode;

  return (
    <div className="app" data-text-size={textSize}>
      <header className="topbar">
        <div className="brand">
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
        </div>
        <div className="topbar-right">
          <ConnectionStatus online={online} health={health} onRetry={checkHealth} />
          <SettingsMenu
            textSize={textSize}
            autoplay={autoplay}
            canClear={captions.length > 0}
            onTextSize={(size) => {
              setTextSize(size);
              writePreference('textSize', size);
            }}
            onAutoplay={(value) => {
              setAutoplay(value);
              writePreference('autoplay', value);
            }}
            onClear={clearConversation}
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
          <button type="button" className="link-button" onClick={checkHealth}>
            Try again
          </button>
        </p>
      )}
      {!online && (
        <p className="banner warning" role="alert">
          You're offline. Recordings can't be translated until you reconnect, and failed ones can be
          retried.
        </p>
      )}

      <LanguageBar
        languages={LANGUAGES}
        source={source}
        target={target}
        disabled={recorder.state === 'recording'}
        onChange={changeLanguages}
      />

      <main className="feed" aria-label="Conversation">
        {captions.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Speak, and read it in another language.</p>
            <ol>
              <li>Pick the language you speak and the one to translate into.</li>
              <li>Turn on the microphone and tap to speak.</li>
              <li>Tap again to stop. The translation appears here.</li>
            </ol>
          </div>
        ) : (
          captions.map((caption) => (
            <CaptionCard
              key={caption.id}
              caption={caption}
              playing={speech.playingId === caption.id}
              loadingSpeech={speech.loadingId === caption.id}
              speechError={speech.error?.id === caption.id ? speech.error.message : undefined}
              onPlay={() => {
                if (caption.status === 'done') {
                  void speech.play({
                    id: caption.id,
                    text: caption.translatedText,
                    language: caption.targetLanguage,
                  });
                }
              }}
              onStop={speech.stop}
              onRetry={() => {
                if (caption.status === 'failed') {
                  void submit(
                    caption.id,
                    caption.audio,
                    caption.sourceLanguage,
                    caption.targetLanguage,
                  );
                }
              }}
              onDiscard={() => setCaptions((list) => list.filter((c) => c.id !== caption.id))}
            />
          ))
        )}
        <div ref={feedEndRef} />
      </main>

      <footer className="dock">
        {notice && (
          <p className="dock-message" role="status">
            {notice}
          </p>
        )}
        <RecordControl
          state={recorder.state}
          elapsedMs={recorder.elapsedMs}
          maxMs={MAX_RECORDING_MS}
          level={recorder.level}
          busy={busy}
          onEnable={recorder.enable}
          onDisable={recorder.disable}
          onStart={() => {
            speech.stop();
            recorder.start();
          }}
          onStop={recorder.stop}
        />
      </footer>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
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
    label = health.health.demoMode ? 'Demo server' : 'Connected';
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
