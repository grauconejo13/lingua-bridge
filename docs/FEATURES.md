# Feature Backlog

Legend: **MVP**, **Next**, **Later**, **Research**. These are plans, not completed features.

| Priority | Capability | Acceptance idea |
| --- | --- | --- |
| MVP | English/Hindi language selection | Each side can configure target language |
| MVP | Microphone permission and input | Clear consent prompt, mute/stop available |
| MVP | Speech recognition | Interim/final recognized text displayed |
| MVP | Translation | Clearly labeled source and target text |
| MVP | Optional translated TTS | Play and stop translated speech |
| MVP | Error / loading states | API failure and disconnection visibly handled |
| MVP | Basic privacy controls | No recording without explicit user action |
| Next | Two-person room links | Each device joins its own secure session |
| Next | Automatic source language detection | User can override incorrect detection |
| Next | Per-person audio/caption preferences | Independent listener settings |
| Next | Network diagnostics | Measure round-trip delay, loss/jitter where exposed |
| Next | Text fallback and re-send | Recover from transient audio failure |
| Next | Mobile-responsive PWA | Usable on phone-sized screens |
| Next | Cost/latency instrumentation | Log aggregate timings without storing speech content |
| Later | Conference/QR audience join | One speaker; multiple translated language channels |
| Later | Zoom Apps/RTMS integration | Validate availability, consent, approved audio access |
| Later | Offline-friendly store-and-forward | Queue with consent; sync when network returns |
| Later | More language pairs | Add only after quality evaluation |
| Research | Voice-preserving synthesis | Opt-in voice ownership/consent and misuse safeguards |
| Research | Local on-device inference | Device support, model size, accuracy, battery tradeoffs |
| Research | Speaker diarization | Differentiate overlapping voices with measured reliability |

## UX expectations

- Accessible text sizing and contrast; captions are available when audio is off.
- Display original and translated text side by side when useful.
- Clearly show live, reconnecting, queued, delivered, and failed states.
- Never imply a queued message was delivered before acknowledgement.
- Avoid automatically enabling cameras or recording calls.

## Out of scope for MVP

Video, hidden cameras, proprietary earbuds, standalone ESP32 translator hardware, enterprise billing, and custom Zoom audio replacement.
