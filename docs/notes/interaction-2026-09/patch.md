# PATCH (the rack): interaction design review

Area: the rack view. Evidence prefix `D/` = `/home/user/auracle/www/video/out/view-patch/dry/`
(1920×1080 stills of the seeded session, rehearsed 28 Sep 01:52–03:32, after the lane and knob-redraw
fixes landed at 00:51–01:35). `vp-probe*.json` predate those fixes (22:46 and 00:46); I used them
only for settle times and did not report the lost-edit they show (fixed: "Every edit lands, in order").
Code refs are `apps/web/main.js` unless another file is named.

## 1. Summary

1. **Two readouts lie about the sound.** After any knob turn, the knob's readout goes back to the *old*
   value in amber, with a "Playing at … in PERFORM" ghost (PA-01, three films' worth of stills). And an
   "EMPTY" socket plays a sawtooth, although the film says "the socket goes quiet" (PA-02).
2. **The editing verbs don't match a musician's mental model.** *Bypass* takes the module out of the rack
   rather than switching it off where it sits. *HELD* collides with HOLD, and you can only use it by dragging
   a 13 px ring. *Commit* ("how do I keep my version?") neither keeps nor saves: it renames your patch to
   an auto-name in the evictable pool. The commit duel's Esc *commits*.
3. **Responsiveness is good for the hands and bad for the one long act.** Sound follows a drag at once,
   the belief settles in 0.7–1.1 s, and ⌘Z lands in 0.29 s. ⚡ evolve from this takes **23 s** with no
   progress bar and no cancel, and it blocks the engine worker for the whole time.
4. **Consistency:** amber means five things (the model, modulation, *your* locks, destructive "replace",
   PERFORM ghosts). The header offers two amber "breed" actions side by side. A placement says the same
   thing in three places. The camera re-fits after every structural edit.
5. **Strengths to keep:** the rack reads as hardware (plugs, green/amber cables, units on every knob),
   arm-and-place with lit, named sockets, the ghost plate, undo that answers for locks, holes and the
   shelf, and the spec card's honest "heard as" line.

## 2. Flows walked

**Read the circuit** (vp-read-00, vp-move-03, vp-steps-03, vp-lock-03)
1. Open Glass Pad. Five plates, green audio left to right, one amber LFO cable ending in a CUTOFF tab.
   It reads at a glance at 1920. *Friction:* the rack uses about 60 % of its band. The bottom ~200 px is
   empty except for a black PRE-MASTER box (vp-read-00, x1290–1610, y680–820), and the permanent strip
   under it says "Point at a module — …" (PA-17).
2. A 9-module ⚡ child (vp-lock-03) shrinks to plate titles of about 8 px and knob labels of about 6 px at
   1920, and 40 % of the frame stays empty. At 1280 the silk floor hides knob names (PA-15).
3. The modulation chain (vp-move-03) reads right to left and then up. It is legible, but the audio chain is
   pushed top-right, and the "3/3 mod depth" ceiling is printed at the belief row's far end.

**Hear it** (vp-hear-*)
1. ▶ plays the 5 s standard sample and lights within 0.25 s (log `sample` at 9.24, click at 8.99). Good.
2. Pointing at a chip in IN THIS PATCH opens the chorus card over the rack's bottom edge. The rack doesn't
   resize (the audit's X2 is fixed). *Friction:* the chorus plate on the rack isn't marked, so the card
   and the thing it describes don't meet.
3. The card's right column says "θ 0.03 ± 0.15, an interval that straddles zero". That's honest, but it's
   level-3 language shown at level 2.

**Change it while playing** (vp-change-*)
1. Drag the cutoff. The sound follows every pixel (`attachKnobDrag`, 11764; `live.param` per move) and the
   belief settles 0.7 s after release (path ends 8.20, `ready2` 8.91). *Then the readout reverts to
   1.78 kHz in amber* (vp-change-01-ctx; log `cut` = 7.83 kHz) (PA-01).
2. ⋯ opens a 9-item menu (vp-change-01-ctx, about 620 px tall, covering the chorus and ENV/OUT). Three of
   the nine take the module away: *extract to HELD*, *bypass*, *delete*.
3. Bypass: the chorus disappears in about 0.6 s, a HELD row appears, the rack frame loses 53 px, and every
   plate moves (vp-change-03). To hear it again you drag a 13 px ring from HELD, or catch the toast's
   SWITCH IT BACK IN inside 7 s (PA-03, PA-04, PA-13).
4. Pull the filter's in-cable. The socket becomes a dashed "EMPTY — drop a source" plate in 0.34 s, *and the
   scope shows a clean saw while the chord is held* (vp-change-08-hole) (PA-02).
5. ⌘Z: the supersaw is back 0.29 s later (21.40 → 21.69). Excellent.

**Add a module** (vp-add-*)
1. Click `delay` in the node bank. Within 300 ms three sockets light green, unrelated plates dim, and the
   hand status appears *twice*: in the spec strip and in the node bank's footer (vp-add-03).
2. Point at the socket after the filter. A dashed ghost DELAY plate is drawn *over the chorus*, and a chip
   on the rack says "INSERT AFTER FILTER no lean −0.06 ± 0.37 esc ×". That makes three statements of one
   intent (vp-add-04).
3. Rest on the socket for 600 ms: a 2 s render appears on the strip ("hear it here") but doesn't play. You
   travel about 500 px down to ▶ (vp-add-05) (PA-12).
4. Click the socket: placed in 0.46 s, with a "TAKE IT OUT" toast and the whole rack re-laid (vp-add-07).
5. `formant` → the four in-sockets turn amber, "REPLACES SUPERSAW … not priced — this takes modules out
   too". Amber here means *destructive*, not *model* (vp-add-08) (PA-08, PA-11).

**Make it move** (vp-move, vp-steps)
1. `slew` armed onto a slot that already has a mod env says "put slew after the mod env", then wraps it
   (toast "slew now shapes the mod env on filter → cutoff"). This is very good.
2. Steps: pressing and dragging bars works. There's no running light on the lane, the readouts collide
   ("2.1 Hz sync5 steps"), and the bars are about 20×45 px (PA-16).

**Protect and vary** (vp-lock-*)
1. Hover the cutoff and click its dot (invisible until hover), then click the chorus ▢. Everything turns
   amber with dashed rings, and the header says "8 locked" while 7 marks show (log `locks`) (PA-18).
2. ⚡ evolve from this. **23.05 s** pass (click 10.43 → `benched` 33.48) with only a toast and the
   wordmark lamp. The film cuts the wait (`clips: lock3 @benched-0.6`). The child arrives renamed "Soft
   Wash 3", with 9 modules and "6/6 depth" in red at x≈1850 (PA-07, PA-09).

**Keep my version** (vp-keep-*, vp-together)
1. COMMIT opens a modal in 0.55 s: "WHICH ONE IS BETTER?", with sides shuffled but labelled "your edit" /
   "the original". Both waveforms look identical for a cutoff change. The keys are dimmed and owned by the
   modal. "esc skip" is shown (vp-keep-01).
2. Pick → "taught: you heard both and your edit won." The header now reads **"Soft Drone"**, not "Glass
   Pad". The cutoff readout still shows the old 1.78 kHz in amber (vp-keep-04).
3. Tick *my edit is better*, COMMIT → "committed as patch #51 · … The patch it liked least was retired". The
   header reads "Soft Drone 2". The tick stays ticked (vp-keep-05/06). The bank sidebar still highlights
   Glass Pad in PRESETS, and nothing appears in MY PATCHES ("3/10 saved" unchanged) (PA-05, PA-06).
4. In *together*, 1.3 s after COMMIT the visible toast is still the placement's "distortion patched into
   the wire. TAKE IT OUT +1" (log `claim`, 22.57 vs click 21.26) (PA-19).

**Take it with you** (vp-take-*)
1. The export controls are in the *app's* ⋯ menu, between "Load taste profile" and "Scope & analyser…"
   (vp-take-01). JSON downloads in ≤1 s including the menu. SVG downloads 0.09 s after EXPORT.
2. Drop an SVG: "First Bass" opens 2.3 s after the drop, and nothing says "opening…" in between
   (vp-take-06). The toast adds "The patch it liked least was retired to make room."

## 3. Findings (ranked)

### PA-01 · A turned knob's readout reverts to the old value, in amber · **P0** · understandability, quality
- **Evidence.**
  - `D/vp-change-01-ctx.jpg`, FILTER: the green arc sits at about 2 o'clock, an amber pointer at
    about 1 o'clock, and the readout says **1.78 kHz** in amber. The log `cut` read 7.83 kHz at 8.91 s, and
    `vp-change-03-held1.jpg` shows 7.83 kHz once a structural edit re-sends the tree.
  - `D/vp-keep-04-toast.jpg`, `vp-keep-05-toast2.jpg`, `vp-keep-06-end.jpg`: CUTOFF **1.78 kHz** and RES
    **Q 0.6** in amber, with ghost pointers. The committed patch has the cutoff at 20 kHz (vp-take log:
    "cutoff 1.78 kHz → 20 kHz").
  - `D/vp-cold-01-end.jpg`: LADDER CUTOFF **240 Hz** amber, while the log `cut` says 480 Hz. This is the
    film's cold open.
- **Code.**
  - `paintPerformedKnobs` (3383–3423, every 100 ms) draws a ghost and *replaces the readout text*
    whenever `perform.performedKnobs()` differs from the knob.
  - `performedKnobs` (perform.js:1860) reads `state.cur.knobs`, which changes only through
    `setLivePatchJson` → `perform.patchChanged` (228–235).
  - A continuous-knob reply never calls it: `calibration`/bench handler 1620–1633 does so only for
    structural or non-live edits, and the worker posts `tree_json` only for "structure"/"restore"
    (worker.js:1643, 1787).
  - The ghost's tooltip says "Playing at N% in PERFORM — Keep writes it in", which is false in PATCH.
- **What the player experiences:** they turn CUTOFF to 7.8 kHz and hear it, then the knob says 1.78 kHz in
  the model's colour. The only readout of the value is wrong until some structural edit happens.
- **Risk (medium confidence):** PERFORM's `push()` (perform.js:406) writes `liveValue()`, which is built on
  the stale `state.cur.knobs`. The first time a PERFORM control that touches that knob moves, it can write
  the *old* value into the voices and silently undo the PATCH edit.
- **Principle:** a readout says what is sounding (the code's own comment at 3401). This also breaks
  AGENTS "Say what is true".
- **Recommendation:**
  - In `sendEdit` (6089), after `live.param(...)`, call a new `perform.knobSet(addr, v)`. It sets
    `state.cur.knobs.set(addr, v)` and `state.sent.set(addr, v)`, so PERFORM's base follows the hand.
  - Also have `paintPerformedKnobs` draw a ghost only when PERFORM holds a non-zero offset on that address
    (`state.c[i] + p ≠ 0`), never merely because two copies of the base disagree.
  - Add a spec: turn a knob in PATCH, wait 2 s, and assert that `.knob-value` equals `aria-valuetext`'s
    head and that no `.knob-ghost` exists.
- **Effort** S · **confidence** high.

### PA-02 · An "EMPTY" socket plays a sawtooth · **P0** · understandability (truth)
- **Evidence.**
  - `D/vp-change-08-hole.jpg`: the scope shows a single clean saw ramp while a chord is held. With the
    supersaw back in `vp-change-09-saw2.jpg` it shows a dense supersaw trace. Crops side by side:
    `ixd/crops/scopes.png`.
  - The log `rack` at 16.84 reads `node/0:vco`.
  - `placeholderNode() { return SEED_VCO(); }` (10765), and `SEED_VCO` is a saw VCO with mod depth 0.3
    (12350).
  - Film line (script.json:153): "Pull a cable, and the socket goes quiet". The storyboard's callout says
    "an empty socket: silence".
  - The belief scores the stand-in: "0.41 (was 0.39) ▲ · movement +0.10".
- **What the player experiences:** the plate says EMPTY / "drop a source" and the IN THIS PATCH chip says
  "empty", but a thin saw keeps sounding. The model learns from a patch the player never built.
- **Principle:** every state visible and true. The earlier review (musical-instrument-review Part VII)
  already found that `Silence` can't be reached through the edit vocabulary. This is its user-facing cost.
- **Recommendation:**
  - Add `Silence` to the edit vocabulary (a `NodeKind`/`Replace` target) and make `placeholderNode()`
    return it, so the engine renders zero and φ counts `n_silence`.
  - Until then, keep the app true: the stand-in's live voice is muted by writing its level knob to 0 (or
    the chain is compiled with the hole's input gained to 0), and the belief row reads "no guess while a
    socket is empty" instead of scoring the saw.
  - Add a spec: unplug a source with a note held and assert that the live peak is under −60 dBFS within
    100 ms.
- **Effort** M (Rust + JS) · **confidence** high.

### PA-03 · "Bypass" takes the module out instead of switching it off in place · **P1** · consistency, understandability
- **Evidence.**
  - `D/vp-change-01-ctx.jpg`: the ⋯ menu offers *extract to HELD*, *bypass* and *delete*, and all three
    remove the plate.
  - `D/vp-change-03-held1.jpg`: after bypass the CHORUS plate is gone, "HELD · CHORUS BYPASSED" appears,
    the frame shrinks by 53 px and every plate moves. Re-engaging it means a drag back from HELD or the
    toast's "SWITCH IT BACK IN" within 7 s.
  - Code: `bypassModule` (11119) is a client-side tree rewrite. Its own comment calls a uid side map "the
    phase-2 version" (11117), and the plate well is "where bypass and solo go when they land" (8094).
    Bypassing a binary also takes its second branch into HELD (11143).
  - Bypass also marks the patch "(edited)", re-vets it, moves the belief and lights COMMIT.
- **What the player experiences:** "Does the chorus help?" is the most common patching question, and on
  every hardware or DAW rack it's a single toggle, pressed repeatedly while playing. Here each press
  restructures the patch, rearranges the screen and costs a drag.
- **Principle:** match the musician's model (one concept, one behaviour); undo-able ≠ toggle-able.
- **Recommendation:**
  - Put a **BYP** latch in each plate's control well (the pocket at 8089 is already sized for it), next to
    ⋯ and ▢. Also bind the key `b` on a focused plate.
  - Bypassed means: the plate stays where it is at 45 % opacity with "BYPASSED" silkscreened across it, a
    straight green cable is drawn across it, and the voices cross-fade the module out in 10 ms.
  - It is a live parameter (a per-uid bypass flag in the engine's compile), not a structural rewrite. It
    doesn't enter HELD. It does count as an edit for commit (a bypassed module is committed as removed), and
    the belief row says "re-measuring" as for a knob.
  - Keep "extract to HELD" and "delete" in ⋯, and move bypass out of ⋯.
- **Effort** M–L (engine flag + compile) · **confidence** high.

### PA-04 · HELD: the word, the gesture and the place · **P1** · consistency, accessibility
- **Evidence.**
  - The tray label "held" (index.html:477) sits one row above the dock's **HOLD** button (vp-change-06),
    and the CHANGELOG uses "held notes" for the keys. The code calls it the "shelf" (640, 13279).
  - Re-inserting works only by press-dragging the 13 px `.t-jack` ring (style.css:2665–2672; `renderTray`
    13233–13299). There's no click-to-arm and no keyboard route.
  - The node bank's primary gesture is arm-and-place, chosen because "unlike a 6px drop target it cannot
    miss" (13285–13290).
  - HELD appears as a new row and takes 53 px from the rack (vp-change-01 → 03).
- **What the player experiences:** "HELD" reads as "notes held" or "on hold". Getting a module back means
  aiming a 13 px ring. Keyboard users can't get it back at all, except through ⌘Z.
- **Principle:** one concept, one gesture (the catalogue and the shelf are both "things to place"). Keyboard
  parity. Nothing resizes under the hands.
- **Recommendation:**
  - Rename it **SET ASIDE**, with the empty hint: "unplugged, bypassed or deleted modules wait here".
  - Make each chip arm-and-place exactly like a catalogue entry: click or Enter arms it, sockets light, ↑↓
    walk them, Enter places, Esc puts it down. Keep the drag as the expert path.
  - Move the section to the top of the node bank rail ("SET ASIDE · 2"), above IN THIS PATCH, so it never
    takes the rack's height. The collapsed rail already shows the count (index.html:488–490).
- **Effort** M · **confidence** high.

### PA-05 · Commit doesn't keep your version: it renames it and files it where it can be evicted · **P1** · understandability
- **Evidence.**
  - `D/vp-keep-04-toast.jpg`: after the heard duel the header changes from "Glass Pad (edited)" to
    **"Soft Drone"**. `vp-keep-05/06`: the second commit is "Soft Drone 2".
  - The toasts say "committed as patch #51 … The patch it liked least was retired to make room". The header
    hides ids as "engine bookkeeping" (`renderSubject` 7753–7756), yet the toast speaks in them.
  - The bank still highlights "Glass Pad IN BANK" under PRESETS, and "3/10 saved" doesn't change
    (vp-keep-06).
  - `edit_commit` (crates/auracle-wasm/src/lib.rs:1835) inserts a pool candidate and doesn't pin it. Per
    bank.md:18/60 only MY PATCHES is "never evicted".
  - The film's chapter asks "How do I keep my version?" and answers "Commit".
- **What the player experiences:** they commit to *keep* their tweak and it disappears under a name the
  machine chose, into a list they aren't looking at. A later generation can evict it.
- **Principle:** labels say what things do. The result should be visible where the player looks. Their
  authorship should be respected.
- **Recommendation:**
  - Rename the button **KEEP AS NEW**.
  - On landing, save (pin) the child into MY PATCHES by default and name it after its parent ("Glass Pad
    ✎", then "Glass Pad ✎2"), not the auto-namer.
  - Toast: "Kept as **Glass Pad ✎** in MY PATCHES — Glass Pad is unchanged. [open the original]".
  - Switch the bank to MY PATCHES and scroll to the row.
  - If the pin cap is reached, say so in the toast rather than silently leaving it unpinned.
- **Effort** M · **confidence** high (behaviour), medium (eviction risk is by rule, not observed).

### PA-06 · The commit duel: Esc commits, the "blind" test is labelled, and one tick silently changes every later commit · **P1** · understandability, quality of the signal
- **Evidence.**
  - `D/vp-keep-01-card.jpg` hint "1 / 2 play · ← → pick · esc skip". Esc → `cd-skip` → `sendCommit("none")`
    (12178–12196), so **Esc commits**, and nothing cancels.
  - Sides are shuffled "because position bias is real" (12139), but each is titled "your edit" / "the
    original" (12146).
  - `#improve-check` is read once (12099) and never cleared: vp-keep-06 and vp-together-05 show it still
    ticked after the commit. Every later COMMIT, and every ⚡ on an edited patch (12202–12215), becomes a
    `self_edited` claim with no duel.
  - ⚡ on an edited patch opens this modal without warning.
  - Both waveforms look identical for a cutoff edit (vp-keep-01), and the keys are dimmed and captured.
- **What the player experiences:** Esc means "never mind" everywhere else, and here it commits. The
  "comparison" tells them which one is theirs. Ticking the box once turns off the heard comparison for the
  rest of the session without a word.
- **Principle:** consistent keys (Esc = cancel), honest measurement, no hidden modes.
- **Recommendation:**
  - Esc = **cancel** (nothing committed, back to the bench). Add a visible "keep without comparing" button.
  - Label the sides **A / B** and reveal after the pick ("B was your edit — taught").
  - **Space toggles A↔B at the playhead**: one buffer plays, and switching is position-preserving with a
    20 ms cross-fade, so a comparison takes about 3 s, not 10 s.
  - Replace the sticky checkbox with a one-shot split button: **KEEP AS NEW ▾ → "…and mine is better"**.
  - Drop the waveform thumbnails, or show a spectrum difference.
- **Effort** M · **confidence** high.

### PA-07 · ⚡ evolve from this: 23 s with no progress or cancel, and the engine is deaf meanwhile · **P1** · responsiveness
- **Evidence.**
  - `D/vp-lock.json`: click at 10.43, then `benched` at 33.48 = **23.05 s** on a quiet machine. The film
    cuts the wait.
  - `refine_from` is one synchronous engine call inside `beginLongOp` (worker.js:1571–1586), and
    worker.js:40–50: "For their whole duration this worker services no messages at all".
  - Knob sound still works (`live.param`), but bypass, place, unplug, the belief, previews and ▶ all wait
    for up to 23 s.
  - Feedback is one toast, "⚡ evolving around the locked controls…" (12041), plus the wordmark lamp.
- **What the player experiences:** they press ⚡ and keep playing, and nothing on screen says how long it
  will take or whether it's working. A structural edit made meanwhile hangs with "1 edit waiting".
- **Principle:** long work shows progress, can be cancelled, and never blocks the player.
- **Recommendation:**
  - Run ⚡ as a single walk job on the render farm. RFC-001 names this exact path ("`refine_from` … can use
    the same job path for a single job on a farm worker", proposals/001:146).
  - The ⚡ button becomes its own progress control: "⚡ breeding · 18/48 steps · ✕", with the fill growing
    and ✕ cancelling.
  - When the child lands, show "Soft Wash 3 is on the bench · ⇄ hear the parent" (a one-key A/B against
    the seed).
- **Effort** M–L · **confidence** high.

### PA-08 · Amber means five things · **P1** · consistency
- **Evidence.** The law in rack.md is "Green is sound. Amber is the model's mind, and modulation", but
  amber also paints:
  - *your* locks: dots, dashed rings and a filled ▢ (vp-lock-02);
  - destructive "replaces" sockets (vp-add-08);
  - PERFORM ghosts and readouts (PA-01);
  - "BYPASSED" in HELD (vp-change-03);
  - the duel's "THIS ONE" (vp-keep-01);
  - the step bars (vp-steps-03).

  The code even hides unlocked dots to avoid "competing with the amber-means-the-model law" (8481–8483).
- **What the player experiences:** after ⚡ they can't tell "the model changed this" from "I locked this"
  from "this is modulated" (vp-lock-03: the locked chorus and the LFO's cable share one colour).
- **Principle:** one colour, one meaning.
- **Recommendation:**
  - Keep amber for the model and modulation only.
  - Locks go to silk: neutral panel ink, a solid pin glyph and a hatched halo. The halo stays, with the
    `--silk` token.
  - "Replaces" sockets use `--led-red` rings with "REPLACES …" in red silk, because destructive is red
    elsewhere (the delete dot in ⋯).
  - BYPASSED uses silk-dim, and the duel's picks use the neutral `hw-btn`.
  - Add a legend row to the node bank's existing "audio / modulation" key (vp-together-05): "▪ locked".
- **Effort** S–M · **confidence** medium (design judgement; the pieces are all tokens).

### PA-09 · The header offers two "breed" actions in amber, and ⚡'s ceiling is 1,500 px away · **P2** · understandability, hierarchy
- **Evidence.**
  - Every still: "It's learned something. Breed a generation ▸" (amber italic chip, which goes to EVOLVE
    and breeds the *pool*) beside the patch name, and "⚡ EVOLVE FROM THIS" (amber, breeds *this* patch)
    on the same row.
  - `vp-lock-03-subject.jpg`: "6/6 depth" in red at x≈1850 on the belief row, while ⚡ sits at x≈1830 two
    rows up with no mention of it.
- **What the player experiences:** "Which one do I press?" Then the next ⚡ on the child can't grow, and
  they don't see why.
- **Principle:** one primary action per view (ui-hierarchy "three levels"). A caveat sits beside the act it
  qualifies.
- **Recommendation:**
  - In PATCH, the next-step chip speaks about this patch ("turn a knob · lock what you love · ⚡") or folds
    to a grey "EVOLVE ▸" link.
  - Only ⚡ is amber and filled.
  - Show the budget as ⚡'s sub-caption when it's close ("no room to grow · 6/6 depth") and in its tooltip.
- **Effort** S · **confidence** high.

### PA-10 · The model's guess mixes scales and flickers on every turn · **P2** · understandability
- **Evidence.**
  - Every still: "MODEL'S GUESS 0.39 · slow motion −0.13 · pulsing −0.10 · LFO mods −0.09 in your 1st
    style". The headline is `sq(u)`, a logistic (4839, 5219). The contributions are raw utility units, and
    the tooltip admits it (4861).
  - "(was 0.39) ▲" shows for a 0.005 move (vp-add-07: "0.39 (was 0.39) ▼").
  - "· re-measuring…" appears on every turn and lasts 0.7–1.1 s (vp-change `ready2`/`ready3`/`ready4`).
- **What the player experiences:** 0.39 of what? Is −0.13 a lot? The number and its reasons can't be added
  up, and "(was 0.39) ▼" contradicts itself.
- **Principle:** the model's reasoning should be legible, in one unit.
- **Recommendation:**
  - Copy: "MODEL'S GUESS **39 %** likely to beat a typical patch · held back by *slow motion*, *pulsing*,
    *LFO mods* · your 1st style", with the numbers on hover.
  - Show "was" only when the printed digits differ.
  - Replace "re-measuring…" with a dimmed row (opacity 0.5) and no text change when it lasts under 1.5 s.
- **Effort** S · **confidence** medium.

### PA-11 · Placement says one thing three times, in statistics · **P2** · consistency, understandability
- **Evidence.**
  - `D/vp-add-04-status.jpg`: the rack chip "INSERT AFTER FILTER no lean −0.06 ± 0.37 esc ×", the spec
    strip "delay IN HAND · the model has no lean here (−0.06 ± 0.37, straddling zero) WHAT, NOT WHERE ·
    hold a socket, or ▶ · 3 sockets lit · click one, or esc to put it down", and the node-bank footer
    "INSERT DELAY AFTER FILTER · click to place · esc to put it down · no lean −0.06 ± 0.37".
  - The price is identical at every socket by construction (14145–14150), yet it is pinned to the socket.
  - vp-add-08: "not priced — this takes modules out too".
- **What the player experiences:** a lot of reading at the moment of aiming, and a number that *looks* like
  it's about the socket but isn't.
- **Principle:** one place per statement. Level-3 math behind disclosure.
- **Recommendation:**
  - The socket chip says only the verb: "insert after filter · click".
  - The strip says the price once, in words: "the model: no lean on delays (?)". The "?" opens
    `priceWhatNotWhere`.
  - Remove the node-bank footer while armed.
  - Say "rest here to render" instead of "hold a socket" (which reads as press-and-hold).
- **Effort** S · **confidence** high.

### PA-12 · The placement preview is hard to find and heard away from the hands · **P2** · discoverability, parity
- **Evidence.**
  - Dwell renders without playing (`previewDwell`, 14477; `PREVIEW_DWELL_MS` 600, 14317). ▶ is on the strip
    about 500 px below the aimed socket (vp-add-05).
  - The render is 2 s of the phrase's first note, not the chord being played.
  - The keyboard socket walk (`nbArmedKeys`, 15749) never starts a render and has no play key.
- **What the player experiences:** "rest on a socket for a moment" isn't discoverable, and when it works you
  still have to travel to ▶. Meanwhile "place, play, ⌘Z" is faster, so the feature goes unused.
- **Principle:** progressive disclosure should sit where the eye already is. Keyboard parity.
- **Recommendation:**
  - Draw a ▶ at the ghost plate's top-left corner (it's already drawn at the socket).
  - **Space** while armed plays the aimed socket's render. The keyboard walk starts the same 600 ms dwell.
  - Later: while armed and aimed, the keys play the bench with the module spliced (live preview), with the
    chip line "keys play it spliced in · click to keep".
- **Effort** S (▶ + Space), L (live splice) · **confidence** high.

### PA-13 · The camera re-fits after every structural edit · **P2** · quality, motion
- **Evidence.**
  - FILTER's top-left moves (702, 222) → (660, 272) → (600, 251), and its width 316 → 317 → 348 px, across
    `vp-change-01`, `-03` and `-06`.
  - Placing a delay shrinks every plate (vp-add-06/07). A 9-module ⚡ child re-zooms the whole rack
    (vp-lock-03).
- **What the player experiences:** the knob they were about to reach moves while they play.
- **Principle:** nothing moves under the hands. Motion should explain, not relocate.
- **Recommendation:**
  - After a structural edit, keep `view.zoom` and pan so that the edited plate's neighbour stays at its
    screen position.
  - Re-fit only if content leaves the frame or the zoom would drop below the silk floor, and show "Home ⌂
    fits" in that case.
- **Effort** M · **confidence** medium-high.

### PA-14 · Structural edits have no ≤100 ms acknowledgement · **P2** · responsiveness
- **Evidence (measured).**
  - Bypass: pressed at about 10.30 s (seq 9.78, plus the menu and a 350 ms wait) → gone at 10.92 (≈0.6 s).
  - Unplug: released at about 15.41 → 15.75 (0.34 s).
  - Place: click at 21.52 → 21.98 (0.46 s).
  - ⌘Z: 21.40 → 21.69 (0.29 s).

  Nothing changes on screen in between, except "1 edit waiting" when the lane is busy.
- **What the player experiences:** a beat of "did it take?", which is long enough to click again.
- **Recommendation:** within one frame, dim the affected plate to 40 % and silkscreen the verb ("bypassing…",
  "unplugging…"). An unplugged cable drops at once, and the ghost plate turns solid on a placement click.
  All of it is reverted if the engine refuses.
- **Effort** S–M · **confidence** high.

### PA-15 · At 1280 wide, knob names disappear · **P2** · legibility, density
- **Evidence.**
  - Rack text tokens: labels 10 px, values 11 px, micro 9 px (style.css:108–111). `SILK_FLOOR_PX = 8`
    (main.js, `syncSilkFloor`), so labels drop below 0.8× and jack "in/out" below 0.89×.
  - Glass Pad needs about 910 units of width. At 1280 the canvas between the 250 px bank and the 220–268 px
    node bank is about 720 px, so zoom ≈ 0.75. That shows "1.78 kHz", "Q 0.6", "40 %" with **no names**.
  - Pre-fix capture: `ui-audit/shots/patch-preset__1280x800.png`, where labels printed at 5–7 px. The floor
    now hides them instead.
  - At 1920, a 9-module child sits at about 0.75× too (vp-lock-03).
- **What the player experiences:** a rack of numbers, with "CUTOFF" available only by hovering.
- **Principle:** legible at a glance.
- **Recommendation:**
  - When the fitted zoom is under 0.8×, below 1440 px width, fold the node bank to its 34 px rail by
    default. It opens on `/` or on a click.
  - Replace dropped labels with 3–4-letter abbreviations at value size (CUT, RES, ATK, REL; a table next to
    `KNOB_UNITS`) instead of hiding them.
  - Hide the PRE-MASTER scope while it would cost more than 10 % of the fit.
- **Effort** M · **confidence** medium (zoom is estimated from geometry, not captured post-fix at 1280).

### PA-16 · Steps: no playhead, colliding readouts, tiny bars · **P2** · quality
- **Evidence.**
  - `D/vp-steps-03-rate2.jpg` (crop `ixd/crops/steps.png`): "2.1 Hz sync5 steps", where two readouts run
    together.
  - The bars are about 20×45 px at 1920.
  - No step position is drawn anywhere (no playhead/step-index code in main.js).
- **What the player experiences:** they draw a rhythm without seeing where it is, and at 1280 the bars are
  about 12 px wide.
- **Recommendation:**
  - The worklet posts the current step index at 30 Hz. The current bar's outline lights in phos-a green
    (sound), and the bar number brightens.
  - Put the RATE readout on two lines ("2.1 Hz" / "sync") and reserve width per readout.
  - Give the steps plate its own minimum bar width of 28 units.
- **Effort** M · **confidence** high.

### PA-17 · The spec strip is a permanent instruction row · **P2** · hierarchy
- **Evidence.** Every rest still shows "Point at a module — in the catalogue or in this patch — and this
  strip says what it does, where it can go, and what the model thinks of it." It is a 46 px band. The
  ui-hierarchy spec says "No placeholder rows … appears only when it has content".
- **Recommendation:** at rest the strip shows the patch's own blurb ("Glass Pad — bright, transparent,
  faintly fragile") in the bank's italic, or collapses to 0 and opens over the rack. It already opens
  upward (index.html:437–472). Give the height back to the rack.
- **Effort** S · **confidence** high.

### PA-18 · Locks are invisible until hovered, and counted in addresses · **P2** · discoverability
- **Evidence.**
  - `.lock-dot { opacity: 0 }` until hover or focus (style.css:3601–3603). The dot is r 3.4 units, a 7 px
    target at 1×.
  - The first-visit banner tells you to use "a knob's dot".
  - The header says "8 locked" where the log counts "7 locked marks" (1 knob and 1 module to the player).
    After commit it says "7 locked". The count comes from `wb.locks.size` (7763), which counts addresses.
- **Recommendation:**
  - While ⚡ is hovered or focused, show every dot at 35 % and fill the locked ones, so the "what will stay"
    preview sits where the decision is made.
  - Count in player units: "1 knob · 1 module locked".
- **Effort** S · **confidence** high.

### PA-19 · Commit's receipt queues behind stale edit news · **P2** · consistency (toast lane)
- **Evidence.**
  - `D/vp-together.json` log `claim` at 22.57, 1.3 s after COMMIT (21.26): the visible toast is
    "distortion patched into the wire. TAKE IT OUT +1". The commit's receipt is the "+1", and TAKE IT OUT is
    still offered on a patch that has been committed.
  - apps/web/AGENTS.md: "A confirmation must not queue behind stale news."
- **Recommendation:** a landed commit retires every open edit receipt (the same `replace` key family as
  edits) and takes the floor with "Kept as …" (PA-05).
- **Effort** S · **confidence** high.

### PA-20 · Knob gestures missing: reset, wheel, MIDI · **P3** · feel, parity
- **Evidence.**
  - Drag is 140 px full-scale (700 with Shift; `attachKnobDrag` 11783). There's no double-click or
    Backspace reset.
  - The wheel over a knob pans the rack (9961–9980).
  - `midi.js` has no rack-knob learn (grep: no `data-addr`), although PERFORM's controls have MIDI learn.
- **Recommendation:**
  - Double-click, or Backspace on a focused knob, returns it to the value it loaded with, with the readout
    flashing "↺ 1.78 kHz".
  - Alt+wheel turns the knob under the pointer.
  - Right-click → "map to MIDI CC…" reuses midi.js learn.
- **Effort** S–M · **confidence** high.

### PA-21 · The IN THIS PATCH chips don't point at their plate · **P3** · understandability
- **Evidence.** `D/vp-hear-02…05`: hovering the chorus chip opens its card, but the CHORUS plate is unmarked.
  The chip only jumps on click (`nbRenderInPatch`, 13893).
- **Recommendation:** on hover, add `plate-hot` to the matching `g.mod-group[data-key]` and draw a 1 px
  phos-a outline. Clear it on leave.
- **Effort** S · **confidence** high.

### PA-22 · The toolbar has a hidden 100 px gap, and its layout button names the state · **P3** · polish
- **Evidence.**
  - Every still: an empty run between CHAIN and DETAIL AUTO (about x1300–1405). These are the invisible
    `snap`/`reset` slots (`.tt.held`, index.html:350, 356).
  - "CHAIN" names the current mode and cycles on click.
- **Recommendation:**
  - Render snap/reset only in freeform, or show them disabled with their labels.
  - Label the button "layout: chain ▾" as a three-way menu.
- **Effort** S · **confidence** high.

## 4. Keep (must not be lost)

- **The panel reads as hardware.**
  - Plugs sunk in nuts, green audio and amber modulation, and mod cables ending in named tabs (PITCH,
    CUTOFF, DEPTH).
  - Every knob is in musical units (158 ms, −3.9 dB, Q 0.6).
  - The ENV / OUT plate always sits last.
- **Sound first.** Continuous knobs write straight into the voices on every pointer move, and a held knob
  is never rebuilt. ⌘Z answers for tree, locks, holes and shelf as one transaction and lands in 0.29 s.
- **Arm-and-place.**
  - Legal sockets light and dim everything else.
  - Green insert and the ghost plate at the destination.
  - A modulator dropped on an occupied slot *wraps* ("put slew after the mod env"), and the toast names the
    new chain.
  - The same path works from the keyboard.
- **Search by sound** (`grit` → distortion, bitcrush), the "2 of 42" count, and the group order along the
  signal path.
- **The spec card's honesty:** the "heard" line (chorus: "the pipeline sums L and R") and the four kinds of
  silence.
- **Commit's two-way learning** (an original that wins is recorded). Keep the teaching; fix the frame
  (PA-05/06).
- **Export as a picture that carries the patch.** SVG in 0.09 s, and dropping it back opens the patch.
- **Locks carried through ⚡**, and the child waits in the bank if you kept editing.
- **The silk floor's intent** (don't print ink nobody can read). PA-15 only asks for abbreviations over
  absence.

## 5. Response-time budget

| Gesture | Target | Measured now (source) | Verdict |
|---|---|---|---|
| Knob drag → sound + knob moves | ≤16 ms | synchronous per pointermove (`attachKnobDrag` → `paintKnob` + `live.param`) | ✓ |
| Knob release → belief settled | ≤1 s | 0.71 s (vp-change: path end 8.20 → `ready2` 8.91); ≈0.35 s after last drag (vp-probe3 `settled` 3.25) | ✓ |
| Knob readout after edit | correct, always | **reverts to old value in amber** (PA-01) | ✗ |
| ▶ standard sample → sound | ≤100 ms ack, ≤1 s | lit and playing ≤0.25 s (vp-hear: click 8.99, `playing` 9.24) | ✓ |
| Arm a module → sockets lit | ≤100 ms | lit by the +300 ms still (vp-add-03); not isolated | ✓? |
| Rest on socket → preview rendered | ≤1 s | 600 ms dwell + render; ready by ▶ (vp-add) | ✓ |
| Preview ▶ → sound | ≤100 ms | playing at +0.6 s log (vp-add `pv` 19.38 vs 18.66 incl. wait) | ~ |
| Place module → in the rack | ≤100 ms ack, ≤1 s | 0.46 s, no interim ack (21.52 → 21.98) | ack ✗ / result ✓ |
| Bypass (menu click) → gone | ≤100 ms ack, ≤1 s | ≈0.6 s (≈10.30 → 10.92); belief +0.94 s | ack ✗ / result ✓ |
| Unplug (release) → empty socket | ≤100 ms ack | 0.34 s (15.41 → 15.75); belief +1.1 s | ack ✗ / result ✓ |
| ⌘Z → restored | ≤300 ms | 0.29 s (21.40 → 21.69) | ✓ |
| COMMIT → duel shown | ≤300 ms | 0.55 s (6.96 → 7.51) | ~ |
| Pick in duel → receipt | ≤300 ms | ≤0.6 s (17.12 → toast by 17.72) | ~ |
| ⚡ evolve from this → child | progress ≤1 s, cancel | **23.05 s**, no progress, no cancel, worker blocked (10.43 → 33.48) | ✗ |
| SYNC → RATE shows division | ≤300 ms | ≤0.74 s (15.41 → logged 16.15, a poll) | ✓? |
| Export JSON (from ⋯) | ≤1 s | ≈1.0 s incl. opening the menu (4.48 → download 5.47) | ✓ |
| Export SVG (EXPORT pressed) | ≤1 s | 0.09 s (9.19 → 9.28) | ✓ |
| Drop a patch file → opened | ≤100 ms ack, ≤1 s | 2.3 s, no "opening…" ack (10.31 → 12.62) | ✗ |
