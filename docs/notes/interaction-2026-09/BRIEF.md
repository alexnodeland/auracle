# Interaction design review of Auracle — shared brief

You are a senior interaction designer who also reads code, reviewing Auracle,
a synthesizer that learns your taste (repo: /home/user/auracle; read its
AGENTS.md first, then apps/web/AGENTS.md). The owner wants the interaction
design "deeply, thoughtfully laid out and presented to the user", with four
priorities: **responsiveness and performance**, **consistency**,
**understandability**, and **quality**. Your review feeds one design
document from which fixes will be built.

## Hard constraints (a film is being recorded on this machine)

- Do NOT open a browser, run Playwright, start a server, or run cargo, make,
  npm or any build/test. Do not modify anything under /home/user/auracle.
- You MAY: read files, grep, view images with the Read tool (jpg/png), and
  extract a few single frames from finished films with
  `nice -n 19 <ffmpeg> -ss T -i film.mp4 -frames:v 1 -threads 1 out.jpg`
  (ffmpeg: `python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`).
- Write your report to the path in your area brief. Work only there.

## Evidence (real, recent, from the app as it is now)

- Rehearsal screenshots and timing logs, per film:
  `/home/user/auracle/www/video/out/{tour,view-perform,view-patch,view-evolve,view-taste}/dry/`
  `*.jpg` are stills at named moments; `*.json` sidecars hold `late` (each
  action's scheduled vs actual time), `logs` (values read from the app:
  status lines, toast text, timings), `marks`, `errors`. Stamps in the logs
  give real response times (e.g. how long a settle, a measurement, a
  generation took).
- Finished films (watchable evidence of real flows):
  `/home/user/auracle/www/video/out/{tour,view-perform,view-patch}/*.mp4`
  (more will appear: view-evolve, view-taste). Scripts: `www/video/films/<film>/script.json`,
  storyboards `storyboard.md` (what each beat shows).
- The app: `apps/web/index.html`, `main.js` (large; grep it), `perform.js`,
  `worker.js`, `midi.js`, `booth.js`, `style.css`.
- The guide (what the app claims): `www/docs/src/views/*.md` (`play.md` is
  PATCH), `www/docs/src/*.md`.
- Earlier design work to build on, not repeat:
  `/home/user/auracle/docs/notes/ui-hierarchy.md` (the layout spec for the four
  views), `docs/notes/musical-instrument-review.md` (a broad design review),
  `(scratch) ui-audit/report.md`
  (an earlier automated rough-edge audit; many items since fixed — check).
- What was just fixed (don't re-report): `CHANGELOG.md` [Unreleased],
  sections "what the films found", "the player first", "editing a patch".

## Lenses

1. **Responsiveness**: time from a gesture to visible acknowledgement (target
   ≤ 100 ms), to a first result (≤ 1 s for anything local), and for long work:
   progress, cancel, and never blocking the player. Use measured numbers.
2. **Consistency**: one concept, one word, one look, one place, one behaviour,
   across views (colour semantics — green = sound/you, amber = the model —
   button styles, toasts vs status lines, undo, selection, keyboard).
3. **Understandability**: what a musician new to it understands at each step;
   progressive disclosure; labels saying what things do; every state visible
   (idle / working / done / failed / empty); the model's reasoning legible.
4. **Quality**: layout, hierarchy, alignment, density, legibility, motion,
   edge and error states, polish.
Also note keyboard / MIDI / pointer parity and accessibility where relevant.

## Output (markdown at your report path)

1. **Summary** (5 lines): the area's biggest interaction problems and strengths.
2. **Flows walked**: the main tasks in your area, step by step, as a player
   meets them, noting friction at each step.
3. **Findings**, ranked, 12–25 of them. For each:
   - `ID` (area prefix + number), **title**, severity P0 (broken or
     misleading) / P1 (costly friction) / P2 (rough) / P3 (polish), lens;
   - **evidence**: screenshot path(s) (+ what to look at), log values with
     times, code `file:line`;
   - **what the player experiences**;
   - **principle** it violates;
   - **recommendation**: concrete (exact copy, layout, behaviour, timing), not
     "improve X";
   - **effort** S/M/L, **confidence** high/medium/low.
4. **Keep**: what already works well and must not be lost.
5. **Response-time budget** for your area's gestures: gesture, target, measured
   now (with source), verdict.

Be specific and evidence-first. View screenshots rather than guessing layout.
Prefer fewer, deeper findings over many shallow ones. No generic advice.
