# Decisions, Assumptions & Risks

## Decisions captured

- Working project name: **Lingua Bridge**.
- Keep platform independent of Zoom; Zoom plugin is a later adapter.
- Build a modular language registry rather than hardcoding any language pair. Initial test languages will be selected based on provider capabilities and quality testing, without naming specific languages in public project documentation.
- Target browser-based software on laptops and phones; dedicated hardware optional later.
- Prioritize lower-bandwidth experiences and non-audio fallback.
- Preserve project documentation before starting code.
- Explore mission-driven business and affordability; no legal structure decided.

## Milestone 1 decisions

These are working choices for the one-device prototype. Each can be revisited once benchmarks exist.

**D1. Pipeline first: speech-to-text → translation → text-to-speech.** Each step can be timed and swapped on its own, and the transcript gives captions for free. A direct speech-to-speech API will be benchmarked against it behind the same server interface before Phase 2.

**D2. Server relay, not browser-to-provider.** The browser sends audio to our server, which holds the key and calls the provider. This keeps credentials off the client and makes rate limits and cost caps enforceable, at the cost of one extra hop.

**D3. Turn-based (tap to speak, tap to stop) instead of continuous streaming.** It is simpler, works on every major browser via `MediaRecorder`, and gives clear consent boundaries. Streaming partial captions is a later improvement once turn latency is measured.

**D4. Explicit source language, no auto-detection yet.** The user picks the language they speak, which avoids misdetection on short phrases and is passed to the provider as a hint. Auto-detection with manual override stays on the backlog.

**D5. First real provider: OpenAI, called over plain REST.** One key covers transcription, translation and speech, which keeps the prototype small. The adapter uses `fetch` rather than the SDK to avoid a dependency and to make tests simple. This is not a long-term commitment; another provider can be added as a second adapter.

**D6. A keyless demo provider ships with the app.** Anyone can run the full UI and tests without an account or cost. The server reports demo mode and the UI labels every demo caption, so placeholder output is never mistaken for translation.

**D7. No retention by default.** Audio and transcripts exist only in memory for the request. Captions live only in the browser tab. Logs record language codes, sizes and timings.

## Milestone 2 decisions

**D8. Rooms are in memory, two seats, no accounts.** A room is created by one person and joined through a link. The join secret is in the URL fragment, which browsers do not send to servers, so it stays out of logs and referrers. Accounts would add sign-up friction to a two-minute conversation and belong to the private product if anywhere. A server restart ends all conversations, which is consistent with D7.

**D9. Send over HTTP, push over WebSocket.** Each send is an HTTP POST with a client-generated id; repeating it returns the same message, so retries after timeouts or reconnects can never duplicate. The WebSocket only pushes presence, messages and receipts. This keeps one clear reliability rule instead of building acknowledgements and retries into the socket protocol.

**D10. Messages carry a room sequence number.** A reconnecting device sends the last number it has and receives everything after it. Clearing the screen remembers the number so cleared messages don't return.

**D11. "Delivered" means the other device acknowledged it.** Server acceptance is shown as _Sent_. This follows the rule in [Features](FEATURES.md) never to imply delivery before acknowledgement.

**D12. Translate once per language, at the server.** Speech is transcribed once in the speaker's language and translated into each participant's language. Late joiners and people who switch language get translations on demand. The sender sees what the other person sees, so mistranslations can be noticed.

**D13. Turn-aware playback.** Each device shares when it is recording. Translated speech waits while either person is recording, because two phones in the same room would otherwise feed one speaker into the other microphone.

**D14. A device remembers its seat for 12 hours.** The seat token (never messages) is stored locally so a refresh, closed tab or dropped connection rejoins as the same person. An abandoned seat can be taken by someone new after 5 minutes.

## Open decisions

- Real-time speech-to-speech vs the current pipeline (D1), decided by benchmark
- Long-term provider(s), terms, language support, and unit economics
- Whether streaming in Phase 2 still needs a server relay (D2)
- Consent, data retention, and regional processing options
- Whether rooms need anything beyond link secrets (for example a host-approved join) once used outside demos
- When to add source language auto-detection (D4)
- Exact requirements and feasibility of Zoom integration

## Risks and mitigations

| Risk                                           | Mitigation idea                                            |
| ---------------------------------------------- | ---------------------------------------------------------- |
| Translation changes meaning or technical terms | Show original text; allow correction; test glossary        |
| Audio streaming costs outpace revenue          | Rate limits, quotas, metering, text options                |
| Weak connections cause dropped messages        | Explicit queue/retry and delivery acknowledgements         |
| High latency disrupts turn-taking              | Instrument end-to-end timings; offer push-to-talk          |
| Mic/camera privacy concerns                    | Visible consent and stop controls; minimal retention       |
| Voice-cloning misuse                           | No cloning in MVP; verified opt-in if researched later     |
| Platform/API restrictions                      | Keep core portable; test adapters separately               |
| Mobile audio/autoplay limitations              | Test real devices and require user gesture when needed     |
| Offline expectations exceed device ability     | Clearly distinguish offline queue from offline translation |
| Competing established products                 | Focus on user research and measured differentiators        |

## Non-goals

No hidden recording, bypassing call consent, guaranteeing zero-latency interpretation, or claiming superior translation before benchmarking.
