# Playing it — storyboard

A walkthrough over the real instrument: one recorded shot per beat
(`shots.json` → `tools/footage.mjs`), framed by `stage/walk.js` with a slow
camera, callouts pinned to measured marks, a chapter label and captions, as in
`films/perform`. Twelve beats, 362 words at speed 0.9.

**This film is about playing, so the footage carries the music.** Every shot
holds or plays notes from its first frame. Keep the app's own sound up in the
mix (as the perform film does); the study bed sits under it.

**Common set-up** (`shots.json` top level): viewport 1920×1080, dpr 1, query
`?film`. Two set-ups are used:

- **plain** — `click #warm-skip` (no taste model), for beats that need no
  model.
- **taught** — `own_setup: true` and, instead of skipping, the three-pick warm
  start: `until #warmstart:not(.hidden)` (180 s), `click .warm-item >> nth=0`,
  `nth=4`, `nth=7`, `click #warm-go`, `wait 4000`. Used where Wander and
  the offers must move *toward your taste* (Wander, offers).

Then each shot: `preset <name>`, `view perform`, `measured <name>`, then
re-checked, and holds. Every preset ships wired
(`apps/web/perform-wirings.json`), so `measured` comes at once with
*re-checking* on the status line while PERFORM measures it again under this
session's pool; the set-up waits that out (`RECHECKED` in `gen_shots.py`), so
a shot starts on the session's own wiring.

**Keys.** `a` = C4 (the default octave). Chords used below, in the computer
keymap: **C** `a d g` · **Am** `h k ;` · **F** `f h k` · **G** `g j l`.
A line: `a s d g h` (C D E G A).

**Selectors.** Named controls `.pf-knob[data-i='0'…'5']` (Bright, Snap,
Motion, Body, Grit, Space), Blend `.pf-knob[data-i='6']`, Wander
`.pf-knob[data-i='7']`; pads `.pf-pad:has-text('Keep'|'Back'|'Take'|'Peek'|'Freeze')`,
Offer `.pf-pad.primary`; B strip `.pf-offer` (`.pf-offer.ready` once an offer
is in); XY `.pf-xy-field`; touch row `.pf-touch`, its menu `#pf-touch-sel`,
depth `#pf-touch-depth`; hood `.pf-hood`; status `.pf-status`. Dock:
`#hold-btn`, `#uni-btn`, `#arp-btn`, `#sync-btn`, `#glide`, `#arp-ctl`,
`#arp-mode`, `#arp-div`, `#bpm`, `#oct-label`, `#piano`, `.pkey[data-note='60']`,
`#midi-ind`, `#midi-panel`. Named-control drags: 180 px of travel is the whole
range, so `dy −45` is half a turn up. Wander drags are relative to where it is:
0.15 / 0.40 / 0.75 are the ideas / drift / roam boundaries (three ticks on
Wander's ring). Wander's state is on the line under its dial
(`.pf-knob[data-i='7'] .pf-k-sub`: *ideas · one in B*, *drift · next in 9 s*,
*drift · walking…*, *drift · gliding*, *paused 3 s*, *held*); the status line
speaks only about the patch.

**Features the app or the tools lack** are marked **⚑** and collected at the
end.

---

## 1. `intro` — shot `pl-intro` (intro1)

- **Set-up:** plain · preset **Glass Pad** · view perform · measured.
- **Actions:** `at 0.3` hold C (`a d g`) 1400 ms; `intro1:chords` hold Am
  (`h k ;`) 1000 ms, then F (`f h k`) 1000 ms; `intro1:lines` the line
  `a s d g h`, 220 ms each; `intro1:swells` hold C `ms: "end"` and drag Bright
  `dy −70` over 2600 ms.
- **Camera:** 1.0 → 1.06 toward the deck on `intro1:swells`.
- **Chapter:** `01 · an instrument`.

## 2. `keys` — shot `pl-keys` (keys1–4)

- **Set-up:** plain · Glass Pad · view perform · measured.
- **Marks:** `keybed: #piano`, `oct: #oct-label`, `midi: #midi-ind`.
- **Actions:**
  - `keys1:rows` → the line `a s d f g` (230 ms each), then C (`a d g`) 700 ms.
  - `keys1:X` → `key x` (label reads `a = C5`), `hold a` 400 ms; `keys1:octaves`
    → `key z` (back to `a = C4`).
  - `keys2:Shift` → `hold ["a"]` 350 ms, then `hold ["Shift", "a"]` 350 ms
    (velocity 0.78, then 1.0).
  - `keys3:strike` → ⚑ two presses on `.pkey[data-note='64']`, one near the
    top of the key (soft, ≈0.4) and one near its front edge (hard, ≈1.0).
    `press` has no offset today; see ⚑1.
  - `keys4:MIDI` → `click #midi-ind`; `mark panel #midi-panel`.
- **Camera:** 1.0 → 1.45 on the keybed at `keys1:rows` (fx 0.5, fy 0.97);
  1.5 on the dock's right end at `keys4:MIDI`.
- **Callouts:** `keys1:octaves` on `oct` "z / x: octave"; `keys2:accent` on
  `keybed` "shift: an accent"; `keys4:velocity` on `panel` "velocity · bend ·
  sustain".
- **⚑2:** headless Chromium has no MIDI device, so the indicator reads
  `midi —` and the panel "no device — plug one in". Either record this beat by
  hand with a real keyboard, or add the film hook in ⚑2.

## 3. `touch` — shot `pl-touch` (touch1–2)

- **Set-up:** plain · Glass Pad · view perform · measured.
- **Marks:** `touch: .pf-touch`, `sel: #pf-touch-sel`, `hood: .pf-hood`.
- **Actions:** `touch1:touch` → `move` over `#pf-touch-sel` (it already reads
  "bright — soft dark, hard bright", the default); `touch2:soft` → ⚑1 a soft
  strike of C (`.pkey[data-note='60']` near its top), `touch2:hard` → a hard
  strike near its front edge. Without ⚑1: `hold a` 500 ms then
  `hold Shift a` 500 ms (0.78 then 1.0, both above the no-change point of
  0.6, so only "brighter" is shown).
- **Camera:** 1.35 on the touch row and the hood (the hood's filter cutoff
  bar moves per note).
- **Callouts:** `touch1:velocity` on `touch` "velocity → a named control";
  `touch2:brighter` on `hood` "per note, on its own voice".

## 4. `controls` — shot `pl-controls` (controls1–4)

- **Set-up:** plain · Glass Pad · view perform · measured.
- **Marks:** `deck: .pf-deck`, `bright: .pf-knob[data-i='0']`,
  `body: .pf-knob[data-i='3']`, `hood: .pf-hood`.
- **Actions:** `at 0.2` hold Am (`h k ;`) `ms: "end"` (a pad chord under the
  whole beat). `controls1:named` → quick `dy −30` nudges on Snap and Motion
  (500 ms each) and back (`dy +30`). `controls2:interrupts` → drag Space
  `dy −40` 900 ms. `controls3:ride` → drag Bright `dy −110` over 3200 ms
  (the swell). `controls4:press` → `press .pf-knob[data-i='3']` 700 ms (a
  still press of more than 550 ms: Body sweeps both ends and back over 2.4 s).
- **Camera:** 1.28 on the deck through `controls2`; 1.12 with the hood in view
  for `controls3`.
- **Callouts:** `controls1:same` on `deck` "the same six names on every
  patch"; `controls3:swell` on `hood` "the real knobs it turns";
  `controls4:long` on `body` "long press: hear it".

## 5. `xy` — shot `pl-xy` (xy1)

- **Set-up:** plain · Glass Pad · view perform · measured.
- **Actions:** `at 0.1` hold C `ms: "end"`; `xy1:XY` → `path .pf-xy-field`
  through `[0.5,0.5] [0.85,0.3] [0.8,0.8] [0.2,0.75] [0.3,0.2] [0.6,0.45]`
  over 3600 ms.
- **Camera:** 1.45 on the pad (fx 0.22, fy 0.86), as in `p-xy`.
- **Callouts:** `xy1:across` on the pad's right edge "Bright"; `xy1:up` on its
  top edge "Motion".

## 6. `wander` — shot `pl-wander` (wander1–4; music `loop_b`)

- **Set-up:** **taught** · Glass Pad · view perform · measured · re-checked ·
  `wait 9000` (a spare offer grows ahead).
- **Marks:** `wander: .pf-knob[data-i='7']`, `status: .pf-status`,
  `offer: .pf-offer`, `hood: .pf-hood`, `freeze: .pf-pad:has-text('Freeze')`.
- **Actions:** `at 0.2` hold F (`f h k`) `ms: "end"`. `wander1:Wander` → drag
  Wander `dy −30` (ideas): let go in a new zone, it asks 1.5 s later, and the
  spare lands in B at once (stamp `offered`; no cut). `wander2:More` →
  `dy −45` (drift): the first move is asked for 1.5 s after letting go, and
  the walk renders a step at a time (*drift · walking…*), so the beat cuts
  (`clips`) from `wander2:taste+0.2` to just before the glide (stamp `drift`,
  *drift · gliding*; no cut if it is already gliding). `wander3:way` →
  `dy −75` (roam). `wander4:waits` → a short nudge on the first control that
  reaches (hands on: a glide stops where it is and the line under Wander reads
  *paused 3 s*). `wander4:Freeze` → `click` Freeze (the dial reads *held*).
- **Camera:** 1.25 on Wander, then on the pads and the hood toward Freeze.
- **Callouts:** `wander1:Wander` on `wander` "Wander"; `wander2:ideas` on
  `offer` "B: ideas"; `wander2:taste+0.3` on `wander` "drift · gliding, toward
  your taste" (amber); `wander4:Freeze` on `freeze`.
- **Note:** do not fake a glide. If the walk finds nothing better
  (*staying — nothing better nearby*), the `drift` stamp waits for the next
  move; the rehearsal's logs say which.

## 7. `offer` — shot `pl-offer` (offer1–4)

- **Set-up:** **taught** · Glass Pad · view perform · measured · `wait 9000`
  (a spare offer grows in the background after about six steady seconds, so
  Offer hands it over at once, as in `p-offer`).
- **Marks:** `offer-pad: .pf-pad.primary`, `offer: .pf-offer`,
  `blend: .pf-knob[data-i='6']`, `peek: .pf-pad:has-text('Peek')`,
  `take: .pf-pad:has-text('Take')`.
- **Actions:** `at 0.2` hold C `ms: "end"`. `offer1:press` → click Offer.
  `offer3:Peek` → `press` Peek 1600 ms. `offer3:Blend` → drag Blend `dy −120`
  over 2000 ms (past half: this is what makes B *heard*). `offer4:Take` →
  click Take; `offer4:Take+1.0` → `mark toast #toasts .toast`.
- **Camera:** 1.22 on the pads and B strip; 1.18 on Blend at `offer3:Blend`.
- **Callouts:** `offer2:joins` on `offer` "B joins the chord you hold";
  `offer3:matched` on `blend` "matched loudness"; `offer4:teaches` on `toast`
  (amber) "a heard answer is a pick".

## 8. `keep` — shot `pl-keep` (keep1–2)

- **Set-up:** plain · Glass Pad · view perform · measured.
- **Actions:** `at 0.1` hold G (`g j l`) `ms: "end"`. `keep1:Keep` → click
  Keep. `keep1:home+0.2` → drag Body `dy −60` (700 ms), then Grit `dy −50`
  (700 ms): the sound wanders out. `keep2:glides` → click Back (a 1.2 s glide
  home; the hood's bars return to their home ticks).
- **Camera:** 1.2 on the pads (fx 0.3, fy 0.55); ease to the hood at
  `keep2:glides`.
- **Callouts:** `keep1:home` on Keep "home"; `keep2:glides` on Back "glides
  back".

## 9. `dock` — shot `pl-dock` (dock1–4)

- **Set-up:** plain · preset **Acid Line** · view perform · measured ·
  `eval` set the tempo to the bed's 84 BPM:
  `const b=document.getElementById('bpm'); b.value='84'; b.dispatchEvent(new Event('change'))`.
- **Marks:** `hold: #hold-btn`, `uni: #uni-btn`, `glide: #glide`,
  `arp: #arp-btn`, `sync: #sync-btn`, `drawer: #arp-ctl`.
- **Actions:**
  - `dock1:Hold` → click `#hold-btn`; hold Am (`h k ;`) 600 ms (latched: it
    keeps sounding after the keys lift).
  - `dock1:Unison` → click `#hold-btn` again (latch off, voices stop), click
    `#uni-btn` (label reads `uni ×4 mono`), `hold ["a"]` 900 ms.
  - `dock2:Glide` → `drag #glide dx +40`; play `a`, `g`, `k` legato, each held
    480 ms and started 400 ms after the last (three `hold` actions at
    `dock2:Glide+0.9`, `+1.3`, `+1.7`); then click `#uni-btn` off.
  - `dock3:arpeggiator` → click `#arp-btn` (the drawer opens); `eval` pattern
    up·down (`#arp-mode` value `2`, dispatch `change`); click `#hold-btn`;
    hold Am `h k ;` 300 ms at the next beat of the bed (the beat's `t0` is on
    the grid: `at` = this shot's `pre` + a whole number of beats).
  - `dock4:Sync` → click `#sync-btn` (the patch has no step sequencer; this is
    the button only — the composing film shows it working).
- **Camera:** the dock's left side, 1.6 (fx 0.12, fy 0.95); ease to the
  drawer at `dock3:arpeggiator`.
- **Callouts:** one per control on its word; `dock3:tempo` on `#bpm` "84".

## 10. `midi` — shot `pl-midi` (midi1–2)

- **Set-up:** plain · Glass Pad · view perform · measured.
- **Marks:** `ind: #midi-ind`, `panel: #midi-panel`.
- **Actions:** `at 0.2` hold C `ms: "end"`; `midi1:controller` → click
  `#midi-ind`, `mark panel`; `midi1:Learn` → click
  `#midi-panel .midi-row:has-text('Grit') button:has-text('learn')` (the row
  reads *move a knob…*).
- **⚑2 required for the rest of the beat:** feed, through a film hook,
  CC 74 moves (auto-map: *mapped: CC 74 → Bright*, and the Bright knob follows),
  a CC on the armed Grit row, channel pressure (Bright rises from its centre,
  and falls back on release), CC 1 (Motion), and 24 clock ticks per beat at
  96 BPM (the panel footer reads *clock 96.0 bpm*; `#bpm` follows).
- **Callouts:** `midi1:claim` on `panel` "the first eight claim the eight";
  `midi2:Pressure` on Bright; `midi2:wheel` on Motion; `midi2:clock` on the
  panel footer.

## 11. `booth` — shot `pl-booth` (booth1–2)

- **Set-up:** plain · `click #ovf-btn` · `click #booth-btn` (*Booth mode:
  on*) · `wait 64000` (a minute with nobody at the keys) ·
  `until #booth-attract:not(.hidden)` (the instrument is playing itself:
  Am–F–C–G, two controls under an invisible hand).
- **Actions:** none until `booth2:touch` → `hold a` 600 ms: attract stops on
  the spot, the band disappears, and the visitor holds the sound.
- **Camera:** 1.0, the whole instrument.
- **Callouts:** `booth1:itself` on the attract band "attract"; `booth2:hands`
  on the deck "any key, click or touch".
- **Note:** nothing attract does is logged or taught; say nothing that implies
  it is.

## 12. `outro` — shot `pl-outro` (outro1)

- **Set-up:** taught · Glass Pad · view perform · measured · `wait 9000`.
- **Actions:** a four-chord loop C–Am–F–G (each held one bar of the 84 BPM bed,
  2.86 s); `outro1:Nothing` → click Offer; `outro1:phrase` → drag Blend
  `dy −90`. No dialog appears at any point, which is the claim.
- **Camera:** 1.0, slow push to 1.04.

---

## ⚑ Gaps to close before recording

1. **`press` with an offset.** `footage.mjs`'s `press` always presses the
   element's centre. Velocity on the screen keys comes from where the key is
   struck (0.35 at the top, 1.0 at the front edge), so `keys3` and `touch2` need
   `ox`/`oy` on `press` (the `move` op already takes them). Pen pressure is
   also honoured, but there is no pen in Playwright.
2. **MIDI in footage.** `midi.js` exports `feed(data, timeStamp)` "for tests and
   scripted captures", but `main.js` keeps the `midi` object private and
   `onDevices` is only called by real Web MIDI access. A `?film` hook such as
   `window.__film.midi(bytes)` (calling `midi.feed`) plus a way to mark a
   device connected would let `keys4`, `midi1–2` be scripted; otherwise
   record them by hand with a controller.
