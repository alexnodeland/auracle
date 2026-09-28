# EVOLVE: breeding sounds you like — storyboard

The deep dive into EVOLVE, over the real instrument: one recorded shot per
chapter (`shots.json` → `tools/footage.mjs`), framed by `stage/walk.js`, with
the title, the chapter cards and the outro drawn with the kit (`cards.js`).
Nineteen beats (a cold open, the title, eight chapters of a one-bar turn and a
demo each, the outro) over ten recorded shots, 46 lines, 503 words at speed
0.9, 4 min 31 s.

**Who it is for.** Musicians who want to grow sounds rather than dial them
in. They should leave knowing how to judge a duel by ear (1, 2, then ← or →),
when to click a card and play it instead, what the warm start is worth, what a
pick does to the model and why the pairs are random, what EVOLVE POOL does to
the pool and how to read what changed, what stars, save and cut each teach,
and the rhythm a session settles into.

**The sound.** The capture taps the master bus, so every audition in the film
is heard: the five-second phrase each card plays (a held C4, a C5 stab, C4+E4,
and a low C3 that rings out), the warm start's ▶, a bank row's ▶, and chords
played on a card. Under the demos the app is the music: the bed is out
(`bed_db: -60`). The `study` bed comes in under the title, each chapter's
one-bar turn and the outro (`bed_db: 0`). Its sections are `loop_a` from the
title and `loop_b` from the fifth turn, each running until the next starts
(`walkthrough.sh` fits the score to them; the levels do the rest). Chords are C, Am, F and G, two beats each at 84 BPM, on
the beat grid.

## The session

**One seeded session everywhere** (`init`, the same seed as the walkthrough
films). The warm start deals *Acid Line, Folded Lead, Coin Toss, Sea Change,
Pump Room, Glass Rain, Woodblock, Gated Snare, Ceiling*.

**Taught** (the film's common set-up):
1. Wait for the warm start and a pool of 40.
2. Pick the first two pads on the grid and the first texture (Sea Change,
   Pump Room, Glass Rain; the selectors list every pad and texture, so a new
   deal still picks by family), then **teach it**.
3. Wait until the app has switched to PERFORM and the model has fitted, then
   go to EVOLVE.
4. Play one note, so the "press A–L" coach goes.

Each chapter then adds its own picks off camera, so the pair on the cards
differs from chapter to chapter.

**Picks** are made the way a musician after pads would make them: the side
whose name sounds like a pad (Swell, Wash, Pad, Drone), else alternately
(`PICK_JS`). They are made through the app's own buttons, so the app does
what a click does.

**The turns.** Each chapter's demo shot starts 3.4 s before its beat
(`pre`). The chapter's turn beat borrows that shot (`film.js`,
`meta.pre = 3.4 − one bar`), so the footage runs unbroken under the chapter
card and into the chapter. The title borrows the cold open's shot the same
way; `ve-open` has a `dur` that covers the title.

**Generated.** `shots.json` comes from `gen_shots.py` (with the shared
`tools/shotgen.py`), and the tails, turn leads and bed sections in
`script.json` from `fit_timing.py`. Re-run both after any change to the
voice:

    www/video/tools/voice.sh view-evolve
    python3 www/video/films/view-evolve/fit_timing.py
    python3 www/video/films/view-evolve/gen_shots.py

**Selectors.**
- EVOLVE: `#duel-mid` (the meter), `#teach-pips`, `#teach-copy`, `#duel-pred`
  (the forecast and the probe mark), `#skip-duel`, `#evolve-btn`, `#duel-a`,
  `#duel-b`, `#name-a`, `#scope-a`, `#play-a`, `#choose-a` (and the `-b`
  twins), `#lineage-log`.
- The bank: `#bank-list .bank-item` (with `.saved`, `.fresh`, `.live`, `.kbd`),
  `.bi-hear`, `.star[data-s='4']`, `.bi-save`, `.bi-kill`, `#pin-budget`.
- Elsewhere: the live label `#live-label`, the keybed `#piano`, and the warm
  start (`#warmstart`, `.warm-item`, `+ .wi-play`, `#warm-go`).

**Focus.** A focused button swallows 1, 2 and the arrow keys (main.js
ignores non-note keys whose target is a button), so every set-up ends with a
blur, and a skip that is clicked on camera is followed by one.

---

## `open` — cold open, shot `ve-open` (no words, 11.3 s; bed out)

- **Set-up:** taught; the pair's renders in; no toast.
- **Actions:**
  - at 0.3 s, `1`: A's phrase, whole;
  - at 5.4 s, `2`: B's phrase, whole;
  - at 10.05 s, the pick (B's release still ringing). The name flashes, the
    forecast appears, and the next pair slides in.
- **Camera:** 1.1 on the cards, still.
- **Callouts:** "A · press 1" on A's ▶ SAMPLE while A plays; "B · press 2" on
  B's while B plays.

## `title` — borrows `ve-open` (title1–2; bed in, `loop_a`)

- **Picture:** the session runs on under the title card: *Auracle · the four
  views*, **EVOLVE**, *breeding sounds you like*. Six amber pips (the teaching
  meter's) light on "two", "pick", "reach", "breeds", "toward" and "picks".
  Under them: "two sounds · one pick · a new generation".
- **Camera:** 1.1 → 1.16, a slow push.

## `turn1` + `duel` — shot `ve-duel` (duel1–7) · 01 · the duel

- **Card:** *01 · The duel · How do I choose between two sounds?*
- **Set-up:** taught + 3 picks.
- **Actions:**
  - `duel2:one`: `1`; `duel3:two`: `2`. Both phrases play whole, with the
    narration paused over them.
  - `duel6:B+0.3`: `→`, which picks B, as the line says.
- **Camera:** wide, then card A (1.32) for "one", card B for "two", both
  cards for the phrase, the button row for the arrows, then both cards.
- **Callouts:**
  - "1 · hear A" and "2 · hear B";
  - "the same five seconds, every time" on A's waveform;
  - "← picks A" and "→ picks B".

## `turn2` + `play` — shot `ve-play` (play1–5) · 02 · play it yourself

- **Card:** *02 · Play it yourself · How do I hear more than the phrase?*
- **Set-up:** taught + 2 picks.
- **Actions:**
  - `play1:click`: click card A's body (it goes live on the keyboard; the
    shot waits for the live label to name it);
  - `play2:That`: C, Am, F, G on the beat;
  - `play3:Click`: card B; `play3:play`: the same four chords;
  - `play5:quick`: a quick pick.
- **Callouts:** "click a card", "now on your keys" (the keybed), "the other
  card".

## `turn3` + `point` — shot `ve-point` (point1–4) · 03 · point it

- **Card:** *03 · Point it · How do I tell it what I'm after?*
- **Set-up (own):** a fresh session with the warm start up and the pool
  full. Nothing is taught.
- **Actions:**
  - `point2:Play`: ▶ on the first pad card (its phrase is heard);
  - `point2:closest`: the two pads and the texture;
  - `point3:passed+0.2`: **teach it**.
- **Cut** (`clips`): from `point4` to `@taught+0.9`. The teach takes seconds
  and then switches to PERFORM; the shot goes to EVOLVE, which reads
  *18 picks in*.
- **Callouts:**
  - "one per family, then filled" on the grid;
  - "▶ hear it";
  - "3 picks × 6 passed = 18" on **teach it**;
  - "eighteen picks in" (amber) on the meter after the cut.

## `turn4` + `meter` — shot `ve-meter` (meter1–4) · 04 · what a pick does

- **Card:** *04 · What a pick does · What happens when I pick?*
- **Set-up:** taught + 3 picks (three pips lit), then a skip after the
  forecast's hold, so the forecast line is clear.
- **Actions:** three quick duels (1, 2, pick), each heard. The picks land on
  `meter1:dot` and `meter2:away`. The third, on `meter4:sixth`, is the sixth
  since the last fit, and the refit takes the meter over: "● it just learned
  — see what changed ▸".
- **Callouts** (all amber): "one dot per pick" on the pips; "its forecast,
  made before you picked" on the forecast; "it just learned" on the copy.

## `turn5` + `fair` — shot `ve-fair` (fair1–5) · 05 · fair questions

- **Card:** *05 · Fair questions · Why these two?*
- **Set-up:** taught + 4 picks, then a skip after the forecast's hold, so the
  forecast line starts clear.
- **Actions:**
  - `1`, then `2`, heard under fair2;
  - `fair3:pick`: a pick, and its forecast;
  - `fair5:skip`: skip, a new pair, and nothing recorded.
- **The truth it tells.** Under the default pairing every pair is random, so
  every pick is a fair test of the forecast (TASTE › TRUST). This build shows
  its "◇ unbiased probe" mark only on the first deals after a page load, and
  its tooltip says one duel in ten. That is reported, and a fix that states
  the rule steadily is on its way. The film does not show the mark; re-point
  the first callout at the new element when it lands.
- **Callouts:** "A and B: dealt at random" (amber) on the pair; "its forecast,
  checked against you"; "TASTE › TRUST" on the TASTE tab; "skip · nothing
  recorded".

## `turn6` + `breed` — shot `ve-breed` (breed1–7) · 06 · a generation

- **Card:** *06 · A generation · How does it grow new sounds?*
- **Set-up:** taught + 9 picks (one refit), and the bank tour marked as seen,
  so the generation's own toast is the one that shows.
- **Actions:**
  - `breed1:press`: EVOLVE POOL ("breeding 1/10…").
- **Cut** (`clips`): from `breed3` to `@bred-0.4`. A generation takes about
  two minutes.
- **After the cut:** ⚡ rows glow in the bank; the toast reads *Gen 1: N new
  patches in the bank. The N patches it liked least were retired to make
  room*; the lineage lines say what changed, in real units. `breed7:listen`
  plays ▶ on the first new row, whose phrase is heard.
- **Callouts:** "breeds from its ten best"; "⚡ a new child"; "the ones it
  liked least, retired"; "what each child changed" (amber); "▶ hear it".

## `turn7` + `keep` — shot `ve-keep` (keep1–5) · 07 · stars, save, cut

- **Card:** *07 · Stars, save, cut · How do I keep a sound, and what does that
  teach?*
- **Set-up:** taught + 2 picks.
- **Actions** on the first unsaved row:
  - `keep1:three`: ▶ (heard);
  - `keep2:teach`: four stars ("… rated 4★");
  - `keep3:keeps`: save ("Saved … — it won't be replaced. 4/10 slots used.");
  - `keep4:Cut`: hover the next unsaved row (its cut control shows on
    approach), then cut it ("Cut … #id." with undo).
- **Camera:** wide, so the rail and the toasts are both in view (the rows
  re-sort as the model takes each answer in, so the callouts point at what
  stays put); the rail at 1.4 for the last line.
- **Callouts:** "a rating teaches" (amber) on the rating's toast; "a save
  keeps, and teaches nothing" on the save's toast; "seven seconds to undo" on
  the cut's toast; "saved: never retired" on the pin budget.

## `turn8` + `rhythm` — shot `ve-rhythm` (rhythm1–5) · 08 · a working rhythm

Putting it together.

- **Card:** *08 · A working rhythm · How does it fit into a session?*
- **Set-up:** taught + 3 picks; the bank tour marked as seen.
- **Actions:**
  - four quick duels, each heard (the third is the sixth pick: a refit);
  - `rhythm3:Evolve`: EVOLVE POOL.
- **Cut** (`clips`): from `rhythm4` to `@bred-0.3`.
- **After the cut:**
  - `rhythm4:Play`: the first new ⚡ row is clicked, which opens the child on
    the bench and in PATCH, and the child plays C, Am, F, G on the keys;
  - after the chords, its row is saved;
  - `rhythm5:back`: back to EVOLVE; `rhythm5:round`: a pick.
- **Callouts:** "a new child, on the keys"; "saved".

## `outro` — shot `ve-outro` (outro1–2; bed in)

- **Set-up:** taught + 1 pick.
- **Picture:** the outro card: the mark; *next · the fourth view*;
  **TASTE**, *what it learned about you*; and the pill *the guide · views ›
  EVOLVE*. Then a fade to the rack.

---

## Where this departs from VIEWS.md's outline

- **"New · built for you"** is the landing page's hero demo, not the app. In
  the app a generation shows as ⚡ rows, the *Gen N* toast and the lineage
  lines, and that is what the film shows (reported).
- **Check duels** are not "some pairs": under the default pairing every pair
  is random, so the film says "by default, every pair is dealt at random".
  The probe mark is shown after a skip early in the page load, which is the
  only time the app shows it (reported).
- **The forecast** is one sentence (meter3), as asked.
- **Generations and EVOLVE POOL** are one chapter (06). A second generation
  runs in the working rhythm (08).
