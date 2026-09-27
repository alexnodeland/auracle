# Sound design with it — storyboard

A walkthrough over the real instrument, one recorded shot per beat
(`shots.json` → `tools/footage.mjs`, framed by `stage/walk.js`), eleven beats,
358 words at speed 0.9. One patch is taken apart and rebuilt on camera:
**Glass Pad** (a chorus at `node`, an SVF low pass at `node/0` with an LFO on
its cutoff at `node/0/m`, and a supersaw at `node/0/0`), plus **Ask The Dice**
for the modulation chain.

**Set-up for every shot: taught.** The belief row, the spec card's belief line
and *⚡ evolve from this* all need a fitted model. `own_setup: true`:
`until #warmstart:not(.hidden)` (180 s), `click .warm-item >> nth=0`, `nth=4`,
`nth=7`, `click #warm-go`, `wait 3000`, then `preset <name>`, `view play`,
`until #belief .bl-u` (60 s: the model's guess for the bench patch is shown).

**Selectors.** Knobs by trace address: `#rack-svg [data-addr='node/0#cut']`
(cutoff, Hz), `[data-addr='node/0#res']` (resonance), `[data-addr='amp#release']`
(ms), `[data-addr='amp#sustain']` (dB); a knob's lock `… .lock-dot`; a module
`#rack-svg g.mod-group[data-key='node']` (the chorus) with its `.mod-lock` (▢)
and `.mod-menu-btn` (⋯); the menu `#ctx-menu .cm-item:has-text('bypass')`;
jacks `#rack-svg .jack[data-childkey='…']` (audio) and `.jack[data-modkey='…']`
(modulation), lit ones `.jack.legal`, amber ones `.jack.legal.replaces`; the
node bank `.nb-item[data-kind='delay'|'formant'|'chorus'|'slew']`, the armed
status line `#nb-status`, the strip `#spec-dock` with `.sp-blurb`,
`.sp-params`, `.sd-model` (the belief line), `.sp-heard`, and its ▶ `#pv-play`;
toolbar `#lock-knobs`, `#lock-structure`, `#rack-evolve`, `#rack-commit`,
`#improve-check`; the belief row `#belief`; the commit duel `#cduel`,
`#cd-play-a`, `#cd-play-b`, `.cduel-cell:has-text('your edit') .cd-pick`;
HELD `#tray`, `#tray-items .tray-item`; EVOLVE `#lineage-log`.

The hover-revealed controls (lock dots) are reached the way `c-edit` does it:
`move` onto the knob first, then `click` the dot.

**⚑** marks a feature the app or the tools lack; the list is at the end.

---

## 1. `intro` — shot `sd-intro` (intro1)

- **Set-up:** taught · Glass Pad · view play.
- **Actions:** `at 0.3` hold C (`a d g`) `ms: "end"`.
- **Camera:** 1.0 → 1.06 on the rack. **Chapter:** `01 · from a preset`.

## 2. `open` — shot `sd-open` (open1–3)

- **Marks:** `hz: [data-addr='node/0#cut']`, `ms: [data-addr='amp#release']`,
  `db: [data-addr='amp#sustain']`, `belief: #belief`.
- **Actions:** `at 0.2` hold C `ms: "end"`; `open1:edit` → drag the cutoff
  `dy −60` over 1500 ms (the sound opens under the chord; the readout changes
  in Hz).
- **Camera:** 1.4 on the filter plate for `open1–2`; 1.2 with the belief row
  for `open3`.
- **Callouts:** `open2:hertz` on `hz`; `open2:milliseconds` on `ms`;
  `open2:decibels` on `db`; `open3:guess` on `belief` (amber): it reads
  *model's guess 0.xx (was 0.yy) ▲/▼ · feature ±… · … in your … style*,
  recomputed from the edited bench.

## 3. `lock` — shot `sd-lock` (lock1–2)

- **Marks:** `dot: [data-addr='node/0#cut'] .lock-dot`,
  `square: g.mod-group[data-key='node'] .mod-lock`, `knobs: #lock-knobs`,
  `wiring: #lock-structure`.
- **Actions:** `at 0.2` hold Am (`h k ;`) `ms: "end"`. `lock1:dot-0.6` →
  `move` onto the cutoff; `lock1:dot` → `click` its `.lock-dot` (a halo);
  `lock1:square` → `click` the chorus's `.mod-lock` (▢ → ▣: every address in
  the module). `lock2:knob` → `move #lock-knobs`; `lock2:wiring` →
  `move #lock-structure` (hover only; pressing them would lock everything).
- **Callouts:** `lock1:dot` on `dot` "one knob"; `lock1:square` on `square`
  "the whole module"; `lock2:press` on `knobs` "every knob · all the wiring".

## 4. `evolve` — shot `sd-evolve` (evolve1–2)

- **Set-up:** taught · Glass Pad · view play · lock the cutoff and the chorus
  as in beat 3 · `click #rack-evolve` ·
  `until #toasts .toast:has-text('now on the bench')` (300 s). The walk (40
  steps from this one seed, every locked address held) takes tens of seconds,
  so it runs off camera; recording starts the moment the child is benched.
- **Marks:** `evolve: #rack-evolve`, `subject: #rack-subject`,
  `meta: #rack-meta`, `toast: #toasts .toast`.
- **Actions:** `at 0.1` hold C `ms: "end"` (the child, heard);
  `evolve1:Evolve-0.4` → `move #rack-evolve`.
- **Camera:** 1.4 on the ⚡ button for `evolve1`; 1.2 on the subject block and
  the rack for `evolve2`.
- **Callouts:** `evolve1:Evolve` on `evolve` "⚡ evolve from this";
  `evolve2:unlocked` on the chorus plate "locked: unchanged";
  `evolve2:bench` on `subject` (amber) "one child, on the bench".
- **⚑1:** the press itself is not on camera. A jump cut inside a beat
  (`walk.js` places one continuous clip per beat) would let the press and the
  arrival share one shot.

## 5. `bank` — shot `sd-bank` (bank1–4)

- **Marks:** `delay: .nb-item[data-kind='delay']`,
  `formant: .nb-item[data-kind='formant']`, `lit: #rack-svg .jack.legal`,
  `status: #nb-status`, `play: #pv-play`, `dock: #spec-dock`.
- **Actions:** `at 0.2` hold C `ms: "end"`. `bank1:click` →
  `click .nb-item[data-kind='delay']` (armed; the sockets light).
  `bank2:lights+0.3` → `mark lit`. `bank3:Green` →
  `move #rack-svg .jack[data-childkey='node/0']` (the status line reads
  *insert delay after filter*). `bank3:Amber` → `key Escape`,
  `click .nb-item[data-kind='formant']`,
  `move #rack-svg .jack[data-childkey='node/0/0']` (amber: *replaces
  supersaw*). `bank4:Rest` → stay there (after 0.6 s a two-second render of
  this patch with the formant spliced in is made; nothing is placed).
  `bank4:play` → `click #pv-play` (heard). `bank4:place` → `key Escape` (put
  down; the bench is untouched).
- **Camera:** 1.2 across rack and rail; 1.35 on the filter and supersaw
  plates for `bank3`; 1.3 on the strip for `bank4:play`.
- **Callouts:** `bank2:hand` on the armed chip "in your hand"; `bank3:Green`
  on the green socket; `bank3:Amber` on the amber one (amber);
  `bank4:play` on `play` "a preview, not a placement".

## 6. `spec` — shot `sd-spec` (spec1–4)

- **Marks:** `chorus: .nb-item[data-kind='chorus']`,
  `blurb: #spec-dock .sp-blurb`, `params: #spec-dock .sp-params`,
  `model: #spec-dock .sd-model`, `heard: #spec-dock .sp-heard`.
  (Measure them with `mark` actions after the hover, since the strip only
  fills then; if the card renders in the floating `#nb-spec` instead, point
  the marks there.)
- **Actions:** `at 0.2` hold C `ms: "end"`; `spec1:card` → `move` onto the
  chorus entry and stay; `spec1:card+0.6` → `mark` the four parts.
- **Camera:** 1.5 on the strip.
- **Callouts:** `spec1:does` on `blurb` *A copy of the signal drifting in and
  out of tune with itself…*; `spec1:arrives` on `params`; `spec2:believes`
  on `model` (amber): one of *not measured · not fitted · too few examples ·
  the belief with its interval*; `spec3:cannot` on `heard` *as comb
  filtering, not as width — the pipeline sums L and R…*.

## 7. `chains` — shot `sd-chains` (chains1–4; music `loop_b`)

- **Set-up:** taught · `preset Ask The Dice` · view play.
- **Marks:** `rand: #rack-svg g.mod-group[data-kind='rand']`,
  `quantize: g.mod-group[data-kind='quantize']`,
  `slew: g.mod-group[data-kind='slew']`,
  `slot: #rack-svg .jack[data-modkey='node/m']` (the filter's slot, holding a
  mod env).
- **Actions:** `at 0.2` hold `["a"]` `ms: "end"`: one held key plays the
  melody (a new random value on each sample-and-hold tick, snapped to A minor,
  slurred by the slew).
  `chains4:Drop` → `click .nb-item[data-kind='slew']`; `chains4:modulated` →
  `move` onto `slot` (the socket stays green: *filter → cutoff — put slew after
  the mod env*); `chains4:wraps` → `click` it (placed; the chain now reads
  mod env → slew → cutoff).
- **Camera:** 1.5 on the amber chain for `chains2–3`; 1.25 on the filter
  plate for `chains4`.
- **Callouts:** `chains2:sample` on `rand`; `chains2:quantizer` on `quantize`
  "root A · minor"; `chains2:slew` on `slew`; `chains4:wraps` on the filter
  plate "wrapped, not replaced".
- **Note:** the quantizer lands on whole semitones here because this preset
  runs the oscillator's pitch slot at full depth; say nothing about scales on
  other depths.

## 8. `commit` — shot `sd-commit` (commit1–4)

- **Set-up:** taught · Glass Pad · view play · drag the cutoff `dy −50` ·
  `wait 2500` (the edit settles; `#rack-commit` enables).
- **Actions:** `at 0.2` hold C 2000 ms. `commit1:Commit` →
  `click #rack-commit` (the duel opens: *WHICH ONE IS BETTER?*, sides in random
  order). `commit1:original` → `click #cd-play-a`; `commit1:edit` →
  `click #cd-play-b`. `commit2:Either` →
  `click .cduel-cell:has-text('your edit') .cd-pick` (toast: *taught: you heard
  both and your edit won.*). `commit3:tick` → drag the resonance
  `dy −40`, then `click #improve-check`. `commit4:claim` →
  `click #rack-commit` (committed at once, no duel).
- **Camera:** 1.0 for the duel card; 1.4 on the toolbar's teach group for
  `commit3–4`.
- **Callouts:** `commit1:random` on the card "sides shuffled";
  `commit4:claim` on `#improve-check` (amber) "filed as a claim · scored
  apart in TRUST".

## 9. `undo` — shot `sd-undo` (undo1–2)

- **Marks:** `res: [data-addr='node/0#res']`,
  `menu: g.mod-group[data-key='node'] .mod-menu-btn`, `tray: #tray`.
- **Actions:** `at 0.2` hold C `ms: "end"`. `undo1:change` → drag the
  resonance `dy −60` (600 ms); `undo1:undo` → `hold ["Control", "z"]` 150 ms
  (it springs back). `undo2:bypass` → `click` the chorus's ⋯, then
  `click #ctx-menu .cm-item:has-text('bypass')` (the chorus leaves the chain
  and appears in HELD with its settings; the toast offers *switch it back
  in*).
- **Camera:** 1.4 on the filter plate for `undo1`; the tray under the rack for
  `undo2`.
- **Callouts:** `undo2:held` on `tray` "held, with its settings";
  `undo2:reload` on `tray` "kept across a reload" (not demonstrated: a reload
  would end the shot's recording).
- **⚑2:** dragging the held chorus back onto a lit ○ needs a drag to a target
  element; `footage.mjs`'s `drag` only moves by `dx`/`dy` from the source.

## 10. `lineage` — shot `sd-lineage` (lineage1–2)

- **Set-up:** taught · Glass Pad · view play · edit + commit through the heard
  duel (as in beat 8) · lock the chorus · `click #rack-evolve` ·
  `until #rack-evolve:not([disabled])` (300 s) · `view evolve`.
- **Marks:** `lineage: #lineage-log`.
- **Actions:** hold a chord `ms: "end"`.
- **Camera:** 1.5 on the lineage strip.
- **Callouts:** `lineage1:edits` on the `✎ your edit on #… → #…` line;
  `lineage1:steps` on the `⚡ evolution on #… → #…` line;
  `lineage2:estimate` on its `Δtaste` (amber). An *exploring* tag may appear
  on a child that landed below its parent; leave it on screen.

## 11. `outro` — shot `sd-outro` (outro1)

- **Set-up:** as beat 10, then `view play` (the evolved child is on the bench).
- **Actions:** C–Am–F–G, one bar each at the bed's tempo.
- **Camera:** 1.0, slow push to 1.05.

---

## ⚑ Gaps to close before recording

1. **A cut inside a beat.** `walk.js` plays one continuous clip per beat, so a
   press whose result arrives tens of seconds later (⚡ evolve from this, and
   EVOLVE POOL in the composing film) cannot show both. A plan option for a
   second clip window, or a clip rate, would.
2. **Drag to an element.** `footage.mjs`'s `drag` takes `dx`/`dy` only;
   putting a held module back needs the target's position (a `to:` selector).
