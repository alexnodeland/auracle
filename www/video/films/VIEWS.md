# The tour, and the four views in depth

Five films. **The tour** is the map: a short, high-level pass over the whole
instrument, where everything is and roughly what it does. It is for someone
opening Auracle for the first time. Then four deep dives, one per view of the
instrument. For most musicians these are the
films that matter: how to play it (PERFORM), how to change it (PATCH), how to
grow new sounds (EVOLVE) and how to read what it has learned (TASTE). They sit
on the home page, in *Four views, one loop*, each beside the view it shows, and
at the top of that view's page in the guide.

They replace the two short walkthroughs `perform` (*PERFORM, in two minutes*)
and `circuit` (*Open the circuit*), and they take the best of `playing`,
`sounddesign` and `composing`. Those shots already pass rehearsal, so reuse
them wherever they show the view.

| Film | Working title | View | Length | Guide page |
|---|---|---|---|---|
| `tour` | A tour of Auracle | the whole layout | 2–3 min | `docs/src/getting-started/first-session.md` |
| `view-perform` | PERFORM: playing the sound | PERFORM | 4–6 min | `docs/src/views/perform.md` |
| `view-patch` | PATCH: inside the sound | PATCH | 4–6 min | `docs/src/views/play.md` |
| `view-evolve` | EVOLVE: breeding sounds you like | EVOLVE | 4–5 min | `docs/src/views/evolve.md` |
| `view-taste` | TASTE: what it learned about you | TASTE | 4–5 min | `docs/src/views/taste.md` |

The guide page is the source of truth for what the view does. Where the film
and the page disagree, the app decides, and whichever of the two is wrong gets
reported.

## Who they are for

Musicians: players, producers, sound designers and composers, not engineers.
After watching a film they should be able to use that view in their own work,
and know why they would reach for each part of it. Speak to *you*. Name things
by what you hear before what they are called. Leave the maths to *The math*.

## The bar: what "better than the rest" means

1. **Sound first.** Every demo is heard, from the app itself: the capture taps
   the master bus, so the voices and every audition are in it. Play musical
   material, not scattered keys: chords that change on the bar line, a
   bassline, a pad held while a control moves. When a demo has a tempo, use
   66 BPM, the bed's tempo, in F (84 BPM for a film still on Study). Play
   what the film cast from the shortlist (`shotgen.CAST`), not what the seed
   deals.
2. **Show, then say.** The picture shows the thing happening while the
   narration names it; a callout points at it when the eye would not find it
   alone. Never describe a change you can't hear or see.
3. **A camera that helps.** Open each chapter wide enough to orient, then
   frame the part being discussed (`aim`, about 1.2–1.8×). Settle before the
   words land. Don't move while a callout is up.
4. **Chapters you can navigate.** Six to nine per film. Each answers one
   musical question ("How do I make it brighter while I play?") and carries a
   short on-screen label, which becomes its name in the films page's chapter
   list.
5. **The same session every take.** Seed it (`init`), so what you rehearse is
   what gets recorded. Views that need history (EVOLVE, TASTE) run a taught
   session, built off camera.
6. **No dead air.** About 150–170 wpm. The screen never sits still for more
   than two seconds without narration or sound; a wait of more than a couple of
   seconds is a cut (`clips`).
7. **The truth.** Every number, name and behaviour on screen is what the app
   does. If rehearsal shows the app doing something surprising, film what it
   does and report it; don't script around it.

## Voice, captions, music

- The spoken voice follows [`www/brand/voice.md`](../../brand/voice.md), which
  wins where this file differs: explain, pause, demo, continue, and nothing
  under speech.
- Voice `af_heart` at speed 0.81, with pronunciations from `lexicon.json`.
  Every line passes `asr_check.py` (per-line WER ≤ 0.10; aim for a mean of
  0.02 or less). Then run `timeline.py --voice` for real word times.
- Short sentences with one idea each, because every sentence is also a
  caption. Plain, warm and precise, with no marketing adjectives.
- Music: ADR-014's, in `docs/notes/sound-2026-09/SPEC.md` section 9.
  - The script is on the N3 bed (`"music": {"bed": "n3"}`).
  - Bloom comes before the first word and Reach after the last, 1.75 s from
    the voice.
  - The bed sits under the voice throughout, with no `bed_db`.
  - Each demo plays after its line (the line's `demo`, `README.md` § A demo):
    0.7 s after the last word, its tail rung out, 0.8 s more. The bed comes
    down 6 LU under it by itself.
  - Nothing snaps to a bar.
  - The films still on the `study` bed keep the old rule until they are
    re-voiced: the bed under the title, the chapter turns and the outro, and
    out under each demo.

## Structure of each film

1. **Cold open, 10–15 s.** The film's most musical moment, played before a
   word is said.
2. **What this view is for,** in one or two lines, over the title.
3. **The chapters.** For each: the question, the demo, what it means for you.
4. **Putting it together, 20–40 s.** A short passage that uses several of the
   chapters at once, as a musician would.
5. **Outro.** Where to go next (the next view) and the guide page.

## Outlines

These are starting points, not scripts. Cut, merge or reorder freely if the
film gets better for it. The tour covers orientation, so the deep dives skip
general orientation (where the bank, the dock and the tabs are) beyond what
their own view needs, and each deep dive's outro points on to the next.

### `tour`: A tour of Auracle

The map, not the territory: 2–3 minutes, brisk, and still musical. Cold open:
the instrument playing (a chord, a control turned, an offer taken), wide.
Then a guided pass, each region framed and named as it is used, never just
pointed at:

- **The four views,** the tabs across the top, in one sentence each:
  - PERFORM is where you play;
  - PATCH is what the sound is made of;
  - EVOLVE is where you pick and it breeds;
  - TASTE is what it has learned about you.
  Visit each for a few seconds.
- **The bank,** on the left: presets, evolution, your patches, and how a row
  plays and opens.
- **The dock,** along the bottom: the keybed and computer keys, hold, the
  arpeggiator and the rest; volume and REC; the MIDI indicator.
- **The header:** PICKS and GEN, the help card (?), and the ⋯ menu (files, the
  taste profile, the films).
- **First visit:** the warm start (pick three), and what happens next.
- **Where to go next:** one line per deep dive.

Start from a fresh session (the warm start, skipped or answered), so the
viewer sees what they will see.

### `view-perform`: PERFORM

Cold open: pad chords (Slow Weather) while an XY gesture brings in Bright and Motion.
The chapters:

- **Play it:** the computer keys (A–L and W–P, Z/X for octaves, Shift to
  accent), the on-screen keys and MIDI. Velocity plays timbre (the touch row).
- **Six controls named for what you hear:** Bright, Snap, Motion, Body, Grit
  and Space. Each is wired to *this* patch's own knobs by measurement; the
  strip underneath shows the real knobs moving. Long-press a control to hear it.
- **Honest controls:** a half-closed control only goes one way; an amber,
  dashed control is a search, and turning it grows a variant.
- **The XY pad:** two controls under one hand. Choose the axes, then play a
  gesture while holding a chord.
- **Offer:** a variant grows in slot B. Peek at it, ride Blend, then Take it
  or pass. Every take and every pass teaches the model.
- **Keep, Back and Freeze:** mark where you are, and come home.
- **Wander:** the model plays the controls with you. Set the depth; stop it.
- **The dock:** Hold, Unison, Glide, the arpeggiator, Sync and ● REC.
- **MIDI:** knobs claim controls; learn a knob; the pedal, pressure, mod wheel
  and clock. Only the tab you use plays MIDI (`midi ○` on the others).

Putting it together: an arpeggio at 84 with Wander up, and an Offer taken on
the downbeat. Reuse `playing`'s `pl-*` shots.

### `view-patch`: PATCH

Cold open: a filter swept on the rack while a phrase plays, the cables alive.
The chapters:

- **A real modular circuit:** modules and cables, green for audio and amber
  for modulation, with every knob at its true position in musical units.
- **Hearing a patch properly:** the bank (presets, evolution, your patches),
  ▶ and the audition phrase, and the spec card (what the model believes about
  this patch).
- **Changing it:** turn any knob while playing, with no recompile. Bypass,
  unplug (HELD) and ⌘Z.
- **The node bank:** 45 modules. Preview before you place; green inserts,
  amber replaces. Modulation chains (S&H → quantize → slew).
- **Steps:** a sequencer for timbre, on the tempo.
- **Locks and ⚡ evolve from this:** lock what you love, and breed the rest.
- **Commit:** the commit duel (the original against your edit), and *my edit
  is better*.
- **Taking it with you:** `.auracle.json`, the picture export, and dropping a
  file to open it. The lineage in EVOLVE.

Reuse `sounddesign`'s `sd-*` shots, and `composing`'s `co-steps` and
`co-share`.

### `view-evolve`: EVOLVE

Cold open: A heard, B heard, a pick, and the next pair slides in. The chapters:

- **The duel:** hear A (1) and B (2), then pick (← or →). You judge the sound,
  not its name.
- **Pointing it:** the warm start (pick three) on a first visit.
- **What a pick does:** the teaching meter counts down to the next refit. It
  forecasts each duel before you answer; keep it to that one sentence.
- **Generations:** the pool breeds toward your picks. The EVOLUTION strip and
  its lineage log say what changed ("attack 0.59→0.83, +noise").
- **EVOLVE POOL:** growing more of what you like.
- **Stars, save and cut:** what each one teaches, and what it doesn't.
- **Check duels:** why some pairs are deliberately random.
- **A working rhythm:** a dozen quick duels, play, repeat; *New · built for
  you*.

Reuse `composing`'s `co-direction`, `co-evolve` and `co-keep`.

### `view-taste`: TASTE

Cold open: the MAP brightening as picks land. The chapters:

- **Four lenses** on what it learned: MAP, STYLES, DIRECTIONS and TRUST.
- **MAP:** every patch you've heard, placed by sound and structure. Glow is
  how much it thinks you'll like a patch; size is how sure it is. Click a dot
  to hear it.
- **STYLES:** more than one taste, so dark drones *and* bright plucks. Hear
  the exemplars and name a style.
- **DIRECTIONS:** what pushes a sound up or down for you. A long bar whose
  whisker crosses the centre line is a guess.
- **TRUST:** is its confidence honest? Forecasts are scored against check
  duels.
- **When it's wrong:** disagree with it (duels, stars) and watch the map move.
- **Your profile:** save it as a file, load it, reset it. It stays in your
  browser.

It needs a taught session with enough picks for STYLES, DIRECTIONS and TRUST
to say something. Build it off camera; `www/capture-screens.mjs` builds one
for the screenshots. Keep this film lively: hear patches, and show the views
changing, not sitting still.

## Process: your deliverables, in order

1. **`script.json` and `storyboard.md`** in `films/<id>/`, in the format of
   `films/playing/`, with chapter-sized beats and short lines.
2. **The voice:** `tts.py` → `asr_check.py` (it must pass) → `timeline.py
   --voice --demos` (the demos' measured tails) → `fit_score.py --film`, which
   writes the bed and the marks to the timeline.
3. **`shots.json`:** a seeded `init`, one shot per beat, `clips` for any
   wait. Rehearse with `footage.mjs <id> --dry` until every shot passes with
   empty errors and little lateness. `validate.mjs` and `framing.py` must be
   clean too.
4. **`film.js` and `index.html`:** the `walk.js` plan (chapters, camera,
   callouts), plus the cold-open title and outro cards drawn with the kit, the
   way `films/launch/` and `films/perform/` draw theirs.
5. **The hand-back report:**
   - the chapter list (beat id → on-screen name);
   - a poster time;
   - an 8–15 s *silent loop* window for the home page, one that reads with the
     sound off;
   - the rehearsal summary;
   - open issues;
   - the exact recording command.

## Rules

- **Files you own:** `www/video/films/<id>/**` only. Don't edit
  `www/video/tools/`, `www/video/stage/` or `apps/web/`. If you need a tool
  or app change, send the orchestrator (`main`) the exact need, and don't
  work around an app bug.
- **`lexicon.json`:** add entries only, in one read-modify-write, re-reading
  just before you write.
- **The machine is shared** by four film agents. Run one browser at a time
  (`queue.sh`), use `nice -n 10` for TTS and rehearsals, and never run a full
  render or a real (non-dry) recording. The orchestrator records every film on
  a quiet machine.
- **No commits and no pushes.** The orchestrator commits.
- Read anything; delete nothing that belongs to another film.
