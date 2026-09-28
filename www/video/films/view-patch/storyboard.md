# PATCH: inside the sound — storyboard

The deep dive into PATCH, for sound designers: **read** a patch, **hear** it
properly, **change** it while you play, **grow** it from the node bank, give it
movement (chains, Steps), **protect** what you love (locks, ⚡ evolve from
this), and **keep** your version (commit, files). Every change is heard.

A cold open with no words, the title over the bed, nine chapters, *putting it
together*, and the outro. Each chapter opens on a **one-bar card** over the bed
(chapter number, name, and the musical question it answers), drawn by
`cards.js` over the chapter's own rack at rest; on the chapter's downbeat the
card lifts and the demo starts, with the bed out and the app as the music.
Chapters play over one recorded shot each (`shots.json` →
`tools/footage.mjs`), framed by `stage/walk.js`.

The tour film covers orientation (tabs, bank, dock, header, warm start), so
this film does not: it starts inside PATCH.

**Music.** `bed_db` per beat (script.json → arrangement.json `levels`): the
bed is **in** under the title, every chapter card and the outro (0 dB), and
**out** under the cold open, every chapter and *putting it together* (−60).
`loop_a` from the title, `loop_b` from chapter 07's card. Beats start on bar
lines (`snap: "bar"`), and each beat's tail runs to the next bar line
(`align_tails.py` in the scratchpad), so one scene hands to the next with no
gap; the cards and the bed turn on the downbeat. Every demo with a tempo runs
at 84 BPM, the bed's, and chords change on the film's bar lines (the shots'
chord times are computed from timeline.json, so a re-timed voice re-times the
playing).

**Session** (shots.json `init`, `setup`): seeded `Math.random`; the warm start
taught by its first, fifth and eighth cards (this seed deals *Acid Line, Folded
Lead, Coin Toss, Sea Change, Pump Room, Glass Rain, Woodblock, Gated Snare,
Ceiling*, so the picks are Acid Line, Pump Room and Gated Snare). Taught, so
the model's guess, the spec card's belief and ⚡ all have a fit. Each shot then
opens its preset in PATCH, puts the first-visit aids away (the bench tour's
banner by its *got it*; the keybed's hint by one note), and waits for the
engine to settle (`#belief` not re-measuring, the wordmark's lamp not
thinking) and the toasts to clear.

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

## 0. `cold` — shot `vp-cold` (no words, 4 bars)

- **Set-up:** Acid Line · tempo 84 · HOLD on, then ARP (1/16, up·down), the
  drawer folded.
- **Actions:** Fmaj7 struck on beat 2 of bar 1 and latched: the acid line
  runs. The cutoff is dragged up over 3 s (≈0.36 → 0.82), then back down over
  3 s. HOLD off on the title's downbeat.
- **Camera:** wide on the rack, pushes to ~1.45× on the filter as it opens,
  back out as it closes. No callouts: the cables flow green while notes sound,
  and the amber mod-env cable pulses.

## 1. `title` — cards.js (title1–2)

The bed comes in on the downbeat. PATCH / *inside the sound*, over a small
circuit drawing itself: SUPERSAW → FILTER → ENV / OUT in green, an LFO on the
filter in amber, the cutoff knob breathing. Captions as in the walkthrough.

## Chapter cards — cards.js (`t-read` … `t-together`, one bar each)

Over the chapter's shot (its first `pre` seconds: the rack at rest), dimmed:
*chapter 0N*, the name, a green rule, the question. On the downbeat the dim
lifts onto the same frame.

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
| `t-together` | Putting it together | Everything at once, the way you'd work. |

## 2. `read` — shot `vp-read` (read1–6) · Glass Pad

- **Actions:** C–Am–F–G, one chord per bar, the whole chapter.
- **Callouts:** the audio cable "sound, left to right"; the supersaw, the
  filter, the chorus by name as read3 says them; ENV / OUT "always last";
  the amber cable and its CUTOFF tab "LFO → cutoff" (amber); the cutoff
  (1.78 kHz), release (398 ms), sustain (−3.9 dB) on "hertz", "milliseconds",
  "decibels".
- **Camera:** wide, then along the chain (1.3×), to the LFO and CUTOFF (1.5×),
  then across the knobs.

## 3. `hear` — shot `vp-hear` (hear1–5) · Glass Pad

- **Actions:** `#rack-play` at the end of hear1: the five-second standard
  sample, heard alone (hear1 has a 5 s pause after it). "play it" (hear2):
  chords, one per bar, to the end. hear4: the pointer rests on the chorus chip
  in IN THIS PATCH; the strip under the rack opens the chorus's card.
- **Callouts:** ▶ "the standard sample"; the belief row "the model's guess,
  and why" (amber); the card's blurb "what it does"; its *heard as* line "not
  as width" (amber).

## 4. `change` — shot `vp-change` (change1–4) · Glass Pad

- **Actions:** chords every bar. change1: the cutoff dragged down, then up
  past where it was. change2: chorus ⋯ → *bypass* (the chorus leaves the chain;
  HELD shows it, *bypassed*). change3: the filter's `in` socket is pulled
  (a drag off the jack into empty canvas): the patch goes silent and the
  supersaw waits in HELD. change4: ⌘Z (pressed once the engine has settled,
  never while an edit is queued): the supersaw is back, and sounds.
- **Callouts:** the cutoff; *bypass* in the menu; HELD; the empty socket
  "quiet"; the held supersaw; ⌘Z.

## 5. `add` — shot `vp-add` (add1–5) · Glass Pad

- **Actions:** chords until the preview. add2: `delay` clicked (in hand, the
  sockets light green), the pointer on the socket between filter and chorus
  (*insert delay after filter*). add3: ▶ in the strip: a two-second render with
  the delay spliced in, heard alone. add4: the socket clicked: placed
  (*take it out* toast), and the chords come back with echoes. add5:
  `formant` clicked, the pointer on the supersaw's socket: amber, *replaces
  supersaw*; `esc` puts it down.

## 6. `move` — shot `vp-move` (move1–4) · Ask The Dice

- **Actions:** one key (`a`) held throughout: the S&H → quantize → slew chain
  plays the oscillator's pitch as a random melody in A minor. move4: `slew`
  armed, the pointer on the filter's CUTOFF slot (it already holds a mod env),
  clicked: the slew wraps the mod env.

## 7. `steps` — shot `vp-steps` (steps1–3) · Loom

- **Actions:** Am held; Loom's Steps walks its ladder filter. steps2: two bars
  redrawn (one down, one up) and the length taken to eight. steps3: SYNC on;
  the chord re-struck on the next bar line, where the pattern restarts at 84.
- **Callouts:** the STEPS plate; the bars; SYNC and the tempo.

## 8. `lock` — shot `vp-lock` (lock1–3) · Glass Pad · **cut**

- **Actions:** chords; lock1: the cutoff's lock dot, then the chorus's ▢.
  lock2: ⚡ *evolve from this*. The beat cuts at lock3 to the moment the child
  is on the bench (`clips: [["lock3", "@benched-0.6"]]`); chords again on the
  child.

## 9. `keep` — shot `vp-keep` (keep1–4) · Glass Pad (edited in set-up)

- **Actions:** chords, then COMMIT: the duel (*which one is better?*, sides
  shuffled). ▶ *the original*, then ▶ *your edit*, each heard (keep2 has a 5 s
  pause after it). keep3: *this one* under your edit. keep4: resonance
  nudged, *my edit is better* ticked, COMMIT: committed as a claim, no duel.

## 10. `take` — shot `vp-take` (take1–3) · Glass Pad → its ⚡ child

- **Set-up:** an edit committed through the heard duel, the chorus locked, ⚡
  run to its child (so the lineage has both kinds of entry).
- **Actions:** ⋯ → *Export this patch* (a `.auracle.json`); ⋯ → *Export as
  image…*, SVG, export (its note: the patch rides inside). take2: the panel
  closed; `fixtures/First_Bass.svg` (a real picture export) dropped on the
  window: First Bass opens; a bass figure on the beat. take3: EVOLVE, the
  lineage.

## 11. `together` — shot `vp-together` (together1–4) · Acid Line

- **Actions:** Am7 latched on the downbeat (arp up, 1/16, 84). together2: the
  cutoff opened, the resonance nudged. together3: `/`, "grit" typed,
  `distortion` armed and placed after the filter. together4: the filter's ▢,
  *my edit is better*, COMMIT. HOLD off on the last bar line.

## 12. `outro` — cards.js (outro1–2)

The five verbs as pills, each lit as it is said; then *next* · **EVOLVE** ·
*breeding sounds you like*, the guide pill (Views › PATCH), the lockup. Bed in.
