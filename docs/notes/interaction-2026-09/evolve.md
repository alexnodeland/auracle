# EVOLVE — interaction design review (EV)

Reviewer's scope: the duel (A/B cards, ▶ SAMPLE, ⌖ BENCH, CHOOSE), the teaching meter and pips, the
forecast line and the dealing rule, skip ↻, "it just learned", EVOLVE POOL (wait, progress, result,
children), the lineage strip, and the bank as used from EVOLVE (▶, stars, save, cut).
Evidence: `www/video/out/view-evolve/dry/*.jpg|json` (two full rehearsals, `dry.log`), the film's
`script.json`/`storyboard.md`, `www/docs/src/views/evolve.md`, and `apps/web/{main.js,worker.js,index.html,style.css}`.
Stills are 1920×1080. The finished film `view-evolve.mp4` had not been rendered when this was written
(`out/view-evolve/` holds only `dry/`, `shots/`, `voice/`).

## 1. Summary

1. **The pick loop works well until a generation runs, and then it stops.** Deals take ≤ 0.4 s and the vote is acknowledged in the same frame. But EVOLVE POOL holds the engine thread for 103–191 s, measured over four rehearsal runs. During that time a pick waits up to one walk (about 17 s on average) for its next pair, and then possibly another walk for that pair's audio. A skip leaves the old pair on screen with buttons that look live but do nothing.
2. **What a pick teaches is not readable where it happens.** The forecast is the payoff of each pick, but it is 10 px, names neither patch, sits away from the pair it describes, and its bands are uneven. "● it just learned" fires when the refit is *sent*, not when it finishes. During a generation that can be minutes before anything has been learned.
3. **Undo is uneven across EVOLVE's actions.** A pick can be undone for 7 s, except the sixth. A cut can be undone from its toast only. A star cannot be undone. ⌘Z with nothing to undo falls through to an undo of a PATCH edit the player cannot see.
4. **The bank does not make protection visible.** A saved row differs from an unsaved one only by a 2 px rail and a slightly brighter floppy icon. Patch names the player chose are painted amber, which reads as "special". Rows re-sort under the pointer after a star or a save. Retired patches are counted but never named and cannot be brought back. A save made during a generation can arrive after the walk has already retired that patch.
5. **Strengths to keep:** an undo window that holds the vote rather than logging it and then compensating; honest refine outcomes; a truthful statement of how pairs are dealt; the pending-scope sweep; controls that go inert while a pair is dealt; lineage written in real units. Card-click to live took 0.12 s.

## 2. Flows walked

**F1 · Arriving (after the warm start, 18 picks).** `ve-open-00-start.jpg`: the meter reads "18 picks in. Every 6 it redraws your taste map." with **six dark pips**. That is honest but reads as "nothing yet". Two huge waveforms (≈790×600 px each) dominate the view. The deal rule "◇ random pair — a fair test" and **skip ↻** are 10 px mono in the middle of the bar. EVOLVE POOL is amber, top right, and already enabled. *Friction:* the eye goes to the scopes, and nothing on screen says what to press first except the small `1`/`2`/`←`/`→` kbd hints inside the buttons.

**F2 · One duel by ear.** `1` plays A's 5 s phrase and `2` plays B's, so there is 10 s of serial listening before an informed pick. `→` flashes B's name. A toast "Picked Warm Wash over Soft Stab. NOT WHAT I MEANT" appears over B's waveform tail. The forecast "Toss-up — that one taught it the most. 53%" appears top centre, and the next pair slides in within ≤ 0.41 s (`deal ms` 410–434 against a 400 ms probe floor, all shots). *Friction:* the forecast names neither patch and is shown beside the **new** pair (`ve-open-01-pred.jpg`). The toast covers the release segment of B's waveform, the part that tells patches apart most. There is no playhead, so there is no way to line up "the stab" in A against "the stab" in B.

**F3 · A close call: play it yourself.** Clicking card A puts it on the keys in 0.12 s (`ve-play` stamps liveA 5.18 s after the click at 5.06 s). The only sign is a faint green border (`.duel-card.live-sel`). After the pick, the keys **stay on the candidate from the old pair** (`ve-play-01-pred.jpg`: bottom right reads "Fat Key" while the cards show Soft Stab | Soft Pad). The patch that was on the keys before, Sea Change, is not given back. *Friction:* the keys have been changed and nothing says so.

**F4 · Can't decide: skip.** skip ↻ is the smallest button in the bar, and it has no key. A skip gives no acknowledgement beyond the new pair (0.5 s, `ve-fair` fair5). During a generation the new pair takes up to a whole walk, while the old pair keeps looking live (see EV-01).

**F5 · The sixth pick.** The pips fill amber, the bar glows, and the copy reads "● it just learned — see what changed ▸" 0.3 s after the pick (`ve-meter` stamp learned 17.28 s against the pick at 16.97 s, `ve-meter-02-copy.jpg`). After 3.2 s the takeover and the link disappear on a timer. In the first full rehearsal the takeover did not appear within 5 s at all (`dry.log`: "ve-meter: until @ meter4:sixth+0.5 … Timeout 5000ms"). The sixth pick's toast reads **"IN THE LOG"** at once, with no undo (`ve-meter-02-copy.jpg`).

**F6 · Undo a mistaken pick.** This works within 7 s via the toast or ⌘Z, provided another pick has not been made in between. It does not work for the sixth pick. After any of those windows has closed, ⌘Z in EVOLVE undoes the last knob edit on the PATCH bench instead (EV-03).

**F7 · EVOLVE POOL.** On press, within ≤ 0.04 s: the button dims to "BREEDING 1/10…" and a toast reads "breeding a generation toward your taste…" (`ve-breed-01-evolve.jpg`). The toast leaves after 4.2 s. For the rest of the wait the only progress indicator is the dim button text, which advances about every 17–19 s. There is no ETA and no cancel, and the bank does not change. The generation ended after 191 s (`ve-breed` until #evolve-btn took 191 s; the rhythm run took 165 s; the earlier run took 157 s and 103 s). Then ten **NEW** ⚡ rows are scattered through the ranked list, the toast reads "Gen 1: 10 new patches in the bank. The 10 patches it liked least were retired to make room.", and three lineage lines about `#9 → #59` appear. *Friction:* the wait is long and unshaped. The result does not say which patches are new in words the player can find (#ids), or which ones were retired. The first obvious "hear them" gesture, clicking the row, leaves EVOLVE for PATCH (`ve-rhythm-01-child.jpg`).

**F8 · Keep a sound from the rail.** ▶ plays (no pending state). ☆ → 4★ gives the toast "Noisy Pad rated 4★", which does not say that it teaches or that it does not protect. Save gives "Saved Noisy Pad — it won't be replaced. 4/10 slots used." After the save the row **moved from first to eighth** and its prediction fell from 76% to 68% (`ve-keep-02-toast1.jpg` → `ve-keep-04-toast2.jpg`). Its name stayed white, while the warm-start saves Pump Room and Glass Rain show amber names. Cut appears on hover and gives "Cut Soft Wash #9. UNDO", which shows an id the rows hide. PICKS went 20 → 21 (star) → 22 (cut), while the pips stayed at 2 (`ve-keep-*`, header crops).

**F9 · The working rhythm (film chapter 08).** Four quick duels (1 at +0 s, 2 at +0.7 s, pick at +1.4 s: B is cut off each time). Then EVOLVE POOL, and a 165 s wait that the film cuts over. Then click a new row, which switches the view to PATCH. Then save, then go back to EVOLVE. *Friction:* this is the loop the guide recommends, and it leaves EVOLVE twice and waits minutes once.

## 3. Findings (ranked)

### EV-01 · During a generation the duel stops being dealt, and a skip leaves a pair whose buttons do nothing — **P0** · responsiveness
- **Evidence:** `worker.js:865–871` breeds one seed per `engine.refine_seed()` call and serves the `now` lane only in `breathe()` between seeds (`worker.js:983–986`). Measured generations: 191 s, 165 s, 157 s, 103 s for 10 seeds (`ve-breed.json` late `until #evolve-btn` took 191; `ve-rhythm.json` took 165.25; `dry.log` first run bred at 162.8 and 116.5), which is **10–19 s per seed**. After a pick, `choose()` sets `dealing` and disables the controls (`main.js:5086–5089`); the deal waits for the next seed boundary, and the pair's `render` requests, sent 180 ms after the deal lands (`RENDER_SETTLE_MS`, `main.js:4492`), wait for the one after. `$("skip-duel").onclick` only sets `currentDuel = null` and sends `duel` (`main.js:5158–5161`). It does not set `dealing` or disable anything, so ←/→ hit `if (!currentDuel) return` (`main.js:5046`) and are dropped silently while the old pair looks live. The guide promises "a pick is answered between one seed and the next" (`evolve.md` § EVOLVE POOL), which is technically true.
- **What the player experiences:** they press EVOLVE POOL and keep picking, as the guide's "working rhythm" suggests. Each pick greys the cards out for about 5–19 s, and ▶ SAMPLE on the new pair sweeps "rendering…" for up to another seed. A skip freezes the loop outright, with no visible state.
- **Principle:** long work never blocks the player's main loop; an inert control must look inert and say why.
- **Recommendation:**
  1. **Deal ahead.** Keep one pair *queued* with its two buffers rendered while the current pair is on the table. Under `Acquisition::Random` the next pair does not depend on the pick. A pick or a skip then swaps it in at 0 ms, and `duel` is requested again in the background. Under `bald`/`thompson`, deal ahead against the current posterior; the model already tolerates lag (comment at `main.js:5093`).
  2. When RFC-001 lands (walks on the farm, engine worker free), test that a pick mid-generation deals within 100 ms (`responsive.spec.js`).
  3. Until then, skip must set `dealing = true` and disable controls like a vote does. While `dealing` lasts more than 300 ms, write on the dimmed cards "dealing — the engine is breeding (seed 4/10)".
- **Effort:** M (deal-ahead), S (skip inert). **Confidence:** high.

### EV-02 · ⌘Z in EVOLVE undoes an invisible PATCH edit whenever no vote is pending, and the sixth pick is never undoable — **P0** · consistency / understandability
- **Evidence:** `main.js:3819–3828`: in EVOLVE, `retractVote()` runs first; if it returns false, the handler **falls through to `doUndo()`**, the workbench undo. `settleFit()` commits the sixth pick at once (`main.js:5118–5126`, `commitPendingVote()`), and `retireToastUndo` relabels its button "in the log" (`main.js:2709–2715`; seen in `ve-meter-02-copy.jpg`: "Picked Warm Wash over Noisy Stab. IN THE LOG"). The guide says a vote "for seven seconds … can still be taken back, with ⌘Z" (`evolve.md` § The duel). Stars have no undo at all (`rateRow`, `main.js:5698–5721`). Cut has a toast undo but no ⌘Z.
- **What the player experiences:** they pick, realise it was wrong, and press ⌘Z. After the sixth pick, or after 7 s, the pick stays, and a knob edit made minutes ago in PATCH (possibly on a duel candidate they clicked) is silently reverted.
- **Principle:** one gesture, one scope; undo acts on what the player can see; a guide promise holds every time.
- **Recommendation:** In EVOLVE, ⌘Z acts on **EVOLVE's own history only**: the last pick, cut, star or save, most recent first, each within its 7 s window. With nothing to undo, show the toast "nothing to undo here — PATCH edits undo in PATCH" and leave the bench alone. For the sixth pick, send the fit **7 s after** the sixth pick, or when the next pick commits it, whichever comes first. Keep the pips full and the copy "● learning from your last 6…" during that time, so the undo window is real. Give stars the same 7 s held-observation undo as cut ("Noisy Pad rated 4★ · undo").
- **Effort:** S–M. **Confidence:** high.

### EV-03 · "● it just learned" is shown when the refit is *sent*; during a generation that is minutes before it happens — **P1** · understandability / truth
- **Evidence:** `settleFit()` calls `teachLearned()` in the same breath as `send({type:"fit"})` (`main.js:5118–5130`). `fit` is in the `later` lane (`worker.js` `laneOf`), which waits behind a running generation ("a refit waits for the generation", `worker.js:1456–1468`). The takeover ends on a 3.2 s timer (`main.js:2336–2351`), not on `fitted` (`main.js:1355–1370`). The fit itself takes ≈2.7 s (comment at `main.js:5075–5080`). In one of two rehearsals the takeover did not appear within 5 s of the sixth pick (`dry.log`, ve-meter error): `settleFit` returns early while a fit is already running (`if (!fitDue || fitting) return`).
- **What the player experiences:** "it just learned — see what changed ▸". They click and see the **old** map, and during a generation the redraw arrives up to three minutes later with no announcement. Sometimes the moment comes late with no link to the pick that caused it.
- **Principle:** say what is true; the system state (working / done) must be visible.
- **Recommendation:** two phases, both in the meter.
  - (a) On send: pips pulse amber, copy "● learning from your last 6 picks…". During a generation the copy is "● it will learn from these 6 when breeding finishes".
  - (b) On `fitted`: "● it just learned — see what changed ▸". This stays until the next pick, with no timer. Add one clause of what moved when the engine can say it (for example "a second style appeared", using the milestones idea in `musical-instrument-review.md` §4.2).
  - Log the `fitted` time so the film can stamp it.
- **Effort:** S. **Confidence:** high.

### EV-04 · The forecast, the payoff of every pick, is 10 px, unnamed, on the wrong pair, and its bands are uneven — **P1** · understandability
- **Evidence:** `#duel-pred` uses `font-size: var(--t-micro)` (10 px, `style.css:3057`) beside a 17 px italic meter copy. It is shown after the pick and is still standing when the **next** pair lands (`PRED_HOLD_MS 3200`, `main.js:4636–4659`; `ve-open-01-pred.jpg` shows "Toss-up — that one taught it the most. 53%" over Warm Bell | Warm Drone, although the pick was Warm Wash over Soft Stab). The bands are ≥ 0.65 "Expected", ≤ 0.45 "⚡ Surprise — it had this backwards", otherwise "Toss-up". So 44% reads as "backwards" and 56% as a toss-up (`ve-meter` d1: "⚡ Surprise — it had this backwards. 42%"). "Toss-up — that one taught it the most" is not true next to a surprise: a Bradley–Terry update scales with |y − p|, which is larger for a surprise. The pick toast (bottom right) and the forecast (top centre) are two surfaces for one event.
- **What the player experiences:** a small grey line with a percentage of nothing in particular, over two sounds it does not describe.
- **Principle:** feedback sits at the point of action and names its object; one event, one receipt.
- **Recommendation:** merge the pick toast and the forecast into one receipt in the meter, left of the pips, at `--t-body` or larger:
  - "**You picked Warm Wash** over Soft Stab · it guessed 74% — *it's getting you*"
  - "… it guessed 26% — *surprise: it had this backwards*"
  - "… it guessed 53% — *a coin flip*"

  Use symmetric bands (≥ 0.65 / ≤ 0.35). Drop "taught it the most". Colour each lit **pip** by the outcome (green hit, amber surprise, dim toss-up), with a hover tooltip carrying the receipt. The row of six then becomes a readable history of what the last six picks taught. Keep "not what I meant" on the receipt. The toast lane stays for other news.
- **Effort:** M. **Confidence:** high.

### EV-05 · The generation wait is unshaped: a 4 s toast, then a dim 10-seed counter for minutes; no ETA, no cancel, no children until the end — **P1** · responsiveness / understandability
- **Evidence:** `main.js:5162–5167` (a toast at 4.2 s TTL, `main.js:2596`) and `main.js:1372–1375` (`breeding ${done+1}/${total}…` in the button). `ve-breed-01-evolve.jpg`: "BREEDING 1/10…" in grey on grey, the only indicator after the toast. Views are posted only at the end (`worker.js:875`), so the bank shows patches that the walks have already retired (each `refine_seed` inserts and evicts as it goes). The result toast does not name the retired patches (`madeRoom`, `main.js:2879`).
- **What the player experiences:** "is it working?" for three minutes. Then ten rows change at once, and some rows they were looking at are gone.
- **Principle:** long work shows progress, estimates, and can be stopped; results arrive where the player will look for them.
- **Recommendation: one presentation that scales from 3 s to 60 s+.** This answers RFC-001 plan step 5: **yes, children appear as they land.**
  - **Model:** the generation is 10 slots filled *in job order* (RFC-001 absorbs in order, so slots never fill out of sequence).
  - **< 400 ms:** only the button's pressed state.
  - **Every generation:** the EVOLVE POOL button turns into its own progress bar (amber fill = children absorbed / 10, label "breeding 3/10"). The wordmark E lights, as today.
  - **Children as they land:** each absorbed child appears at once in a **"new · gen 3" group pinned at the top of the POOL list**, and does not re-sort the ranked rows. Its ⚡ NEW row can be played immediately. Each retiree leaves its row with a 600 ms strike-through fade and goes to a receipts list (EV-07).
  - **When the first child has taken more than 1.5 s** (so the per-walk time predicts a long run): the lineage strip's body becomes the **generation tray**, ten slots filling left to right as "Warm Drone 2 ← Soft Pad". Each slot has ▶, a remaining-time estimate from the running mean ("about 40 s left"), the copy "keep picking — this runs beside you", and **stop after this one**, which keeps the children already absorbed and releases the floor. Show the same progress in PATCH's and PERFORM's header lamp tooltip.
  - **3 s case:** the tray never opens. The button fills in 3 s, the new group appears with one 300 ms glow, and one toast.
  - **Result:** the toast reads "Gen 3: 10 new — 7 closer to your taste, 3 exploring · retired 10 ▸ · hear them ▸". *hear them* starts an audition queue: each child's phrase in bank order, the playing row lit, and any key or pick stops it. The lineage tray then collapses to the lineage lines.
- **Effort:** M (web; progressive views need a `refine_progress` payload with the child and evicted ids). **Confidence:** high on the problem; medium on the retire-as-you-go detail, which comes from `refine_inner` inserting per seed (RFC-001 § Context).

### EV-06 · Bank rows re-sort under the pointer after a star or a save — **P1** · quality / responsiveness
- **Evidence:** `ve-keep-02-toast1.jpg` shows Noisy Pad first at 76%, rated 4★. In `ve-keep-04-toast2.jpg`, after the save, the same row is **eighth**, at 68%, and the pointer now rests over Soft Wash. The film's storyboard works around this ("the rows re-sort as the model takes each answer in, so the callouts point at what stays put"). `renderBank()` rebuilds in rank order on every `views` update (`main.js:5307–5313`).
- **What the player experiences:** they star a row, reach for save or cut on the same row, and hit a different patch. Cut is 7 s-undoable; a mis-starred neighbour is not.
- **Principle:** never move a target under an active pointer; direct manipulation needs stable targets.
- **Recommendation:** freeze the row order while the pointer is inside `#bank-list`, and for 1.5 s after the last click in it. Update % and bars in place, with the changed % flashing once and a ▲/▼ ("68% ▼ from 76%"). When the pointer leaves, animate the re-sort (FLIP, 200 ms; none under `prefers-reduced-motion`). Keep the acted-on row scrolled into view.
- **Effort:** S–M. **Confidence:** high.

### EV-07 · What is protected and what may be replaced is not visible, and losses are counted but never named or reversible — **P1** · understandability / consistency
- **Evidence:**
  - A saved row = `.bank-item.saved { border-left-color: var(--silk) }` (`style.css:517`) plus a floppy that goes silk-dim → silk (`style.css:641`). In `k4` (a crop of `ve-keep-04-toast2.jpg`) a just-saved Noisy Pad is indistinguishable at a glance.
  - User-chosen names are amber (`.bi-name.custom { color: var(--phos-b) }`, `style.css:1659`). In every still, the amber names (Pump Room, Glass Rain, Sea Change) happen to be the warm-start saves, so amber reads as "kept". The model's colour is spent on the player's words.
  - The star tooltip reads "4★ — teaches the model, does not keep the patch", but its toast does not ("Noisy Pad rated 4★", `main.js:5720`).
  - Eviction of a ≥4★ patch raises an alarm **after** the fact (`main.js:2865–2873`).
  - "The 10 patches it liked least were retired" names none, and nothing can be restored.
  - A save sent during a generation is served between seeds, while `refine_seed` may already have evicted the row. The reply is then "#41 isn't in the bank any more — a bred generation replaced it." (`main.js:1976–1980`).
  - The comment at `style.css:626–631` says the save control is "a word, not a glyph"; the code draws a 12 px floppy SVG (`main.js:5207–5213`).
- **What the player experiences:** they cannot answer "which of these are safe?" by scanning. Stars feel protective, and the app says otherwise only after the loss.
- **Principle:** make state visible; consequences before commitment; the colour semantics (amber = the model).
- **Recommendation:**
  1. **Saved** gets a filled floppy plus the word "saved" in `--silk` on the row, a 3 px silk rail, and a silk (not amber) name. Custom names go silk-bright italic, not amber.
  2. **May be retired:** when EVOLVE POOL is hovered or focused, the ten unsaved rows lowest by prediction get a dashed rail and "may be retired" on hover. The engine's rule is the minimum `(has_phi_std, utility)` among unpinned rows, which is computable from `views.ranked`.
  3. **Rated ≥ 4★ but unsaved:** the toast reads "Noisy Pad rated 4★ — that teaches it. It can still be retired · **save it**".
  4. **Retired ▸** in the bank header after a generation opens the last N retirees with ▶ and **bring back** (tombstones: the genome is a few hundred bytes; the idea is from review §4.3).
  5. **Engine:** decide evictions at the **end** of a generation (insert the children, then evict the lowest unpinned). A save made at any point during the run then protects.
- **Effort:** M (web), M (engine, item 5). **Confidence:** high (visuals), medium (the save race).

### EV-08 · Clicking a card silently changes what is on the keys and the bench, and a pick never gives it back; row click and ⌖ BENCH leave EVOLVE — **P1** · consistency
- **Evidence:** `selectDuelSide` calls `openOnBench(id)` (`main.js:4946–4953`), and `choose()` clears `benchBeforeAudition` (`main.js:5050`). The way back (`#pd-back`) exists only on PATCH's strip. `ve-play-01-pred.jpg`: after the pick the keys play "Fat Key" from the previous pair. The live-card indicator is a faint green border only (`style.css:1244`). Clicking a bank row runs `openOnBench` **and** `showView("play")` (`main.js:5395–5400`); `ve-rhythm-01-child.jpg` is PATCH. ⌖ BENCH also switches view (`main.js:11410–11421`).
- **What the player experiences:** "why is my patch different?". A click on a card stays in EVOLVE, a click on a row teleports to PATCH, and both change the patch under the player's hands.
- **Principle:** one gesture, one behaviour across surfaces; side effects stated.
- **Recommendation:**
  - A card that is live shows a green label "♪ on your keys" in its header. The meter shows "keys: Fat Key · ← back to Sea Change" while a detour is active.
  - A pick while auditioning restores the previous patch: "keys back on Sea Change".
  - In EVOLVE, a bank row click **plays it on the keys and stays** (like a card), with a hover "open in PATCH ↗" icon for the explicit jump.
  - Rename ⌖ BENCH to "open in PATCH ↗".
- **Effort:** S–M. **Confidence:** high.

### EV-09 · The listening cost of a duel is 10 s of serial audio, with no instant A/B, no skip key and no hands-free mode — **P1** · responsiveness (rhythm)
- **Evidence:** The duel keys are only `1`, `2`, `←`, `→` (`main.js:3942–3948`). skip has no key, which `musical-instrument-review.md` §4.1 already flagged and is still true. The scopes draw no playhead (no playhead code in `drawWave`), so a segment cannot be lined up. In the film's quick duels B is cut off 0.7 s after A (`ve-rhythm` q1–q4: 1 at +0 s, 2 at +0.7 s, pick at +1.4 s): the fast rhythm is achieved by *not* listening.
- **What the player experiences:** either a slow loop (10–12 s per pick) or picks made on half a phrase.
- **Principle:** the primary signal should cost the least; keyboard parity for the core loop.
- **Recommendation:**
  - **↑ = flip:** while a side plays, switch to the other side *at the same playhead*, crossfaded over 30 ms.
  - **↓ = skip.**
  - Draw a green playhead and four segment ticks (held · stab · dyad · low) under both scopes while ▶ plays.
  - Offer **auto-listen** (⋯ or a meter toggle): on deal, A then B play automatically and the pick keys stay live. This also opens the loop to switch access (review §V).
  - Target: a considered pick in ≤ 6 s.
- **Effort:** M. **Confidence:** high.

### EV-10 · After a generation, "hear the children" has no path in EVOLVE — **P1** · understandability
- **Evidence:** The children are scattered through the ranked list (`ve-breed-02-fresh.jpg`: NEW rows at positions 1, 2, 5, 7, 11, 12). The lineage names `#9 → #59` (`main.js:17460–17470`), while the rows hide ids (`style.css:1666`). The next-step chip "Gen 1 bred new patches — hear them ▸" routes to **TASTE** (`main.js:2386–2388`; seen in PATCH, `ve-rhythm-01-child.jpg`). A row click leaves EVOLVE (EV-08).
- **What the player experiences:** "10 new patches — where, and which is which?".
- **Principle:** a result is delivered where the player will act on it; every reference resolves.
- **Recommendation:** add a "new · gen N" group at the top of POOL (EV-05). Every lineage line uses names ("Soft Pad → **Warm Drone 2**"), and each line is a button that plays the child (▶) and flashes its row. "hear them ▸" (toast and next-step chip) starts the children audition queue in EVOLVE, not TASTE.
- **Effort:** S–M. **Confidence:** high.

### EV-11 · The lineage strip speaks ids, shows 3 of 10 children, and its sparkline is not what the guide says — **P2** · understandability / truth
- **Evidence:** `.slice(-3)` (`main.js:17460`). `ve-breed-02-lineage.jpg`: three dense amber mono lines of about 150 characters each. The sparkline plots `child_utility` per lineage *event* (`main.js:17428–17447`), about 10 points after one generation, while `evolve.md` says "the pool's utility over generations". "Δtaste" is unexplained on screen.
- **What the player experiences:** a wall of amber code about unknown numbers, and a line chart they cannot read.
- **Principle:** descriptions stay true (ADR-004); progressive disclosure.
- **Recommendation:**
  - Default each generation to **one summary line** ("gen 1 · 10 children · 7 liked more, 3 exploring · most common change: longer release"), with ▾ expanding to all ten named lines.
  - Replace "Δtaste +0.06" with "liked +0.06" (the audit's P6 wording).
  - Plot the **pool mean predicted utility per generation** (one point per generation, x labelled gen 0…N), or change the guide to say "each child's predicted score".
- **Effort:** S. **Confidence:** high.

### EV-12 · "Pick" means two things, and one concept has three names — **P2** · consistency
- **Evidence:** PICKS in the menubar counts every observation (`picksTaught`, `main.js:2255–2259`): stars and cuts raise it (20 → 21 → 22 in `ve-keep`), and the warm start's 18. The pips count duel picks only (`duelsSinceFit`), so "4 more picks and it redraws" did not move after a star and a cut. The vocabulary varies: button "CHOOSE A", guide "Vote", toast "Picked", first-run copy "Keep the one you'd reach for" (while "keep" means *save* in the film and Keep is a PERFORM pad). The pool is called "EVOLUTION 40" (bank chip), "pool" (EVOLVE POOL, guide) and "bank" ("10 new patches in the bank"). The header "EVOLUTION — what each generation actually did" reuses the chip's name for something else. Saves appear as "3/10 saved", "MY PATCHES 3" and "4/10 slots used".
- **Principle:** one concept, one word.
- **Recommendation:** the button reads "PICK A ←". The first-run copy becomes "Play both. Pick the one you'd reach for." The menubar reads **ANSWERS** (all teaching signals) and the meter says "picks" for duels only; alternatively, count stars and cuts toward the pips too, as the guide's "every answer counts" implies. Rename the bank chip **POOL**, the toast to "10 new in the pool", and the saves to "3 of 10 saved" everywhere.
- **Effort:** S. **Confidence:** high.

### EV-13 · Keyboard and MIDI parity in EVOLVE — **P2** · accessibility
- **Evidence:** In EVOLVE the key handler `return`s after 1/2/←/→ (`main.js:3942–3948`), so 3/4/5 do nothing and **no bank row can be rated from the keyboard in EVOLVE**, although the help lists "1–5 rate the highlighted bank row". There is no key for skip, ⌖, flip or EVOLVE POOL. `midi.js` has no duel bindings. `#teach-pips` is `aria-hidden` and `#duel-pred` is not `aria-live`.
- **Principle:** keyboard/MIDI/pointer parity for the core loop.
- **Recommendation:**
  - In EVOLVE: ↓ skip, ↑ flip, Shift+1–5 rate the cursor row. Keep `m` for save.
  - MIDI learn for pick A, pick B, skip and flip (notes or CC), through the existing learn flow.
  - Make the merged receipt (EV-04) `aria-live="polite"`.
  - Give the meter `role="status"` and a label ("3 of 6 picks to the next redraw").
- **Effort:** S. **Confidence:** high.

### EV-14 · A cut hides the row but leaves the patch in the pool, where it can be dealt again; the cut toast shows an id — **P2** · consistency / truth
- **Evidence:** `cutRow` adds the id to `cutIds` (UI-only filtering, `main.js:5435–5460`) and sends `record_keep(kept:false)`. `next_duel` does not exclude killed patches (`engine.rs` ~2750 filters only on `phi_std`). The bank chip drops to 39 (`ve-keep-07-toast3.jpg`) while the pool still holds 40. The toast reads "Cut Soft Wash **#9**." (`main.js:5456`); the ids are hidden everywhere else.
- **What the player experiences:** they cut a sound, and minutes later are asked to judge it in a duel.
- **Principle:** an action means what it says everywhere.
- **Recommendation:** exclude cut ids from dealing: pass them with `duel`, or have the engine skip `kept:false` members. Make the toast read "Cut Soft Wash — it won't be dealt again, and it's first to go · undo". If "first to go" is not true, make it true by retiring cut patches first at the next generation.
- **Effort:** S (web filter) / S (engine). **Confidence:** medium (engine dealing checked by grep, not by running).

### EV-15 · The toast lane sits on B's waveform tail — **P2** · quality
- **Evidence:** In every EVOLVE still with a toast (`ve-open-01-pred.jpg`, `ve-fair-01-forecast.jpg`, `ve-keep-04-toast2.jpg`, `ve-breed-05-toast.jpg`), the toast covers the bottom right of `#scope-b`: the C3 release segment, the part of the phrase that distinguishes pads.
- **Principle:** nothing overlays the thing you touch (`ui-hierarchy.md`).
- **Recommendation:** with EV-04 most EVOLVE toasts move into the meter. For the rest, add `.duel-row` to the lane's reserved rects in EVOLVE, so the lane sits in the lineage strip's right half, which is empty whenever the lines are short.
- **Effort:** S. **Confidence:** high.

### EV-16 · The bank ▶ gives no sign while it waits — **P2** · responsiveness
- **Evidence:** `.bi-hear` gets `.playing` only when audio starts (`main.js:5403–5408`, `style.css:616`). There is no pending state, unlike ▶ SAMPLE's sweep and dim (`markScopePending`, `main.js:4531`). During a generation a row ▶ waits up to one seed (10–19 s measured).
- **Principle:** acknowledge within 100 ms.
- **Recommendation:** the `.pending` style, shared with SAMPLE: amber dotted ring plus `aria-busy`. After 1 s during a generation, the tooltip reads "waiting for the breeding step (4/10)".
- **Effort:** S. **Confidence:** high.

### EV-17 · A rating's effect is unexplained, and can look backwards — **P2** · understandability
- **Evidence:** Noisy Pad rated 4★ went from 76% to 68% (`ve-keep-02` → `ve-keep-04`) with no explanation. The toast "Noisy Pad rated 4★" does not say what was taught. "A rating teaches" exists only as a film callout.
- **Principle:** make the model's reasoning legible at the point of action.
- **Recommendation:** the rating receipt says where the prediction went: "Noisy Pad rated 4★ · it had guessed ≈ 4.5★, so it lowered this kind of sound a little". Map the logistic % to its star scale if the model's `Stars` likelihood allows; otherwise use "it now likes this 68% (was 76%)". The row's % flashes ▼.
- **Effort:** S–M. **Confidence:** medium (the reason for the drop is inferred).

### EV-18 · Style badges on the cards are unexplained and rename themselves on the same patch — **P3** · consistency
- **Evidence:** `styleBadge` (`main.js:16795`) has no title. Sea Change reads "sustained, slow swells" (`ve-breed-01-evolve.jpg`), then "slow-blooming sustain" after the generation (`ve-breed-02-fresh.jpg`), then "sustained, slow swells" again (`ve-rhythm-05-end.jpg`). Both cards often carry the same badge (`ve-meter-02-copy.jpg`).
- **Recommendation:** title "the style the model files this under — see TASTE › STYLES". Keep auto-names stable per style across refits unless the style's membership changes by more than half. Hide the badge when both cards share it.
- **Effort:** S. **Confidence:** medium.

### EV-19 · Hierarchy: the scopes take ≈ 60% of the view while the teaching surface is 10 px — **P3** · quality
- **Evidence:** At 1920×1080 each scope is ≈ 790×600 px (`ve-open-00-start.jpg`). The deal rule, skip and forecast are `--t-micro` 10 px (`style.css:3057, 4018`; skip is `.inspect-btn`). The empty-pip state at "18 picks in" is six dark dots.
- **Recommendation:**
  - Cap the scopes at about 45% of the view height, and use the freed band for the receipt (EV-04) and the pip history.
  - Raise skip to a real `hw-btn small` ("skip ↻ ↓").
  - At zero pips after a warm start, show the six pips as "0 of 6", with a subtle outline animation on the first pip.
- **Effort:** S. **Confidence:** medium (a taste judgement from the stills).

### EV-20 · EVOLVE POOL looks ready before it can do anything — **P3** · understandability
- **Evidence:** The button is amber and enabled from the first frame (`ve-point`, 0 picks). A press answers after a round trip: "Nothing to breed toward yet — make a few picks first, then evolve." (`main.js:1398`).
- **Recommendation:** before the first fit, draw it disabled (still focusable), with the caption "after 6 picks" and a tooltip saying why. Enable it with one amber pulse when the first fit lands.
- **Effort:** S. **Confidence:** high.

## 4. Keep

- **The held vote**, which is not logged and then compensated (`main.js:4990–5000`). `replace: "vote"` so the lane names the pick ⌘Z would take back.
- **Controls inert while a pair is dealt**, and a pick deliberately *dropped* rather than queued onto an unseen pair (`main.js:5038–5044`). Keep this, and extend it to skip (EV-01).
- **Deal before fit**: the sixth pick's pair is audible through the refit (`main.js:5086–5093`, `settleFit`).
- **The pending-scope sweep** ("rendering…", amber line, SAMPLE dimmed not disabled; honours reduced motion).
- **Random side assignment** (`main.js:1250`) and **names painted on the deal**.
- **The honest deal-rule line**. The film's "fair test" chapter depends on it.
- **Honest refine outcomes**: "no move was accepted", "outside what evolution can reach", "Nothing to breed toward yet".
- **Evictions reported on every path** (`applyViews`), and the after-the-fact alarm for a high-star loss, until EV-07 makes it unnecessary.
- **Lineage in real units**, and the "exploring" tag for downhill steps.
- **Cut on approach** with `visibility: hidden` (not clickable while invisible); 24 px targets; unrated stars quiet at rest.
- **Save in silk, neither phosphor.** Extend the same principle to custom names (EV-07).
- **Card click to the keys in 0.12 s**, the best hidden feature, as the earlier review said. It only needs to state its side effect (EV-08).

## 5. Response-time budget

| Gesture | Target | Measured now (source) | Verdict |
|---|---|---|---|
| `1`/`2` → sound (buffer ready) | ≤ 50 ms | same frame on a cached buffer (`play` → `playBuffer`, `main.js:3136`) | OK |
| `1`/`2` → sound (new pair, not rendered) | ≤ 300 ms | 180 ms settle + render; during a generation up to one seed, **10–19 s** (`ve-breed` 191 s / 10) | Fails during a generation |
| ←/→ → acknowledgement (name flash, receipt) | ≤ 100 ms | same frame (`choose`, `main.js:5055–5076`) | OK |
| Pick → next pair visible | ≤ 300 ms | ≤ 0.41 s (`deal ms` 410–434, probe floor 400 ms); code notes 17–30 ms | OK (deal-ahead makes it 0) |
| Pick → forecast shown | ≤ 300 ms | ≤ 0.4 s (`ve-meter` d1 at +0.40 s) | OK, but unreadable (EV-04) |
| Pick during a generation → next pair | ≤ 300 ms | up to one seed, 10–19 s, cards at 55% opacity, no words | **Fail** (EV-01) |
| skip → new pair | ≤ 300 ms | ≈ 0.5 s (`ve-fair` fair5 mark +0.5) | OK |
| skip during a generation | ≤ 300 ms, inert state at once | up to one seed; controls look live and do nothing | **Fail** (EV-01) |
| 6th pick → "learning" state | ≤ 100 ms | 0.3 s (stamp `learned` 17.28 vs pick 16.97); once > 5 s (`dry.log`) | Marginal / flaky |
| 6th pick → map actually redrawn | ≤ 3 s, announced | ≈ 2.7 s (code note), not announced; during a generation, minutes | **Fail** (EV-03) |
| Card click → on the keys | ≤ 150 ms | 0.12 s (`ve-play` liveA 5.18 vs click 5.06) | OK |
| EVOLVE POOL → acknowledgement | ≤ 100 ms | ≤ 0.04 s (button + toast, `ve-breed` late) | OK |
| EVOLVE POOL → children | 3 s (RFC-001 target); ≤ 60 s fallback with progress, ETA, cancel | **103–191 s** over four runs; progress = dim "n/10" label | **Fail** today; EV-05 for both cases |
| Bank row ▶ → sound | ≤ 300 ms, pending mark ≤ 100 ms | not stamped; no pending mark; during a generation up to one seed | Fail on acknowledgement (EV-16) |
| Star → receipt | ≤ 100 ms | optimistic, same frame (`rateRow`) | OK (no undo: EV-02) |
| Save → receipt | ≤ 300 ms | waits for the engine reply; during a generation up to one seed, and can lose to an eviction | Fail during a generation (EV-07) |
| Cut → row gone + undo | ≤ 100 ms | same frame, 7 s undo | OK |
| Bank row click → patch on keys | ≤ 300 ms | ≈ 1.7 s right after a generation (`ve-rhythm` seq 178.95 → child 180.70), and a view switch | Slow, and it leaves EVOLVE (EV-08) |
