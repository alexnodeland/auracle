# PERFORM: playing the sound — storyboard

The PERFORM view in depth, for players. It is a walkthrough over the real
instrument: one recorded shot per chapter (`shots.json` → `tools/footage.mjs`),
framed by `stage/walk.js`, with a camera that settles before the words land,
callouts pinned to measured marks, and captions. Around the footage, the kit
draws three kinds of card: the title, one card at each chapter's turn, and the
outro. The film runs about five and a half minutes: eight chapters, then
*all of it at once*.

**The app is the music.** Every demo is heard from the instrument itself: the
capture taps the master bus. The `study` bed (84 BPM) plays only under the
title, the chapter turns and the outro. Every beat sets `bed_db`: 0 on those
beats and −60 on the demos. Demos play chords that change on the bar line and
lines at 84 BPM.

**Chapters and turns.** Each chapter is two beats:

- **The turn:** one bar (2.857 s), with no words and the bed at 0 dB. A kit
  card shows the chapter's number, its name and the musical question it
  answers, over the instrument dimmed behind a veil.
- **The demo:** the narration, with the bed out.

A turn borrows its demo's shot. The shot's `pre` covers the turn
(`pre = demo.t0 − turn.t0 + 0.5`), and the turn's plan entry sets
`meta: {pre: 0.5}` and `clips: []`. Both entries therefore put the shot's
start at the same film time, and the picture runs on unbroken. Nothing is
played during a turn, because `app_audio.py` places a shot's sound over its
own beat only. The title borrows the cold open's shot, and the outro borrows
the `together` shot, in the same way. `validate.mjs` checks all of it.

Only the demo beats carry lines. publish.py lists a film's chapters from its
`CHAPTER_NAMES` entry, so each chapter starts at its turn card (the names are
in the hand-back: the cold open, the title, the nine turns and the outro).

**The session.** Every shot is the same seeded session (`init`) as a
returning player's: the film's `init` also marks the first-run coach and
PERFORM's first steps as done. The tour film shows both. Two set-ups:

- **plain**: `#warm-skip`, a pool of at least 40, a MIDI keyboard plugged in
  through the `?film` port, then `preset` → `view perform` → `measured` → the
  wiring logged → no toast on screen.
- **taught**: the three-pick warm start (`nth=0, 4, 7`), then the fit, then as
  above. It adds `wait 9000`, so a spare offer has grown for Offer to hand
  over at once.

**The wiring this session measures** (logged by every shot):

- Plain, Glass Pad: Bright both ways (cutoff), Snap only toward bloom
  (*at the snap end*), Motion only toward restless (*at the still end*),
  Body only toward full (*at the thin end*), Space only toward far (*at the
  close end*). Grit is a search control. 5 of 6 reach.
- Plain, other patches:
  - Bell Jar: Bright turns the wavefolder's *fold*.
  - Loom: Bright both ways; Motion and Body up only.
  - Tine: Bright both ways; Snap down only.
- Taught, Glass Pad: as plain, but Body is a search control (4 of 6).

**Keys.** `a` = C4. The computer keymap's chords used below:

- Fmaj7 `f h k ;`, G/F `f g j l`, Em7 `d g j l`, Am7 `d g h k`;
- C `a d g`, Cmaj7 `a d g j`, G6 `g j l ;`.

**Selectors.**

- Named controls: `.pf-knob[data-i='0'…'5']` (Bright, Snap, Motion, Body,
  Grit, Space). Blend is `data-i='6'` and Wander is `data-i='7'`.
- Pads: `.pf-pad:has-text(…)`, with Offer as `.pf-pad.primary`.
- The PERFORM panel:
  - the B strip: `.pf-offer` (`.ready` once an offer is in);
  - the XY pad: `.pf-xy-field`, with its axis selects in `.pf-xy-head select`;
  - the touch row: `.pf-touch` (`#pf-touch-sel`);
  - the hood: `.pf-hood`;
  - the status line: `.pf-status`.
- The dock: `#hold-btn #uni-btn #arp-btn #sync-btn #glide #rec-btn
  #arp-ctl #arp-mode #arp-div #bpm #midi-ind #midi-panel`.

A named-control drag of 180 px is the whole range: `dy −45` is a quarter
turn up. A Wander drag is relative to where the dial is: 0.15, 0.40 and 0.75
are the offer, drift and roam boundaries.

---

## 0. `open` — the cold open (shot `vp-open`, 4 bars, no words)

- **Set-up:** plain · Glass Pad.
- **Actions:**
  - one chord a bar from the film's first frame: Fmaj7, G/F, Em7, Am7 (the
    bed's own changes, F Lydian);
  - from the second bar, an XY gesture that brings in Bright and Motion:
    centre → (0.72, 0.32) → (0.9, 0.12) → (0.68, 0.26), over three bars.
    Motion only turns toward restless on this patch, so the gesture stays in
    the pad's upper half.
- **Camera:** wide on the first chord, then a slow push over the deck, the
  pad and the hood (1.08, then 1.2).
- **Music:** none. The app is the music.

## 1. `title` — over `vp-open` (title1–2; the bed comes in)

- **Card:** the eyebrow *Auracle · the four views, in depth*; **PERFORM**;
  *playing the sound*. Below them, the eight controls drawn in the kit: the
  six named ones in green, then Blend and Wander in amber. They turn slowly,
  leaning with the bed.
- The footage is the cold open's shot running on, silent and veiled.
- *PERFORM is where you play the sound. Its controls are named for what you
  hear, and nothing in it ever stops the music.*

## 2. `play` — **01 · Play it** · *How do you play it?* (shot `vp-play`, Tine)

- **Actions:**
  - on the words: a white-key run (A to L) and a black-key run (W to P);
  - `z` to C3 and a chord, then `x` back and the chord again;
  - `a`, then Shift+`a` (the accent);
  - E4 on the screen, struck near its top (soft) and at its front edge
    (hard);
  - MIDI G4 at velocity 34 and 122, then a C5 bent up and back;
  - with the pointer resting on the touch row, a MIDI C chord at velocity 28
    (darker), then at 124 (brighter).
- **Camera:** on the keybed (1.45), then the octave end of the dock, the MIDI
  indicator, and the touch row with the scope.
- **Callouts:** *A to L: white keys* · *W to P: black keys* · *z / x: the
  octave* · *shift: an accent* · *near the top: soft* · *the front edge:
  hard* · *a MIDI keyboard* · *touch: velocity → Bright*.

## 3. `named` — **02 · Named for what you hear** · *How do you make it brighter while you play?* (shot `vp-named`)

- **Set-up:** plain · Glass Pad, with Fmaj7 held until `named5`.
- **Actions:**
  - the camera pans along the deck as the six names are said;
  - Bright is ridden up (the swell), then down with the hood in frame;
  - a long press on Bright sweeps it low, high and back, under the chord.
- **Bell Jar:** on "wiring" it is opened from the bank. A preset not yet in
  the bank loads and stays in PERFORM; one already in the bank would switch
  to PATCH. The status reads *measuring how this patch moves…*, and the bell
  is played in quarter notes while it measures (the measurement renders
  offline; the keys still play). The beat cuts (`clips`) at `named7`
  ("Then it wires…") to 0.6 s before the wiring lands. Bell Jar's Bright is
  its wavefolder's threshold (lower folds more), ridden up under a struck
  figure of eighth notes.
- **Callouts:** *Bright: ridden up* · *the patch's own knobs* · *long press:
  hear it* · *PERFORM listens* (amber, on the status) · *Bright → wavefolder threshold* ·
  *different knobs, same name*.

## 4. `honest` — **03 · Honest controls** · *What if this patch can't do that?* (shot `vp-honest`)

- **Set-up:** plain · Glass Pad.
- **Actions:**
  - a short chord, then Space turned up (toward far), then a short chord
    again, so the longer tail is heard;
  - under a held Am7, Grit (amber, dashed) is turned up. It springs back,
    and a variant grows in B, marked *(grit up)*. If it grows slowly, the
    beat cuts to it (`clips`);
  - Peek plays B alone.
- **Callouts:** *at the close end: only toward far* · *amber, dashed: out of
  reach* (amber) · *B: grown because you asked* (amber) · *Peek: hear it
  first*.
- The film says what the sound does ("Space can only take it toward far").
  Off camera, the set-up drags Space the closed way and logs where the dial
  and the sound end up, then double-clicks it back to the centre. The guide
  says the control will not go past the centre; the drag code clamps only
  the sound.

## 5. `xy` — **04 · The XY pad** · *How do you move two things at once?* (shot `vp-xy`)

- **Actions:**
  - the Y axis is set to Grit: its end words dim to amber, and the pad says
    *Grit doesn't reach this patch*;
  - it goes back to Motion;
  - under a held Am7, a gesture of about 3.6 s;
  - a double-click takes the dot and the dials home.
- **Callouts:** *choose the axes* · *an amber axis says so* (amber) ·
  *Bright → · Motion ↑* · *the dials follow* · *double-click: home*.

## 6. `offer` — **05 · Offers** · *How do you try something new without stopping?* (shot `vp-offer`, taught)

- **Actions:** Fmaj7 is held throughout (struck again just after the cut,
  since a hold cannot run across a cut that waits on a stamp), then:
  - Offer: the spare lands in B at once;
  - Peek is held for 1.6 s, then Blend is ridden past half (B is heard);
  - Offer again is the pass (its toast), and a new variant grows. The beat
    cuts (`clips`) to just before it lands;
  - it is heard at the same Blend, then taken (its toast, with *don't count
    it*).
- **Callouts:** *B: a variant of this sound* (amber) · *held: B alone* ·
  *Blend, at matched loudness* · *a pass is a pick for A* (amber) · *a take is
  a pick for B* (amber).

## 7. `wander` — **06 · Wander, Keep and Back** · *Can it play along, and bring you home?* (shot `vp-wander`, taught)

- **Actions:** Fmaj7 is held throughout (struck again just after each cut),
  then:
  - Keep;
  - Wander into the offer zone, and the idea lands in B (the beat cuts to it
    if it is slow);
  - Wander into drift. The beat cuts (`clips`) to just before the first
    glide, whose status reads *drifting toward your taste*, and the hood's
    bars move;
  - Wander to roam;
  - a touch on Bright (it waits), then Freeze (*held*);
  - Back glides home, and the bars return to their home ticks.
- **Camera:** one framing (1.3) that holds the status line, the deck, the
  pads, B and the hood.
- **Callouts:** *Keep: this is home* · *Wander* · *an idea, in B* ·
  *drifting toward your taste* · *roam* · *new modules arrive only in B* ·
  *Freeze: held* · *back to the ticks: home*.

## 8. `dock` — **07 · The dock** · *How do you hold, stack and arpeggiate it?* (shot `vp-dock`, Loom at 84)

Loom is the one preset with a step sequencer. Its filter walks a five-step
pattern, so Sync is heard.

- **Actions:**
  - HOLD, and Cmaj7 latches;
  - HOLD off, UNI, and a C4 held (four voices on one note);
  - glide at about 200 ms, and a legato line of C, G and C;
  - UNI off, and a clean C chord;
  - HOLD, ARP (up·dn), SYNC, then Cmaj7 on the beat: the arpeggio and
    Loom's steps start together;
  - ● rec, a bar, ● rec again. The *saved … take* toast follows the
    *recording…* one about 4 s later, since toasts show one at a time, so
    dock6 holds a long pause;
  - HOLD off.
- **Callouts:** *hold: latched* · *unison: four voices, one note* · *glide* ·
  *up · down, at 84* · *sync: Loom's steps on the beat* · *● rec* · *a WAV of
  what you played*.

## 9. `midi` — **08 · MIDI** · *What does a controller do here?* (shot `vp-midi`)

- **Actions:** C is held throughout, then:
  - the MIDI panel opens;
  - CC 74, 71 and 73 claim Bright, Snap and Motion;
  - Learn on Space, then CC 20;
  - channel pressure, then the mod wheel;
  - the sustain pedal holds three released notes;
  - clock at 84;
  - another Auracle tab claims MIDI: its claim arrives over the app's own
    `auracle-midi` BroadcastChannel, from an `eval`. The dock reads
    `midi ○`, and the panel says why.
- **Camera:** one framing (1.2) that holds the MIDI panel, the dock's
  indicator, and the Bright and Motion dials.
- **Callouts:** *the first eight claim the eight* · *learn: CC 20 → Space*
  (on the panel's Space row) · *pressure → Bright* · *mod wheel → Motion* ·
  *the tempo follows the clock* · *midi ○: another tab has it*.
- The learn callout points at the panel row, not the toast. Toasts show one
  at a time, so the learn toast waits behind the three *mapped* toasts.

## 10. `together` — **all of it at once** · *Putting it together.* (shot `vp-together`, taught, Acid Line at 84)

- **Actions:** HOLD and ARP (up·dn, 1/16) are set off camera. Then:
  - C on the beat's first downbeat, as the card clears: the arpeggio;
  - Wander into drift;
  - Offer: the spare lands at once;
  - Blend past half;
  - Take on the next bar line.
  - The latch stays on, so the arpeggio plays the taken sound to the end of
    the beat. There the app's sound fades over 0.25 s while the bed ramps in
    over 0.4 s (mix.py), so the outro's downbeat is a hand-over, not a gap.
- **Camera:** wide (the dock's HOLD and ARP are lit), then 1.2 on Wander,
  Blend, B and the pads, then 1.2 on Take with room for its toast.
- **Callouts:** *Wander: drift* · *B: an offer, on the arpeggio* (amber) ·
  *Take, on the downbeat*.

## 11. `outro` — over `vp-together` (outro1–2; the bed returns)

- The shot runs on silently and clicks the PATCH tab on "PATCH", so the offer
  just taken is the sound opened in PATCH.
- **Card:** *play it · turn it · let it offer* lights as it is said. Then
  *next, in depth*, **PATCH**, *inside the sound*, and a pill for the guide
  page (docs / views / perform). The Auracle lockup signs off.
