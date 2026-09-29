# Finish the view films (PR3), on your own machine

The five view films (`tour`, `view-perform`, `view-evolve`, `view-patch`,
`view-taste`) and `playing` are written, voiced, and rehearsed clean against
the app on branch `claude/auracles-composer-performer-gtlo9w` (main plus the
film work). Recording and rendering them in a 4-core cloud container took
about half an hour a film, so they are finished on a faster machine. This
page is the whole of what is left.

## 1. Set up (once)

Needs rustup, Node 22 (`.node-version`; with fnm installed, setup and `make`
use it whatever your shell's `node` is) and Python 3.10–3.12.

```bash
git fetch origin && git checkout claude/auracles-composer-performer-gtlo9w
make film-setup        # scripts/setup.sh --film: toolchain, engine, .venv-voice, models, shared sound
```

If it stops with "cannot reach pypi.org" while other programs can, a
per-app firewall (Little Snitch) is blocking that Python: allow it, or build
the voice on another, e.g. `AURACLE_PYTHON=python3.11 make film-setup`.

## 2. Voice

The narration audio is gitignored and rebuilt from the committed scripts. The
committed timelines are what the shots were written against; the re-voice
reproduces them (Kokoro is deterministic, and the ASR gate checks every line).

```bash
for f in tour view-perform view-evolve view-patch view-taste playing; do make film-voice FILM=$f; done
git status --short www/video/films   # expect no timeline changes; if one moved, re-run that film's gen_shots.py and rehearse it
```

## 3. Rehearse (optional, a few minutes each)

They were rehearsed clean on the commit before this page; after any change,
or on a new machine, rehearse the one you touched:

```bash
make film-rehearse FILM=view-perform
```

## 4. Record, on a quiet machine

No builds, suites or other browsers while it records (the log says "quiet
window over" when the takes are in; the renders after that can share the
machine). Disk: the takes for all six are about 6 GB, and a film's frame parts
about 4 GB while it renders (deleted once it is encoded).

```bash
make film-record-all FILMS="tour 30 view-perform 65 view-evolve 120 view-patch 6 view-taste 10 playing 40"
```

Each film ends as `www/video/out/<film>/<film>.mp4`, `.webm` and
`<film>-preview.mp4` (720p, for review). Finishing a film also fits its music
to the takes, which rewrites `www/video/films/<film>/timeline.json`: commit
those.

## 5. Review, then publish

Watch the previews. Then:

```bash
make film-publish FILMS="tour view-perform view-evolve view-patch view-taste playing"
```

`publish.py` copies the films into `www/landing/assets/film/`, fills the
guide's `<!-- film:NAME -->` blocks, the Films page, the README and the app's
film chip. Check the site: `make site && make site-check`.

## 6. Guide screenshots

Several guide screenshots predate Wave 1 (TASTE's DIRECTIONS, STYLES and MAP,
the spec card, the rack detail, the bank). Recapture them from a taught
session with `node www/capture-screens.mjs` and check each against the guide
text it illustrates.

## 7. Changelog, then the PR

Add under `[Unreleased]` in `CHANGELOG.md`, with the published lengths
filled in (`publish.py` prints them):

```markdown
And five films of the instrument itself, recorded in the real app in a
seeded session, so every name and number on screen is one you would see:

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

Then push and open the PR against `main`. CI's required check takes about
8 minutes; the films touch no code the slow tier covers.

## Known, not part of this PR

- **Seeded deals are not fully reproducible** (ADR-001): the duel stream's
  draws depend on the pool's size at each deal (range sampling rejects draws,
  and wasm's `usize` is 32-bit), so deals made while the pool fills can differ
  between runs. The films' taught set-up re-deals to the fifth pair, and no
  line depends on which pair shows, but 1 take in 12 still landed elsewhere.
  Fix: derive each deal's draw from the seed and the deal's index. Its own PR.
- **Published films with stale details** (`taste`, `math`, `dsp`, and the
  unpublished `sounddesign`): six callouts or cards describe the app before
  Wave 1 (for example the TASTE film's inset shows bare bars where the app now
  draws guesses hollow). Listed in the interaction review's film audit; edit
  the cards and re-render those illustrated films.
