# Film sound, September 2026

On 2026-09-30, at `7c893ad`, the films' sound was audited and then auditioned in five rounds, with the maintainer listening to each, and finished in a sixth. Every candidate was a bank preset played by the engine's own `score` example (`crates/auracle-wasm/examples/score.rs`); no outside samples or effects were used. [`SPEC.md`](SPEC.md) is what came out of it, and RFC-007 cites it. Dated and not kept current.

The narration in the reel is from the held round of view films (view-perform, recorded 2026-09-29, at speed 0.9), re-timed. The demo in the reel is the engine playing a score, not the app recorded. SPEC.md marks this, the bend standing in for glide, and the hand-placed sighs as stand-ins.

## Files

| File | What it is |
| --- | --- |
| [`AUDIT.md`](AUDIT.md) | Round 1: the films' sound as it was. Covers cues, beds, the mix ladder, the cast, launch-video tropes, keys and rooms, and the renders on disk, all measured. |
| [`SPEC.md`](SPEC.md) | The specification: the key, the cast with every knob value, the marks' scores, the bed, the mix, the voice chain, the loudness ladder, the grammar's timings, the final reel's measurements, the changes `www/video/tools` would need, and what was decided by ear. |
| [`scores/m2_bloom.json`](scores/m2_bloom.json) | Bloom, the entrance mark (60 BPM) |
| [`scores/m1_reach.json`](scores/m1_reach.json) | Reach, the exit mark (60 BPM) |
| [`scores/n3.json`](scores/n3.json) | The bed, N3: three cycles, each part on its own track, with one sigh |
| [`scores/reel.json`](scores/reel.json) | The final reel's music: drone, both marks, the bed and the demo, placed against the narration's timing. Both transitions are cut from it. |
| [`clips/bloom.mp4`](clips/bloom.mp4) | Bloom on its own, 6.2 s |
| [`clips/reach.mp4`](clips/reach.mp4) | Reach on its own, 6.2 s |
| [`clips/bloom_into_n3.mp4`](clips/bloom_into_n3.mp4) | Bloom and the bed's first 8 s, 13.3 s |
| [`clips/n3_into_reach.mp4`](clips/n3_into_reach.mp4) | The bed's last 8 s and Reach, 15.1 s |
| [`clips/reel.mp4`](clips/reel.mp4) | The whole direction with narration and a demo, 42.6 s, −16.1 LUFS, −1.20 dBTP |

The clips are AAC at 128 kb/s, 48 kHz, audio only, in an `.mp4` container.

To render a score:

```
cargo run --release -p auracle-wasm --example score -- docs/notes/sound-2026-09/scores/<file>.json <out_dir>
```

It writes the mix and one stem per part. The mix in SPEC.md was applied to those stems by a script that is not kept; SPEC.md states every setting it used.

## The rounds

| Round | Heard | Chosen |
| --- | --- | --- |
| 1 | Chapter turns: as mixed with a whoosh, a crossfade, a breath; a pick blip, as published and removed. Marks: the logo sting, a mark built from five presets, no mark. Beds under narration: Study, Study sparse at 66 BPM, the same in C, no bed. The app under the bed as mixed, and held 6 dB over it. | **No cues at all.** The turns' noise was an offer grown from Glass Pad in the tour's cold open (a casting problem). No mark was good; the logo sting was the worst. The sparse, slow pad bed was the best. The direction became Mort Garson's *Plantasia*: warm, round, nothing harsh. The voice should explain, pause, let the instrument play over the music in its key and register, then go on. The voice and music should be mixed better. |
| 2 | The bank measured and 16 presets shortlisted. Three soft marks in F: contracting, growing, a motif. The bed alone, with a melody, with a low arpeggio, with both. The new grammar mocked against today's. The voice mix: today's, EQ'd with the bed carved, and the same breathing in pauses. | The motif (B7). The bed with melody and arpeggio (C7). The new grammar (D4). The EQ'd voice, with the bed more prominent. |
| 3 | The bed 3 dB and 6 dB more prominent under the EQ'd voice; a first reel of the whole direction; the first SPEC. | The bed at −3 LU with a 2 dB duck and 3 dB carve (E4). The demo in the reel cut off abruptly, and the voice came back too soon. |
| 4 | A rewritten bed over an F pedal, built up a part at a time (drone and pad; with the burble; with the melody; the burble as written) against the previous bed. Three motifs (Reach, Bloom, B7 reharmonised) and B7 itself. A second reel, in which the demo rings out and the voice waits for its tail. | The bed with all its parts (N3). **Bloom to open and Reach to close.** Every part to have its own place in the mix. |
| 5 | The marks, both transitions and the bed mixed on stems, against round 4's. A deeper vowel dip on the bed under speech. A third reel. | The bed with the 2 dB dip, not the deeper one. A slightly longer sustain and release on the motif. |
| Final | The motif's lead at sustain 0.80 and release 0.45 everywhere it plays: decay from 0.03 s to 0.11 s, held 2.3 dB fuller. Then two changes from the maintainer. | **The motif only in the marks:** the bed's melody became falling two-note sighs of its own. **The marks placed exactly:** the first word 1.75 s after Bloom, and Reach 1.75 s after the last word. The reel went from 66.7 s to 42.6 s. The files here. |
