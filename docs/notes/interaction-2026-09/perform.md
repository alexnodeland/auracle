# PERFORM: interaction design review (PF)

Reviewer's scope: the playing view: the six named controls, Blend and Wander, the touch row, XY, the six pads, the B strip, the status line, the hood, first steps, search controls and grafts, and how PERFORM relates to the dock, keyboard and MIDI. Sources: `apps/web/perform.js` (all), the PERFORM parts of `main.js`, `style.css` (`pf-`), `worker.js` lanes, `midi.js`, the view-perform rehearsal (`www/video/out/view-perform/dry/`), the finished film, the tour rehearsal, and `www/docs/src/views/perform.md`. Items already fixed in CHANGELOG [Unreleased] are not reported again. That includes the dial stopping at centre, the "re-checking" wording, Wander's "paused", Take keeping the wiring, Offer answering from a spare, and the XY dead-axis strike-through.

Note on evidence: `perform.js` was last committed at 03:39 (672061c), two minutes after the last rehearsal at 03:37. Status text in the `vp-wander` log that reads "measuring how this patch moves…" during roam is therefore the *old* wording of a state that now reads "re-checking". The timing it shows (≥ 9.6 s) still holds.

---

## 1. Summary

1. **The half-closed control is drawn and described wrongly.** Its ring is drawn on the *closed* side (an SVG dasharray that assumes the circle starts at 12 o'clock; it starts at 3). Its caption ("at the still end") states a position that the amber "where" dot on the same knob often contradicts.
2. **Amber means "this patch can't" and also "not measured yet".** After a Take, and during a measurement, controls and XY axes put on the search-control look (amber, "turn to ask for it", struck through) only because they have not been measured. Turning one of them grafts or grows an offer. First steps also sends newcomers to "a lit control", and the only lit names on screen are the amber ones.
3. **The Offer → Peek/Blend → Take/Pass loop is the view's best idea, but its parts are scattered and asymmetric.** B's controls sit in three rows. A pass has no undo while a Take has 8 s. Nothing shows whether B has been "heard" enough to count. Pass → next offer takes 10.9 s against 0.01 s for the first, because no spare grows while B is occupied.
4. **Hands-on performance loses its footing.** Dials and the XY dot snap to centre on every drift, re-measure, Keep and Take, and each time MIDI soft-takeover lets go of the pot. A `<select>` (XY axis, touch) swallows the note keys. The pads have no keyboard or MIDI binding, and a keyboard Peek (0.6 s) can never count as heard (1.0 s).
5. **Strengths to keep:** knob turns reach the voices on the same frame, with no recompile. A spare offer lands in 0.01 s. Hands-on always wins over Wander. Nothing is modal. The hood makes the knobs being moved visible. B is loudness-matched. Take keeps the controls live.

---

## 2. Flows walked

**F1: A first-timer arrives (after the warm start).** `tour/dry/to-first.json` at t = 15.32 shows the status "Acid Line · measuring how this patch moves…", and `to-first-05-end.jpg` shows the view afterwards.
1. The page shows 8 dials, a touch row, 6 pads, B, XY, the hood and "how this works" all at once. Nothing is folded away.
2. The first-steps strip (11 px mono, dim) and the keybed coach toast ("Press A–L or tap a key — you're already holding a synth.", `main.js:2408`) say the same thing in two voices at once (`probe-plain-00-start.jpg`).
3. On arrival every dial says "measuring…" for 11–16 s, with no progress indicator. The keys play, but the controls do nothing.
4. Step 2 reads "Turn a lit control: BRIGHT is a good start". The only coloured names on the deck are BODY, GRIT and SPACE, in amber, and those are the controls that cannot turn. See PF-03.

**F2: Turn a named control / long-press.**
1. A drag moves the sound at once (`push()` writes knob params directly). The hood bars move with it. This is excellent.
2. The caption under each dial names the knobs ("cutoff"), in the same style as the half-closed captions ("at the snap end"). These are two different kinds of fact in one look.
3. A long-press of 550 ms plays a 2.4 s sweep. The only cue that long-press exists is the tooltip text "Long-press to hear it."

**F3: Meet a half-closed control (Glass Pad: Snap, Motion, Space).** See `vp-named-01-row.jpg`, crop `pfimg/deck.png`.
1. The ring should show which way the control turns. It shows the opposite half (PF-01), and in hairline grey at that.
2. The caption says where the sound *is* ("at the still end"). Motion's amber dot sits near the restless stop (PF-02).
3. Since the fix in [Unreleased], dragging the closed way stops at centre. There is no feedback for that stop: no bump, no word.

**F4: Meet a search control (Grit / Body / Space).**
1. An amber dashed ring with "turn to ask for it" is clear once you know the convention.
2. Turn it less than 0.3 of its travel and let go: nothing happens, no word is said, and the dial stays off-centre (PF-17).
3. Turn it past 0.3: it springs back and an offer grows. A Grit request landed in B about 4.3 s later (`vp-honest` stamp `offered` 24.26, released at ≈19.9). The toast reads "Grit: no knobs here make it rough — growing an offer instead". This path is good.
4. Bright, Body and Space turned up graft a module instead. That triggers a structural bench edit, then a full re-measurement (11–16 s, every control dead), then the control jumps to 0.5 up to 30 s after the gesture (PF-14).

**F5: Offer → hear → pass → take.** Evidence: `vp-offer`.
1. Offer with a spare ready puts the variant in B at once (0.01 s). The strip text is long: 2 lines of amber diff, then source, then instructions.
2. Peek sits to the right of Take. The order reads "take it, then listen" (PF-08).
3. Blend, which is B's control, lives in the deck among the timbre dials, two rows away from B.
4. Offer again is a *pass*. The toast says so after the fact, and there is no undo. B is emptied. The next variant takes 10.9 s (21.1 → 31.97), during which Blend stays at 67% with a stale "67% offer" caption over an empty B (`vp-offer-01-passed.jpg`).
5. Take shows the toast with **don't count it**, the name becomes "Glass Pad (taken offer)", and the status reads "2 of 6 controls reach this patch · re-checking". MOTION has turned amber ("turn to ask for it") and the XY Y-axis has switched itself from Motion to Space (`vp-offer-02-toast.jpg`) (PF-04).

**F6: Keep → Wander → Back.** Evidence: `vp-wander`, film at 206 s.
1. Keep shows the toast "kept — this is home now", and the title becomes "Glass Pad (edited)". Keep also starts a full re-measurement in the engine's non-background lane (PF-13).
2. Wander into the offer zone: the status says "paused — your hands are on it", because turning Wander counts as a touch. An idea lands in B 4.5 s later.
3. Wander into drift: nothing audible for **21.6 s** (12.75 → 34.33), with nothing on screen saying when the next move is due (PF-12).
4. Each glide re-centres every named dial and the XY dot (PF-11).
5. Freeze shows "held" and the pad lights amber. Back glides home and the hood bars return to their ticks. This part is lovely.

**F7: XY.** Evidence: `vp-xy`.
1. Choosing an axis uses a native `<select>`. Afterwards focus stays in the select and the note keys are dead. The film script blurs the select by `eval` to get around it (`shots.json` vp-xy, `xy2:Choose+0.2`) (PF-10).
2. A dead axis is struck through in amber with "Grit doesn't reach this patch". That is clear. The same look appears while the patch is merely being measured (film at 83 s).

**F8: Change patch while in PERFORM.**
1. The name dims and the status reads "opening Bell Jar…". This is honest.
2. Then "measuring how this patch moves…" for 11.0 s (`vp-named` stamps: measuring 24.56 → wired 35.49), or 16.3 s in an earlier rehearsal (`dry.log`: 24.57 → 40.82). All six dials show "measuring…" in tiny green, and the XY labels are struck through amber.

**F9: A MIDI controller.** Evidence: `vp-midi`.
1. The first 8 CCs claim the 8 controls, with learn and soft takeover. Pressure and the mod wheel are expression. This is good.
2. There is no way to press Offer, Take, Peek, Keep, Back or Freeze from the controller (PF-09).
3. Expression moves the sound but not the dial (PF-19).
4. After any re-centre the pot stops responding until it is swept back through its middle (PF-11).

---

## 3. Findings (ranked)

### PF-01 · The half-closed ring is drawn on the closed side, in near-invisible grey · **P0** · understandability, quality
- **Evidence:** `style.css:4573-4574` sets `.half-lo .pf-k-ring { stroke-dasharray: 0 70 139 70 }` and `.half-hi { 139 139 }` on a full `<circle r=44>` (circumference 276.5). An SVG circle's stroke starts at **3 o'clock** and runs clockwise. So `half-lo` draws 6 → 9 → 12 o'clock (the *left*, closed half), and `half-hi` draws 3 → 6 → 9 (the *bottom*). The crop `pfimg/deck.png` (from `vp-named-01-row.jpg`) shows this: MOTION ("at the still end", can only go toward restless) has its ring on the left, SNAP (can only go toward bloom) has its ring along the bottom, and SPACE has its ring on the left. The guide promises: "the ring is drawn only on the side you can turn toward" (`perform.md` § Half-closed controls). The ring stroke is `--hairline`, which barely shows against the deck in any state.
- **Player experiences:** a cue that points the wrong way, when it can be seen at all. They drag toward the drawn side, and the dial stops dead at centre.
- **Principle:** a signifier must point to the action it affords; say what is true.
- **Recommendation:** Stop using dasharray on a full circle. Draw the travel as two arcs with the existing `arcPath`: the low half `arcPath(-135, 0)` and the high half `arcPath(0, 135)`. Draw an open half in `--silk-mute` at 3 px and a closed half as a 1 px `--hairline` dotted arc (dasharray `1 4`). Add a 2 px radial "stop" tick at 12 o'clock on a half-closed control. Give the pointer a small bump when a drag hits the stop: rotate ±3° and back over 120 ms.
- **Effort:** S · **Confidence:** high

### PF-02 · The half-closed caption asserts a position that the amber dot contradicts · **P0** · understandability
- **Evidence:** the caption is `at the ${w.low} end` whenever `rangeOf` closes a half (`perform.js:246-252`). `rangeOf` closes a half because the renders did not confirm it (`m < HALF_OPEN`, lines 39-44), which is not the same as the sound being at that end. On the same knob, the dot is `tanh(position/2)`, where the sound actually measures (lines 236-240). Examples:
  - Glass Pad (`vp-named-01-row.jpg`): MOTION's caption says "at the still end" while its dot sits near the **restless** stop (≈ +120°). SPACE's caption says "at the close end" while its dot sits slightly toward far.
  - Cathedral (`probe-plain-00-start.jpg`): MOTION's caption says "at the restless end" while its dot is on the still side.

  The film narrates the caption as fact: "This pad already sits at the close end" (`honest2`). The amber dot itself has no label, legend or tooltip anywhere in the app.
- **Player experiences:** two indicators on one dial that disagree. Nothing tells them what the orange dot is.
- **Principle:** say what is true; every indicator is explained where it is seen.
- **Recommendation:** Caption what the player can *do*, not a cause the app infers: `turns toward restless only` / `turns toward bloom only` (the word of the open end). Add to the knob tooltip: "The amber dot is where this sound measures on Motion, compared with the patches in your session." Change `honest2` in the film to "Space only turns toward far on this pad, and the line under it says so."
- **Effort:** S · **Confidence:** high

### PF-03 · First steps point newcomers at the controls that cannot turn · **P1** · understandability
- **Evidence:** `STEPS` at `perform.js:1561-1565` says "Turn a lit control: BRIGHT is a good start". Named controls are drawn in `--silk` (white). The only coloured (lit-looking) names are the amber search controls (`style.css:4567`); see `to-first-05-end.jpg`, where BODY, GRIT and SPACE are amber. Bright is itself a search control on Detune Dream (`probe-plain.json`: "Bright:search"). The step's text is fixed. The strip is 11 px dim mono, and the keybed coach says step 1 again at the same moment (`main.js:2408`, `probe-plain-00-start.jpg`).
- **Player experiences:** a newcomer turns GRIT because it is the one that is lit. It springs back, and a 4–10 s wait for an offer follows. That is not the lesson the step meant to teach.
- **Principle:** instructions match what the eye sees; one voice per lesson.
- **Recommendation:**
  - Step 2 names the first reachable control: `Turn ${firstReachable.toUpperCase()}: drag up or down` (the order Bright, Motion, Snap… as `pickXY` uses).
  - Give reachable controls an actual "lit" affordance while step 2 is `.now`: a 1.2 s phosphor breathe on their ring.
  - Suppress the keybed coach while PERFORM's first steps are showing, since step 1 already says it.
  - Raise `.pf-steps` to `--t-body` in `--silk-dim`, with the `.now` step in `--phos-a`.
- **Effort:** S · **Confidence:** high

### PF-04 · "Not measured yet" wears the search-control look, and turning such a control acts on it · **P1** · consistency, understandability
- **Evidence:**
  - After a Take, `carryWiring` marks any control whose knobs the taken tree lacks as `{knobs: [], search: true}` (`perform.js:1185-1192`). In `vp-offer-02-toast.jpg`, MOTION (previously "both") turns amber with "turn to ask for it", and the log "after take" reads `… | turn to ask for it | …`. `onRelease` then treats a turn of it as a search request and grafts or grows an offer (lines 532-553).
  - `pickXY` (1639-1647) swaps the XY's Y axis from Motion to Space under the player's hand, because the carried wiring says Motion no longer reaches.
  - During a first measurement, `xyReach` is false, so both axes are struck through in amber (film at 83 s, `pfimg/f83.jpg`), which is the "doesn't reach" look.
- **Player experiences:** a control that worked a second ago now says the patch "can't" do it, and turning it changes the patch's structure. Ten seconds later it is white again.
- **Principle:** one look per meaning; transient states must not trigger permanent actions.
- **Recommendation:** Add a third state, `.pending`: silk-mute ring, pointer greyed, caption `listening…`, no amber, no strike-through.
  - A carried control with no knobs gets `pending`, not `search`.
  - `onRelease` does nothing on a pending control, and the control springs back.
  - `pickXY` does not run on a carried wiring (`if (p.cacheAs?.carried) skip`).
  - `.pf-xy-field` while measuring uses `.pending` (end words dim, no line-through) with the note `listening to this patch…`.
- **Effort:** M · **Confidence:** high

### PF-05 · The status line carries too many jobs, in the least-read place on the screen · **P1** · understandability, quality
- **Evidence:** `renderStatus` (`perform.js:1486-1513`) folds patch arrival, measurement, reach count, re-checking, Wander zone, hands-on pause, hold and walk results into one 13 px `--silk-dim` line (`style.css:4500`) under a 26 px title. Real states:
  - "3 of 6 controls reach this patch · re-checking · paused — your hands are on it" (`vp-together-01-toast.jpg`);
  - "nothing nearby it likes better — staying";
  - "drifting through the grammar — no taste yet".

  Transient messages are overwritten by the next `renderStatus()`, which the pause timer calls 3.52 s after any touch (lines 374-375). "N of 6 controls reach this patch" is engine language; the deck already shows which controls reach. The line sits about 650 px from Wander, which most of its words are about.
- **Player experiences:** mid-phrase, nobody reads a grey line of mono under the title. The Wander states ("paused", "held", "drifting toward your taste") happen out of sight.
- **Principle:** show state at the control it belongs to; progressive disclosure.
- **Recommendation:** Split the line three ways.
  1. **Wander's caption** (under the dial) carries its own state, in amber: `still` / `ideas` / `drift · next in 9 s` / `paused 3 s` / `held` / `staying — nothing better nearby`. Add a thin countdown arc on Wander's ring until the next move.
  2. **The deck** carries measurement (PF-06).
  3. **The status line** keeps only patch-level facts: `opening Bell Jar…`, `listening to this patch…`, `re-checking`, `could not measure this patch — try again`. Drop "N of 6 controls reach this patch" (it can go in the engineer tooltip).

  Offers drawn "from the grammar" say so in B's strip, which already happens.
- **Effort:** M · **Confidence:** high

### PF-06 · A new patch leaves every control dead for 11–16 s with no progress shown · **P1** · responsiveness
- **Evidence:**
  - `vp-named` stamps: measuring 24.56 → wired 35.49 (11.0 s). An earlier run of the same shot took 16.3 s (`dry.log`).
  - The tour's first PERFORM moment, after the warm start, lands in this state (`tour/dry/to-first.json` 15.32: "Acid Line · measuring how this patch moves…").
  - The worker already measures in pieces (`perform_wire_plan`, `worker.js:808-839`) but reports nothing until the end.
  - The only cue is a 9 px "measuring…" under each dial (film at 83 s).
- **Player experiences:** the first impression of the "instrument" view is six knobs that do nothing for up to a quarter of a minute.
- **Principle:** first result in ≤ 1 s; long work shows progress.
- **Recommendation:**
  - Post `perform_wire_progress {done, total}` from the plan loop and draw it as a determinate sweep on the deck border, with the status reading `listening to this patch… 12 / 30`.
  - Better still, deliver the wiring **per control as it is verified**, Bright first (it reaches nearly every patch in `probe-plain.json`), so the first dial comes alive in about 2–3 s.
  - Keep the 0.12 s cache path as it is.
- **Effort:** M (progress) / L (per-control) · **Confidence:** high (timings), medium (per-control feasibility)

### PF-07 · Offer-as-pass: a hidden verdict with no undo, an unheard B silently discarded, and a 10.9 s wait for the next one · **P1** · responsiveness, consistency, understandability
- **Evidence:**
  - `requestOffer` passes first whenever B holds an offer (`perform.js:858-860`, `passOffer` 851-856). If B was heard, the pass is recorded at once with no undo ("Passed on B — that counts as a pick for what you had.", line 761). A Take gets an 8 s window with **don't count it** (764-771).
  - If B was *not* heard, it vanishes with no word and cannot be recovered.
  - `growSpare` returns while `state.offer` exists (line 803), so the next offer is always grown on demand. Measured in `vp-offer`: the pass at ≈21.1 s, then B2 ready at 31.97 (≈10.9 s), against 0.01 s for the first offer (spare).
- **Player experiences:** "Offer" reads as "give me an idea", but pressing it again is a vote against B. They also wait ten seconds for the next idea, at exactly the moment they are exploring fastest.
- **Principle:** a verdict should look like a verdict and be reversible; symmetric actions get symmetric safety.
- **Recommendation:**
  - While B holds an offer, relabel the pad **NEXT**, with a sub-line `passes on B` in the same `::after` style as `needs an offer`.
  - The pass toast gets `undo` for 8 s (restore B and drop the record), mirroring Take.
  - An unheard pass says `B skipped — not counted, you hadn't heard it`.
  - Grow the next spare in the background as soon as an offer is presented, since it belongs to the same A. Drop the `state.offer` guard and keep `spareFresh`. That makes NEXT instant too.
- **Effort:** M · **Confidence:** high

### PF-08 · B's controls are spread over three rows, in the wrong order, and Blend looks like a timbre control · **P1** · understandability, quality
- **Evidence:**
  - Blend is knob 7 in the named-control deck (`perform.js:1718`), in the same style and the same row as Bright…Space.
  - Offer, Take and Peek are in the pad row, in the order Keep · Back · Offer · **Take · Peek** · Freeze (1721-1745).
  - The B strip is a third row below them (`probe-plain-00-start.jpg`).
  - The six pads are equal and ungrouped, although they belong to three different subjects: home (Keep/Back), B (Offer/Peek/Take) and Wander (Freeze).
  - At rest the view also shows the touch row, XY, hood and "how this works" together (`to-first-05-end.jpg`), with no folding.
- **Player experiences:** the one idea no other instrument has (a second sound following your hands) has no single place. Peek comes after Take, although you listen before you choose.
- **Principle:** group by subject; order by the sequence of use; progressive disclosure.
- **Recommendation:**
  - Pads, grouped with a `--s5` gap: `[KEEP BACK] · [OFFER PEEK TAKE] · [FREEZE]`, with Freeze directly under Wander.
  - Move Blend out of the deck into the B strip, as a horizontal crossfader `home ◀━━●━━▶ B` at the strip's left, drawn in amber like the B tag. The deck keeps the six named controls plus Wander (seven), separated by a vertical hairline.
  - Clamp the B strip's copy to one line: the diff, then `· grown toward your taste`. The instructions ("hold Peek to hear it, slide Blend, or Take it") only appear for the first 3 offers.
  - Collapse the touch row into a chip `touch: bright ▾` beside XY's axis selects.
- **Effort:** M · **Confidence:** medium (layout choices are judgement; the scattering is fact)

### PF-09 · Pads have no keyboard or MIDI binding, and a keyboard Peek can never count as heard · **P1** · parity, accessibility
- **Evidence:**
  - `pad(key)` exists on the PERFORM API (`perform.js:1959-1961`), but nothing calls it. The MIDI panel maps only the 8 controls (`vp-midi-05-why.jpg`). `keyboard.md` lists no PERFORM keys.
  - A keyboard or AT activation of Peek runs `onDown`, then `onUp` after **600 ms** (`perform.js:1472`). "Heard" needs `HEARD_MS = 1000` of Peek while notes sound (736, 752). A keyboard player's Peek therefore never makes their answer count.
- **Player experiences:** a controller player must reach for the mouse to do the loop's central gesture. A keyboard-only player's answers silently teach nothing.
- **Principle:** keyboard, MIDI and pointer parity.
- **Recommendation:**
  - In PERFORM, with focus not in a text field: **Space held = Peek** (Space's "audition" is meaningless where you are already playing), **Enter = Take**, **n = Offer/Next**, **b = Back**, **Shift+Enter = Keep**, **Shift+Space = Freeze**. None of these letters are notes.
  - For AT/keyboard activation, Peek latches until the next activation or Escape, instead of a 600 ms blip.
  - MIDI panel: add learnable rows for Offer, Peek (momentary: note on/off or CC ≥ 64), Take, Keep, Back and Freeze.
  - List all of these in the `?` map and `keyboard.md`.
- **Effort:** M · **Confidence:** high

### PF-10 · The XY axis and touch `<select>`s swallow the note keys, and a letter changes the select · **P1** · responsiveness, parity
- **Evidence:** `main.js:3884` returns from the note handler when the target is inside a `select`. The XY axis selects (`perform.js:1613-1629`) and `#pf-touch-sel` (442) keep focus after a choice. A native select also type-aheads, so pressing `s` (a note key) jumps the axis to Snap or Space. The film works around this by blurring (`shots.json` vp-xy: `eval document.activeElement.blur()` after each select).
- **Player experiences:** choose an XY axis, go back to the keys, and silence follows, or the axis changes under your fingers.
- **Principle:** a focused control must not silence the instrument (main.js's own rule, applied to buttons but not to selects).
- **Recommendation:** Blur the select on `change`, returning focus to the XY field or the knob deck. Alternatively, replace these three selects with button-menus (a popover list of the 6 names, with arrow keys inside) that do not type-ahead.
- **Effort:** S · **Confidence:** high

### PF-11 · Dials re-centre under the player, and a MIDI pot goes dead after each re-centre · **P1** · consistency, parity
- **Evidence:**
  - Every drift glide zeroes the named controls (`startGlide`, `perform.js:1222-1230`). So do every applied measurement (`applyWired` 919-925, including a background re-check after a 1.5 s pause), Keep (1367-1374) and Take (1146-1152). Each calls `host.controlMoved(i)`, which calls `midi.controlMovedElsewhere`, which calls `Pickup.release()` (`midi.js:372-373, 121-124`).
  - A released pot only engages again once it crosses the dial's value, which is now centre (0.5).
  - In roam a glide comes every 7–12 s (`wanderPace`, 79-82), so a pot set to 80% is inert again and again until it is swept back through its middle.
  - Film at 206 s: after the drift, every named dial reads centre.
- **Player experiences:** "I set Bright to 70%, and now it says 0." The hardware knob stops doing anything.
- **Principle:** the controls stay under the hands; visible state is continuous.
- **Recommendation:**
  - Animate re-centring: over 250 ms the pointer glides to 12 o'clock while a ghost tick marks where it was, fading over 1 s. The sound does not move.
  - For MIDI, re-anchor instead of release: on `controlMovedElsewhere` from a re-centre, keep the pickup engaged and store `offset = potValue − 0.5`, so the pot's *next movement* moves the control relative to its new centre. Release only when something else genuinely set the value (mouse, XY).
  - Do not re-centre on a background re-check at all unless the wiring's knob set changed.
- **Effort:** M · **Confidence:** high (code), medium (MIDI UX choice)

### PF-12 · Wander: a long silent first move, "paused" as you turn it, unmarked zones, and "offer" used twice · **P1** · responsiveness, understandability
- **Evidence:**
  - The clock fires only when `now − lastMove ≥ period` (`perform.js:1760`). The period at the left of drift is 36 s (77). `vp-wander`: into drift at 12.75, first glide at 34.33 (21.6 s).
  - Turning Wander calls `touch()` (313-335), so the status says "paused — your hands are on it" (`vp-wander` 39.36, after dragging to roam) and Wander waits 3.5 s after being asked to move.
  - The dial has no zone marks at 0.15/0.40/0.75 (`WANDER_*`, 25-27).
  - The zone "offer" collides with the Offer pad and with Blend's "offer" end word.
- **Player experiences:** "I turned it up and nothing happens… and it says paused."
- **Principle:** acknowledge within 100 ms, first result within ~1 s; one word per concept.
- **Recommendation:**
  - On release into a new zone, set `lastMove = now − period + 1.5 s`, so the first move comes 1.5 s after the hand leaves.
  - Wander's own drag does not count as a touch: `touch()` skips for `kind === "wander"`.
  - Draw three 4 px ticks on Wander's ring at the boundaries, and rename the zone **ideas** (the film already says "ideas appear in B").
  - Add the countdown arc from PF-05.
- **Effort:** S · **Confidence:** high

### PF-13 · Re-checks after Keep and after a glide hold the engine for 10–16 s in a foreground lane · **P1** · responsiveness
- **Evidence:**
  - `wire()` sends `perform_wire` without `bg` (`perform.js:693`). `worker.js:932` puts a non-`bg` wire in SOON, which holds the floor, and a pressed Offer (also SOON) waits behind it.
  - Keep triggers it every time: the bench echo goes to `patchChanged` → keeping branch → `wire()` (1082-1089), although the sound, and so the wiring, did not move.
  - Glides trigger it once `outsideTrust()` (1244, 1258). `vp-wander`: a re-measure started as roam began was still running at 48.95 (≥ 9.6 s).
  - `keep()`'s own comment says the wiring "is refreshed… in the background" (1363-1365). It is not.
- **Player experiences:** press Keep, then Offer (with no spare), and the offer takes about 20 s instead of about 10 s. In roam the worker is permanently busy re-measuring.
- **Principle:** the player first; background work must be background.
- **Recommendation:**
  - After Keep, re-measure only if `outsideTrust()`, and then with `bg: true` (as `revalidate()` does).
  - After a glide, use `bg: true` as well. The wiring in hand keeps the dials working, as the status now says ("re-checking").
- **Effort:** S · **Confidence:** medium-high (lane behaviour read from code; the timing was measured in one rehearsal)

### PF-14 · A graft rebuilds the patch mid-phrase, kills the controls, then moves the sound up to 30 s later · **P2** · responsiveness, understandability
- **Evidence:**
  - `onRelease` sends `perform_graft` (`perform.js:543-548`). The reply is `host.commitTree` (1061), a structural `edit_set_tree`, which rebuilds the voices. `main.js` itself calls a redundant swap "a second fade-out, rebuild and re-attack" (around line 1617).
  - `patchChanged` then clears the wiring, and a full first measurement runs (11–16 s, PF-06).
  - `applyWired` finally sets the control to ±0.5 if `now − intent.at < 30 000` (943-954). That is an audible move that nobody's hand made, long after the gesture.
  - The notes "Bright: giving it a tone EQ to turn…" and "Bright now turns …" use no `replace` key, so they queue as separate toasts.
- **Player experiences:** a turn, a hiccup, a dead deck, then 15 s later Bright jumps half-way on its own.
- **Principle:** nothing stops the music; nothing moves that the player did not move.
- **Recommendation:**
  - Skip the full re-measure: the graft is a known module with a known knob, so wire only that control (a one-control plan, about 1 s) and keep the others' wiring.
  - Do **not** auto-turn on arrival. Pulse the control's ring twice and say `Bright now turns the tone EQ: turn it`, using `replace: "graft:" + name` over the first note.
  - If the rebuild is audible on held notes, tell the player before the turn completes: the caption during the drag reads `let go to add a tone EQ`.
- **Effort:** M · **Confidence:** medium

### PF-15 · Whether B has been "heard", and so whether an answer counts, is invisible · **P2** · understandability (the model's reasoning)
- **Evidence:**
  - `heardMs` accumulates in 250 ms ticks only while Peek is held or Blend ≥ 0.5 *and notes sound* (`perform.js:752`). Answers under 1000 ms are dropped (757).
  - An unheard Take shows no toast at all (`answerOffer` returns before `host.note`).
  - The rule is stated only in the guide.
- **Player experiences:** they Take an offer and cannot tell whether it taught anything. Peeking in silence (no key held) never counts, and nothing says so.
- **Principle:** make the model's bookkeeping legible where it happens.
- **Recommendation:**
  - The B tag fills left to right in amber as B is heard, and at 1 s shows `B ✓`. The tooltip reads "You've heard B: Take or Next now counts as a pick."
  - An unheard Take says `Took B — not counted: you hadn't heard it yet`.
  - Peek with no note held says `hold a key to hear B` (a refusal, `urgent`).
- **Effort:** S · **Confidence:** high

### PF-16 · After a pass, Blend stays past half over an empty B, and the next offer arrives at that level · **P2** · consistency
- **Evidence:** `vp-offer-01-passed.jpg`: B reads "growing an offer…" while Blend reads "67% offer". `passOffer` (851-856) neither repaints nor resets Blend. Take brings Blend home, "left turned toward 'offer', the next offer would sound at that level the moment it arrived" (1411-1419), and a pass leaves it exactly in that state.
- **Player experiences:** about 10 s later a new sound appears at 67% over what they were playing, without them asking.
- **Principle:** the same situation gets the same behaviour.
- **Recommendation:** On pass, glide Blend home over 300 ms, as Take does, and repaint. If the film wants "heard at the same Blend", the player can ride it again, and B's arrival stays a choice.
- **Effort:** S · **Confidence:** high

### PF-17 · A search control has a silent dead zone below 30% · **P2** · understandability
- **Evidence:** `onRelease` acts only when `|value| > 0.3` (`perform.js:532`). Below that, the dial stays where it was released (search controls span −1..1, `spanOf` 293), nothing sounds, and nothing is said.
- **Player experiences:** a small nudge leaves an amber dial pointing off-centre, doing nothing.
- **Principle:** every gesture gets an answer.
- **Recommendation:**
  - Always spring a search control back on release.
  - During the drag, draw an amber notch at ±0.3 and set the caption live: below it `turn further to ask`, past it `let go to ask for rougher` (or the graft wording).
  - Below the threshold on release, say nothing, and the spring-back is the answer.
- **Effort:** S · **Confidence:** high

### PF-18 · PERFORM's toasts ignore the lane's rules, and the Take window can close while its button is still showing · **P2** · consistency, quality
- **Evidence:**
  - No `host.note` in `perform.js` passes `replace` or `urgent`: graft start/finish (547/954), refusals like "still measuring this patch" (562) and "nothing offered yet" (1735).
  - `answerOffer`'s 8 s timer starts at the press (767). `note()` starts a toast's life when it becomes *visible* (`main.js` rules 3 and 5). A Take toast queued behind "kept — this is home now" or "Passed on B…" therefore shows a **don't count it** button after the pick was already sent. Clicking it does nothing, silently.
  - Casing is inconsistent: "kept — this is home now" against "Took B — …" and "Passed on B — …".
- **Player experiences:** stale news, a dead undo, and uneven voice.
- **Principle:** AGENTS rule "toasts follow the lane's rules"; an undo must work while it is shown.
- **Recommendation:**
  - Pass `replace: "pf-offer"` for pass/take/offer notes, `replace: "pf-graft:"+name` for graft notes, and `urgent: true` for refusals.
  - Start the Take window from the toast's `shown` moment (have `note()` return an `onShown` hook), or make the undo re-check `dropped` and say `already counted` if it is too late.
  - Change the copy to `Kept — this is home now. Back returns here.`
- **Effort:** S · **Confidence:** medium (the timer race is read from code; not seen on film)

### PF-19 · Pressure and the mod wheel move the sound but not the dial · **P2** · understandability, parity
- **Evidence:** `setExpression` adds into `liveValue` and `push()` (1947-1953), but `paintKnob` draws only `k.value` (219-282), and the XY dot follows `k.value` too. The film says "Pressure pushes Bright" (midi3) while the dial is still.
- **Player experiences:** they cannot see what their hand is doing, and the hood is the only witness.
- **Principle:** every state visible.
- **Recommendation:** Draw expression as a second, thinner arc (2 px, `--phos-a` at 50%) from the pointer to the pointer plus the offset, and move the XY dot by the same offset, with a hollow ring left at the hand's position.
- **Effort:** S · **Confidence:** high

### PF-20 · Hood rows look like meters but are full-width links out of PERFORM · **P2** · quality
- **Evidence:** each row is a `<button>` spanning name, bar and value (`perform.js:1302-1313`). A click calls `showKnob`, which switches to PATCH, and `hide()` silences B (1905-1908). The rows also reflow as Wander adds knobs (`hoodAddrs` 1271-1286; the film at 206 s shows "CHORUS mix" joining).
- **Player experiences:** a click on a bar, as if to set it, leaves the view mid-phrase. The list shifts while you watch it.
- **Principle:** affordance matches action; layout stability.
- **Recommendation:** Make only the name the link (underline on hover, `↗` glyph, title `open in PATCH`), with the bar and value inert. Reserve row slots (`HOOD_MAX` rows' height) and append new knobs at the end, never re-sorting.
- **Effort:** S · **Confidence:** high

### PF-21 · Words and labels that disagree with the app · **P3** · consistency
- **Evidence and fixes:**
  - "Eight controls with names…" (`perform.md` lede, `perform.js:2`) against "six controls named for what you hear" (film, help). Change to **"Six controls named for what you hear, Blend and Wander, six pads…"**.
  - Help says "Freeze holds everything still" (`index.html:788`), but it only freezes Wander. Change to **"Freeze stops Wander where it is"**.
  - Keep re-labels the patch "(edited)" (`vp-wander-01-paused.jpg`) where Take says "(taken offer)". Use **"(kept in PERFORM)"**, or no suffix change for a Keep that altered only continuous knobs.
  - The knob caption still ellipsizes ("mod depth · lfo rate · chorus rat…", `vp-wander-01-paused.jpg`), despite the CSS comment saying an ellipsis reads as broken (`style.css:4548-4563`). Show at most 2 knob names plus `+N`.
  - `aria-valuetext` at centre reads "far 0%" (269). Use `centre`.
  - The storyboard claims "the drag code clamps only the sound", which is stale since the [Unreleased] fix. Correct it (the log `space dragged down: 0.00` proves the clamp).
- **Effort:** S · **Confidence:** high

---

## 4. Keep

- **Turning is instant and never breaks a note.** Continuous-knob writes with no recompile (`push()`), and the hood bars moving with the hand.
- **Offer answers at once from a spare** (0.01 s in `vp-offer`), and a press while an offer grows claims it rather than dropping it.
- **Hands on, it waits.** A touch mid-glide stops the glide where it is, and it never snaps back (`stepGlide`).
- **Nothing is modal.** Every message is a line, a strip or a pad you can ignore.
- **B is loudness-matched, equal-power, and follows your hands.** Take hands over without a gap, and Blend comes home on Take.
- **Take keeps the controls live** (the carried wiring), with "(taken offer)" naming what happened. Keep this, and fix only the look (PF-04).
- **Honest search controls:** the springback and the "(grit up)" provenance in B, and the graft table's restraint (no Grit graft).
- **Disabled pads say what they wait for** ("needs an offer"), instead of reading as broken.
- **The wiring cache:** a revisit is playable in 0.12 s, and a pre-warm serves the booth.
- **The hood's home ticks.** Back visibly returns the bars to them, the clearest "home" picture in the app.
- **"opening Bell Jar…" with the old name dimmed:** an honest in-between state.
- **Long-press to hear it:** the right way to teach a control whose knobs change per patch.

---

## 5. Response-time budget

| Gesture | Target | Measured now (source) | Verdict |
|---|---|---|---|
| Drag a named control → sound and dial | ≤ 16 ms | same frame: `push()` writes params synchronously (`perform.js:406-424`) | OK |
| Long-press → sweep starts | 550 ms hold, then ≤ 100 ms | 550 ms by design (`perform.js:323`) | OK; undiscoverable (tooltip only) |
| Offer (spare ready) → B | ≤ 100 ms | 0.01 s after the click (`vp-offer` `until .pf-offer.ready` took 0.01) | OK |
| Offer again / pass → next B | ≤ 1 s | ≈ 10.9 s (21.1 → 31.97, `vp-offer`) | **Fail**: grow the spare while B is occupied (PF-07) |
| Search control released → offer in B | ≤ 1 s acknowledgement, ≤ 5 s result | toast at once; B at ≈ 4.3 s (release ≈ 19.9 → `offered` 24.26, `vp-honest`) | Acknowledged OK; result acceptable |
| Search control (graft) → playable again | ≤ 2 s | graft, then a full measure of 11–16 s (inferred from `vp-named` stamps) | **Fail** (PF-14) |
| New patch → first working control | ≤ 1 s acknowledgement, ≤ 3 s first control | acknowledged at once ("measuring…"); controls at 11.0 s (`vp-named` 24.56 → 35.49), 16.3 s in an earlier run (`dry.log`) | **Fail** on result; no progress shown (PF-06) |
| Revisit a measured patch → controls | ≤ 1 s | 0.12 s (CHANGELOG, `perform_instant.spec.js`) | OK |
| Take → controls usable | ≤ 100 ms | immediate (carried wiring); "re-checking" still showing 3.2 s later (`vp-offer` log at 37.26) and 3.6 s later (`vp-together` 18.41) | OK, but carried amber misleads (PF-04) |
| Take → confirmation toast | ≤ 500 ms | visible by +0.5 s (`vp-offer` mark at 34.03) | OK |
| Wander into offer zone → idea in B | ≤ 5 s | ≈ 4.5 s (drag 6.7 → `offered` 11.26, `vp-wander`) | OK |
| Wander into drift → first audible move | ≤ 2 s after release | ≈ 21.6 s (12.75 → 34.33, `vp-wander`); up to 36 s by `wanderPace` | **Fail** (PF-12) |
| Keep → a pressed Offer with no spare | ≤ 10 s | queues behind a non-bg re-measure of 10–16 s (`worker.js:932`, `perform.js:1088`) | **At risk** (PF-13) |
| Keyboard Peek → counts as heard | ≥ 1 s of B | 0.6 s latch (`perform.js:1472`) against `HEARD_MS` 1000 | **Fail** (PF-09) |
| Touch → Wander pauses | ≤ 100 ms | immediate; holds 3.5 s (`HANDS_OFF_MS`) | OK; but turning Wander itself pauses it (PF-12) |
| Choose XY axis → keys play again | immediate | never, until the player clicks elsewhere (`main.js:3884`; the film blurs as a workaround) | **Fail** (PF-10) |
