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
