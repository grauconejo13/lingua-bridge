import { useCallback, useEffect, useRef, useState } from 'react';
import { LANGUAGES, getLanguage, isLanguageCode, type LanguageCode } from '@lingua-bridge/shared';
import { AppShell } from './components/AppShell';
import { CaptionCard } from './components/CaptionCard';
import { LanguageBar } from './components/LanguageBar';
import { RecordControl } from './components/RecordControl';
import { useAutoplayQueue } from './hooks/useAutoplayQueue';
import { useHealth } from './hooks/useHealth';
import { useOnline } from './hooks/useOnline';
import { usePreferences } from './hooks/usePreferences';
import { useRecorder, type Recording } from './hooks/useRecorder';
import { useSpeechPlayer } from './hooks/useSpeechPlayer';
import { ApiClientError, sendUtterance } from './lib/api';
import { readPreference, writePreference } from './lib/storage';
import type { Caption } from './types';

export const MAX_RECORDING_MS = 30_000;
const MAX_CAPTIONS = 50;

let nextId = 0;
const newId = () => `c${++nextId}`;

function defaultTarget(): LanguageCode {
  const browser = navigator.language?.slice(0, 2).toLowerCase();
  return isLanguageCode(browser) && browser !== 'en' ? browser : 'es';
}

/** Milestone 1: one device, one speaker, translated captions and optional playback. */
export function SoloPage() {
  const online = useOnline();
  const { health, checkHealth, demoMode } = useHealth();
  const prefs = usePreferences();
  const [source, setSource] = useState<LanguageCode>(() =>
    readPreference<LanguageCode>('source', 'en', isLanguageCode),
  );
  const [target, setTarget] = useState<LanguageCode>(() =>
    readPreference<LanguageCode>('target', defaultTarget(), isLanguageCode),
  );
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const speech = useSpeechPlayer();
  const feedEndRef = useRef<HTMLDivElement>(null);
  const autoplayRef = useRef(prefs.autoplay);
  useEffect(() => {
    autoplayRef.current = prefs.autoplay;
  }, [prefs.autoplay]);

  // Bumped when the conversation is cleared, so late responses for cleared captions are ignored.
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Set<AbortController>());

  useEffect(() => {
    feedEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [captions.length]);

  const updateCaption = useCallback((id: string, next: Caption) => {
    setCaptions((list) => list.map((caption) => (caption.id === id ? next : caption)));
  }, []);

  // `enqueue` is stable, so a ref lets `submit` use it before the recorder exists.
  const enqueueRef = useRef<(target: { id: string; text: string; language: LanguageCode }) => void>(
    () => undefined,
  );

  const submit = useCallback(
    async (id: string, audio: Blob, sourceLanguage: LanguageCode, targetLanguage: LanguageCode) => {
      const generation = generationRef.current;
      const controller = new AbortController();
      inFlightRef.current.add(controller);
      const stoppedAt = performance.now();
      updateCaption(id, { id, status: 'pending', sourceLanguage, targetLanguage, stoppedAt });
      try {
        const result = await sendUtterance(
          { audio, sourceLanguage, targetLanguage },
          controller.signal,
        );
        if (generation !== generationRef.current) return;
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
          demo: demoMode,
        });
        setAnnouncement(
          `${getLanguage(targetLanguage).englishName}${demoMode ? ' demo' : ''} translation: ${result.translatedText}`,
        );
        if (autoplayRef.current) {
          enqueueRef.current({ id, text: result.translatedText, language: targetLanguage });
        }
      } catch (error) {
        if (generation !== generationRef.current) return;
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
      } finally {
        inFlightRef.current.delete(controller);
      }
    },
    [demoMode, updateCaption],
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
  const autoplay = useAutoplayQueue({
    player: speech,
    blocked: recorder.state === 'recording',
  });
  useEffect(() => {
    enqueueRef.current = autoplay.enqueue;
  }, [autoplay.enqueue]);

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
    generationRef.current += 1;
    inFlightRef.current.forEach((controller) => controller.abort());
    inFlightRef.current.clear();
    autoplay.clear();
    speech.forget();
    setCaptions([]);
    setAnnouncement('Conversation cleared.');
  };

  const busy = captions.some((caption) => caption.status === 'pending');

  return (
    <AppShell
      online={online}
      health={health}
      onCheckHealth={checkHealth}
      textSize={prefs.textSize}
      autoplay={prefs.autoplay}
      onTextSize={prefs.setTextSize}
      onAutoplay={prefs.setAutoplay}
      canClear={captions.length > 0}
      onClear={clearConversation}
      offlineMessage="You're offline. Recordings can't be translated until you reconnect, and failed ones can be retried."
      actions={
        <a className="status-pill mode-link" href="/conversation">
          Two devices
        </a>
      }
    >
      <LanguageBar
        languages={LANGUAGES}
        source={source}
        target={target}
        disabled={recorder.state === 'recording'}
        onChange={changeLanguages}
      />

      <main className="feed" aria-label="Captions">
        {captions.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Speak, and read it in another language.</p>
            <ol>
              <li>Pick the language you speak and the one to translate into.</li>
              <li>Turn on the microphone and tap to speak.</li>
              <li>Tap again to stop. The translation appears here.</li>
            </ol>
            <p className="empty-more">
              Talking with someone on their own phone?{' '}
              <a href="/conversation">Start a two-device conversation</a>.
            </p>
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
    </AppShell>
  );
}
