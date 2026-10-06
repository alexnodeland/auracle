# Test-quality audit: EVOLVE, bank and TASTE browser specs

Area: `tests/web/evolve_*.spec.js`, `bank_*.spec.js`, `taste_*.spec.js`, `faces.spec.js`,
`session_seed.spec.js`, `first_run.spec.js`, `guide_pill.spec.js`, at `main` 42bd322. Read-only:
nothing was run. Timings are CI medians from the three fast-tier runs and the slow run in
the blob reports of CI runs 37383132211, 37379867024 and 37345520856 (fast tier) and 37381447489 (slow tier), merged by title.

Severity follows the rubric mechanically (flimsy, vacuous or an over-claiming title is high), so
the high count is wide. Category 9 (`level`) has no severity of its own: its rows are medium, like
duplicate and cost, except the `pct` helper (low). The evidence column gives the margin or window where that matters, for
triage. "When #137.N lands" means the module that issue proposes does not exist yet, and until it
does the browser spec is the only coverage of that logic.

Lower-level keepers cited below (they exist today):
- Rust, session (`crates/auracle-session/src/lib.rs`):
  - `next_seeds_and_may_replace_are_what_a_generation_does` (:1772, asserts `parents(jobs) == seeds` and the lineage);
  - `may_replace_counts_a_filling_pool_and_passes_over_a_seed_evolving` (:1866);
  - `the_belief_after_a_pick_is_the_reweighted_posterior` (:1639);
  - `a_stopped_generation_keeps_what_it_bred` (:1398);
  - `a_save_made_mid_generation_is_never_retired` (:1485);
  - `a_seed_evolving_is_never_evicted_until_its_walk_lands` (:1525);
  - `a_sound_kept_as_new_is_not_replaced_until_its_first_pick` (:2367);
  - `farm_width_does_not_change_the_pool` (:4212);
  - `a_generation_absorbed_in_any_completion_order_is_the_serial_one` (:1174).
- Rust, farm: `draw_seed_is_pure_and_decorrelated` (`farm.rs:129`).
- Rust, wasm (`crates/auracle-wasm/src/lib.rs`): `belief_is_the_ranked_numbers_and_the_next_seeds` (:4786),
  `model_facts_and_forecasts_are_the_engines` (:3850), `farm_walks_breed_the_serial_generation` (:4728),
  and `tests/boot_agrees.rs`.
- JS units (`apps/web/tests/`):
  - `words.test.mjs`: lineage lines :266, forecast words :126, TAUGHT tooltip :133, generation receipts :151–214, the math :353, REPLAY :374, the counts TASTE and LEARNING say :323;
  - `taste-geom.test.mjs`: pullMark :130–188, forecasts score :256, small-map shading :350, history :281–338;
  - `faces.test.mjs`: whitening :101/:146;
  - `guide.test.mjs`: migration :24/:29;
  - `worker-lanes.test.mjs`: lanes.

## Findings

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| evolve_ahead.spec.js:166,197 | pairs go up in the order they were dealt when a pick lands while the next deal is out | flimsy, duplicate | high | `expect(await pickAndTime(page, "#choose-a")).toBeLessThan(300);`: the exact bound #160 quarantined :75 for (CI measured 346 ms), still in the gate here; budgets.spec.js:188 owns the 0.3 s budget | rewrite: drop the number. The guide promises "at once" (evolve.md:90), so assert that no table deal (`sent:duel`, `ahead: false`) went out between the click and the cards changing (`app.log`), as #160's first option |
| evolve_ahead.spec.js:206,224 | a pick taken back while the next deal is out leaves that pair waiting as the next | flimsy, duplicate | high | `expect(await pickAndTime(page, "#choose-a")).toBeLessThan(300);` twice, in the fast tier; same bound as above | rewrite: as above; :226–227 already asserts the no-deal part, so delete the two bounds |
| evolve_ahead.spec.js:75 | a pick puts the pair dealt ahead on the table at once, sounds and all (@quarantine #160) | flimsy, duplicate | high | `expect(ms).toBeLessThan(300);` … `expect(play).toBeLessThan(150);`: the same numbers as budgets.spec.js:188 "a pick puts the next pair up within 0.3 s, and its ▶ sounds within 0.15 s" | rewrite (the #160 fix): leave the numbers to budgets.spec.js. Keep what only this test checks: ↻ puts up the waiting pair with no table deal, and ⌘Z brings the pick's pair back with the other waiting, both as tap order. Then untag it |
| evolve_ahead.spec.js:124 | a patch cut while its pair waits ahead is never put up | vacuous | high | `const [cut] = (await aheadPairs(app)).pop();` takes the newest ahead reply, and nothing checks that it is still the pair waiting when the cut lands. A refused answer is dealt again (`aheadUsable`), so in that window the test only proves "a cut patch is not dealt", which is evolve_truth:235's claim. The window is narrow | rewrite: before the cut, assert the cut id is in the pair waiting (newest usable ahead pair, nothing put up since). After the first pick, assert `duel_shown` never showed that pair and that a deal sent after the cut excludes it. When #137.1 lands, move the rule to deal.js |
| evolve_ahead.spec.js:150–198 | pairs go up in the order they were dealt … | level, cost | medium | `const firstUsable = (pairs, refused, from = 0) => …` re-implements `aheadUsable` (main.js:7157) in the spec. `expect(forTable(0), …).toBe(up)` counts one re-deal per refused answer | merge into :201 (one browser test of the waiting pair going up without a deal). When #137.1 lands, move the ordering and re-deal rules to deal.js units |
| evolve_ahead.spec.js:29 | (helper) `cardIds`, also `toEvolve`, `picks`, `pick` | idiom | low | `page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(…".dn-id")…` is copied in evolve_feedback:54 and evolve_truth:64. `toEvolve`/`picks`/`pick` are copied across evolve_feedback, evolve_truth and taste_learning | move to a shared `evolve_page.js`, as PATCH has `patch_page.js` |
| evolve_breeds_beside_you.spec.js:161 | EVOLVE POOL breeds beside you: children land in order … within 1 s | flimsy | high | `expect(midway, "the generation ended before the picks could test it").toBe(true);` fails when the farm is fast, and the comment above says "on a fast farm it is over in seconds" | rewrite: per tests/web/AGENTS.md, accept the faster app. Keep main's view of the generation open deterministically (hold `refine_child`/`refined` from main while the three picks run, then `app.release()`) |
| evolve_breeds_beside_you.spec.js:163 | EVOLVE POOL breeds beside you … | flimsy | high | `for (const ms of deals) expect(ms, …).toBeLessThan(1_000);`: a wall-clock bound under testing.md's 1.5 s slack (slow tier; a deal is about 30 ms, so the margin is about 30x) | rewrite: keep the claim and bound it from a measured step, as perform_budget.js does, or at least 1.5 s as a named constant. With a worker harness, "a duel is answered while a walk runs" becomes a worker-protocol test |
| evolve_breeds_beside_you.spec.js:185,189 | EVOLVE POOL breeds beside you … | vacuous | high | `expect(receipt).toBeTruthy();` is always true after `app.toast()` returned. `if (retired.some((id) => !born.includes(id))) expect(receipt).toMatch(/it could: …/)` may not run and has no else | rewrite: delete the truthy line. Assert both branches (no "it could:" when nothing outside the children was retired). The sentence itself is words.test.mjs:206 |
| evolve_breeds_beside_you.spec.js:108 | EVOLVE POOL breeds beside you … | misnamed | low | the title names order and 1 s deals. It also checks ⚡'s disabled reason, the lamp agreeing with the slot, the receipt and the estimate | rename to cover them, or leave it: the title's own claims are all checked |
| evolve_breeds_beside_you.spec.js:111,340 | EVOLVE POOL breeds beside you …; ⚡ evolve from this … | implementation | low | `page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, …)` reads the workbench's private field through the debug hook | rewrite: wait for what the player sees (`#rack-subject` named; :343 already waits for `#rack-evolve` enabled) |
| evolve_breeds_beside_you.spec.js:40–81 | (WATCH) | idiom | low | `const Orig = window.Worker; function Wrapped(url, opts) {…`: an after-main snapshot of the bank on `refine_child`, the same hook bank_lineage.spec.js:73 hand-builds | move to the fixture: a hook that runs after main's handler (`app.after(type, fn)`) |
| evolve_breeds_beside_you.spec.js:224 | GENERATIONS and the next-step chip count a generation once a child of it has landed, not when a pick's status does | vacuous, level, duplicate | high | `if (!early.landed) { expect(early.count, …).toBe("0"); … }`: the title's claim runs only when no child has landed by the pick's status, which arrives after its 7 s undo window, so a fast farm skips it silently. Same rule as bank_lineage:589 | rewrite+merge: one fast-tier test that presses EVOLVE POOL with `app.stall({ type: "refine" })` and injects `refine_progress`, a pick's `status` and `refine_child` in both orders. Merge bank_lineage:589 into it. `gensBred()` (main.js:3687) is pure: propose it as #137's eleventh item (js-unit). Takes ~100 s out of the slow tier |
| evolve_breeds_beside_you.spec.js:238 | GENERATIONS and the next-step chip … (also bank_lineage:585,612,653) | idiom | low | `if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});` swallows a failed click | rewrite: with the generation held open (pattern d) STOP is always there, so click it without a catch |
| evolve_breeds_beside_you.spec.js:244 | stop ends with what's bred, and replaced patches leave only then | misnamed, flimsy | high | nothing here reads the bank before the stop, so "leave only then" is unchecked in this test (only :144 in the first test checks it). `expect(refined.stopped).toBe(true)` fails if the last walks land before STOP is pressed | rewrite: snapshot the bank ids just before `#job-stop` and assert every id in `refined.retired` was still in it. Keep the generation open (pattern d). The engine half is native: `a_stopped_generation_keeps_what_it_bred` |
| evolve_breeds_beside_you.spec.js:254–258 | stop ends with what's bred … | vacuous, duplicate | high | `if (landed.some((e) => e.child > 0)) { … may-go … toBeGreaterThan(0) }` is a branch, and bank_lineage:657 pins "will be replaced" during a generation | delete these five lines (bank_lineage:657 keeps the behavior) |
| evolve_breeds_beside_you.spec.js:306,314,320 | during a generation PERFORM is answered: a new patch is measured and a pressed Offer starts within 1 s | flimsy, cost | high | `expect(breedingStill, "the measurement waited for the whole generation").toBe(true);` fails when the generation ends first. `expect(started[0], …).toBeLessThan(1_000);` is a sub-1.5 s wall-clock bound. The test then waits up to 480 s for the generation to end and asserts nothing after it (109 s median) | rewrite: assert the order from the tap (`perform_wired` landed before `refined`) instead of a class read. Bound the Offer's start from a measured step. Drop the trailing wait (or press STOP). Wait for `.pf-offer.ready` with `app.offerBudget()`, not `waitForSelector(…, 120_000)` |
| evolve_breeds_beside_you.spec.js:365,367,375 | ⚡ evolve from this leaves the engine free: a deal answers within 1 s and a ▶ while it walks, and its stop drops it | flimsy | high | `expect(stillWalking).toContain("⚡ evolving");` and `expect(playedAt, …).toBeLessThan(landedAt);` race a walk that can land before the ▶'s render on a fast machine. Also `expect(deals[0], …).toBeLessThan(1_000)` | rewrite: hold `evolved_from` from main (`app.hold`) so "still walking" is main's state, and compare the render reply's arrival to the held reply's `at`, then release. Bound the deal as above |
| evolve_cards.spec.js:48 | the buttons keep their ids under the specimen's words, and the small map goes to TASTE | misnamed, implementation | low | the title claims ids, which mean nothing to a player. The test checks the labels, six pips and EVOLVE POOL's dashed, pressable state before a fit (`toHaveClass(/\buntaught\b/)`, listed in testing.md) | rename: "EVOLVE's buttons say PLAY · 1, PICK A · ←, ANOTHER PAIR · N, EVOLVE POOL is dashed and pressable before the first fit, and the small map goes to TASTE" |
| evolve_cards.spec.js:84 | what each generation did opens over the foot of the cards, and Esc folds it | idiom | low | `expect(await page.evaluate(() => document.activeElement?.id)).toBe("lineage-btn");` | `await expect(btn).toBeFocused();` |
| evolve_feedback.spec.js:153 | the sixth pick always redraws the taste map, even after agreeable picks | misnamed | high | nothing reads the map. It asserts `sentCount("fit")`, `count("fitted")`, *it just learned* and the pips | rename: "the sixth pick always refits, even when the engine says its weights are intact". taste_learning:169 owns the map settling on a refit |
| evolve_feedback.spec.js:194 | the sixth pick always redraws the taste map … | duplicate, cost | medium | cycle 1 of `for (let cycle = 1; cycle <= 2; cycle++)` re-checks evolve_truth:144 (the learning copy, the fit sent after the sixth pick's window, *it just learned* after `fitted`). The test is 41.7 s, over the 40 s line, untagged | merge: run only cycle 2 (the amended `needs_refit: false` case this test exists for), about 20 s off the fast tier |
| evolve_feedback.spec.js:231–239 | the sixth pick always redraws the taste map … | level, duplicate, split | medium | `expect(e.ratings.seeds).toBe(10); expect(e.ratings.may).toBe(Math.min(10, Math.max(0, e.pool + 10 - e.target)));` is native: `next_seeds_and_may_replace_are_what_a_generation_does`, `may_replace_counts_a_filling_pool…`, `belief_is_the_ranked_numbers_and_the_next_seeds`, and `the_belief_after_a_pick_is_the_reweighted_posterior` for "moves per pick" | delete these lines and testing.md's "(ten seeds, ten may-replace)". A real pick's `status` carrying `ratings` stays covered in the browser by taste_learning:387 (`meansOf(second)` reads `reply.ratings.ranked` off real pick replies), and their reaching the halos by taste_learning:169 |
| evolve_feedback.spec.js:146–150 | TAUGHT counts a pick at once, ⌘Z takes it back, and the lane names the latest pick | level, cost | medium | `expect([...new Set([...counted, await picks(page)])]).toEqual([n0 + 3]);` and `expect(new Set(picked)).toEqual(new Set([third]));`: the vote ledger through undo windows (`picksTaught`, #137.5) and the lane's `replace` rule (#137.2), through a boot | move when #137.5 and #137.2 land. Keep in the browser: one pick counts at once, ⌘Z uncounts it, and the lane shows the latest pick's words |
| evolve_feedback.spec.js:282–301 | ◇ states the dealing rule steadily … | level, cost | medium | `await app.amend({ type: "duel", meta: true }, { … "meta.method": method });` takes three deals and three skips per method to read `renderDealRule`'s words | move when #137.4 (`words.dealRule`) lands: the method-to-words table goes to words.test.mjs. Keep the default rule holding through picks and one amended method. About 12 s off the fast tier |
| evolve_feedback.spec.js:251,252,301 | ◇ states the dealing rule steadily … | idiom | low | `expect(await rule.getAttribute("title")).toContain("every pair is dealt at random");` | `await expect(rule).toHaveAttribute("title", /every pair is dealt at random/)` |
| evolve_feedback.spec.js:356 | the warm start's result replaces its loading toast when it lands | flimsy | high | `await expect(lane).toContainText("Your three taught it 18 picks", { timeout: 1_500 });`. The lane shows one toast and queues the rest (main.js:4005–4044). `replace: "warm"` takes the floor only while the loading toast is still live, and otherwise queues behind what is on screen | rewrite: `app.toast(/^Your three taught it 18 picks/, { since })` from the tap's log, and check the loading toast never came back after it in `app.toasts()` |
| evolve_truth.spec.js:134 | ⌘Z in EVOLVE with nothing to take back says so and leaves the PATCH edit alone | vacuous | high | `expect(await page.locator("#toasts .toast").count()).toBe(1);`: the lane keeps queued toasts out of the DOM (`note()` attaches only the live one), so a second copy queued behind would never be counted inside `app.quiet()` | rewrite: wait out the toast's window, then assert `app.toasts(mark)` holds the sentence once. When #137.2 lands, unit-test `replace` on urgent toasts |
| evolve_truth.spec.js:108 | ⌘Z in EVOLVE with nothing to take back … | implementation | low | `page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, …)` | rewrite: wait for the knob (:111 already does). Drop this line |
| evolve_truth.spec.js:176 | the sixth pick can be taken back, and it just learned only once fitted has landed | implementation | low | `const pickAt = (await app.sent("duel_pred")).filter((m) => m._at < fitAt).pop()._at;` times the pick by an internal forecast request | rewrite: `const t = await app.now()` just before the sixth click, then `fitAt - t >= 6_990` (the guide's seven seconds, keyboard.md:84) |
| evolve_truth.spec.js:212 | another pair leaves no live-looking buttons while it deals, and says why when slow | flimsy | high | `await app.delay(TABLE, 2_500);`: every check through the ArrowRight (a reason shown after 300 ms and waited up to 1.5 s, six disabled checks, a key) must finish inside 2.5 s of the click. On a loaded runner the deal lands first and → becomes a pick | rewrite: `app.holdRequests(TABLE)` … `app.releaseRequests()`, so the deal is out until the spec lets it go |
| evolve_truth.spec.js:292 (×3) | a pair dealt while a cut was taken back never puts the patch up once it is cut again (three cases) | level, cost | medium | `window.__tap.inject({ type: "duel", pair, meta, ahead: !!stalled.ahead });` hand-builds three races to drive `onDealt`/`checkAhead`/`aheadUsable` (main.js:7157–7223), one boot each, 37 s | move when #137.1 lands: each race shape becomes a deal.js unit. evolve_truth:235 stays as the browser wiring |
| evolve_truth.spec.js:361 | a sound cut while the table waits on its fourth deal is not put up by it | level, idiom | medium | `T.stalls = [table]; T.inject({ type: "duel", pair, meta: null, ahead: !!m.ahead });` drives the fourth-try rule (#137.1 "the fourth try") by poking the tap's internals | move when #137.1 lands. Until then, add a fixture call that answers the stalled request and stalls the next (`app.answerStalled(reply, { stallNext })`) |
| evolve_truth.spec.js:413–415,423–426 | after clicking EVOLVE's stop on the rail, → picks | implementation, duplicate | low | `expect(focus).toBe("view-evolve");` asserts which element holds focus. The rail's arrow walk (:423–425) is shell_levels.spec.js's | delete the focus-id line (the → pick is the behavior). Keep only "→ on a focused stop is not a pick" |
| evolve_truth.spec.js:438 | opening a patch is not announced unless it kept you waiting | implementation | low | `page.waitForFunction((id) => window.__aur.wb.subjectId === id, id, { timeout })` | wait for `#rack-subject` to contain the row's name |
| evolve_truth.spec.js:512–534 | with no farm, a pick's deal during a generation says which seed it waits on, and what it bred and replaced is named (300.8 s, @slow) | vacuous, flimsy, cost | high | `const receipt = said.find(…)` reads `app.toasts(mark)` once, while the receipt can still be queued in the lane. `if (sawSixth) { … if (state.fitted === 1) expect(state.lit, …).toBe(true);` holds a lamp claim the title doesn't make inside two branches. The test waits up to 400 s for the whole generation | rewrite: `app.toast(/^Generation \d+:/, { since: mark, timeout: 15_000 })`. Split the lamp claim out or drop it. Press STOP once a `(seed n/10)` reason has been seen (receipt words are words.test.mjs:151–214). Or, with no real generation, `app.stall({ type: "refine" })` plus injected `refine_progress` with a held table deal shows the seed reason in seconds |
| evolve_from_new.spec.js:47 | a ⚡ child joins the bank's New group, as a generation's children do | implementation | low | `await expect(row).toHaveClass(/\bfresh\b/);`: a class beside the visible tag, which :48 checks (`.bi-new` reads "new") | delete the class line |
| bank_find.spec.js:81–83,92–93 | Find a sound survives the bank redrawing under it: a rating, a cut and a rename | vacuous | high | `expect(await shown()).toBe(true);` reads straight after the rating's toast and the rename's Escape, before the redraw under test (`renderBank`, the rename guard's deferred one) has to have run. A redraw that dropped the filter would still read the old, filtered list. The cut half (:99) waits properly | rewrite: wait for each redraw's own mark first (the rated row's ★ `aria-pressed="true"` re-queried; after the rename the row's `.bi-name` back), then `expect.poll(shown).toBe(true)` and `toHaveValue(word)` |
| bank_find.spec.js:23–61 | Find a sound narrows the pool and the presets by name, family and blurb, and Esc clears it | level, cost | medium | `for (const p of byFamily) expect(…).toContain(family);`: `bankMatches` (main.js:8062) through a boot | move when #137.3 (bank-find.js) lands: the name, family, blurb and case rules become units. Keep typing narrows, the no-match line and Esc clears in the field |
| bank_find.spec.js:81; bank_row.spec.js:23,46,54 | (rating and cut toasts) | flimsy | high | `await expect(page.locator("#toasts .toast").last()).toContainText(/^Cut /);`: the lane shows one toast and queues the rest out of the DOM (main.js:4018), so a toast queued behind a 7 s one plus a backlog can outlast the 10 s expect | rewrite: `app.toast(/^Cut /, { since })` and `app.toast(/^Rated .+ 4★\./, { since })` from the tap's log (bank_touch:70 already does) |
| bank_find.spec.js:106 | typing in Find a sound plays no note, and the same key outside it does | implementation | low | `page.waitForFunction(() => window.__aur && window.__aur.getLive && window.__aur.getLive(), …)` | rewrite: the boot's `#boot.done` is the playable state, so drop the wait. If the keybed needs a gesture first, wait for the visible state |
| bank_kept.spec.js:102 | a sound kept as new stays when a preset opens on a full pool, though it rates lowest | vacuous | high | `expect(said.some((t) => keptName && t.includes(\`it could: ${keptName}\`)), …).toBe(false);`: with `keptName` undefined, `some` is false whatever the toasts say. The window is narrow: the name comes from the engine's views | rewrite: `expect(keptName, "the kept sound has a name").toBeTruthy()` first |
| bank_kept.spec.js:60–63 | a sound kept as new stays … | idiom | low | `Promise.race([skip.waitFor(…).then(() => skip.click()).catch(() => {}), app.reply(…).catch(() => {})])` swallows both | rewrite: `await expect(skip.or(<committed state>)).toBeVisible()`, then click if it is the card |
| bank_lineage.spec.js:198,207,231,255,303 | pointing at EVOLVE POOL marks the seeds …; … what may be replaced; a mark never moves … (×2) | flimsy | high | `await app.inject({ type: "status", status: s.status, ratings: { ranked: [], seeds, may_replace: may } });` with no `app.hold`. A later engine reply carrying ratings or views (#126) puts the engine's lists back over the injected ones. It passes 3/3 on CI today | rewrite: `app.hold([{ ratings: true }, { views: true }], { inject })`, as taste_learning:297 does |
| bank_lineage.spec.js:308–310 | a mark never moves or narrows a row's name … (1440 px, 1080 px) | vacuous | high | `f.textContent = w;` writes each word into the app's flag and measures what the test wrote. The flag the app draws for "will be replaced" (only during a generation) is never measured | rewrite: measure "will be replaced" from a stalled-and-injected generation (`app.stall({ type: "refine" })`, press EVOLVE POOL, inject `refine_child` with `retiring`), and "seed" and "may be replaced" from the held injected ratings |
| bank_lineage.spec.js:336–338 | a child keeps its unheard dot across a reload … | idiom | low | `await page.reload();` then `await app.booted();` | `await app.reload();` |
| bank_lineage.spec.js:495,506 | pointing at EVOLVE POOL while ⚡ walks marks its seed and the one sound its child would replace (@slow, 45 s) | vacuous, level | high | `test.skip(!m.walking, "⚡ landed before the marks were read");` and `if (done.childId > 0) { expect(…"what ⚡'s child replaced").toEqual(want); }`: the title's second half runs only if ⚡ bred a child. `want` re-derives `markMayGo` in the spec | rewrite: hold `evolved_from` from main while the marks are read (no skip). The replacement rule is native (`may_replace_counts_a_filling_pool_and_passes_over_a_seed_evolving`, `a_seed_evolving_is_never_evicted_until_its_walk_lands`). `markMayGo` becomes js-unit when #137.6 lands. The browser keeps the two marks from held, injected ratings |
| bank_lineage.spec.js:564,576 | a sound saved while a generation runs loses its mark, and the one that will go instead gains it (@slow, 70 s) | vacuous, flimsy, level | high | `test.skip(!breeding, "the generation ended before the save");` skips when the farm is fast. `expect(saved.breeding, …).toBe(true)` fails if the generation ends between the key and the reply | rewrite: `app.stall({ type: "refine" })`, press EVOLVE POOL, inject `refine_progress`, save, and answer `pinned` with `retiring` (or let the engine answer it). Read the marks. The engine half is native (`a_save_made_mid_generation_is_never_retired`). `markMayGo` becomes js-unit when #137.6 lands. About 60 s out of the slow tier |
| bank_lineage.spec.js:605–606 | GENERATIONS counts a generation from its first child, with no pick since it opened (@slow, 38 s) | vacuous, duplicate, level | high | `test.skip(!walks[first].breeding, …); test.skip(!(walks[first].statusGen < walks[first].generation), …);` are two timing skips. Same rule (`gensBred`) as evolve_breeds:200 | merge into the injected GENERATIONS test proposed at evolve_breeds:224 (the no-pick order is one of its cases) |
| bank_lineage.spec.js:618–655 | a child the pool would not take buds beside its seed and is gone, and EVOLVE POOL says why (@slow, 31 s) | cost | medium | `await taught(page, app);` … `await page.locator("#evolve-btn").click();` sets up six picks, a refit and a real generation only to be "breeding" when a fake `refine_child` is injected, then waits for the real generation to stop | rewrite: `app.stall({ type: "refine" })`, press EVOLVE POOL, inject `refine_progress` and the refused child. It runs in the fast tier in ~10 s and needs no STOP |
| bank_lineage.spec.js:694,722,705,714,738 | a generation's children land in New with their seed and what changed, and Replaced names what it replaced (@slow, 89 s) | level, vacuous, cost | high | `expect(k.seed, …).toBe(seeds[k.index]);` and `expect(ev.parent_id, …).toBe(walk.seed);` are engine facts no view shows: native `next_seeds_and_may_replace_are_what_a_generation_does` asserts `parents(jobs) == seeds` and the lineage. `if (kept.length) {…}`, `if (gone.length) {…}` and `if (during.some(…))` run the New and Replaced checks only if the seeded generation kept and replaced something | rewrite: drop the engine-fact lines. Drive New, the from-line, buds and Replaced from a stalled `refine` with injected `refine_child`/`refined` (as :443 already does for Replaced), so every branch runs. evolve_breeds:108 keeps one real generation end to end. About 75 s out of the slow tier |
| bank_row.spec.js:77 | a sound opened from outside the bank has its row brought into the bank's view | idiom | low | `await page.locator('.rail-stop[data-level="evolve"]').click();` | `await goLevel(page, "evolve");` |
| faces.spec.js:25 (whole file) | (all nine) | idiom | low | `const { test, expect } = require("@playwright/test");` plus `page.on("pageerror", …)` and `expect(errors).toEqual([])` in every test, and its own `Worker` wrapper (`window.__pwLog`, `__pwNoFaces`) doing what the tap does | move onto the fixture (#170): `app.boot()`, `app.hold("faces")` for the no-faces run, `app.sent`/`app.replies` for the log |
| faces.spec.js:131–136 | a face appears on every row, card and chip once its render lands | idiom | low | `pad.dispatchEvent(new PointerEvent("pointerdown", …))`, and `{ timeout: 120_000 }` for the offer | press Offer as a player does (`.pf-pad` click, as guide_pill:74) and bound the wait with `app.offerBudget()` |
| faces.spec.js:150 | the warm start's cards carry their faces (@slow, 152 s) | cost | medium | `await expect(page.locator("#warm-grid .warm-item .face-slot img.face")).toHaveCount(9, { timeout: 150_000 });`: a whole slow boot for one count | merge into first_run:17 once it is on the fixture and waits for `app.fullPool()` with the warm start open (the cards' renders wait for the bank). ~150 s out of the slow tier |
| faces.spec.js:197,188 | a name is at the same x and width with or without its face, on a desktop / on a phone | flimsy, cost | high | `else await page.waitForTimeout(2000);` stands in for "the bank drawn without faces". Two boots per test (57 s and 50 s, fast tier, over the 40 s line, untagged) | rewrite: one boot with `app.hold("faces")` (rows drawn, no faces), measure, `app.release()`, wait for every face, measure again. No fixed wait, and ~50 s less |
| faces.spec.js:314–315 | a refit is answered promptly while sixty face renders wait | level, flimsy | high | `expect(t.ms, …).toBeLessThan(6000);` puts a fit's own duration on a runner inside a wall-clock bound. The claim is a lane rule (`fit` → LATER, `face_render` → FACES, worker.js:2381–2414) | move: add to worker-lanes.test.mjs "a refit goes before every queued face render", modelling the chain the spec runs: `faces` becomes `face_lookup` (LATER), which queues `face_render` jobs (FACES), so `served([face_lookup, fit, …60 face_render])` must give lookup, fit, then the renders. Then delete the spec (46 s, fast tier) |
| faces.spec.js:323,226 | a preset's face still lands after the bank redraws while it was on its way; the sound's card downloads … | cost | medium | `await bankDrawn(page);` waits for all 40 pool faces before a test about the presets tab (42 s, over the 40 s line, untagged) and before a card that needs one row's face | rewrite: wait for the pool rows only (`app.poolRows()`), and in :223 for the opened sound's `#out-face` (which :228 already waits for) |
| first_run.spec.js:20,62,127 (whole file) | (all three) | flimsy, idiom | high | `await page.goto("/");` with no `?seed` and no seeded Math.random, so the pool and the nine warm-start cards differ every gate run. Off the fixture, collecting `pageerror` by hand | move onto the fixture: `app.boot({ warmed: false, seen: false, wait: … })` |
| first_run.spec.js:40 | warm start: a slow chooser keeps all 18 preferences | flimsy, cost | high | `await page.waitForTimeout(20_000);` stands in for the state the bug needed (inserts into a full pool). 24.7 s of fixed waits per run | rewrite: `await app.fullPool()`. Keep the three 1.5 s listens as a named pacing constant |
| first_run.spec.js:47 | warm start: a slow chooser keeps all 18 preferences | vacuous | high | `await expect(page.locator(".toast", { hasText: "is gone" })).toHaveCount(0);` passes at once, and toasts from the minute before have left the DOM | rewrite: `expect((await app.toasts()).filter((t) => /is gone/.test(t))).toEqual([])` |
| first_run.spec.js:51–53 | warm start: a slow chooser keeps all 18 preferences | vacuous, idiom | high | `.toEqual([await page.locator("#live-label").textContent(), await page.locator("#live-label").textContent()])`: the expected value is read once before polling, and two labels are compared to each other, so two stale labels pass | rewrite: `await expect(page.locator(".pf-name")).toHaveText(<name of the sound main has open>)` from the engine (`app.facts()` and the open subject) |
| first_run.spec.js:60 | PERFORM's first steps tick off as they happen; measurements are one menu item away | duplicate, idiom | medium | the steps (Play a key → Turn X → Press OFFER → That is the loop) are guide_pill:39's. `await page.waitForTimeout(800);` comes before a wait that already waits for the name (a fixed wait with no job) | delete the steps half (guide_pill:39 keeps it). Move the engineer-mode check (`#engineer-btn`, a knob's title says "purity", the only test of it) into a PERFORM spec on the fixture (perform_controls.spec.js) |
| first_run.spec.js:132–138 | the warm start measures its cards in the background while it is open | implementation, cost | medium | `expect(early, …).toBe(0)` counts `perform_wire` posts with `bg` against a patched `performance.mark`: request scheduling, not what a player sees. 65 s median in the fast tier, over the 40 s line | rewrite: the player's half is budgets.spec.js:158 (a warm pick's controls live within 1 s). Keep "measuring a card inserts nothing" as the bank's row count unchanged. Tag @slow, or move the "only after the pool is full" rule to a js-unit once the scheduler leaves main.js |
| guide_pill.spec.js:39 | the pill shows one step at a time and ticks each off as it happens | cost | medium | 91 s median (70–95 s) in the fast tier, untagged. Its siblings take 8–13 s. Most of it is `await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });` on the boot sound | tag @slow, or start from a sound whose measurement is quick (`app.openOnPerform("Glass Pad")` under PERFORM_SEED, as PERFORM's specs do) |
| guide_pill.spec.js:77–79,88,119 | the pill shows one step …; × stops the pill …; × on PERFORM's pill … | implementation | medium | `expect(kept.done.sort()).toEqual(["offer", "patch-play", "play", "turn"]);` asserts the store's shape, which guide.test.mjs:14 owns | rewrite: prove it as the player sees it, by reloading and checking that the pill stays gone, or that PATCH's pill opens past "Play it". Keep :96's old-key-goes check (a persisted key's migration) |
| guide_pill.spec.js:89–92 | × stops the pill, and a reload keeps it stopped | idiom | low | `await page.reload(); await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });` | `await app.reload();` |
| guide_pill.spec.js:127 | a first visit that starts on PATCH is asked to play before anything else … | idiom | low | `await page.goto("/#patch");` bypasses `app.boot` (no seed, no tap) | give `app.boot` a `hash` option |
| session_seed.spec.js:21 | the same ?seed fills the same pool on a fresh session, and another seed another | level, cost | medium | three full fills (69 s, fast tier, over the 40 s line) prove a seeded fill repeats, which is native: `farm_width_does_not_change_the_pool`, `boot_agrees` (the shipped seed pinned in wasm), `draw_seed_is_pure_and_decorrelated` | move: `seedOverride` parsing goes to params.js units when #137.10 lands. Keep one boot asserting that `?seed=7` reaches the engine (`app.sent("init")`'s `seed`) and that a fresh context restores nothing. ~55 s off the fast tier |
| taste_learning.spec.js:194–212 | every halo moves to the ratings a pick posts, and a refit settles them all at once | flimsy | high | `window.__tap.inject({ type: "status", … ratings: r })` and an injected `fitted`, with no `app.hold`. A later engine reply with ratings or views (#126) replaces them. The same file holds them at :297 | rewrite: `app.hold([{ ratings: true }, { views: true }, "styles"], { inject })` |
| taste_learning.spec.js:116 | (helper `pct`, used at :184, :410) | level, idiom | low | `const pct = (mean) => Math.round(100 / (1 + Math.exp(-mean)));` re-implements the plate's percentage in the spec | import the app's own (`words.plateGuess`, as `mapPositions` imports taste-geom.js), or compare to fixed literals as :199 does |
| taste_learning.spec.js:237,246–266 | LEARNING's weights, forecasts and math are the engine's numbers, and copy as JSON gives them back | level, duplicate | medium | `expect([facts.audio, …]).toEqual([18, 26, 500, 5, 20]);` is wasm `model_facts_and_forecasts_are_the_engines`. The θ sort and `toFixed(2)`, and the forecast score, are re-derived in the spec (taste-geom.test.mjs:256, words.test.mjs:353) | rewrite: delete the literals line. Compare the shown math, one bar and the score to what the worker posted, not a re-computation. The full bars check duplicates :547's `expectBars(now, …)`, so leave it there |
| taste_learning.spec.js:309–310 | a mark sits left of its label: the label's x is the same with the mark and without | duplicate | medium | `expect(await fill(guess)).toBe("rgba(0, 0, 0, 0)");`: a guess drawn hollow with a ? is taste_marks:47's (and taste-geom.test.mjs:130 `pullMark`) | delete the fill lines here. Keep the x alignment, this test's own claim |
| taste_learning.spec.js:528 | pointing at a weight shades the small map by each sound's z on that feature (@quarantine #173) | flimsy, level | high | `expect(Math.min(...shade.hi), …).toBeGreaterThan(Math.max(...shade.lo) + 60);`: one pixel read of a map that may be redrawing. The z-to-shade mapping is taste-geom.test.mjs:350 "the small map and its shading" | rewrite: keep the wiring with no pixel read (pointing at a weight says *dots: ‹feature›…*, leaving puts the arrow's legend back). The arithmetic stays in the unit. Untag |
| taste_marks.spec.js:47 | a guess is drawn hollow with a ?, in LEARNING's weights and the module rail, and the guess above the rack is a percentage and a word | misnamed | low | the title leaves out the spec card's sentences (:126–132, `In … you lean toward it (θ +0.50 ± 0.10).`), which testing.md lists | rename to add "and the spec card says a settled lean in sentences" |
| taste_profile.spec.js:93,132 | Reset asks with the counts …; Reset takes ?seed off the address … | flimsy | high | `await page.waitForEvent("load", { timeout: 60_000 });` is registered after the download (and, at :88, after reading the file). A reload whose load event fires first is missed | rewrite: start the load wait in the same `Promise.all` as the click, or wait for `#boot.done` on the new document (`app.booted()` after `page.waitForURL`) |
| taste_profile.spec.js:72–75 | Reset asks with the counts, downloads the profile first, and keeps the saved patches | level | medium | `toContainText("Reset your taste? Your 2 picks, 0 stars, 0 cuts, and 0 generations are forgotten, …")` | move the sentence to `words.resetQuestion` units when #137.9 lands. Keep a regex check that the counts reach the question |
| (gap) www/docs/src/views/learning.md:67–80 | LEARNING's "Where liking rises" | gap | medium | the arrow follows every pick with its old heading dashed for a moment, the legend reads *the arrow: liking rises · explains 16%*, and before a fit *no direction yet*. Only the quarantined taste_learning:530 touches the legend | add: before the first fit `#md-maplegend` says *no direction yet*; after a fit it reads /^the arrow: liking rises · explains \d+%/; a pick's ratings (held, injected) change it |
| (gap) www/docs/src/views/evolve.md:97–98 | a waiting pair that lost a sound to a generation is dropped and dealt again | gap | medium | "…that pair is dropped and dealt again, and so is one that lost a sound to a generation." Only cuts are tested (evolve_ahead:121, evolve_truth:235) | add: a deal.js unit when #137.1 lands. Until then, a browser case that injects `refine_child`/`refined` retiring a sound of the waiting pair, and asserts the next pick does not put it up |
| (gap) www/docs/src/views/evolve.md:143–145 | reduced motion during a generation | gap | low | "With your system set to reduce motion nothing moves, and the button, the row, and the line under New say the same." Only a refused bud is checked under reduced motion (bank_lineage:645) | add to the injected New test (bank_lineage:657 rewrite): under `reducedMotion: "reduce"` a kept child adds no bud and its row and the New line still say it |

## Tally

Counted from the table above: 80 rows, gap rows included. A row can carry several categories, so
the category counts add up to more than 80.

| Category | Rows |
| --- | --- |
| flimsy | 21 |
| level | 18 |
| cost | 17 |
| idiom | 17 |
| vacuous | 15 |
| duplicate | 12 |
| implementation | 10 |
| misnamed | 5 |
| gap | 3 |
| split | 1 |

| Severity | Rows |
| --- | --- |
| high | 35 |
| medium | 21 |
| low | 24 |

Of the 35 high rows, the ones to fix first are:
- the gate's 300 ms bounds (evolve_ahead:166/197/206/224);
- the unheld injections (bank_lineage:198–303, taste_learning:194);
- the conditionals and skips on whether a real generation is still running (evolve_breeds:161/224/244/306, bank_lineage:495/564/605/657);
- first_run's unseeded boots and 20 s fixed wait;
- the DOM toast reads (pattern b).

The rest are high by the rubric's rule with narrow windows (evolve_ahead:124, bank_kept:102), or
are wall-clock bounds in the slow tier with a wide margin (evolve_breeds:163/314/367).

## Per-file summary

Test-seconds are CI medians, fast plus slow tier. Actions are each test's main action; a test with
no row is "keep".

| File | Tests | On the fixture | keep | rewrite | merge | move | delete | split | Test-seconds (fast / slow) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| evolve_ahead.spec.js | 4 | yes | 0 | 3 | 1 | 0 | 0 | 0 | 27.7 / 8.6 (quarantined) |
| evolve_breeds_beside_you.spec.js | 5 | yes | 0 | 4 | 1 | 0 | 0 | 0 | 0 / 366.1 |
| evolve_cards.spec.js | 3 | yes | 1 | 2 | 0 | 0 | 0 | 0 | 25.0 / 0 |
| evolve_feedback.spec.js | 5 | yes | 1 | 1 | 0 | 2 | 0 | 1 | 114.9 / 0 |
| evolve_from_new.spec.js | 1 | yes | 0 | 1 | 0 | 0 | 0 | 0 | 0 / 50.9 |
| evolve_generation_timing.spec.js | 1 (harness, skipped) | partly (`openApp`, its own contexts) | 1 | 0 | 0 | 0 | 0 | 0 | 0 / 0 |
| evolve_truth.spec.js | 11 | yes | 1 | 6 | 0 | 4 | 0 | 0 | 137.1 / 300.8 |
| bank_find.spec.js | 3 | yes | 0 | 2 | 0 | 1 | 0 | 0 | 78.1 / 0 |
| bank_kept.spec.js | 1 | yes | 0 | 1 | 0 | 0 | 0 | 0 | 0 / 42.0 |
| bank_lineage.spec.js | 14 | yes | 4 | 9 | 1 | 0 | 0 | 0 | 230.7 / 273.4 |
| bank_row.spec.js | 3 | yes | 0 | 3 | 0 | 0 | 0 | 0 | 56.1 / 0 |
| bank_touch.spec.js | 2 | yes | 2 | 0 | 0 | 0 | 0 | 0 | 55.7 / 0 |
| faces.spec.js | 9 | **no** | 2 | 5 | 1 | 1 | 0 | 0 | 330.3 / 151.8 |
| first_run.spec.js | 3 | **no** | 0 | 2 | 0 | 0 | 1 | 0 | 108.0 / 0 |
| guide_pill.spec.js | 5 | 4 of 5 (:124 is not) | 1 | 4 | 0 | 0 | 0 | 0 | 126.7 / 0 |
| session_seed.spec.js | 1 | yes | 0 | 0 | 0 | 1 | 0 | 0 | 69.1 / 0 |
| taste_learning.spec.js | 11 | yes | 7 | 4 | 0 | 0 | 0 | 0 | 266.4 / 23.6 (quarantined) |
| taste_marks.spec.js | 2 | yes | 1 | 1 | 0 | 0 | 0 | 0 | 35.6 / 0 |
| taste_profile.spec.js | 3 | yes | 1 | 2 | 0 | 0 | 0 | 0 | 36.2 / 0 |
| **Total** | **87** | | 22 | 50 | 4 | 9 | 1 | 1 | **1697.7 / 1217.3** |

These 87 tests are about 28 minutes of the fast tier's seventy, and 20 minutes of the slow tier.

Notes on actions:
- The two "keep" tests in faces.spec.js keep their assertions; they still move onto the fixture
  with the file.
- bank_kept.spec.js is already split the right way: the protection is native
  (`a_sound_kept_as_new_is_not_replaced_until_its_first_pick`), and this test is its one
  end-to-end, in the slow tier.

## Category 9: level

| Test | CI median | Target level | Lower keeper | Thin check left in the browser | Seconds leaving |
| --- | --- | --- | --- | --- | --- |
| faces:286 refit answered while sixty face renders wait | 46.4 fast | js-unit over worker.js (worker-lanes.test.mjs) | new unit in the existing file (`face_lookup` and `fit` in LATER, `face_render` in FACES) | none (delete) | 46 now |
| session_seed:21 | 69.1 fast | rust-engine; js-unit (`seedOverride`, #137.10) | `farm_width_does_not_change_the_pool`, `boot_agrees`, `draw_seed_is_pure_and_decorrelated` | one boot: `?seed=7` reaches `init` | ~55 now |
| evolve_feedback:153 lines 231–239 (belief's shape) | in 41.7 | rust-engine / wasm-binding | `next_seeds_and_may_replace_are_what_a_generation_does`, `may_replace_counts_a_filling_pool…`, `belief_is_the_ranked_numbers_and_the_next_seeds`, `the_belief_after_a_pick_is_the_reweighted_posterior` | taste_learning:387 (a real pick's reply carries ratings) and :169 (they reach the halos) | ~0 (lines only) |
| taste_learning:217 line 237 (model_facts literals) | in 30.4 | wasm-binding | `model_facts_and_forecasts_are_the_engines` | the math shows what was posted | 0 |
| taste_learning:217 lines 246–266 (θ order and format, forecast score) | in 30.4 | js-unit | taste-geom.test.mjs:256, words.test.mjs:353 | one bar and the score equal the posted values | 0 |
| taste_learning:503 (quarantined) | 23.6 | js-unit | taste-geom.test.mjs:350 | the legend's words on hover | 0, but it leaves quarantine |
| bank_lineage:657 lines 691–694, 719–722 | 88.9 slow | rust-engine | `next_seeds_and_may_replace_are_what_a_generation_does` | New, the from-line, buds and Replaced from injected facts | ~75 now (with the injected rewrite) |
| bank_lineage:543 | 70.1 slow | rust-engine; worker reply; js-unit (`markMayGo`, #137.6) | `a_save_made_mid_generation_is_never_retired` | stalled `refine` plus injected `pinned` with `retiring`, marks read | ~60 now |
| bank_lineage:471 | 45.0 slow | rust-engine; js-unit (#137.6) | `may_replace_counts_a_filling_pool_and_passes_over_a_seed_evolving`, `a_seed_evolving_is_never_evicted_until_its_walk_lands` | marks while ⚡ walks, from held `evolved_from` and held ratings | ~35 now |
| evolve_breeds:200 and bank_lineage:589 (GENERATIONS) | 63.5 + 38.4 slow | js-unit (`gensBred`, proposed as #137's 11th) | none yet | one injected fast-tier test (~12 s) | ~90 now (injection); the unit when added |
| evolve_breeds:244 | 53.7 slow | rust-engine | `a_stopped_generation_keeps_what_it_bred` | the receipt says stopped, the slot hides, the retired rows go | 0 (keep; fix the title) |
| evolve_truth:292 ×3 and :361 | 37.1 + 8.4 fast | js-unit (deal.js, #137.1) | none yet | evolve_truth:235 | 45.5 when #137.1 lands |
| evolve_ahead:121 and :157 (+:201 merged) | 9.4 + 10.1 fast | js-unit (deal.js, #137.1) | none yet | one test: the waiting pair goes up with no deal | ~19.5 when #137.1 lands |
| evolve_feedback:244 | 27.0 fast | js-unit (`words.dealRule`, #137.4) | none yet | the default rule, and one amended method | ~12 when #137.4 lands |
| evolve_feedback:96 (ledger, lane) | 20.8 fast | js-unit (#137.5, #137.2) | none yet | one pick, ⌘Z, the latest named | ~5 when they land |
| bank_find:23 | 31.7 fast | js-unit (bank-find.js, #137.3) | none yet | typing narrows, the no-match line, Esc | ~10 when #137.3 lands |
| taste_profile:53 (the sentence) | 10.3 fast | js-unit (`words.resetQuestion`, #137.9) | none yet | the counts reach the question | 0 |
| first_run:98 (warm cards measured only after the pool is full, in the background) | 64.8 fast | js-unit (a scheduler pulled out of main.js; not in #137) | none yet | measuring a card leaves the bank as it was | ~55 when extracted |
| evolve_breeds:288 and :323 (the engine answers a deal, an Offer and a stop while walks run) | 109.2 + 61.9 slow | worker-protocol | none (no harness) | evolve_breeds:108 keeps one real generation; ⚡'s slot and STOP by injection | ~150 with a harness |
| evolve_truth:463 (with no farm, a deal waits on the walk) | 300.8 slow | worker-protocol, for "the serial path makes a deal wait"; the seed reason is main's | none (no harness) | the seed reason from a stalled `refine`, injected `refine_progress` and a held deal | ~280 with a harness; most of it now by injection |

**Seconds leaving the browser tier:**
- **Now**, where the lower keeper already exists or the injected rewrite needs nothing new: about
  360 s. That is ~100 s of the fast tier (faces:286, session_seed) and ~260 s of the slow tier
  (bank_lineage:657/543/471 and the two GENERATIONS tests).
- **When #137 lands** (items 1, 2, 3, 4, 5, 9 and 10): about 90 s more of the fast tier.
- **With a worker-protocol harness**: about 430 s more of the slow tier.
- **With a warm-start scheduler module** (first_run:98): about 55 s of the fast tier.

**Does the worker-protocol level exist, and could it?** It doesn't exist today. The units that
touch worker.js (`worker-lanes.test.mjs`, `worker-perform-replies.test.mjs`) lift single functions
out of its source. A harness looks feasible:
- `boot_agrees.spec.js` already loads `apps/web/pkg` in Node (`initSync`).
- worker.js's `init` accepts a precompiled `module` (`m.module || new URL(…, self.location.href)`).
- Its only browser globals are `self` (postMessage, onmessage, location), an `indexedDB` that is
  already guarded (`if (!self.indexedDB …) return null`), and one `fetch` of perform-wirings.json,
  which would need a shim for `file:` URLs.
- Nothing in it touches a canvas or audio.
- With no farm ports it takes the serial path.

So a `worker_threads` bootstrap of about 100 lines would serve: one that defines `self`, sends
`init` with the compiled module and collects posts. Under it these would move:
- a duel answered while a walk runs (evolve_breeds:163/367, evolve_truth:463's waiting);
- ⚡'s stop answered `stopped` with `childId: 0` (evolve_breeds:392–396);
- `pinned` carrying `retiring` during a generation (bank_lineage:569–570);
- a pick's `status` carrying `ratings` (evolve_feedback:234);
- the refit-before-faces order (faces:286), end to end rather than through `laneOf`.

Walks in Node run at native wasm speed in one thread, so a serial generation is still minutes. The
harness tests should use a small pool, as `boot_probe` does.

## Patterns worth a helper or a rule

a. **Fast-tier tests over 40 s, untagged.** Eight tests, 462 s in all, against tests/web/AGENTS.md's
   "over 40 s is tagged @slow":
   - evolve_feedback:153 (41.7 s);
   - faces:187 desktop (57.3 s) and phone (50.0 s);
   - faces:286 (46.4 s);
   - faces:319 (41.8 s);
   - first_run:98 (64.8 s);
   - guide_pill:39 (91.1 s);
   - session_seed:21 (69.1 s).

   A CI step could fail when a test's last-run median passes 40 s and it is not tagged; `shard.mjs`
   already reads those timings.

b. **Toasts read from the DOM.** The lane shows one toast and keeps the queue out of the DOM
   (main.js:4005–4084). A `#toasts .toast` count or `.last()` read either misses a queued copy
   (evolve_truth:134, first_run:47) or races the queue (bank_row:23/46/54, bank_find:81,
   evolve_feedback:356). Rule for tests/web/AGENTS.md: assert toasts through the tap's log
   (`app.toast`, `app.toasts(mark)`), never the lane's DOM.

c. **Hand-built `Worker` wrappers for an after-main snapshot.** They appear in:
   - evolve_breeds:40 (`__pwFirstChild`);
   - bank_lineage:31 (`__pwMarks`, `__pwSaves`);
   - faces:31 (`__pwLog`, `__pwNoFaces`);
   - first_run:101 (`__posts`).

   A fixture hook that runs a page function after main's handler for a reply type would replace
   the first two. `app.sent`/`app.replies`/`app.hold` replace the last two.

d. **Real generations whose assertions branch on "still breeding".** These tests branch, skip or
   swallow a click on whether a real generation is still running, so a fast farm skips the claim
   and a slow one fails it:
   - evolve_breeds:161/224/244/306/375;
   - bank_lineage:495/564/605/653/685;
   - evolve_truth:500/526.

   Main's state is entered by the click and fed by replies. So `app.stall({ type: "refine" })`,
   then a press on EVOLVE POOL, then injected `refine_progress`/`refine_child`/`refined`, makes
   every state deterministic and fast. Holding `refine_child`/`refined` from main keeps a real
   generation open where the engine's own children are wanted. Keep one real generation end to
   end (evolve_breeds:108).

e. **Unheld injections.** bank_lineage:198–303 and taste_learning:194–212 inject ratings or views
   without `app.hold`, which tests/web/AGENTS.md (#126) says to use. A lint is cheap: an
   `app.inject` of a `status` with `ratings`, or of anything with `views`, must be inside
   `app.hold(…, { inject })`.

f. **`window.__aur.*` waits on private state.** These are the app's declared debug hook, not a
   test-only addition, so they are low severity, but each has a visible state to wait on instead:
   - `wb.rack` at evolve_breeds:111/340 and evolve_truth:108;
   - `wb.subjectId` at evolve_truth:438 and taste_learning:519;
   - `getLive()` at bank_find:106.

g. **EVOLVE helpers copied across four specs.** `toEvolve`, `cardIds`, `picks` and `pick` are in
   evolve_ahead, evolve_feedback, evolve_truth and taste_learning. An `evolve_page.js` would hold
   them, as `patch_page.js` does for PATCH.

h. **Engine rules re-derived in the spec.** These tests re-derive a rule in the spec and compare
   (category 9):
   - `firstUsable` (evolve_ahead:152);
   - may-replace arithmetic (evolve_feedback:237, bank_lineage:498/577);
   - `pct` (taste_learning:116);
   - θ sorting and forecast scoring (taste_learning:246–264).

   Rule: the browser compares the screen to what the worker posted. The rule itself is tested where
   it lives.

i. **#137's list, extended.** These are pure logic a boot alone exercises today, beyond #137's ten:
   `gensBred` (GENERATIONS), and the warm-start measurement scheduler (first_run:98).

## Deletions recommended, and what keeps each behavior

- **first_run:60, the steps half.** guide_pill:39 keeps it. The engineer-mode check moves to
  perform_controls.spec.js.
- **faces:286.** A new unit in worker-lanes.test.mjs ("a refit goes before every queued face
  render") keeps it. Add the unit first.
- **faces:150**, by merge. first_run:17 keeps it once it is on the fixture and sits on the warm
  start with the pool full.
- **evolve_feedback:153 cycle 1.** evolve_truth:144 keeps it.
- **evolve_feedback:231–239, the belief's shape.** The four Rust tests named above keep it. A real
  pick's reply carrying `ratings` stays covered in the browser by taste_learning:387.
- **taste_learning:237, the model_facts literals.** `model_facts_and_forecasts_are_the_engines`
  keeps it.
- **taste_learning:309–310, the hollow fill.** taste_marks:47 and taste-geom.test.mjs:130 keep it.
- **evolve_breeds:254–258.** bank_lineage:657's "will be replaced" checks keep it.
- **bank_lineage:589**, by merge. The injected GENERATIONS test keeps it.
- **evolve_ahead:75's numbers.** budgets.spec.js:188 keeps them; the test itself is rewritten,
  not deleted.
- **evolve_truth:292 ×3 and :361**, only once #137.1's deal.js units exist. evolve_truth:235 stays.
