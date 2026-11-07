# Benchmarks

Lingua Bridge only makes performance claims it has measured. This page defines what is measured, the targets that gate each milestone, and the results so far.

## Targets for the Milestone 1 gate

Measured on a laptop over a normal home connection, one utterance of roughly 3 to 8 seconds, with a real provider (not the demo provider).

| Metric                                         | Target                         | Why                                      |
| ---------------------------------------------- | ------------------------------ | ---------------------------------------- |
| Stop-to-caption time, median                   | ≤ 1.5 s                        | Feels like a short pause in conversation |
| Stop-to-caption time, p95                      | ≤ 3.0 s                        | Occasional slow turns stay tolerable     |
| Stop-to-caption time, p95, throttled "Fast 4G" | ≤ 4.0 s                        | Usable on an ordinary mobile connection  |
| Translation adequacy                           | ≥ 4 of 5 on average            | Meaning preserved; see rubric below      |
| Provider cost                                  | Recorded per translated minute | Needed before any free tier is planned   |

If the targets are missed, the result is still published, and the Phase 1 gate in the [Roadmap](ROADMAP.md) stays open.

## What the app measures

Every caption records:

- `transcribeMs` and `translateMs`: server-side time spent in each provider call.
- `totalMs`: server time for the whole utterance.
- `clientMs`: time in the browser from tapping stop to the caption appearing, including upload. This is the number people feel, shown on each caption.

Speech playback time is logged by the server as `synthesizeMs`.

## Automated run

```bash
npm run dev                                   # or npm start after a build
npm run bench -- --to <language-code> --runs 20
```

Phrases currently exist for English as the source (`--from en`, the default); add phrase sets in `apps/server/scripts/bench.ts` for other source languages. The script synthesizes fixed phrases with `/api/speech`, sends that audio to `/api/utterances`, and writes the transcripts and timings to `bench-results/` (git-ignored). Synthetic speech is cleaner than a microphone, so treat these numbers as a best case.

## Manual device run

1. Use two real devices: one laptop and one phone (iOS Safari or Android Chrome).
2. Speak 20 utterances from a fixed script in the source language, including names, numbers and a few technical terms.
3. Record the latency shown on each caption.
4. Repeat with Chrome DevTools network throttling set to "Fast 4G" and "Slow 4G".
5. Have a fluent speaker of the target language score each translation with the rubric.

## Translation adequacy rubric

| Score | Meaning                                       |
| ----- | --------------------------------------------- |
| 5     | Meaning fully preserved, natural              |
| 4     | Meaning preserved, slightly awkward           |
| 3     | Mostly understandable, a detail lost or wrong |
| 2     | Key meaning lost or changed                   |
| 1     | Wrong or unusable                             |

## Results

| Date | Provider and models | Pair | Setup | Median | p95 | Adequacy | Notes                     |
| ---- | ------------------- | ---- | ----- | ------ | --- | -------- | ------------------------- |
| —    | —                   | —    | —     | —      | —   | —        | No real-provider runs yet |

## Network resilience (simulated)

`npm run resilience` starts the server in-process with the demo provider (300 ms of simulated processing), puts a seeded impaired TCP proxy in front of it, and has two simulated people talk through it using the web app's own reliability rules (`ROOM_CLIENT_TIMING`). Alice sends 20 messages, one every 2 seconds; every third is a 24 KB recording (about 16 s at the poor tier's 12 kbit/s). Bo receives and acknowledges.

- **Received:** messages that reached Bo. **Receipts:** "Delivered" confirmations that made it back to Alice. **Duplicates** must be zero.
- **Delay** runs from Alice's first send attempt to Bo receiving it, so it includes retries and reconnects.
- **Measured RTT and tier** are what the app's own monitor would have shown, which checks the tier thresholds against known conditions.

What this does **not** cover: true packet loss (a userspace proxy sees a byte stream, so loss appears only as stalls and resets; use `tc netem` or Network Link Conditioner for that), real microphones, real phones, or translation quality.

### Results

Run 2026-11-07, Node 22.23, seed 1. "Reconnect attempts" include attempts refused during an outage.

| Profile  | Conditions                               | Received | Receipts | Dupes | Median delay | p95 delay | Retries | Reconnect attempts | Measured RTT | Tier |
| -------- | ---------------------------------------- | -------- | -------- | ----- | ------------ | --------- | ------- | ------------------ | ------------ | ---- |
| baseline | Local, no impairment                     | 20/20    | 20       | 0     | 0.2 s        | 0.5 s     | 0       | 0                  | 3 ms         | good |
| good-4g  | 80 ms RTT, 10 Mbit/s up                  | 20/20    | 20       | 0     | 0.3 s        | 0.6 s     | 0       | 0                  | 99 ms        | good |
| fast-3g  | DevTools Fast 3G: 563 ms, 675 kbit/s up  | 20/20    | 20       | 0     | 0.8 s        | 1.4 s     | 0       | 0                  | 622 ms       | fair |
| slow-3g  | DevTools Slow 3G: 2 s, 400 kbit/s        | 20/20    | 20       | 0     | 2.3 s        | 3.1 s     | 0       | 0                  | 2118 ms      | poor |
| stalls   | 4G, frozen 8 s about every 25 s          | 20/20    | 20       | 0     | 0.3 s        | 4.9 s     | 0       | 0                  | 103 ms       | good |
| resets   | 4G, all connections cut 3 s every ~15 s  | 20/20    | 20       | 0     | 0.3 s        | 0.6 s     | 2       | 8                  | 100 ms       | good |
| worst    | Fast 3G plus a 5 s drop about every 20 s | 20/20    | 20       | 0     | 0.9 s        | 6.2 s     | 5       | 8                  | 729 ms       | fair |

The `worst` profile was also run with seeds 2 and 3: 20/20 received and 20 receipts each, p95 8.4 s.

**Bug found by this harness.** The first run of `worst` lost one receipt: Bo received a message, then the connection dropped before Bo's acknowledgement reached the server. Resuming replayed only messages newer than Bo's last seq, so the acknowledgement was never re-sent and Alice's message stayed at "Sent". The server now also replays the other person's messages that this participant hasn't acknowledged (`RoomService.hello`, covered by a unit test), and the client acknowledges them on arrival.

**Reading the results.** Delivery held up in every profile. Stalls are where people will notice: a freeze holds messages until it ends, so the slowest messages wait out the freeze (the 4.9 s p95). Note that the stall profile still classifies as _good_, because round trips between freezes are fast; the tier describes the link's speed, not its reliability.
