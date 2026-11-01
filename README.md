# Lingua Bridge 🌍

**Speak naturally. Be understood anywhere.**

Lingua Bridge is an accessibility-minded multilingual communication platform. It aims to help people communicate across language barriers and unreliable network connections, using familiar devices rather than specialized hardware.

> **Status: Milestone 2 prototype.** Two modes in the browser: a one-device translator, and two-device conversations where each person speaks their own language on their own phone. Both run end to end with a keyless **demo provider** (placeholder text, clearly labeled), and an **OpenAI adapter** handles real transcription, translation and speech. Live latency and translation quality have not been measured with a real provider yet, so no performance claims are made. Zoom integration and adaptive bandwidth are not built.

## What works today

**Two-device conversations** (`/conversation`)

- Start a conversation, then share it by link or QR code. No accounts; the join secret travels in the link's `#fragment`, so it never reaches server logs.
- The other person opens the link on their phone and picks their language. Each of you reads the other in your own language, with the original underneath.
- Speak (tap to talk) or type. Each message is transcribed once and translated for the other person; you see what they see.
- Delivery states are honest: _Sending_, _Sent_, then _Delivered_ only after the other device confirms it received the message.
- Live presence: connected, reconnecting, or speaking. Translated speech never auto-plays while either person is recording, so one phone's speaker doesn't end up in the other's transcript.
- Survives bad connections: automatic reconnect with backoff, replay of anything missed while away, and failed sends retried on their own (sends are idempotent, so retries never duplicate). Refreshing or reopening the link rejoins the same seat.
- Two seats per room, rooms live only in server memory and end after 30 minutes of inactivity.

**One device** (`/`)

- Pick any two languages from the registry (14 to start, not hardcoded to a pair) and swap them.
- Turn on the microphone explicitly, tap to speak, tap to stop (30-second cap per turn).
- Captions show the original and the translation side by side, marked with their language for screen readers and right-to-left scripts.
- Play or stop translated speech per caption, or turn on automatic playback.
- Visible states for connecting, listening, translating, offline, failed and demo mode. A failed recording is kept in memory so it can be retried after a dropped connection.
- Adjustable caption size, light and dark themes, phone-first layout, reduced-motion support.
- Server-side API key, rate limiting, size limits, strict content security policy, and no storage or logging of audio or transcripts.

## Quick start

Requires Node.js 22 or later.

```bash
npm install
cp .env.example .env     # defaults to the keyless demo provider
npm run dev              # API on :8787, web app on http://localhost:5173
```

To translate real speech, set these in `.env` and restart:

```bash
PROVIDER=openai
OPENAI_API_KEY=sk-...
```

The key stays on the server. Model names, rate limits and size limits are configurable in [`.env.example`](.env.example).

**Testing on a phone:** browsers only allow microphone access on `https://` or `localhost`. Use an HTTPS tunnel (for example `cloudflared` or `ngrok`) pointed at the dev server, or deploy the production build behind HTTPS.

### Trying a two-device conversation

Open `http://localhost:5173/conversation`, start a conversation, and open the link in a second browser profile or private window. Set `MOCK_LATENCY_MS=600` in `.env` to see the waiting states with the demo provider. For two real phones, both need to reach the server over HTTPS (see the note above).

### Production build

```bash
npm run build   # builds the web app, then bundles the server
npm start       # one Node process serves the API and the built app on :8787
```

### Latency benchmark

With the server running:

```bash
npm run bench -- --to <language-code> --runs 10
```

It synthesizes test phrases, sends them back through the pipeline, and reports median and p95 timings. See [Benchmarks](docs/BENCHMARKS.md) for the method and targets.

## Project layout

```
apps/web         React + TypeScript + Vite client (solo translator and conversation screens)
apps/server      Fastify API: provider credentials, orchestration, rooms, limits
packages/shared  Language registry, API types and the room protocol
docs/            Vision, architecture, roadmap, decisions, benchmarks
```

The server talks to providers through one interface (`transcribe`, `translate`, `synthesize`), so another provider or a direct speech-to-speech API can be added and benchmarked side by side. See [Architecture](docs/ARCHITECTURE.md).

## Problem statement

Language differences and unstable network connectivity can prevent effective communication in remote meetings, face-to-face conversations, and presentations. Lingua Bridge explores accessible, multilingual communication with graceful fallback when live audio becomes unreliable.

## Product idea

- **Conversation:** two people speak their preferred languages, hear translated speech and/or read captions.
- **Meetings:** optional integrations for platforms such as Zoom, subject to their APIs, permissions, and audio-routing limitations.
- **Presentations:** a speaker presents while attendees select a listening language, potentially via a QR-code room.
- **Low-bandwidth resilience:** adapt to packet loss, high latency, or disconnections; fall back to text or queued messages.

The core service should be useful on laptops and smartphones. Cameras, smart glasses, ESP32 boards, and voice cloning are **not** requirements for the MVP.

## Scope

**Milestone 1 (built):** one-device translation with speech capture, translated captions, and optional synthesized audio.

**Milestone 2 (built):** two-person rooms with independent languages, typed fallback, turn-aware playback, reconnection and delivery receipts.

**Next:** measure accuracy, latency and cost with a real provider on two physical devices, then adapt to weak networks (Phase 3).

**Later:** conference mode, Zoom plugin, offline-capable experiences where feasible, expanded languages.

See [Product Vision](docs/PRODUCT_VISION.md), [Features](docs/FEATURES.md), [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), [Decisions & Risks](docs/DECISIONS.md), [Benchmarks](docs/BENCHMARKS.md), and [Public/Private Repository Strategy](docs/REPOSITORY_STRATEGY.md).

## Code quality

`npm run check` runs formatting, lint, type checks and tests. The same checks plus a production build run in CI on every pull request. Conventions are in [Code Quality](docs/CODE_QUALITY.md).

## Guiding principles

1. **Accessibility first:** readable captions, transparent status, simple onboarding.
2. **Graceful degradation:** if audio fails, preserve the conversation through text and retryable messages.
3. **Privacy and consent:** explicit microphone/meeting permissions, data minimization, clear retention policy.
4. **Honest translation:** preserve meaning; communicate errors and uncertainty.
5. **Affordable operation:** track cost per translated minute and avoid unnecessary data transfer.
6. **Platform independence:** own the core product, integrate with third-party meeting platforms separately.

## Privacy in the prototype

- The microphone is requested only after you tap **Turn on microphone**, and **Turn off mic** releases it.
- Each recording is sent once to the server, passed to the provider, and discarded. The server never writes audio or transcripts to disk or logs; logs contain language codes, sizes and timings only.
- One-device captions live in the browser tab's memory and disappear when the tab closes. Only preferences (languages, caption size, autoplay) are saved locally.
- In a conversation, the server keeps the room's recent messages (text only, up to 100) in memory so a reconnecting person can catch up. They are gone when the room ends after 30 idle minutes or the server restarts. Each device stores only its seat token for that room, which expires after 12 hours.
- Anyone with a conversation link can join while a seat is free, so share it only with the person you're talking to.
- With `PROVIDER=openai`, audio and text are processed by OpenAI under its API terms.

## Development status

- [x] Repository and concept documentation
- [x] One-device prototype: speech capture → transcript → translation → captions
- [x] Text-to-speech playback
- [x] CI: format, lint, typecheck, tests, build
- [x] Two-person rooms with reconnect, replay and delivery receipts
- [ ] Measured latency, quality and cost with a real provider
- [ ] Two physical devices over different networks
- [ ] Network resilience testing under throttling
- [ ] Deployment and public demo

## Portfolio goal

Demonstrate real-time systems design, AI API integration, accessible UX, streaming media, network resilience, privacy-conscious engineering, and measurable performance, with claims tied to implemented features.

## Business model exploration

Consider a free limited tier for individuals and students and paid meeting/conference usage that helps subsidize access. **No pricing or charitable commitments are decided.**

## License

No open-source license has been selected. Public visibility does not by itself grant reuse rights.
