# PATCH: inside the sound — storyboard

The deep dive into PATCH, for sound designers: **read** a patch, **hear** it
properly, **change** it while you play, **grow** it from the node bank, give it
movement (chains, Steps), **protect** what you love (locks, ⚡ evolve from
this), and **keep** your version (commit, files). Every change is heard.

A cold open with no words, the title over the bed, nine chapters, *putting it
together*, and the outro: 106 bars at 84 BPM, 5:03. Each chapter opens on a
**one-bar card** over the bed (chapter number, name, the musical question it
answers, and a row of nine small plates with this one lit). On the chapter's
downbeat the card's veil lifts and the demo starts, with the bed out and the
app as the music. Chapters play over one recorded shot each (`shots.json` →
`tools/footage.mjs`), framed by `stage/walk.js`.

The tour film covers orientation (tabs, bank, dock, header, warm start), so
this film does not: it starts inside PATCH.

**Cards over real footage.** Every card beat borrows a shot and runs it on
unbroken under the card (film.js): a chapter's turn borrows the chapter's own
shot, which starts a bar early (`pre` 3.4 s), so the rack under the card is the
rack the chapter opens on; the title borrows the cold open's shot and the outro
the last chapter's (their `dur` runs on through the card). The turn's plan
entry gives the shot's start (`meta.pre`) and keeps its cuts out of the card
(`clips: []`); `tools/validate.mjs` checks it. `cards.js` draws only a veil
over the footage's window and the type; walk.js draws the captions below the
window.

**Music.** `bed_db` per beat (script.json → arrangement.json `levels`): the
bed is **in** under the title, every chapter card and the outro (0 dB), and
**out** under the cold open, every chapter and *putting it together* (−60).
`loop_a` from the title, `loop_b` from chapter 07's card. Beats start on bar
lines (`snap: "bar"`), and each beat's tail runs to the next bar line
(`align_tails.py`), so one scene hands to the next with no gap; the cards and
the bed turn on the downbeat. Every demo with a tempo runs at 84 BPM, the
bed's, and chords change on the film's bar lines: `gen_shots.py` lays them on
the score's bars from timeline.json and pins them to the narration's words, so
they stay on the bar lines through a shot's cuts, and a re-timed voice
re-times the playing. The app is heard over its own beat only (app_audio.py),
so a borrowed shot is silent under its card.

**Session** (shots.json `init`, `setup`; `shotgen.taught`): seeded
`Math.random`; the warm start taught by its first, fifth and eighth cards (the
deal is logged by every shot). Taught, so the model's guess, the spec card's
belief and ⚡ all have a fit. Each shot then opens its preset in PATCH, puts
the first-visit aids away (the bench tour's banner by its *got it*; the
keybed's hint by one note), and waits for the engine to settle (`#belief` not
re-measuring, the wordmark's lamp not thinking) and the toasts to clear.

**Edits.** Every bench edit goes through one ordered lane, so knobs can be
turned back to back. A gesture that turns one knob both ways is one press
(the cold open's, *changing it*'s and *together*'s cutoff: `path` in
shots.json). A bypass or an unplug is refused while another structural edit
is in flight, so chapter 03 waits (stamped) for each step to land, and the
beat cuts through the wait; on a quiet machine the cuts skip nothing.

**Keys.** `a` = C4. Chords: **C** `a d g` · **Am** `h k ;` · **F** `f h k` ·
**G** `g j l`; Fmaj7 `f h k ;`; Am7 `g h k ;`.

**Selectors.** Plates `#rack-svg g.mod-group[data-key='…']` (Glass Pad: chorus
`node`, filter `node/0`, LFO `node/0/m`, supersaw `node/0/0`, amp `amp`);
knobs `[data-addr='node/0#cut']`, `amp#release`, `amp#sustain`; a plate's ⋯
`.mod-menu-btn`, its ▢ `.mod-lock`, a knob's `.lock-dot`; menu items
`#ctx-menu .cm-item:has-text('bypass')`; audio sockets
`.jack[data-childkey='…'] circle:last-of-type` (the hit target), mod slots
`.jack[data-modkey='<owner>']`; wires `path.wire.audio[data-from]`,
`path.wire.mod`; bench ▶ `#rack-play`; belief `#belief`; the strip
`#spec-dock` (`.sp-blurb`, `.sp-params`, `.sp-heard`, `.sd-model`); IN THIS
PATCH chips `.nb-chip[data-kind]`; catalogue `.nb-item[data-kind]`, its search
`#nb-q`, armed status `#nb-status`, preview ▶ `#pv-play`; HELD `#tray`,
`#tray-items .tray-item`; toolbar `#rack-evolve`, `#rack-commit`,
`#improve-check`; the commit duel `#cduel`, `.cduel-cell:has-text('the
original'|'your edit') .cd-play|.cd-pick`; files `#ovf-btn`,
`#patch-export-btn`, `#image-btn`, `#ix-fmt`, `#ix-go`; dock `#hold-btn`,
`#arp-btn`, `#arp-div`, `#arp-mode`, `#bpm`, `#sync-btn`.

---

## 0. `cold` — shot `vp-cold` (no words, 4 bars) · Acid Line

- **Set-up:** tempo 84 · HOLD on, then ARP (1/16, up·down), the drawer folded.
- **Actions:** Fmaj7 struck on beat 2 of bar 1 and latched: the acid line
  runs. The cutoff is dragged up over 3 s, then back down over 3 s, as one hand
  on one knob. HOLD off on the title's downbeat.
- **Camera:** wide on the rack, pushes to 1.5× on the filter as it opens, back
  out as it closes. No callouts: the cables flow green while notes sound, and
  the amber mod-env cable pulses.

## 1. `title` — `vp-cold` runs on (title1–2), card

The bed comes in on the downbeat, the acid line stops, and the rack eases back
to whole under a veil. *Auracle · the four views, in depth* · **PATCH** ·
*inside the sound* (on title1). On "One patch" a single green cable patches
itself, out → in; its signal flows on "playable".

## Chapter cards — `t-read` … `t-together` (one bar each), the chapter's shot

The chapter's shot is already running (the rack at rest, a bar before its
demo), veiled: *chapter 0N*, the name, a green rule, the question word by word,
and nine small plates with this chapter's lit. On the downbeat the veil lifts
onto the same frame. The veil runs unbroken from the title through
chapter 01's card.

| beat | name | question |
|---|---|---|
| `t-read` | Reading the circuit | What am I looking at? |
| `t-hear` | Hearing it properly | How do I really hear a patch? |
| `t-change` | Changing it | How do I change it while I play? |
| `t-add` | Adding a module | How do I add something new? |
| `t-move` | Modulation chains | How do I make it move by itself? |
| `t-steps` | Steps | How do I give the tone a rhythm? |
| `t-lock` | Locks and ⚡ evolve | How do I keep what I love, and vary the rest? |
| `t-keep` | Commit | How do I keep my version? |
| `t-take` | Taking it with you | How do I take it with me? |
| `t-together` | Putting it together (*all together*, no plates) | Everything at once, the way you'd work. |

## 2. `read` — shot `vp-read` (read1–6) · Glass Pad

- **Actions:** C–Am–F–G, one chord per bar, the whole chapter.
- **Camera:** wide, then it reads the chain itself, left to right, as read3
  names each module (the saws, the filter, the chorus, ENV / OUT); then the
  LFO's amber cable; then the knobs.
- **Callouts:** the audio cable "sound, left to right"; the amber cable "a slow
  LFO, moving the cutoff" (amber); the cutoff, the release and the sustain on
  "hertz", "milliseconds", "decibels".

## 3. `hear` — shot `vp-hear` (hear1–5) · Glass Pad

- **Actions:** `#rack-play` at the end of hear1: the five-second standard
  sample, heard alone (hear1 has a 5.5 s pause after it). "play it" (hear2):
  chords, one per bar, to the end. hear4: the pointer rests on the chorus chip
  in IN THIS PATCH; the strip under the rack opens the chorus's card.
- **Callouts:** ▶ "the standard sample: 5 s, the same for every patch"; the
  belief row "the model's guess, and what moves it" (amber: the number is a
  reading of this session, not a constant, so nothing says it); the card's
  blurb "what it does"; its *heard as* line "what the model can't hear"
  (amber).

## 4. `change` — shot `vp-change` (change1–4) · Glass Pad · **cuts**

- **Actions:** chords every bar. change1: the cutoff dragged down, then up
  past where it was (one knob). change2: chorus ⋯ → *bypass* (the chorus
  leaves the chain; HELD shows it). change3: the filter's `in` socket is pulled
  (a drag off the jack into empty canvas): the patch goes quiet and the
  supersaw waits in HELD. change4: ⌘Z: the supersaw is back, and sounds.
- Each step waits (stamped `ready2`, `ready3`, `ready4`) until the one before
  has landed and the engine has settled, and the beat cuts through the wait
  (`clips`). On a quiet machine the waits are short and the cuts skip nothing.
- **Callouts:** "live: the voices follow at once"; "bypassed, and held"; "an
  empty socket: silence"; "held, with its settings"; "⌘Z: back in, and heard".

## 5. `add` — shot `vp-add` (add1–5) · Glass Pad

- **Actions:** chords until the preview. add2: `delay` clicked (in hand, the
  sockets light green), the pointer on the socket between filter and chorus
  (*insert delay after filter*). add3: ▶ in the strip: a two-second render with
  the delay spliced in, heard alone. add4: the socket clicked: placed (*take it
  out* toast), and the chords come back with echoes. add5: `formant` clicked,
  the pointer on the supersaw's socket: amber, *replaces supersaw*; `esc` puts
  it down.
- **Callouts:** "42 modules"; "sources → shape → filter → space → …"; "every
  socket it fits"; "green: insert delay after filter"; "a preview: nothing is
  placed"; "placed, as one undo step"; "amber: replaces the supersaw" (amber).

## 6. `move` — shot `vp-move` (move1–4) · Ask The Dice

- **Actions:** one key (`a`) held throughout: the S&H → quantize → slew chain
  plays the oscillator's pitch as a random melody in A minor. move4: `slew`
  armed, the pointer on the filter's CUTOFF slot (it already holds a mod env),
  clicked: the slew wraps the mod env.
- **Callouts:** "random values"; "snapped to A minor"; "glides"; "one key,
  held"; "already moved by a mod env" (amber); "mod env → slew → cutoff"
  (amber).

## 7. `steps` — shot `vp-steps` (steps1–3) · Loom

- **Actions:** Am latched by HOLD on the downbeat; Loom's Steps walks its
  ladder filter. steps2: two bars redrawn back to back, the second step down
  to about −70% and the third up to about +70% (a bar is set where it is
  pressed and dragged to). steps3: HOLD off, SYNC on (the RATE knob reads its
  division), and the chord struck again on the next bar line, where the
  pattern restarts at 84.
- **Callouts:** "steps → the ladder's cutoff" (amber); "one bar per step, up to
  eight"; "SYNC"; "on the tempo: 84".

## 8. `lock` — shot `vp-lock` (lock1–3) · Glass Pad · **cut**

- **Actions:** chords; lock1: the cutoff's lock dot, then the chorus's ▢.
  lock2: ⚡ *evolve from this*. The beat cuts at lock3 to the moment the child
  is on the bench (`clips: [["lock3", "@benched-0.6"]]`); chords again on the
  child. Which child ⚡ breeds varies from load to load; the chorus, locked,
  never changes.
- **Callouts:** "one knob, by its dot"; "a whole module, by its ▢"; "⚡ evolve
  from this"; "locked: unchanged"; "unlocked: free to change" (amber).

## 9. `keep` — shot `vp-keep` (keep1–4) · Glass Pad (edited in set-up)

- **Actions:** chords, then COMMIT: the duel (*which one is better?*, sides
  shuffled). ▶ *the original*, then ▶ *your edit*, each heard (keep2 has a 5 s
  pause after it). keep3: *this one* under your edit. keep4: once settled, the
  resonance nudged, *my edit is better* ticked, COMMIT: committed as a claim,
  no duel.
- **Callouts:** "sides shuffled"; "▶ the original"; "▶ your edit"; "heard, and
  taught" (amber); "my edit is better"; "a claim, scored apart from what you
  heard" (amber).

## 10. `take` — shot `vp-take` (take1–3) · Glass Pad → its ⚡ child

- **Set-up:** an edit committed through the heard duel, the chorus locked, ⚡
  run to its child (so the lineage has both kinds of entry).
- **Actions:** ⋯ → *Export this patch* (a `.auracle.json`); ⋯ → *Export as
  image…*, SVG, export (its note: the patch rides inside). take2: the panel
  closed; `fixtures/First_Bass.svg` (a real picture export) dropped on the
  window: First Bass opens; a bass figure on the beat. take3: EVOLVE, the
  lineage.
- **Callouts:** "a .auracle.json file"; "a picture: PNG or SVG"; "the patch
  rides inside the picture"; "what changed, in words" (amber).

## 11. `together` — shot `vp-together` (together1–4) · Acid Line

- **Actions:** Am7 latched on the downbeat (arp up, 1/16, 84). together2: the
  cutoff opened and brought part of the way back, then the resonance nudged.
  together3: `/`, "grit" typed, `distortion` armed and placed after the
  filter. together4: the filter's ▢, *my edit is better*, COMMIT.
  HOLD off on the bar line after "yours".
- **Callouts:** "search by sound"; "locked"; "my edit is better · commit".

## 12. `outro` — `vp-together` runs on (outro1–2), card

The committed acid line, still, under a veil; the bed in. The five verbs as
pills, each lit as it is said (*read, change, grow, protect, keep*); then *next,
in depth* · **EVOLVE** · *breeding sounds you like*, the guide pill (*The
instrument › PATCH*), the lockup; then black.

---

## Building it (from the repo root)

1. `www/video/tools/voice.sh view-patch` — narration, ASR check, timeline.
2. `python3 www/video/films/view-patch/align_tails.py` — every beat to the next
   bar line (script.json tails, timeline.json, arrangement.json).
3. `python3 www/video/films/view-patch/gen_shots.py` — shots.json.
4. `node www/video/tools/validate.mjs view-patch` — references and borrowed
   shots.
5. `www/video/tools/rehearse.sh view-patch` — every shot, dry.
6. `python3 www/video/tools/framing.py view-patch` — callouts inside the frame.
7. `www/video/tools/one_browser.sh node www/video/films/view-patch/preview.mjs 17 21.4 …` — stills of the
   cards (a shot not recorded yet is stood in for by its rehearsal).
8. `www/video/tools/walkthrough.sh view-patch 15.5` — record, mix, render.
