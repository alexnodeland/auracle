# Composing with it — storyboard

A walkthrough over the real instrument, one recorded shot per beat
(`shots.json` → `tools/footage.mjs`, framed by `stage/walk.js`), eleven beats,
316 words at speed 0.9. The story is one piece being written: a bass, a pad
and a moving texture, found, kept, put on the tempo, recorded and carried away.

**The palette used throughout,** cast from the films' shortlist
(`shotgen.CAST`): a bass (**Held Under**, with a Steps lane added in beat
5), a pad (**Slow Weather**) and a moving texture (**Rotor**); **Ceiling**
plays the arpeggio, and **Loom** (the one preset with a step sequencer)
the MIDI clock. Set the app's tempo to the
bed's **84 BPM** in every shot that uses tempo, so the arpeggiator and the
sequencers sit in time with the score:
`eval: const b=document.getElementById('bpm'); b.value='84'; b.dispatchEvent(new Event('change'))`.

**Set-ups.**

- **plain** — the film's common set-up, `click #warm-skip`.
- **taught** — `own_setup: true`: `until #warmstart:not(.hidden)` (180 s),
  the deal checked for a card on the films' shortlist (`shotgen.CAST_DEALT`),
  then `pick("cast")`, `pick("pad")`, `pick("texture")`, `click #warm-go`,
  `wait 3000`, `view evolve`, six votes (`key ArrowLeft`/`ArrowRight`
  alternating, `wait 1500` between), `wait 4000`.

**Selectors.** Bank tabs `.bf[data-f='pool'|'mine'|'preset']`; the row on the
bench `.bank-item.live` with `.bi-save`, `.star[data-s='1'…'5']`, `.bi-name`;
EVOLVE `#evolve-btn`, `#choose-a`, `#choose-b`, `#lineage-log`, `#duel-mid`;
warm start `#warmstart`, `.warm-item`, `.wi-play`, `#warm-go`; node bank
`.nb-item[data-kind='steps']`; rack jacks `#rack-svg .jack[data-modkey='…']`,
step bars `#rack-svg [data-addr='<slot>#s0'…'#s7']`; dock `#hold-btn`,
`#arp-btn`, `#arp-div`, `#sync-btn`, `#bpm`, `#rec-btn`, `#midi-ind`,
`#midi-panel`; ⋯ menu `#ovf-btn`, `#patch-export-btn`, `#image-btn`,
`#image-panel`, `#ix-fmt`, `#ix-go`, `#export-btn`; `#drop-veil`; PERFORM
pads as in the playing film.

**⚑** marks a feature the app or the tools lack; the list is at the end.

---

## 1. `intro` — shot `co-intro` (intro1–2)

- **Set-up:** plain · `view play`.
- **Actions:** `intro1:bass` → `preset Held Under`, then `hold ["a"]` 1200 ms;
  `intro1:pad` → `preset Slow Weather`, hold C (`a d g`) 1400 ms;
  `intro1:texture` → `preset Rotor`, hold `["a", "g"]` `ms: "end"`.
- **Camera:** 1.0, the rack; each preset change re-fits the rack.
- **Chapter:** `01 · a palette`.
- **Callouts:** on each preset word, the subject name `#rack-subject`.

## 2. `direction` — shot `co-direction` (direction1–3)

- **Set-up:** `own_setup: true`; `until #warmstart:not(.hidden)` (180 s); the
  deal checked for a card on the shortlist (`CAST_DEALT`, logged). The
  warm-start card is on screen when recording starts.
- **Marks:** `grid: #warm-grid`, `go: #warm-go`, `mid: #duel-mid`.
- **Actions:** `direction1:shows` → ▶ on the card on the shortlist (Ceiling,
  in this deal: it is heard); `direction2:Pick` → that card, then the first
  pad and texture card not yet picked, 0.25 s apart (the button changes to
  *teach it*); `direction2:eighteen` →
  `click #warm-go`; `direction3:duels` → `view evolve`; `direction3:gut` →
  `key ArrowRight`.
- **Camera:** 1.15 on the card; 1.0 after `direction3:duels`.
- **Callouts:** `direction1:nine` on `grid` "one per family, then filled";
  `direction2:eighteen` on `go` "3 picks × 6 passed = 18"; `direction3:data`
  on `mid` (amber) "the forecast, then your pick".

## 3. `evolve` — shot `co-evolve` (evolve1–3)

- **Set-up:** taught · `view evolve` · `click #evolve-btn` ·
  `until #evolve-btn:not([disabled])` (600 s) · `wait 1500`. One generation
  has run off camera: a walk from each of the ten best, forty steps each, takes
  tens of seconds and cannot finish inside a beat.
- **Marks:** `btn: #evolve-btn`, `lineage: #lineage-log`, `lamp: #wm-lamp`,
  `bank: #bank-list`.
- **Actions:** `evolve1:Press` → `click #evolve-btn` (a second generation
  starts; the wordmark's E lights). Nothing else is claimed about it.
- **Camera:** on the button at `evolve1:Press`; the lineage strip at
  `evolve2:children` (it shows the first generation's lines,
  `gen 1 ⚡ evolution on #… → #… · … · Δtaste …`); the bank rail at
  `evolve3:saved`.
- **Callouts:** `evolve1:ten` on `btn`; `evolve2:resemble` on `lineage`
  (amber) "what each child changed"; `evolve3:weakest` on `bank` "the lowest
  guesses are replaced".

## 4. `keep` — shot `co-keep` (keep1–3)

- **Set-up:** taught · `view play` · `click .bf[data-f='pool']` ·
  `click .bank-item >> nth=0` (the model's top patch goes on the bench and its
  row becomes `.bank-item.live`).
- **Actions:** `at 0.2` hold Am (`h k ;`) `ms: "end"`. `keep1:save` →
  `click .bank-item.live .bi-save`; `keep1:save+0.8` → `mark toast #toasts .toast`
  (*Saved … — it won't be replaced. 1/10 slots used.*); `keep1:Patches` →
  `click .bf[data-f='mine']`. `keep3:Stars` →
  `click .bank-item.live .star[data-s='4']`. `keep3:name` → ⚑1 rename:
  double-click `.bank-item.live .bi-name`, type *night pad*, Enter.
- **Camera:** 1.35 on the bank rail throughout.
- **Callouts:** `keep2:never` on `toast` "saved: never replaced · pins are
  capped at a quarter of the pool"; `keep3:teach` on the stars (amber)
  "a rating teaches; a save does not".

## 5. `steps` — shot `co-steps` (steps1–4; music `loop_b`)

- **Set-up:** plain · `preset Held Under` · `view play` · tempo 84 (eval).
  Its low-pass filter (`node/0`) has an empty modulation slot, so the
  placement is a plain fill.
- **Marks:** `steps: .nb-item[data-kind='steps']`,
  `slot: #rack-svg .jack[data-modkey='node/0/m']`, `sync: #sync-btn`,
  `bpm: #bpm`.
- **Actions:** `at 0.2` hold `["a"]` until 0.3 s before `steps4:restarts`
  (compute `ms` from the timeline). `steps1:Steps` →
  `click .nb-item[data-kind='steps']` (mod sockets light); `steps1:filter` →
  `click #rack-svg .jack[data-modkey='node/0/m']` (placed; one undo step).
  `steps2:draw` → drag four bars: `[data-addr='node/0/m#s0']` `dy −30`,
  `#s1` `dy +25`, `#s2` `dy −40`, `#s3` `dy +10`, 300 ms each, 0.35 s apart.
  `steps3:Sync` → `click #sync-btn` (the tempo drawer opens beside it).
  `steps4:restarts` → press it again: `hold ["a"]` `ms: "end"` (with sync
  on, the pattern restarts from step one on the key).
- **Camera:** 1.5 on the new steps plate once placed; 1.3 with the dock at
  `steps3:Sync`.
- **Callouts:** `steps2:eight` on the lane "up to eight; length picks how
  many play"; `steps3:division` on `bpm` "84"; `steps4:first` on the lane.
- **Note:** sync snaps the free rate to the nearest division of the tempo in
  octaves (straight, triplet or dotted); the model still auditions every patch
  free-running. Do not show the step pattern as part of what the model hears.

## 6. `arp` — shot `co-arp` (arp1–2)

- **Set-up:** plain · `preset Ceiling` · `view play` · tempo 84 (eval) ·
  `click #arp-btn` · eval `#arp-div` to `4` (1/16) and dispatch `change`.
- **Marks:** `arp: #arp-btn`, `drawer: #arp-ctl`, `hold: #hold-btn`,
  `cut: #rack-svg [data-addr='node#cut']`.
- **Actions:** `arp2:Latch` → `click #hold-btn`; hold `["a", "g", "k"]`
  300 ms, timed to land on a beat of the bed (`at` = the shot's `pre` plus a
  whole number of beats, 0.714 s each). `arp2:shape` → drag the ladder's
  cutoff `dy −45` over 2400 ms while the line runs.
- **Camera:** 1.4 on the dock and the drawer; ease to the filter plate at
  `arp2:shape`.
- **Callouts:** `arp1:tempo` on the drawer "84 bpm"; `arp2:Hold` on `hold`
  "latched".

## 7. `clock` — shot `co-clock` (clock1–2) ⚑2

- **Set-up:** plain · `preset Loom` · `view play` · `click #sync-btn` ·
  `click #arp-btn` · `click #hold-btn` · `click #midi-ind`.
- **Needs ⚑2.** Feed 24 clock ticks per beat at 96 BPM from `clock1:Send`:
  the panel footer changes from *no clock* to *clock 96.0 bpm* and `#bpm`
  follows. At `clock2:start` feed Start (`0xFA`) with a chord held: the step
  lane and the arpeggio restart together on the next block.
- **Without ⚑2:** record this beat by hand with a DAW sending clock into
  Chromium, or leave it illustrated (a drawn clock pulse train into the dock).
- **Callouts:** `clock1:tempo` on the panel footer; `clock2:downbeat` on the
  steps lane.

## 8. `scenes` — shot `co-scenes` (scenes1–3)

- **Set-up:** taught · for each of **Held Under**, **Rotor**, **Slow Weather**:
  `preset <name>`, `click .bank-item.live .bi-save` (three saved patches) ·
  `click .bf[data-f='mine']` · `click .bank-item:has-text('Slow Weather')` ·
  `view perform` · `measured Slow Weather`.
- **Actions:** `at 0.2` hold C (`a d g`) `ms: "end"`. `scenes1:Keep` →
  click Keep; `scenes1:home` → drag Bright `dy −60` (700 ms);
  `scenes1:glides` → click Back. Then `eval document.activeElement.blur()`
  (a focused button swallows `]`), and `scenes2:step` → `key ]` (the next
  saved patch loads under the held chord); `scenes3:carry` → `key ]` again.
- **Camera:** 1.2 on the pads, then 1.0 with the bank rail in view for
  `scenes2`.
- **Callouts:** `scenes2:bracket` on the rail "] next · [ previous";
  `scenes3:click` on the deck "held notes carried, no new attack".
- **Honest limit:** Keep holds one home at a time; saved patches are the
  scenes. The narration says exactly that.

## 9. `record` — shot `co-record` (record1–2) ⚑3

- **Set-up:** plain · `preset Slow Weather` · `view play`.
- **Actions (once ⚑3 is fixed):** `record1:record` → `click #rec-btn` (it
  reads *◼ stop* and lights); `record1:play` → C–Am–F–G, one bar each;
  `record1:stop` → `click #rec-btn`; `record2:downloads` →
  `mark toast #toasts .toast` (*saved 6.8s take*).
- **Callouts:** `record1:record` on the button; `record2:output` on the toast
  "post-limiter · the session's sample rate".

## 10. `share` — shot `co-share` (share1–3)

- **Set-up:** plain · `preset Slow Weather` · `view play`.
- **Actions:** `share1:export` → `click #ovf-btn`, `move #patch-export-btn`
  (hover only, ⚑4); `share2:picture` → `click #image-btn` (the export panel
  opens), eval `#ix-fmt` to `svg` + `change`, `move #ix-go` (hover only);
  `share3:Drop` → the picture exported at share2, dropped back (footage.mjs
  `drop {download}`): the veil reads
  *drop a patch to open it · .auracle.json · .png · .svg*, then the toast
  *… is already in the bank — opening it* or *patch imported as …*.
- **Camera:** 1.3 on the menu and panel (top right); 1.0 for the veil.
- **Callouts:** `share2:inside` on the panel note *The patch rides inside the
  file. Drop the picture back onto auracle and it opens as a patch.*
  `share3:same` on the toast.

## 11. `outro` — shot `co-outro` (outro1)

- **Set-up:** taught, with the three saved patches of beat 8 ·
  `click .bf[data-f='mine']` · `view play`.
- **Actions:** hold a chord `ms: "end"`; `outro1:profile` → `click #ovf-btn`,
  `move #export-btn` (*Save taste profile*, hover only, ⚑4).
- **Camera:** 1.0; slow push to 1.04.

---

## ⚑ Gaps to close before recording

1. **Rename on camera.** A bank name is renamed by double-clicking it and
   typing; `footage.mjs` has neither a `dblclick` nor a `type` op. Stopgap:
   `eval` a `dblclick` `MouseEvent` on the name, then `key` presses per letter
   (the input stops note keys from playing) and `key Enter`.
2. **MIDI clock.** As in the playing film: `midi.feed` exists but is private
   to `main.js`; a `?film` hook (`window.__film.midi(bytes)`) is needed to
   script clock and Start.
3. **● rec on camera.** `footage.mjs` captures each shot's sound through the
   app's own recorder (`window.__film.rec`, the same buffer as ● rec). A click
   on `#rec-btn` mid-shot toggles that same recording off, so the button would
   appear to *stop* and the shot's audio would end there. The shot needs the
   footage capture on a separate tap (or a separate worklet buffer for
   `__film.rec`) before this beat can be recorded.
4. **Downloads mid-shot.** `footage.mjs` takes the shot's first `download`
   event as its audio. Pressing *Export this patch*, *export* in the image
   panel or *Save taste profile* on camera would hand it a JSON, PNG or SVG
   instead. Filter the download by suggested filename (`.wav`) before
   recording those presses; until then the storyboard only hovers them.
5. **Drag-and-drop a file.** Needs a fixture patch file (export one by hand
   once, e.g. Glass Pad's `.auracle.json` or its PNG) and either a `drop` op in
   `footage.mjs` or an `eval` that builds a `DataTransfer` with a `File` and
   dispatches `dragenter`, `dragover` and `drop` on `window` (`main.js`
   `dropInit` listens there).
