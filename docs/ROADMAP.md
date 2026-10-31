# Roadmap

## Phase 0: Capture and validate

- [x] Describe problem, audiences, goals, architecture, and backlog.
- [ ] Review comparable offerings and identify an underserved use case.
- [ ] Choose target language quality tests and evaluation phrases.
- [ ] Estimate provider cost/translation minute.
- [ ] Define privacy and consent baseline.

## Phase 1: One-device MVP (current)

- [x] Scaffold React/Vite/TypeScript UI and Node backend.
- [x] Secure API integration and microphone permission.
- [x] Configurable multilingual speech capture to translated text.
- [x] Optional translated audio playback.
- [x] Responsive captions, visible errors, mute and stop controls.
- [x] Latency instrumentation and benchmark script.
- [ ] Record latency/cost test results with a real provider (see [Benchmarks](BENCHMARKS.md)).
- [ ] Deploy a rate-limited public demo and record a short video.

**Gate:** Can someone demonstrate a translation with transparent permissions that meets the [Milestone 1 targets](BENCHMARKS.md#targets-for-the-milestone-1-gate): median stop-to-caption ≤ 1.5 s, p95 ≤ 3 s, adequacy ≥ 4/5?

## Phase 2: Two-person conversation

- [ ] Joinable rooms with language preferences per listener.
- [ ] Bidirectional audio/text delivery and interruption handling.
- [ ] Avoid feedback loops/overlapping playback.
- [ ] Add reconnect, text/push-to-talk fallback.
- [ ] Test with two physical devices over different connections.

**Gate:** Can two people converse without losing track when one network becomes unstable?

## Phase 3: Adaptive low-bandwidth experience

- [ ] Capture network quality metrics where available.
- [ ] Adapt audio encoding/transmission where controllable.
- [ ] Add opt-in queued recordings/text with acknowledgements.
- [ ] Simulate throttling, dropouts, congestion and high RTT.
- [ ] Publish measured results with reproducible test setups.

## Phase 4: Platform expansion

- [ ] Evaluate Zoom Apps SDK and RTMS access plus permissible audio playback.
- [ ] Prototype meeting-caption overlay or companion audio experience.
- [ ] Explore presenter-to-many QR-room conference flow.
- [ ] Add languages based on evidence and testing.

## Phase 5: Product readiness (optional)

- [ ] Accessibility and privacy reviews, observability and operational limits.
- [ ] Pricing experiments informed by per-minute AI costs.
- [ ] Free usage policies and mission-driven access partnerships.
- [ ] Public pilot and feedback.

## Project policy

This is an idea captured for the project queue, **not** a commitment to immediate implementation. Prioritize a finished, measurable MVP before integrations or subscriptions.
