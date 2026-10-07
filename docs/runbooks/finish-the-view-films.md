# Record and publish the view films

The view films are `tour`, `view-perform`, `view-evolve`, `view-patch` and
`view-taste`, plus `playing`. This page is how a round of them is made, from a
fresh machine to published files.

## Status

The first round was recorded on an M3 Mac on 2026-09-29 (all six rehearsed
clean, every take checked) and is **held, not published**. Watching the
previews, the narration was too fast (195–202 words a minute against the voice
pipeline's own target of 160, `TARGET_WPM` in `asr_check.py`), the sounds the
seeded session dealt were often blaring, noisy or harsh, and the films were
walkthroughs with too little visual explanation. The second pass is
[Plan-004](../plans/004-one-design-system.md) task 8, under
[ADR-011](../decisions/011-one-design-system.md). It waits on the design
system and the rebuilt views (tasks 1–6) and the sonic floor (RFC-005), so
that it films the improved app. The scripts, timelines and shots of the
first round are committed; the renders were not.

**Where published films live is undecided.** `publish.py` copies them into
`www/landing/assets/film/`, which puts every version into git history for good
(the six already published are 158 of the repository's 163 MB). Decide the
storage before the next publish.

## 1. Set up (once)

Needs rustup, Node 22 (`.node-version`; with fnm installed, setup and `make`
use it whatever your shell's `node` is) and Python 3.10–3.12.

```bash
make film-setup        # scripts/setup.sh --film: toolchain, engine, .venv-voice, models, shared sound
```

If it stops with "cannot reach pypi.org" while other programs can, a
per-app firewall (Little Snitch) is blocking that Python: allow it, or build
the voice on another, e.g. `AURACLE_PYTHON=python3.11 make film-setup`.

## 2. Voice

The narration audio is gitignored and rebuilt from the committed scripts.
**The films' voice is `af_heart` at speed 0.81** (ADR-011, chosen by
audition on 2026-09-30). The scripts still say 0.9 until the second pass moves
them (Plan-004 task 8); do not voice a new round at 0.9.
Kokoro is deterministic on one machine but **not across CPU architectures**:
on Apple silicon, line boundaries held within 3 ms of the container's, but up
to 15% of word starts moved, by as much as 260 ms. The shots are pinned to
those words, so a machine change means re-timing. The films voice
independently, so voice them in parallel:

```bash
for f in tour view-perform view-evolve view-patch view-taste playing; do
  OMP_NUM_THREADS=3 make film-voice FILM=$f &
done; wait
git status --short www/video/films   # a moved timeline.json means: re-time and re-shoot that film
```

To re-time a film, run its tail script and then its shots, from the repo root:
`tour` and `view-patch` use `align_tails.py`, `view-perform` uses
`fill_tails.py` and `view-evolve` uses `fit_timing.py`; each is then followed
by `gen_shots.py`. `view-taste` and `playing` need only `gen_shots.py`. The
ASR gate fails a line Whisper hears differently: in the first round "Hold
latches a chord" came back as "latch as a cord", an ambiguity a listener has
too, so the line was reworded rather than aliased.

## 3. Rehearse

Required after a voice pass that moved timelines, after an app change a film
shows, and on a new machine. One film at a time, on a quiet machine:

```bash
make film-rehearse FILM=view-perform
```

On the M3 all six took 64 minutes, the longest being `view-taste` at 17
(its shots each teach a session off camera first).

## 4. Record, on a quiet machine

No builds, suites or other browsers while it records (the log says "quiet
window over" when the takes are in; the renders after that can share the
machine). Recording takes about as long as rehearsing. Disk: the takes for all
six are about 6 GB, and a film's frame parts about 4 GB while it renders
(deleted once it is encoded).

```bash
make film-record-all FILMS="tour 30 view-perform 65 view-evolve 120 view-patch 6 view-taste 10 playing 40"
```

Each film ends as `www/video/out/<film>/<film>.mp4`, `.webm` and
`<film>-preview.mp4` (720p, for review). Finishing a film (score, mix, render,
encode) took 4–10 minutes each on the M3 and also fits its music to the takes,
which rewrites `www/video/films/<film>/timeline.json`: commit those.

`takes.py` flags a take that paints slowly while the page moves. In the first
round it flagged TASTE's `vt-styles` and `vt-together` at 10 and 6 paints a
second; their frames arrive on a steady 100 ms and ~170 ms beat, the app's own
timers rather than a starved compositor, and a re-take measured the same.
Check the gaps (`shots/<shot>.frames.json`) before re-recording a flagged take.

## 5. Review, then publish

Watch the previews. Once the storage question above is settled:

```bash
make film-publish FILMS="tour view-perform view-evolve view-patch view-taste playing"
```

`publish.py` places the films, fills the guide's `<!-- film:NAME -->` blocks,
the Films page, the README and the app's film chip (`data-films`; the chip
and ⌘K's Watch ‹LEVEL› in depth read it, and the chip and the warm start's
tour link stay hidden until their film is published). Check the site: `make site && make site-check`.

## 6. Guide screenshots

Several guide screenshots predate Wave 1 (TASTE's DIRECTIONS, STYLES and MAP,
the spec card, the rack detail, the bank). Recapture them from a taught
session with `node www/capture-screens.mjs` and check each against the guide
text it illustrates.

## 7. Changelog, then the PR

Write it as the branch's changelog entry, `changelog.d/<topic>.md` (the
`changelog` skill), with the published lengths filled in (`publish.py`
prints them). An entry opens with its `### Kind: title` heading:

```markdown
### Added: five films of the instrument itself

Recorded in the real app in a seeded session, so every name and number on
screen is one you would see:

- **A tour of Auracle** (m:ss): the four views, the bank, the dock and a
  first visit. The warm start's "▶ new here? take the tour" opens it, and so
  does the menu-bar film link on a first visit.
- **PERFORM** (m:ss), **PATCH** (m:ss), **EVOLVE** (m:ss) and **TASTE**
  (m:ss): each view in depth, in its own tab on the landing page (a silent
  loop in the view's pane) and at the top of its guide page.

In the app, **▶ film** in the menu bar opens the film of the view you are in,
with its length on hover. The first time you open a view it says so ("new to
PATCH? watch PATCH in depth"), and a newcomer's first note is the tour; after
that it folds away. It stays out of booth mode and out of the films
themselves (`film_chip.spec.js`).
```

## Known

- **A film's deals made while the pool fills can differ between takes**
  (ADR-001, #211). A seed in the address (`?seed=`, as every spec boots)
  keeps a session's deals to the fill's schedule: the k-th deal of a fresh
  session draws only from the first 8·(k+1) sounds in the order the seed
  fills the pool, and waits for them, so it deals the same pairs at any
  machine speed, however fast its pool fills. A film opens `?film` and
  seeds the page's `Math.random` (`shotgen.INIT`), which draws the engine's
  seed, but puts no seed in the address, so it deals as an ordinary session
  does: at once, over however many sounds have joined. The duel stream's
  draws depend on that number (range sampling rejects draws), so the first
  deals, and the deals after them, can differ between takes. The films'
  taught set-up re-deals to the fifth pair (`shotgen.REDEAL`), and no line
  depends on which pair shows, but takes can still land on different pairs.
  Fix: open the films with a seed in the address (the page then draws no
  engine seed from `Math.random`, so every later draw of the page moves:
  the warm start's cards and the sides change too, and every patch name in a
  recording needs re-checking), or let `?film` deal by the schedule as
  well. The maintainer's call. (A draw of
  wasm's 32-bit `usize` used to read the stream differently from a native
  one. `auracle_grammar::rng::gen_index` pins it for the pool and the
  random-rule duels; taste fits, walks and PERFORM's offers still differ
  across targets until `fugue-ppl` draws its site as a `u64`. That fix
  changed what a seed deals in the browser too: a film's seeded session, and
  every seeded spec, dealt a different pool than before it.)
- **Published films with stale details** (`taste`, `math`, `dsp`, and the
  unpublished `sounddesign`): six callouts or cards describe the app before
  Wave 1 (for example the TASTE film's inset shows bare bars where the app now
  draws guesses hollow). Listed in the interaction review's film audit; edit
  the cards and re-render those illustrated films.
