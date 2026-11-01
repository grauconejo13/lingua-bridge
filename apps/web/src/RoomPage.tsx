import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  LANGUAGES,
  ROOM_MAX_NAME_CHARS,
  getLanguage,
  isLanguageCode,
  languageLabel,
  type LanguageCode,
  type RoomMessage,
} from '@lingua-bridge/shared';
import { AppShell } from './components/AppShell';
import { Composer } from './components/Composer';
import {
  IncomingBubble,
  OutgoingBubble,
  PendingBubble,
  type OutgoingItem,
} from './components/MessageBubble';
import { RecordControl } from './components/RecordControl';
import { SharePanel } from './components/SharePanel';
import { useAutoplayQueue } from './hooks/useAutoplayQueue';
import { useHealth } from './hooks/useHealth';
import { useOnline } from './hooks/useOnline';
import { usePreferences } from './hooks/usePreferences';
import { useRecorder, type Recording } from './hooks/useRecorder';
import { useRoomConnection } from './hooks/useRoomConnection';
import { useSpeechPlayer } from './hooks/useSpeechPlayer';
import { ApiClientError } from './lib/api';
import {
  clearRoomSession,
  readRoomSession,
  writeRoomSession,
  type RoomSession,
} from './lib/room-session';
import { newClientMessageId, roomLink, sendRoomSpeech, sendRoomText } from './lib/rooms-api';
import { MAX_RECORDING_MS } from './SoloPage';

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

const FATAL_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: 'This conversation has ended or the link is wrong. Start a new one.',
  ROOM_FULL: 'This conversation already has two people in it.',
  FORBIDDEN: 'This link is incomplete. Ask for the full link again.',
  REPLACED: 'This conversation is open in another tab or window.',
};

function browserLanguage(): LanguageCode {
  const code = navigator.language?.slice(0, 2).toLowerCase();
  return isLanguageCode(code) ? code : 'en';
}

/** Entry point for /r/:roomId#secret. Asks a new visitor for their language, then joins. */
export function RoomPage({ roomId, secret }: { roomId: string; secret: string }) {
  const online = useOnline();
  const { health, checkHealth, demoMode } = useHealth();
  const prefs = usePreferences();
  const [session, setSession] = useState<RoomSession | undefined>(() => readRoomSession(roomId));

  const shell = (children: React.ReactNode, extra?: Partial<Parameters<typeof AppShell>[0]>) => (
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
      offlineMessage="You're offline. Messages will send when you reconnect."
      {...extra}
    >
      {children}
    </AppShell>
  );

  if (!secret) {
    return shell(
      <main className="page">
        <section className="panel">
          <h2>This link is incomplete</h2>
          <p className="lede">
            Ask the other person to send the full link again, or scan their QR code.
          </p>
          <a className="button primary" href="/conversation">
            Start a new conversation
          </a>
        </section>
      </main>,
    );
  }

  if (!session) {
    return shell(
      <Lobby
        onJoin={(next) => {
          writeRoomSession(roomId, next);
          setSession(next);
        }}
      />,
    );
  }

  return (
    <RoomView
      roomId={roomId}
      secret={secret}
      session={session}
      onSession={(next) => {
        // Re-read so a resume token saved by the connection since render is kept.
        const merged: RoomSession = { ...session, ...readRoomSession(roomId), ...next };
        writeRoomSession(roomId, merged);
        setSession(merged);
      }}
      shell={shell}
      prefs={prefs}
      demoMode={demoMode}
    />
  );
}

function Lobby({ onJoin }: { onJoin: (session: RoomSession) => void }) {
  const [language, setLanguage] = useState<LanguageCode>(browserLanguage);
  const [name, setName] = useState('');
  const languageId = useId();
  const nameId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onJoin({ language, name: name.trim() });
  };

  return (
    <main className="page">
      <section className="panel">
        <h2>You've been invited to a conversation</h2>
        <p className="lede">
          Pick the language you'll speak. You'll see the other person's words translated into it.
        </p>
        <form className="form" onSubmit={submit}>
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
          <button type="submit" className="button primary large">
            Join conversation
          </button>
          <p className="fine-print">
            No account needed. Nothing is recorded; the conversation lives only in memory.
          </p>
        </form>
      </section>
    </main>
  );
}

interface RoomViewProps {
  roomId: string;
  secret: string;
  session: RoomSession;
  onSession: (next: Partial<RoomSession>) => void;
  shell: (
    children: React.ReactNode,
    extra?: Partial<Parameters<typeof AppShell>[0]>,
  ) => React.ReactElement;
  prefs: ReturnType<typeof usePreferences>;
  demoMode: boolean;
}

function RoomView({ roomId, secret, session, onSession, shell, prefs, demoMode }: RoomViewProps) {
  const myLanguage = session.language;
  const [outbox, setOutbox] = useState<OutgoingItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const languageId = useId();
  const feedEndRef = useRef<HTMLDivElement>(null);

  const speech = useSpeechPlayer();
  const autoplayRef = useRef(prefs.autoplay);
  useEffect(() => {
    autoplayRef.current = prefs.autoplay;
  }, [prefs.autoplay]);
  const enqueueRef = useRef<(t: { id: string; text: string; language: LanguageCode }) => void>(
    () => undefined,
  );
  const partnerNameRef = useRef('The other person');

  const onIncoming = useCallback(
    (message: RoomMessage) => {
      const text = message.translations[myLanguage];
      if (text === undefined) return;
      setAnnouncement(`${partnerNameRef.current}: ${text}`);
      if (autoplayRef.current) enqueueRef.current({ id: message.id, text, language: myLanguage });
    },
    [myLanguage],
  );

  const room = useRoomConnection({
    roomId,
    secret,
    language: myLanguage,
    name: session.name,
    enabled: true,
    onIncoming,
  });
  const { state, receive } = room;

  const me = state.participants.find((p) => p.id === state.participantId);
  const partner = state.participants.find((p) => p.id !== state.participantId);
  useEffect(() => {
    partnerNameRef.current = partner?.name ?? 'The other person';
  }, [partner?.name]);

  // ---------- sending ----------

  const updateItem = useCallback((id: string, patch: Partial<OutgoingItem> | null) => {
    setOutbox((items) =>
      patch === null
        ? items.filter((i) => i.clientMessageId !== id)
        : items.map((i) => (i.clientMessageId === id ? { ...i, ...patch } : i)),
    );
  }, []);

  // Automatic retries with backoff. Sends are idempotent, so a retry never duplicates.
  const attemptsRef = useRef(new Map<string, number>());
  const retryTimersRef = useRef(new Map<string, number>());
  const deliverRef = useRef<(item: OutgoingItem) => Promise<void>>(async () => undefined);
  const scheduleRetry = useCallback((item: OutgoingItem) => {
    const attempts = attemptsRef.current.get(item.clientMessageId) ?? 0;
    const delay = RETRY_DELAYS_MS[attempts];
    // Offline: wait for the browser's online event instead. Out of attempts: manual retry.
    if (delay === undefined || !navigator.onLine) return;
    attemptsRef.current.set(item.clientMessageId, attempts + 1);
    window.clearTimeout(retryTimersRef.current.get(item.clientMessageId));
    retryTimersRef.current.set(
      item.clientMessageId,
      window.setTimeout(() => void deliverRef.current(item), delay),
    );
  }, []);
  useEffect(() => {
    const timers = retryTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const deliver = useCallback(
    async (item: OutgoingItem) => {
      const token = readRoomSession(roomId)?.resumeToken;
      if (!token) {
        updateItem(item.clientMessageId, {
          status: 'failed',
          error: 'Not connected yet. It will send when the connection is ready.',
          retryable: true,
        });
        return;
      }
      updateItem(item.clientMessageId, { status: 'sending', error: undefined });
      try {
        const message =
          item.kind === 'text'
            ? await sendRoomText(roomId, token, {
                clientMessageId: item.clientMessageId,
                text: item.text ?? '',
              })
            : await sendRoomSpeech(roomId, token, {
                clientMessageId: item.clientMessageId,
                audio: item.audio!,
              });
        receive(message);
        attemptsRef.current.delete(item.clientMessageId);
        updateItem(item.clientMessageId, null);
      } catch (error) {
        const apiError =
          error instanceof ApiClientError
            ? error
            : new ApiClientError('INTERNAL', 'Something went wrong. Please try again.');
        if (apiError.code === 'NO_SPEECH') {
          updateItem(item.clientMessageId, null);
          setNotice(apiError.message);
          return;
        }
        updateItem(item.clientMessageId, {
          status: 'failed',
          error: apiError.message,
          retryable: apiError.retryable,
        });
        if (apiError.retryable) scheduleRetry(item);
      }
    },
    [roomId, receive, updateItem, scheduleRetry],
  );
  useEffect(() => {
    deliverRef.current = deliver;
  }, [deliver]);

  const queue = useCallback(
    (item: Omit<OutgoingItem, 'clientMessageId' | 'status'>) => {
      const full: OutgoingItem = {
        ...item,
        clientMessageId: newClientMessageId(),
        status: 'sending',
      };
      setOutbox((items) => [...items, full]);
      void deliver(full);
    },
    [deliver],
  );

  // Retry what failed once the connection is back. Sends are idempotent, so this is safe.
  const outboxRef = useRef(outbox);
  useEffect(() => {
    outboxRef.current = outbox;
  }, [outbox]);
  const retryFailed = useCallback(() => {
    outboxRef.current
      .filter((item) => item.status === 'failed' && item.retryable)
      .forEach((item) => void deliver(item));
  }, [deliver]);
  const previousStatus = useRef(state.status);
  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = state.status;
    if (state.status === 'open' && was !== 'open') retryFailed();
  }, [state.status, retryFailed]);
  // The socket may survive a short offline blip, so also retry when the browser is back
  // online, after a moment: the network is often not usable the instant the event fires.
  const retryFailedRef = useRef(retryFailed);
  useEffect(() => {
    retryFailedRef.current = retryFailed;
  }, [retryFailed]);
  useEffect(() => {
    let timer: number | undefined;
    const onOnline = () => {
      attemptsRef.current.clear();
      timer = window.setTimeout(() => retryFailedRef.current(), 800);
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearTimeout(timer);
    };
  }, []);

  // ---------- recording and turn-taking ----------

  const onRecorded = useCallback(
    ({ blob, durationMs }: Recording) => {
      if (blob.size === 0 || durationMs < 300) {
        setNotice('That was too short to translate. Tap, speak, then tap again.');
        return;
      }
      setNotice(null);
      queue({ kind: 'speech', audio: blob });
    },
    [queue],
  );
  const recorder = useRecorder({ maxMs: MAX_RECORDING_MS, onRecorded });
  const recording = recorder.state === 'recording';

  const { send } = room;
  useEffect(() => {
    if (state.status === 'open') send({ type: 'speaking', speaking: recording });
  }, [recording, send, state.status]);

  // Don't play through the speaker while either microphone may be listening.
  const autoplay = useAutoplayQueue({
    player: speech,
    blocked: recording || Boolean(partner?.speaking),
  });
  useEffect(() => {
    enqueueRef.current = autoplay.enqueue;
  }, [autoplay.enqueue]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [state.messages.length, outbox.length]);

  // ---------- rendering ----------

  const pending = useMemo(() => {
    const sent = new Set(state.messages.map((m) => m.clientMessageId));
    return outbox.filter((item) => !sent.has(item.clientMessageId));
  }, [state.messages, outbox]);

  const link = roomLink(roomId, secret);
  const waitingForPartner = state.status === 'open' && !partner;

  if (state.status === 'closed' && state.fatal) {
    const message = state.fatal.message || FATAL_MESSAGES[state.fatal.code] || 'Disconnected.';
    return shell(
      <main className="page">
        <section className="panel">
          <h2>Can't join this conversation</h2>
          <p className="lede" role="alert">
            {message}
          </p>
          <div className="share-actions">
            {state.fatal.code === 'REPLACED' && (
              <button type="button" className="button primary" onClick={() => location.reload()}>
                Use it here instead
              </button>
            )}
            <a
              className="button"
              href="/conversation"
              onClick={() => {
                if (state.fatal?.code !== 'REPLACED') clearRoomSession(roomId);
              }}
            >
              Start a new conversation
            </a>
          </div>
        </section>
      </main>,
    );
  }

  return shell(
    <>
      <section className="presence" aria-label="People in this conversation">
        <div className="partner">
          {partner ? (
            <>
              <span className="avatar" aria-hidden="true">
                {partner.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="partner-text">
                <strong>{partner.name}</strong>
                <span>
                  {getLanguage(partner.language).englishName} ·{' '}
                  <span className={`presence-state is-${partnerState(partner)}`}>
                    {partnerLabel(partner)}
                  </span>
                </span>
              </span>
            </>
          ) : (
            <span className="partner-text">
              <strong>Waiting for the other person</strong>
              <span>Share the link below</span>
            </span>
          )}
        </div>
        <div className="language-field compact">
          <label htmlFor={languageId}>I speak</label>
          <select
            id={languageId}
            value={myLanguage}
            disabled={recording}
            onChange={(e) => onSession({ language: e.target.value as LanguageCode })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {languageLabel(l)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {state.status === 'reconnecting' && (
        <p className="banner warning" role="status">
          Reconnecting… Anything you send will go through once the connection is back.
        </p>
      )}
      {state.status === 'connecting' && (
        <p className="banner" role="status">
          Connecting…
        </p>
      )}

      <main className="feed" aria-label="Conversation">
        {(waitingForPartner || showInvite) && <SharePanel link={link} />}

        {state.messages.length === 0 && pending.length === 0 && partner && (
          <div className="empty">
            <p className="empty-title">You're connected with {partner.name}.</p>
            <p>
              Tap the microphone and speak, or type a message. Each of you reads the other in your
              own language.
            </p>
          </div>
        )}

        {state.messages.map((message) =>
          message.senderId === state.participantId ? (
            <OutgoingBubble
              key={message.id}
              message={message}
              partnerName={partner?.name}
              partnerLanguage={partner?.language}
              partnerId={partner?.id}
              partnerConnected={Boolean(partner?.connected)}
              demo={demoMode}
            />
          ) : (
            <IncomingBubble
              key={message.id}
              message={message}
              myLanguage={myLanguage}
              partnerName={state.participants.find((p) => p.id === message.senderId)?.name}
              demo={demoMode}
              playing={speech.playingId === message.id}
              loadingSpeech={speech.loadingId === message.id}
              speechError={speech.error?.id === message.id ? speech.error.message : undefined}
              onPlay={() => {
                const text = message.translations[myLanguage];
                if (text !== undefined)
                  void speech.play({ id: message.id, text, language: myLanguage });
              }}
              onStop={speech.stop}
            />
          ),
        )}

        {pending.map((item) => (
          <PendingBubble
            key={item.clientMessageId}
            item={item}
            onRetry={() => void deliver(item)}
            onDiscard={() => updateItem(item.clientMessageId, null)}
          />
        ))}
        <div ref={feedEndRef} />
      </main>

      <footer className="dock">
        {partner?.speaking && !recording && (
          <p className="dock-message turn" role="status">
            {partner.name} is speaking…
          </p>
        )}
        {notice && (
          <p className="dock-message" role="status">
            {notice}
          </p>
        )}
        <Composer disabled={!me} onSend={(text) => queue({ kind: 'text', text })} />
        <RecordControl
          state={recorder.state}
          elapsedMs={recorder.elapsedMs}
          maxMs={MAX_RECORDING_MS}
          level={recorder.level}
          busy={pending.some((item) => item.status === 'sending')}
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
    </>,
    {
      canClear: state.messages.length > 0,
      clearLabel: 'Clear this screen',
      onClear: () => {
        room.clear();
        setOutbox([]);
        autoplay.clear();
        speech.forget();
        setAnnouncement('Conversation cleared from this screen.');
      },
      actions: (
        <>
          {partner && (
            <button
              type="button"
              className="status-pill mode-link"
              aria-expanded={showInvite}
              onClick={() => setShowInvite((v) => !v)}
            >
              {showInvite ? 'Hide invite' : 'Invite'}
            </button>
          )}
          <button
            type="button"
            className="status-pill mode-link"
            onClick={() => {
              room.leave();
              clearRoomSession(roomId);
              window.location.assign('/');
            }}
          >
            Leave
          </button>
        </>
      ),
    },
  );
}

function partnerState(p: { connected: boolean; speaking: boolean }): 'speaking' | 'here' | 'away' {
  if (p.speaking) return 'speaking';
  return p.connected ? 'here' : 'away';
}

function partnerLabel(p: { connected: boolean; speaking: boolean }): string {
  const state = partnerState(p);
  return state === 'speaking' ? 'Speaking…' : state === 'here' ? 'Connected' : 'Reconnecting…';
}
