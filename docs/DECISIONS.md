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

## Open decisions

- Real-time speech-to-speech vs the current pipeline (D1), decided by benchmark
- Long-term provider(s), terms, language support, and unit economics
- Whether streaming in Phase 2 still needs a server relay (D2)
- Consent, data retention, and regional processing options
- Room authentication and abuse mitigation
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
