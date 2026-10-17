# Decisions, Assumptions & Risks

## Decisions captured

- Working project name: **Lingua Bridge**.
- Keep platform independent of Zoom; Zoom plugin is a later adapter.
- Build a modular language registry rather than hardcoding any language pair. Initial test languages will be selected based on provider capabilities and quality testing, without naming specific languages in public project documentation.
- Target browser-based software on laptops and phones; dedicated hardware optional later.
- Prioritize lower-bandwidth experiences and non-audio fallback.
- Preserve project documentation before starting code.
- Explore mission-driven business and affordability; no legal structure decided.

## Open decisions

- Real-time speech-to-speech vs STT → translation → TTS orchestration
- Which provider(s), terms, language support, and unit economics
- Server relay vs client-provider streaming
- Captions only vs speech playback first
- Consent, data retention, and regional processing options
- Room authentication and abuse mitigation
- Source language auto-detection vs explicit selection
- Exact requirements and feasibility of Zoom integration

## Risks and mitigations

| Risk | Mitigation idea |
| --- | --- |
| Translation changes meaning or technical terms | Show original text; allow correction; test glossary |
| Audio streaming costs outpace revenue | Rate limits, quotas, metering, text options |
| Weak connections cause dropped messages | Explicit queue/retry and delivery acknowledgements |
| High latency disrupts turn-taking | Instrument end-to-end timings; offer push-to-talk |
| Mic/camera privacy concerns | Visible consent and stop controls; minimal retention |
| Voice-cloning misuse | No cloning in MVP; verified opt-in if researched later |
| Platform/API restrictions | Keep core portable; test adapters separately |
| Mobile audio/autoplay limitations | Test real devices and require user gesture when needed |
| Offline expectations exceed device ability | Clearly distinguish offline queue from offline translation |
| Competing established products | Focus on user research and measured differentiators |

## Non-goals

No hidden recording, bypassing call consent, guaranteeing zero-latency interpretation, or claiming superior translation before benchmarking.
