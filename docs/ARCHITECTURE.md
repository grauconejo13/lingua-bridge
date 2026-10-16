# Architecture (Proposed)

> Design document only. Components have not been implemented or confirmed.

## High-level flow

```mermaid
flowchart LR
  A[Speaker device: mic + captions] --> B[Audio capture / optional streaming]
  B --> C[Speech recognition or speech translation API]
  C --> D[Translation / language preferences]
  D --> E[Target text / optional TTS]
  E --> F[Listener device: captions + earbuds]
  G[Session & auth service] --- A
  G --- F
  H[Network monitor & fallback] --- A
  H --- F
```

## Proposed components

**Client:** React + TypeScript + Vite as a mobile-friendly web application. Request microphone permission explicitly. Maintain language selection, audio controls, consent UI, caption state, connection status, and safe retry queue.

**Backend:** Node.js/TypeScript service for short-lived room/session tokens, rate limiting, provider credentials, translation orchestration, privacy settings, aggregate usage metering, and error reporting.

**AI provider abstraction:** Evaluate streaming speech-to-speech against a pipeline of speech-to-text → translation → text-to-speech. Choose on measured speed, cost, language coverage, quality, and vendor limitations. Never expose API secrets to clients.

**Media transport:** Evaluate WebRTC for peer/streaming audio where appropriate, or provider-compatible streaming connections. Real-time translation may require a server relay or authorized provider session; avoid assuming all audio is peer-to-peer.

**Persistence:** Keep persistent data minimal. Plan session configuration and anonymous usage counters; do not store raw audio/transcripts by default. If store-and-forward is offered, make storage, encryption, retention, deletion, and user consent explicit.

## Low-bandwidth strategy

1. Measure observed RTT, buffering, reconnects, and WebRTC stats (where available); don't infer quality purely from 3G/4G/5G labels.
2. Prioritize audio over video; start without video.
3. When possible adapt codec/bitrate and apply appropriate jitter buffering.
4. If voice stalls, show text results and delivery state; offer push-to-talk/short messages.
5. Queue outbound messages locally only after opt-in, retry with deduplication IDs, and acknowledge delivery only when actually received.
6. Recover after reconnection without silently duplicating messages.

**Important:** Fallback cannot recover speech never captured by the sender or lost before an integrated platform exposes it. Offline live cloud translation is not possible without connectivity.

## Zoom integration boundary

Treat Zoom as an **adapter**, not the core architecture. Research Zoom Apps SDK UI embedding, RTMS access, marketplace review, privacy/consent requirements, pricing, and permitted audio routing. Receiving Zoom meeting media does **not** imply the ability to replace native per-participant audio streams.

## Security and trust

- Explicit consent and clear audio-on indicators.
- Session authentication and scoped short-lived tokens.
- TLS, server-side credentials, minimal permissions.
- Abuse/impersonation prevention for synthetic voices.
- Opt-in retention and clear deletion; no hidden recording.
- Capacity controls, backpressure, and cost limits.

## Performance metrics

- Speech-to-first-caption latency (median, p95)
- End-of-utterance-to-translated-audio delay
- Packet loss, jitter, reconnect time where measurable
- Translation quality for chosen language/technical terms
- Delivered-message rate under throttled/unstable network simulations
- Cost per translated minute, bandwidth and device battery use

## Initial experiments

- Compare speech-to-text pipeline and direct real-time translation API.
- Measure one-device microphone-to-caption latency.
- Simulate 200–1000 ms RTT, 1–10% packet loss, and disconnections.
- Verify mobile browser audio input/output behavior.
- Validate permissions on at least two devices and avoid acoustic feedback.
