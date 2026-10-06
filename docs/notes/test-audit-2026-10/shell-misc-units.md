# Test-quality audit: shell, misc specs, node units, the fixture

Area: every `tests/web/*.spec.js` outside the patch_/perform_/evolve_/bank_/taste_ families and pad_keys, explain, faces, session_seed, first_run, guide_pill (shell_levels, model_view, keys_*, space_after_a_click, text_fits, type_scale, responsive, narrow_gate, budgets, smoke, failure_flows, booth, film_chip, midi_announced, boot_agrees, audio_in*, plus fixture_tap, which the pattern also leaves here); the helpers `shell.js` and `audio_in_stub.js`; the node:test units in `apps/web/tests/*.test.mjs`; a design review of `tests/web/fixtures.js` and `playwright.config.js`.

Read-only, at `main` 42bd322. Nothing was run. Test-seconds are the mean per run over the three CI blob runs in the blob reports of CI runs 37383132211, 37379867024 and 37345520856 (fast tier) and 37381447489 (slow tier) (37345520856, 37379867024, 37383132211), plus `rows-slow.json` for `@slow` tests, matched by title (responsive.spec.js's line numbers moved between runs).

Severity follows the rubric's mapping exactly: flimsy and vacuous are high; implementation, duplicate, cost and level are medium; idiom is low; misnamed is high only where a title claims coverage it lacks. Where the realistic risk is lower than the category says, the action column says so.

**Counts.** There are 107 finding rows over 87 browser tests (19 files) and 125 node units (11 files), plus 4 gaps in §5. A row can carry more than one category.

| | count |
| --- | --- |
| idiom | 38 |
| implementation | 21 |
| flimsy | 15 |
| level | 16 |
| misnamed | 13 |
| vacuous | 8 |
| duplicate | 6 |
| cost | 5 |
| gap | 2 here, 4 more in §5 |
| **severity high** | 29 |
| **severity medium** | 33 |
| **severity low** | 45 |

## 1. Findings

### shell_levels.spec.js (10 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| shell_levels:30, 67-74 | (file) | idiom | low | `const { test, expect } = require("@playwright/test");` with its own `boot()`: `page.on("pageerror", …)`, an INIT that writes the seen flags, no seed | Move it onto the fixture with `app.boot()`, which is seeded, collects page errors on its own and marks the tours seen. Drop every `errors` array and keep every title. |
| shell_levels:112-128 | the rail and the level keys move between the levels, and the header says where you are | duplicate, level | medium | `await key("Alt+ArrowUp", "learning"); await key("Alt+ArrowUp", "learning"); … await key("Alt+ArrowDown", "patch"); await key("Alt+ArrowDown", "patch");` covers every ⌥ chord, including both axis ends | levels.test.mjs:19-58 already proves the mapping (`step("learning","out") === null`, `levelForKey`, ⌥1–5). Keep in the browser one ⌥↑, one ⌥←, one ⌥digit, the rail-click loop and the focused-stop arrows. That is the wiring and `aria-current`/`#where`. Delete the repeated end-of-axis presses. |
| shell_levels:140-151 | same | misnamed | low | `await page.keyboard.press("Alt"); expect(await page.evaluate(() => window.__pwAlt)).toEqual([true]);` and the hover label, `toHaveCSS("opacity", "1")` | Split these into "⌥ alone is taken" and "a stop's name shows while the rail is pointed at", or name both in the title. |
| shell_levels:88 | expectAt | idiom | low | `expect(await page.locator("section.view:not(.hidden)").count(), …).toBe(1);` | `await expect(page.locator("section.view:not(.hidden)")).toHaveCount(1)` |
| shell_levels:163-166, 184-185, 263-265 | a text field and a modal dialog keep ⌥ and the arrows; stage mode keeps the level keys | idiom | low | `await page.keyboard.press("Alt+ArrowUp"); … await expectAt(page, "patch");`: a "nothing happens" check made through a positive wait that was already true before the press | It is sound today only because shell.js `show()` sets `data-level` in the keydown's own task (shell.js:180-190). Add `await app.quiet()` before `expectAt` so a deferred move would also be caught. |
| shell_levels:218-253 | a reload comes back to the level you were at, and a level's link opens it | duplicate, level, cost | medium | 5 boots, about 15 s. `localStorage.setItem("auracle-view", "play")` → PATCH, and the hash-over-saved permutations | levels.test.mjs:68-87 proves `savedLevel("play")` and `startLevel(hash, saved)` precedence. Keep one reload that returns to the level, one `/#learning` link and the wordmark's history check, for 2 boots. Delete the `play` and in-place-hash-vs-saved permutations. |
| shell_levels:232 | same | implementation | medium | `expect(await page.evaluate(() => localStorage.getItem("auracle-view"))).toBe("taste");` | Delete it. Line 230, `expectAt(page, "taste")` after a fresh load, already proves the level was saved. |
| shell_levels:323-334 | at {1000,1080,1440} px the levels cover no control at any level | vacuous | high | `await goLevel(page, level); await page.mouse.move(10, 400); expect(await page.evaluate(COVERED), …).toEqual([]);` reads the layout the moment the rail says the level is current. The boot is unseeded, and nothing waits for EVOLVE's pair, TASTE's map or the rack at rest. COVERED returns `[]` when the controls by the rail aren't drawn yet. | Wait for each level's content first: `#choose-a` enabled, `rackAtRest` (patch_page.js), PERFORM's knobs. Have COVERED also return how many controls it measured, and assert that count is above 0. Realistic risk is low. |
| shell_levels:339 | KEYS ⋯ reaches every control that left the bar, and the bar keeps VOL, MIDI and REC | misnamed | low | The body also asserts the lit button, `toHaveAttribute("title", /on now: hold, arp$/)`, the Esc fold, the chip reopening it and a press outside folding it | Rename to say what it checks: "…says what is on, and folds on Esc or a press outside". |
| shell_levels:33-57 | (helper) | idiom | low | `window.__pwPeakDb = () => { const a = window.__pwTap; …` | This is one of four copies of the output analyser (also space_after_a_click:35-59, audio_in_stub.js:198-233 and patch_audible). Replace them with a fixture helper `app.output` that offers `peak()`, `at(hz)` and `loudest(ms)`. |

### model_view.spec.js (8 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| model_view:13, 20-57 | (file) | idiom | low | `require("@playwright/test")`, with INIT re-implementing a Worker tap (`window.__pwCounts`); unseeded | Move it onto the fixture: `app.boot({ warmed: false })`, `app.reply`, `app.count`. |
| model_view:60-68 | fitted() | idiom | low | `await page.waitForFunction(() => (window.__pwCounts.fitted \|\| 0) > 0, …)`, then `expect.poll(() => rowIds(page), { timeout: 120_000 }).toHaveLength(40)` | Replace with `await app.warmStart(); await app.poolRows(40);` |
| model_view:96-100 | holding ⌥ shows each row's guess and the pool in the order it rates them; letting go puts the order back | flimsy | high | `const held = await rowIds(page); const shown = await pcts(page); … expect(held, "the model's order is not the pool's").not.toEqual(rest);` is read once, right after the first `.bi-pct` shows | `await expect.poll(() => rowIds(page)).not.toEqual(rest)`, then read the percentages. Low realistic risk if the reorder lands in the same frame. |
| model_view:105 | same | flimsy | high | `expect(await rowIds(page), "letting go puts the order back").toEqual(rest);` is one read after `.bi-pct` hides | `await expect.poll(() => rowIds(page)).toEqual(rest)` |
| model_view:129-130, 186-188, 193-195 | ⌥ and an arrow … never flash the model view; a text field and a modal dialog keep ⌥ | idiom | low | `await page.waitForTimeout(600); expect(await page.evaluate(() => window.__pwModelSeen), …).toBe(0);` uses a 600 ms "nothing happens" window, under QUIET_MS | Use `app.quiet()` (1.5 s) for the window. Keep the MutationObserver counter: it catches any flash, which is the right pattern. |
| model_view:148, 174 | a tap on MODEL keeps the model view… | idiom | low | `await page.keyboard.down("Alt"); await page.waitForTimeout(400);` is a hold past the 220 ms threshold, not named. Line 174's `waitForTimeout(400)` is a "nothing happens" window. | Name `HOLD_PAST_MS` beside the helpers, and make line 174 `app.quiet()`. |
| model_view:235 | under the model view TASTE shows its side of the toggle, and EVOLVE its guess on the card it favours | implementation | medium | `expect(await page.evaluate(() => window.__pwPre \|\| 0)).toBeGreaterThan(0);` counts `duel_pred` replies but does not tie the drawn guess to one | This should be ADR-012's engine fact. Read the `duel_pred` reply with `pre` through `app.reply`, then assert that `.duel-guess` sits on the card the reply favours and that its text is `pairGuess(p)`. |
| model_view:245 | the model view's words say what it is, never a lens | duplicate, cost | medium | `expect(copy).not.toMatch(/\blens\b/i);`, a 5 s boot | **Delete.** `www/checkwords.py` already covers it: `lens \| player` over apps/web/*.js and the engine's player strings, with a baseline of 0 for apps/web, in `make dev-check`. words.test.mjs:692 and :704 cover it (`modelTag`, `pairGuess` never "lens"), and so does patch_model_view.spec.js:87. Merge line 257 (`#model-btn` title `/the model view/i`) into model_view:136. |
| model_view:292 | in PATCH Esc closes what is nearer…, and a tapped view is remembered across a reload | implementation | medium | `expect(await page.evaluate(() => localStorage.getItem("auracle-model-view"))).toBe("0");` | Delete it. Lines 294-299 already prove "remembered" by reloading. |
| model_view:316-317 | PATCH's old LEANS switch, left on, comes back as a tapped model view, once | implementation | medium | `expect(keys).toEqual({ old: null, now: "1" });` asserts "once" as storage keys | Assert "once" by behavior: tap MODEL off, `page.reload()`, and assert `body` lacks `.model-view` (the old switch doesn't bring it back). |

### keys_are_not_notes.spec.js (3 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| keys_are_not_notes:16-100 | (file) | idiom | low | Its own tap carries `__pwHold`, `__pwTeach`, `__pwLog`, `cardIds` and `picks`, none of them used | Move it onto the fixture and drop the dead helpers. |
| keys_are_not_notes:102 | 1 and 2 in the keep-as-new comparison play a side and rate nothing | misnamed, gap | high | The body asserts only `expect(await count(page, "sent:record_stars"), …).toBe(stars);` and the toasts. No spec presses 1/2 in `#cduel` (it appears only in patch_editing:509-553 and patch_keys:204, which use Esc, Home and Delete). | **Merge** into patch_keys.spec.js:184, which has the same 8×ArrowUp → KEEP AS NEW setup and is on the fixture. Add the missing half: after "1", side A's ▶ is lit or the output sounds, and after "2", side B's. Keep `app.sentCount("record_stars")` unchanged. |
| keys_are_not_notes:104, 127, 145 | (all three) | implementation, idiom | low | `await page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, …)` | Wait on the page instead: `#rack-svg [data-addr]` attached (line 107 already does this), and the bank row visible. |
| keys_are_not_notes:119 | 1 and 2… | idiom | low | `await page.waitForTimeout(1500);` | `app.quiet()` |
| keys_are_not_notes:143 | p in the preset list hears the preset without playing a note | misnamed, gap | high | It asserts only `expect(await down(), "p played a note from the preset list").toBe(0);` and that p plays off the list. Nothing shows the preset is heard. | Add it: after p, the preset's row ▶ is lit, or `app.reply("render")` for its id arrives and the output sounds. Otherwise retitle to "…without playing a note". |
| keys_are_not_notes:135-137, 151-153 | L…, p… | idiom | low | `await page.keyboard.down("l"); await page.waitForTimeout(200); expect(await down(), …).toBe(0);` | Use `app.quiet()`, then `await expect(page.locator(".pkey.down, .bkey.down")).toHaveCount(0)`. Give L the counter-check p has at :156-158 (an `l` off the rack is a note), or the negative proves nothing about `l`. |

### keys_for_the_platform.spec.js (2 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| keys_for_the_platform:42-44, 55-57 | both | idiom | low | `expect(await page.locator("#help").textContent()).not.toMatch(/[⌘⇧⌥]/);` | `await expect(page.locator("#help")).not.toContainText(/[⌘⇧⌥]/)`. Keep the test: it is the wiring of `platformKeys`, which words.test.mjs:295 unit-tests. |

### space_after_a_click.spec.js (4 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| space_after_a_click:128 | (spacePlays, used by tests :145 and :189) | flimsy | high | `expect(stop.quietAt - stop.at, …).toBeLessThan(400);` is a 400 ms wall-clock bound, timed with `setTimeout(tick, 10)` in a loaded page. testing.md § Rules asks for 1.5 s of slack. | Assert the transport, not the clock: right after the second Space, `await expect(page.locator("#inhand-play")).not.toHaveClass(/playing/)`, then quiet with `expect.poll(peak).toBeLessThan(-80)`. Keep `stop.peak > -50` (still sounding when Space landed) to rule out the phrase ending by itself, or use a sustained preset so its end can't be mistaken for the stop. |
| space_after_a_click:132-143 | chipOf | implementation | medium | `for (const m of window.__aur.wb.rack.modules) { const k = m.knobs.find((x) => x.addr.endsWith("#" + s));` (as written, with a template literal) | Find the chip by its accessible name, `page.getByRole("button", { name: /wave, / })`. Line 175 shows its label ends "wave, sqr". |
| space_after_a_click:185 | a setting's chip reached with the keyboard cycles on Space and Enter… | vacuous | high | `expect(await peakDb(page), "nothing played").toBeLessThan(-80);` is one read right after the last cycle, and a play started by the key would still be rendering | Use `app.quiet()`, then assert silence. Realistic risk is low because :182 checks `#rack-play` is not `pending` on every cycle. |
| space_after_a_click:156, 184 | (two tests) | idiom | low | `expect(await focused(page), …).not.toContain(chip.addr);` | `await expect(chip.g).not.toBeFocused()` / `toBeFocused()` |
| space_after_a_click:217, 219 | in PERFORM, Space plays after… | implementation | low | `toHaveAttribute("data-frozen", "true")` | Assert what the player reads: Wander's caption says *frozen* (perform_layout: "Freeze … said on Wander"). |
| space_after_a_click:233 | the ⋯ menu's file items open their dialog… | idiom | low | `expect(chooser, …).toBeTruthy();` is always true once `waitForEvent` resolves | Drop it. `waitForEvent("filechooser")` is the assertion. |
| space_after_a_click:155, 203, 211 | (logs) | idiom | low | `console.log(\`[space_after_a_click] ${site}: ${was} → ${now}, focus on …\`)` | Drop these, or attach them with `testInfo.attach`. |

### text_fits.spec.js (6 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| text_fits:63-73 | every PERFORM control caption is whole at {1000,1280} px… | level | medium | `const CAPTIONS = [ "turn to ask for it", … "drift · next in 12 s" ];` is hand-copied from perform.js `paintKnob`, so a caption state added there is never measured | Export the caption states, or the function that writes them, from perform.js and import them here. A perform.test.mjs case should check the export covers each branch of `paintKnob`. |
| text_fits:162-168 | PATCH's callout is whole at {1000,1080} px… | level | medium | `const CALLOUTS = [ "Teach it your taste: 6 quick picks ▸", …` is hand-copied from `renderNextStep` | The same: take the states from the module that writes them. |
| text_fits:75-154, 169-197 | (4 tests) | cost | medium | One full boot per width (4-6 s each) for a layout read that needs nothing from the engine beyond the boot | Boot once and measure each width with `page.setViewportSize`, saving about 10 s. If the titles must stay, keep them as `test.step`s. |

### type_scale.spec.js (4 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| type_scale:175 | the menu bar is one row as tall as --menubar-h, which the alarm is placed under, at every width | vacuous | high | `expect(got[0], …).toBe(got[1]);`, while style.css:437-446 sets `.menubar { height: var(--menubar-h); overflow: hidden; white-space: nowrap; }`. The two are equal by construction. | Drop the height equality. Assert what can break: ⋯ `toBeInViewport()` and inside the bar (:176-178 do), and the bar's items not overflowing it (`scrollWidth <= clientWidth`) at each width. |
| type_scale:159 | same | misnamed | high | The title says "which the alarm is placed under", but no alarm is opened | Open the alarm (e.g. `app.fail(…, { fatal: true })`) and assert its top is at or below the bar's bottom, or drop the clause. |
| type_scale:9-11 (header), testing.md row | a canvas draws its text at the canvas floor… | misnamed | high | The header says "The duel scopes' "0 dBFS" and LEARNING's forecast strip are drawn and read", and testing.md says "on the scopes". The test itself admits (:135-137) the scopes "are drawn only in a commit, which this boot doesn't reach". | Either reach KEEP AS NEW's comparison (an edit, then `#rack-commit`, as patch_keys:184 does) and wait for "0 dBFS", or correct the header and testing.md's row. |
| type_scale:142-149 | same | idiom | low | `window.__pwWorker.dispatchEvent(new MessageEvent("message", { data: { type: "calibration", calib, forecasts } }))` | Use `app.inject({ type: "calibration", calib, forecasts })` on the fixture. |
| type_scale:186-187 | reduced motion makes every duration on the scale instant… | implementation | medium | `["no-preference", { press: "90ms", state: "180ms", move: "320ms", boot: "0.32s" }]` pins token values that `tokens.py --check` owns | Assert the promise instead: under `reduce` every duration is 0, and without it each is above 0, with the veil's transition equal to `--d-move`. |
| type_scale:120 | the page's text is at least … 11 px | idiom | low | `expect(pip.t[2] <= pip.c[2] && pip.t[3] <= pip.c[3], …).toBe(true);` | Use two `toBeLessThanOrEqual` assertions, so a failure prints the numbers. |

### responsive.spec.js (5 tests, on the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| responsive:45-72 | a player's ▶ is answered while PERFORM is still listening to a patch | level, misnamed | medium | `window.__tap.engine.postMessage({ type: "render", id: i });` is a request posted to the worker, not a player's ▶. `expect(!wired \|\| render._at < wired._at, …)` is worker lane order. It takes 20-42 s on the fast tier (42.5 s in one run, past the 40 s @slow line). | Move it to **worker-protocol** (§3): post `perform_wire`, then `render`, and assert the replies' order. Keep one browser wiring test that presses a real bank row's ▶ during a measurement and hears it (app.output) before `perform_wired`. |
| responsive:86-87, 101-102 | a warm-start ▶ that was superseded, or whose card closed, never plays | idiom | low | `const firstPlayed = await plays.nth(0).evaluate((b) => b.classList.contains("playing"));` and `const sounding = await page.evaluate(() => [...].some(… "playing" \|\| … "loading"))` | Fold both into the web-first `await expect(page.locator(".wi-play.playing, .wi-play.loading")).toHaveCount(0)` after `app.quiet(4_000)`. A stronger check would also read the output level during the quiet window: the bug was audio, "playing in PERFORM after the card had closed". |
| responsive:119, 125 | teach it opens PERFORM on the first pick, named at once | idiom | low | `toHaveAttribute("aria-current", "location", { timeout: 2_000 })` and `expect.poll(…, { timeout: 3_000 })` are 2 s and 3 s bounds, above testing.md's 1.5 s flake line | The move is synchronous with the click. Use the default timeout, or assert in the click's own task that the rail moved, which is the real promise of "at once". |
| responsive:146, 203 | Take keeps the controls live…; a Take's measurement… | idiom | low | `await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });` | `await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: OFFER_MS })` |
| responsive:191-229 | a Take's measurement is the player's again when PERFORM comes back into sight (@slow) | level | medium | About 102 s. The claim is worker lanes: `hide`/`show` move the measurement back ahead of a `later` drift (`expect(!drifted \|\| wired._at < drifted._at, …)`). | Move it to **worker-protocol**: post `perform_wire`, `hide`, `show`, `perform_drift`, and assert `perform_wired` comes before `perform_drifted`. The browser keeps a check that a level change sends `hide`/`show` (`app.sent`), which needs no offer. |

### narrow_gate.spec.js (4 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| narrow_gate:11-19 | (file) | idiom | low | `function collectErrors(page) { … page.on("pageerror", …) }` | Use the fixture's `test`: `pageErrors` is automatic and needs no `app`. Otherwise keep all four. They are cheap (0.3 s) and assert what is on screen. |

### budgets.spec.js (4 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| budgets:188, 232-233 | a pick puts the next pair up within 0.3 s, and its ▶ sounds within 0.15 s | flimsy, duplicate | high | `for (const d of deals) expect(d).toBeLessThan(300); for (const p of plays) expect(p).toBeLessThan(150);` These are the same bounds evolve_ahead.spec.js:75 carries, and that test is `@quarantine` (#160) because "its 300 ms wall-clock bounds include a shared runner's jank (CI measured 346 ms for ↻)". Here they are not quarantined. | **Merge; don't delete**, since evolve_ahead:75 is out of the gate. evolve_ahead:75 keeps the ordering without wall clocks and leaves quarantine: the pair put up was dealt ahead, no deal is asked after the pick, its renders are already back, and ⌘Z restores. budgets:188 keeps the two numbers with the escape hatch :149-152 already has: judged only when this machine's step is fast, otherwise an annotation. |
| budgets:148, 180 | a preset's controls are live within a second…; a warm-start pick's… | flimsy | high | `expect(ms - named, \`${name}'s controls live when it lands\`).toBeLessThan(100);` is a 100 ms bound that is always judged, sampled with `setTimeout(r, 2)` in a loaded page | Make "live when it lands" an ordering, not a time: a MutationObserver on `.pf-name` records whether all six knobs were wired in the same task the name landed. |
| budgets:153 | a preset's controls are live within a second of its click | flimsy | high | `await page.waitForTimeout(1500);` between presets stands in for "the last open has settled" | Wait for the state: `.pf-status` says "controls reach" and the bench lane is idle (patch_page.js `settled`). |
| budgets:113-116 | the app marks boot, the veil, … | idiom | low | `await expect.poll(async () => (await page.evaluate(() => window.__aur.marks())).map((m) => m.name), { timeout: 200_000 })` | Read `performance.getEntriesByType("mark")`, the film recorder's actual contract. The pool-full wait belongs in `app.engine`. |
| budgets:107-109, 213 | (two tests) | idiom | low | `await page.waitForTimeout(300);` (a key held) and `await page.waitForTimeout(500);` ("A player listens before choosing") | These are pacing waits for a gesture. Name them (`KEY_HELD_MS`, `LISTEN_MS`). |
| budgets:27-71 | (file) | idiom | low | Its own Worker wrapper (`__ahead`, `__shown`, `__steps`); unseeded | Move it onto the fixture (`app.replies("duel", { where: { ahead: true } })`, `app.sent`). An in-page timing helper (`until`/`pickAndTime`, also in evolve_ahead) belongs in the fixture. |

### smoke.spec.js (2 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| smoke:79-112 | the engine binary exports the walk surface the worker calls | vacuous, level | high | `const methods = [ "refine_jobs", … "face_of_key" ];` is a hand-kept list, so a method that worker.js starts calling but the binary lacks passes | Derive the list from worker.js (`engine\.(\w+)\(`, `glue\.(\w+)`) and check that each exists. Run it in Node as boot_agrees does (`import(pkg) + initSync`), with no page. |
| smoke:30-34 | the instrument boots clean… | idiom | low | `page.on("console", (msg) => { if (msg.type() === "error") errors.push(…) });` | Use the fixture with `test.use({ consoleErrors: true })`. |

### failure_flows.spec.js (4 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| failure_flows:319 | AU-S4: a vote the engine did not take is reported and rolled back | flimsy | high | `expect(Date.now() - picked, "the refusal must land inside the 7 s undo window for this to mean anything").toBeLessThan(6_000);` | On the fixture, call `app.delay({ type: "record_duel", b: pair[1] }, 60_000)` before the pick, so the real vote cannot land first. The synthetic refusal's `b: 4_000_000_000` is not matched. Then drop the clock. |
| failure_flows:303, 311, 325 | same | implementation | medium | `expect(await pips.innerHTML()).toBe(pipsBefore);` | Assert the count the pips show (the lit pips `toHaveCount(n)`, or `#teach-copy`'s words), not their markup. |
| failure_flows:320-324 | same | level | medium | `expect(dropped.pred).toBeNull(); expect(dropped.ratings).toBeNull(); expect(dropped.vote).toEqual(…); expect(dropped.status.observations).toBe(observationsBefore);` is the worker's reply to a refused vote | Move to **worker-protocol**: post `record_duel` with an unknown id and assert the `status` reply. The Rust half (`record_*` returning bool) is already gated, per the header. The browser keeps the pips and toasts rollback. |
| failure_flows:337, 348-349 | same | flimsy | high | `expect(await star().getAttribute("aria-pressed")).toBe("false"); expect(await row.locator(".star.lit").count()).toBe(0);` is read once, after the toast entered the lane | `await expect(star()).toHaveAttribute("aria-pressed", "false"); await expect(row.locator(".star.lit")).toHaveCount(0);` Low realistic risk. |
| failure_flows:190, 265, 281 | AU-S1, AU-S2 | implementation | medium | `expect(await alarm.getAttribute("data-tag")).toBe("quarantine");` | Delete these. The alarm's words (:188-189, :263-264) and its surviving a save or a `bench` reply (:206, :280) are the behavior. |
| failure_flows:203, 271, 385 | AU-S1, AU-S2, AU-S9 | idiom | low | `await page.waitForTimeout(4_000);` / `3_500` / `500` are "nothing happens" windows, and the last is under QUIET_MS | `app.quiet(4_000)` with the debounce named as the reason; make :385 `app.quiet()`. |
| failure_flows:286 | AU-S2 | idiom | low | `expect(await alarm.locator(".al-msg").count()).toBe(1);` | Use `app.quiet()`, then `await expect(alarm.locator(".al-msg")).toHaveCount(1)`. |
| failure_flows:365 | AU-S9 | idiom | low | `page.evaluate(() => document.getElementById("export-btn").click())` | Press the ⋯ menu's item, as a player does. |
| failure_flows:54-168 | (file) | idiom | low | Its own tap, `inject` and `idb`, and the `/__seed` route trick to write IndexedDB before boot | Move it onto the fixture: `app.post`, `app.inject`, `app.fail(…, { fatal: true })` for AU-S2's fatal half, and `app.toast`. Add an `app.seedSave(record)` for the pre-boot store. |

### booth.spec.js (1 test, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| booth:22-26 | attract plays in PERFORM, hands over on a key, and teaches nothing | flimsy | high | `await page.waitForTimeout(3000); const moved = await page.evaluate(() => [0, 1, 2, 3, 4, 5].some(… !== 0));` | `await expect.poll(movedAControl).toBe(true)` waits for the state, not a time. |
| booth:30 | same | flimsy | high | `await page.waitForTimeout(1000);` comes before web-first assertions that wait on their own | Delete it. If it means "the hand does not move again", make that `app.quiet()` and say so. |
| booth:34 | same | vacuous | high | `expect(await page.locator("#duel-count").textContent()).toBe(picks);` is one read right after the hand-over, while TAUGHT (main.js:3659 `picksTaught`) moves only on an engine reply | Assert it through the tap, as AGENTS.md says when the message is the behavior: no `perform_record` and no `record_*` sent from boot through a quiet window after the hand-over (`app.sentCount`). |
| booth:10 + header :4-7 | same | misnamed | high | The title says "attract plays", and the header says "holds a chord", but no output is read; only the caption `#ba-cap` "under one hand" is checked | Assert the output sounds during attract (app.output), or drop "plays" and "holds a chord". |

### film_chip.spec.js (3 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| film_chip:14-25, 76 | a film's own recording never shows the chip | vacuous | high | `.replace(/class="film-chip hidden" id="film-chip" data-films="[^"]*"/, …)`: if the markup's attribute order changes, nothing is injected, and with no films the chip is hidden whatever `?film` does | Throw in `withFilms` when the body is unchanged, or have :76 first assert that `#film-chip` carries the injected `data-films`. |
| film_chip:33 | the chip offers the tour first, then each view's film once, then folds | level | medium | The sequencing (tour first for a newcomer, each view once, folded by hand, `play` → `patch` in `filmNoted`) lives in main.js:23745-23786 `pointFilmChip` | Extract the `say` decision (films, seen, newcomer, warm unresolved, view, `?film`, booth) into a pure function with a node:test. The browser keeps one wiring test (tour, one view, nothing after a reload) and the `?film` case. |
| film_chip:85, 97 | (two tests) | idiom | low | `await expect(page.locator("#film-chip")).toBeHidden();` straight after `goLevel` | Sound today, since `pointFilmChip` runs in the level change's task. Add `app.quiet()` if the chip ever opens on a timer. |

### midi_announced.spec.js (1 test, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| midi_announced:39, 48 | a MIDI knob that claims or learns a control is announced in a sentence | level | medium | `toHaveText("CC 74 now moves Bright, the first free control.")`. The sentence is built in midi.js:279-283 `assign`, and `createMidi(host)` already runs under node:test (midi.test.mjs:60) | Unit-test it: feed CCs to `createMidi` with a host that records `note(text, opts)`, and assert both sentences and `{ replace: "midi-map" }`. The browser keeps one toast as the wiring, and the lane's replace. |
| midi_announced:16-25 | (stub) | idiom | low | `Object.defineProperty(navigator, "requestMIDIAccess", …)`, also copied in perform_recentre | Add a fixture helper, `app.midi()`. |

### boot_agrees.spec.js (1 test, no page)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| boot_agrees:65 | the shipped seed deals the pinned pool in the built wasm, as it does natively | idiom | low | `const engine = await import(pathToFileURL(path.join(PKG, "auracle_wasm.js")).href); engine.initSync({ module: fs.readFileSync(wasm) });` runs in Node, yet sits in the browser tier and its one-browser queue | Keep it. Put it, and smoke:79 once it runs in Node, in a Playwright project with no browser, so they take no browser ticket. It is the template for §3. |

### audio_in.spec.js (14 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| audio_in:337-338 | the first listen captures a clip, and the engine measures with it | vacuous | high | `await page.waitForTimeout(2000); expect(await page.evaluate(() => window.__pwSent.length)).toBe(1);` A capture that started by itself posts its clip only after `CLIP_SECONDS` (6 s, audio-in.js:53), so a 2 s window cannot see it. | Watch the capture's start, not its end: over `app.quiet()`, count any time `.ain-clip` gains `on` (a MutationObserver, as model_view's `__pwModelSeen` does) and expect 0. |
| audio_in:435, 450 | a capture cut short drops its take…; a refused capture is not taken again by itself… | cost | medium | `await page.waitForTimeout(8_000);` and `await page.waitForTimeout(10_000);` outwait a 6 s capture to see that no clip is posted | Use the same watcher: a rolling capture shows `.ain-clip.on` at once, so a QUIET_MS window over the class proves "nothing captures by itself". That saves about 15 s a run. |
| audio_in:163 | the browser is asked for an input only when AUDIO IN is added | cost, level | medium | `await page.waitForTimeout(16_000);` outwaits `ASK_HOLD_MS = 15000` (audio-in.js:72) | Unit-test the hold and `reconcile` with `createAudioIn(host)` under `node:test`'s `mock.timers`. The browser drops the 16 s wait and keeps "1 · Fake Mic A", one ask and one live track. |
| audio_in:151, 320-321 | same; the first listen captures a clip… | idiom | low | `.toContainText("AUDIO IN asks the browser for a microphone or an interface", { timeout: 2_000 })`, though the prompt is held open (:147), so the bound buys nothing | Use the default timeout: the hold keeps "while the question is up" true however long the toast takes. For :321, "says so at once", a 2 s bound on a loaded runner is the same issue. |
| audio_in:162, 300, 311, 318, 335, 358, 429, 437, 452, 464, 468, 501-502 | (9 tests) | implementation | medium | `expect((await state(page)).list[0].id).toBe("mic-a");`, `(await state(page)).monitor`, `.capture === "rolling"`, `.clipSource`, all through `window.__aur.audioIn()` | Each has a visible twin: the list is the input menu's rows (`#ctx-menu .cm-item` `toHaveText([...])`, as :242), monitor is `.ain-monitor[aria-pressed]` (:301, :472 already), "rolling" is `.ain-clip` having `on` (:319 already), and clipSource is the toast (:333) or the engine reply (:332). Delete the internal reads. |
| audio_in:517-531 | the square draws the input's live face while it plays, and nothing once it is unplugged | flimsy | high | `expect((await lit()).n).toBe(0);` is one pixel read after `data-face` turns "none" | `await expect.poll(async () => (await lit()).n).toBe(0)` |
| audio_in:345-365 | a restore that installs a captured clip hands the farm the new phrase | level, misnamed | medium | PHRASE_SPY is prepended to worker.js by `page.route`, then `expect(phrases.filter((p) => p.clip).length).toBeGreaterThan(0);`. The header claims "before the bank's renders go out", which nothing checks. | Move to **worker-protocol** with farm.js under worker_threads: restore a session with a captured clip, and assert that the clip's phrase reaches each farm port before its first `farm_render`, which is the ordering the header claims. |
| audio_in:367-394 | a capture hands the farm crew standing the new phrase (@slow) | level | medium | About 49 s of six picks, a fit and ⚡, just to have a crew standing; `expect(after).toBe(reply.farmResent);` | Move to **worker-protocol**: stand a crew with `farm_ports`, post `set_audition_clip`, and assert the phrase reaches every port. |
| audio_in:478-488 | a mono input with no channel count in its settings is captured as one channel | level | medium | `expect(sent.channels).toBe(1);` The decision is audio-in.js:390, `channels: settings.channelCount === 1 ? 1 : 2` | Give `createAudioIn` a node:test with a fake track. The browser's 2-channel case at :326 stays as the wiring. |
| audio_in:490-508 | the browser's default input is numbered as the input it stands for… | level, implementation | medium | `expect(st.list.map((e) => e.id)).toEqual(["mic-b", "mic-a"]);`. Resolution is `realId` (audio-in.js:178) | Unit-test `realId`'s cases (group, track label, the list's "Default - X"). The browser keeps the visible "1 · Fake Interface B" (:500) and one ask and one track (:505-506). |
| audio_in:425-439 | a capture cut short drops its take, and the tap stops | implementation, misnamed | medium | `expect.poll(() => page.evaluate(() => window.__pwTapSaid), …).toContain("drop");` checks a MessagePort message to the worklet | The player's half is "no clip goes to the engine" (:436). Retitle, and put the tap's own `drop` in worklet-take.test.mjs if that tap is PROCESSOR's. |
| audio_in:232-235, 245 | each input is opened once and fanned out… | implementation | low | `ls.every((l) => Number(l.dataset.db) > -30)`, `l.dataset.slot` | For the slot, read `.ain-dev-text`'s "1 ·" / "2 ·". For the level, prefer `.ain-meter-fill`'s drawn height. |
| audio_in:252 | the input is heard with no key down once MONITOR is on, and not at all while it is off | misnamed | low | The body continues past :289 into the reload ("Monitoring is not kept…") | Split at :289 into "monitoring is off after a reload, and a sound that listens opens its input without a prompt". |
| audio_in:261, 281, 302, 410, 473 | (4 tests) | idiom | low | `await page.waitForTimeout(1500);` before `loudest()` | Use `app.quiet()`, named for the release it waits out. |
| audio_in:120-129, 60-73, 371-377 | (helpers) | idiom | low | `while (Date.now() < end) { … await page.waitForTimeout(100); }`, its own `boot()`, and hand-rolled six picks with a `fitted` poll | `app.output.loudest`, the fixture with an inputs option, and `app.teach()`. INIT's `__pwRefuseClip` mutates a reply, which `app.amend` already does. |

### audio_in_takes.spec.js (9 tests, off the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| audio_in_takes:497-501 | AUDIO IN's and CAPTURE's buttons are reached from the keyboard and pressed with it | flimsy | high | `await page.waitForTimeout(1200); await page.keyboard.press("Enter"); … toHaveText(/^take · 1\.\d s$/ …)` The same file (:206-209) explains why this fails: Playwright's own steps "took half a second on a loaded CI runner, so a fixed '1.x s' read the runner". | Assert `/^take · \d\.\d s$/` and `not.toHaveText("take · 0.1 s")`, or time Enter→Enter in the page as :210-226 does. |
| audio_in_takes:226 | CAPTURE's RECORD puts a take of its input in the sound, and a key plays it | flimsy | high | `expect(Math.abs(said - held), …).toBeLessThanOrEqual(0.15);` allows 150 ms between page click events and the worklet's frames on a loaded runner | Allow the display's rounding plus the message latency (e.g. 0.5 s). The exact frame count is the worklet's, and worklet-take.test.mjs:51 proves it exactly. |
| audio_in_takes:228-233 | same | implementation, duplicate | medium | `const t = window.__aur.wb.tree.root.Capture.take; return t ? t.length / t.sample_rate : 0;` | Delete it. `.take-line`'s "take · N s" (:223-226) is the length a player sees. |
| audio_in_takes:236 | same | flimsy | high | `await page.waitForTimeout(1000);` before the key that plays the take stands in for "the take's edit reached the voices" | Wait for the state (the edit's reply, or the bench settled), or poll the output while the key is held. |
| audio_in_takes:170, 189 | a tracked sound plays from the input with one voice, and keys over it stop with their keys | flimsy | high | `await page.waitForTimeout(2500);` after the keys go up, then `expect(Math.abs(after - alone)).toBeLessThan(1);` | `await expect.poll(() => loudest(page, 440, 600)).toBeLessThan(alone + 1)` waits for the state and keeps the 1 dB claim. The 1200 ms hold at :167 is a gesture: name it. |
| audio_in_takes:261, 271, 308, 386, 423-428, 439, 468, 472 | (5 tests) | implementation | medium | `expect.poll(async () => (await takes(page)).rolling, …).toMatchObject({ waiting: false });` through `window.__aur.takes()` | Use the visible twins: RECORD's `.take-rec.on`, the "recording…" line, `.kept-row`'s count and RECORD AGAIN's text. "Waiting for its input to open" (:423-425) has no visible sign. That is a gap in what the module says, so give it one and assert that. |
| audio_in_takes:417, 426, 430-432, 441 | a sound whose take couldn't be read is kept safe, and RECORD AGAIN brings it back | implementation | medium | `expect(st.recordId).toBe("mic-a"); expect(st.voiceId).toBe("mic-b");` | Assert by sound and at the stub's boundary: the new take, played, holds 440 Hz (Fake Mic A) and not 660 Hz; the monitored bench still sounds 660 Hz; and afterwards `__pwLiveTracks()` is `{ "mic-b": 1 }`, as audio_in:165 reads it. |
| audio_in_takes:262-268 | a STOP before anything was recorded… | implementation | low | `live.node.port.dispatchEvent(new MessageEvent("message", { data: { type: "take_done", … frames: 0 } })); live.takeStop("node");` | Keep it, since it is documented as the only way to stage the race. List `getLive` among the fixture's allowed debug hooks (§4). |
| audio_in_takes:272, 309, 424 | (3 tests) | idiom | low | `await page.waitForTimeout(1000);` / `1500` are "nothing happens" windows | `app.quiet()` |
| audio_in_takes:447 | RECORD AGAIN says plainly when the browser refuses the input, and records nothing | misnamed | low | The title omits the keyboard walk, `while (presses < 120 && … indexOf("kbd") < 0)`, onto the kept-safe row and Enter | Split, or name the walk in the title. |
| audio_in_takes:409, 494, 513, 517, 520, 529 | (2 tests) | idiom | low | `expect((await focused(page)).stop).toBe("ain-monitor");` | `await expect(input.locator("[data-stop='ain-monitor']")).toBeFocused()`, and `toHaveCount(0)` for :409. |

### fixture_tap.spec.js (2 tests, on the fixture)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| fixture_tap:36 | a hold armed with from begins at the request it names, and is spent once it has | implementation, duplicate | medium | `expect(await page.evaluate(() => ({ next: window.__tap.holdNext, from: window.__tap.holdFrom })), "spent once begun").toEqual({ next: [], from: null });` | Delete it. Lines 40-43 prove "spent" by behavior: the same request again holds nothing. |

### Node units (apps/web/tests)

| file:line | test | categories | severity | evidence | action |
| --- | --- | --- | --- | --- | --- |
| worker-lanes.test.mjs:34-47, 56-65 | a clear after a set is answered after it, and so is a read | vacuous | high | `served(msgs)` is the test's own model of the scheduler: "beside a model of how the worker serves its lanes … That model is `serveNow` and `nextLong`". Only `laneOf` and `blocked` are lifted from the worker. | The order asserted is the model's, so a wrong scheduler in worker.js passes. Lift `serveNow`/`nextLong` as :76-104 does, or drive the real worker (§3). |
| worker-lanes.test.mjs:67-74 | the own-sound requests never await the wirings fetch | implementation | medium | `assert.doesNotMatch(body, /await/, \`${type} awaits inside dispatch\`);` asserts on source text | With the §3 harness, stall the wirings `fetch` and assert `own_sound` is answered. Until then, keep it, labelled as a source check. |
| worker-lanes.test.mjs:103 | a face the player is looking at goes before a measurement nobody waits on… | implementation | medium | `assert.match(lift("measure"), /idleOnly\(m\) && \(laterWaiting\(\) \|\| seenFaceWaiting\(lanes\)\)/);` | The behavior is a background measurement yielding to a looked-at face mid-run. Make it a round trip in the harness. |
| words.test.mjs:390-396 | the palette is the engine's eighteen, in its order, each in the house voice | misnamed, level | high | `assert.deepEqual(PALETTE.map((c) => c.name), ["Bright", "Snap", … "Lo-fi"]);` compares the JS copy with a third, hand-written copy. Rust (perform.rs:1795-1798) checks only that the six lead and names are unique. | Compare it with the engine's list: a wasm export, or `PALETTE`'s names lifted from crates/auracle-session/src/perform.rs, as worker-lanes lifts from worker.js. |

No node unit re-proves what a Rust crate already proves. faces.test.mjs:29 reads `fixtures/live-frame-face.json`, which `auracle-features` face.rs:441-473 pins, so the JS live meter and the engine's face are checked against one file. That is a cross-language check, not a duplicate. worker-perform-replies.test.mjs lifts `performReply`, `measure` and `walkRun` out of worker.js by brace-matching into `new Function` with ten stubbed free variables. It is brittle to a rename, but sound until §3 exists.

## 2. Per-file summary

Test-seconds are the mean per run (fast tier unless marked). Actions count findings; a test with no finding is a keep.

| file | tests | on fixture | keep | rewrite | merge | move | delete | split | test-s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shell_levels | 10 | no | 2 | 6 | 0 | 1 | 2 | 1 | 85.7 |
| model_view | 8 | no | 0 | 8 | 0 | 0 | 2 | 0 | 84.7 |
| keys_are_not_notes | 3 | no | 0 | 5 | 1 | 0 | 0 | 0 | 26.1 |
| keys_for_the_platform | 2 | no | 0 | 1 | 0 | 0 | 0 | 0 | 8.6 |
| space_after_a_click | 4 | no | 0 | 7 | 0 | 0 | 0 | 0 | 31.6 |
| text_fits | 6 | no | 2 | 0 | 1 | 2 | 0 | 0 | 28.9 |
| type_scale | 4 | no | 0 | 6 | 0 | 0 | 0 | 0 | 13.8 |
| responsive | 5 | yes | 0 | 3 | 0 | 2 | 0 | 0 | 51.0 + 135.5 @slow |
| narrow_gate | 4 | no | 4 | 1 (file) | 0 | 0 | 0 | 0 | 1.4 |
| budgets | 4 | no | 0 | 5 | 1 | 0 | 0 | 0 | 60.9 |
| smoke | 2 | no | 0 | 1 | 0 | 1 | 0 | 0 | 3.9 |
| failure_flows | 4 | no | 0 | 7 | 0 | 1 | 1 | 0 | 43.4 |
| booth | 1 | no | 0 | 3 | 0 | 0 | 1 | 0 | 13.4 |
| film_chip | 3 | no | 0 | 2 | 0 | 1 | 0 | 0 | 20.4 |
| midi_announced | 1 | no | 0 | 1 | 0 | 1 | 0 | 0 | 8.6 |
| boot_agrees | 1 | no (no page) | 0 | 1 | 0 | 0 | 0 | 0 | 3.7 |
| audio_in | 14 | no | 1 | 8 | 0 | 5 | 1 | 1 | 244.9 + 49.4 @slow |
| audio_in_takes | 9 | no | 1 | 8 | 0 | 0 | 1 | 1 | 175.7 |
| fixture_tap | 2 | yes | 1 | 0 | 0 | 0 | 1 | 0 | 1.7 |
| **browser total** | **87** | **2 of 19 files** | **11** | | | | | | **~908 fast + ~185 @slow** |
| node units (11 files) | 125 | n/a | 121 | 4 | 0 | 0 | 0 | 0 | ms |

"keep" counts tests with no test-specific finding; the other columns count findings (a row's action), so a test can carry several. "move" includes moves to js-unit, to Node, and to the worker-protocol level.

## 3. Category 9 (level): the worker-protocol level, and what would move

### (a) Does a worker-protocol level exist? Could it?

**No harness exists.** The nearest things are:
- **boot_agrees.spec.js:68-69.** It loads `apps/web/pkg` in Node, with no page: `await import(pathToFileURL(…/auracle_wasm.js).href)` then `engine.initSync({ module: fs.readFileSync(wasm) })`. That proves wasm-bindgen's `web` target runs under Node 26.
- **worker-lanes.test.mjs and worker-perform-replies.test.mjs.** They lift individual functions out of worker.js's source by brace-matching and run them with stubs. That is a partial, brittle stand-in for this level.

**It is feasible; not built here.** worker.js's whole browser surface is:
- `self.location.href` (:10, :2752, :1969), `self.postMessage` (:16), `self.onmessage` (:2590) and `self.addEventListener("unhandledrejection")` (:1160);
- a dynamic `import(\`./pkg/auracle_wasm.js?v=${V}\`)` (:2746), then `mod.default({ module_or_path: m.module || new URL(…wasm…) })`. Main passes a compiled `WebAssembly.Module` in `init`'s `m.module`, so the harness passes one too and the binary is never fetched;
- `fetch` of `perform-wirings.json` (:1969);
- `self.indexedDB` for the face cache, guarded by `if (!self.indexedDB …) return null` (:1214);
- `m.farmPorts` (MessagePorts).

**No `OfflineAudioContext` or `AudioContext` appears in worker.js, or anywhere in apps/web outside the page's audio.** Renders are wasm (`memo_render`), so the engine renders in Node.

**What it would take: a ~40-line shim plus helpers.** The simplest path is a `node:worker_threads` entry file that sets up the worker's globals and then `require`s worker.js:
- `globalThis.self = globalThis`;
- `self.location = { href: pathToFileURL("apps/web/worker.js") + "?v=test" }`;
- `self.postMessage = (m, t) => parentPort.postMessage(m, t)`, and `parentPort.on("message", (d) => self.onmessage({ data: d }))`;
- `fetch` stubbed to read `apps/web/perform-wirings.json` from disk;
- then `require("…/apps/web/worker.js")`.

worker.js has no top-level `import`, `export` or `importScripts`, so it should load as CommonJS, and the dynamic `import()` at :2746 works inside CommonJS. Build the `WebAssembly.Module` inside the thread from `fs.readFileSync(pkg/auracle_wasm_bg.wasm)`, and have the shim put it into the `init` message as `module`. That avoids relying on posting a Module across threads.

`farmPorts` can be empty (the `?farm=0` path; ADR: farm width cannot change a result), or Node `MessageChannel` ports wired to farm.js running under the same shim. The test posts `{ type: "init", seed, poolSize }` and awaits replies by type, much as the fixture's `app.reply` does.

**Verify first:**
1. That worker.js loads under `require`. If it does not, `vm.runInThisContext` is the fallback, but then its `import()` needs `importModuleDynamically` (Node 22+: `vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER`).
2. That `import()` of a query-stringed `file:` URL resolves `./pkg/auracle_wasm.js?v=test` relative to the worker's location. Each distinct query is a separate module instance.
3. That wasm-bindgen's `default({ module_or_path: Module })` accepts the Module in Node. boot_agrees uses `initSync({ module: bytes })`, which is the fallback.

**Limits:**
- no AudioWorklet: live-audio.js's PROCESSOR and LivePoly in the worklet, though worklet-take.test.mjs already runs PROCESSOR with a stub port;
- no page lanes (main's bench lane), toasts, views, Web Audio output, AUDIO IN capture (MediaStream) or farm.js's spawn by main;
- IndexedDB absent (the face cache is off; `fake-indexeddb` if needed);
- timing is Node's: the same V8 and wasm speed, without page contention.

### What would move

**Worker-protocol, if the harness existed.** Test-seconds are mean per run.

| test | now | moves | stays in the browser |
| --- | --- | --- | --- |
| responsive:45 | 34.4 s, fast | `render` answered before `perform_wired` | a real bank ▶ heard during a measurement |
| responsive:191 | 101.8 s, @slow | `hide`/`show` vs a later drift | that a level change sends hide/show |
| audio_in:345 | 22.1 s, fast | the clip's phrase reaches the farm before its renders | nothing |
| audio_in:367 | 49.4 s, @slow | `farmResent` to a crew standing | nothing |
| failure_flows:320-324 (part of 15.8 s) | fast | the refused vote's `status` reply shape | pips, star and toasts rollback |
| failure_flows AU-S2 non-fatal half (:233-241) | fast | `import` without `json` → non-fatal `engine_error`, engine still answers | the toast and the alarm |
| smoke:79 | 0.1 s | the binding surface, in Node like boot_agrees | — |
| worker-lanes.test, worker-perform-replies.test | ms | become real round trips instead of lifted source | — |

**Leaving the browser tier:** about **57 s of fast-tier** test time (34.4 + 22.1 + 0.1, plus part of failure_flows), which is the PR gate, and about **151 s of slow-tier** time (101.8 + 49.4). In other areas the same harness would host the engine-fact specs (offers, measurements, lane orders) that today boot a page only to read `app.reply`.

**js-unit moves with no harness needed**, each keeping a thin browser check:
- shell_levels:112-128 and :218: levels.js already covers these; saves about 9 s.
- film_chip `say` decision: extract from main.js; about 11 s of its 20 s.
- midi_announced: midi.js `createMidi(host)`; the browser keeps one toast.
- text_fits caption and callout lists: export from perform.js and main.
- audio_in `realId`, the channel count, and the `ASK_HOLD_MS` reconcile: `createAudioIn(host)` with `mock.timers`. This removes the 16 s wait, and audio_in:478 (15 s) shrinks to a unit.

### (b) Node units against the Rust crates, and logic only in the browser

- **No node unit tests something a Rust crate already proves.** faces.test.mjs:29 is a deliberate cross-language check on a Rust-pinned fixture. words.test.mjs:390 is the opposite problem: it claims to check the engine's palette and checks a hand copy (finding above).
- **Pure logic still tested only in a browser:**
  - film chip sequencing (main.js `pointFilmChip`);
  - MIDI's mapping sentences (midi.js `assign`);
  - PERFORM caption states (`paintKnob`) and PATCH callout states (`renderNextStep`), which exist only as hand lists in text_fits;
  - AUDIO IN's default-device resolution (`realId`), channel-count choice and ask-hold reconcile (audio-in.js);
  - CAPTURE's four-second stop (takes.js / the worklet buffer; worklet-take covers only "stops at the buffer's end");
  - type_scale's reduced-motion durations, which belong to `tokens.py` and need only one browser read.

## 4. The fixture and the config: design review

**Idiomatic where it counts:**
- `base.test.extend` gives the auto fixture `pageErrors`, which watches every page of the context, and the `consoleErrors` option.
- The per-test `app` fixture attaches the tap's toasts and counts when a test fails.
- `app.reply` and `app.toast` are `expect.poll`s with messages, and `booted()` is a web-first `toHaveClass`.
- Seeding (SEED, PERFORM_SEED, `AURACLE_SEED=random` for the flake hunt) is well designed.
- `app.quiet()` names the one fixed wait.
- `app.engine(fn, { ms })` grows the test's timeout by the wait's own bound, so a slow engine doesn't eat the test's budget.

**Where it fights the tools or leans toward internals:**
1. **`App` is protocol-centric.** About 30 of its methods are about messages (`replies`, `last`, `count`, `sentCount`, `sent`, `log`, `facts`, `hold`, `held`, `holding`, `release`, `amend`, `holdRequests`, `stall`, `answer`, `delay`, `busy`, `fail`, `inject`, `post`). About 6 are about what a player does (`level`, `warmStart`, `teach`, `openOnPerform`, `reached`, `toast`). `count`, `sentCount` and `log` hand out exact counts of internal requests, which the rubric names as implementation. The API makes asserting a message the easiest thing a spec can write. AGENTS.md sanctions this only "where the message is the behaviour", and nothing in the fixture steers toward the screen.
2. **`app.engine((timeout) => expect(x).toBeEnabled({ timeout }), { ms })` is a wrapper every engine wait must hand-wrap.** A configured expect, `app.slowExpect = expect.configure({ timeout: ENGINE_MS })`, with the timeout growth applied inside it, would read as Playwright.
3. **Some helpers aren't web-first.** `reached()` uses `page.waitForFunction` reading `.unwired` classes; `poolRows()` polls a count where `expect(locator).toHaveCount(n, { timeout })` fits; `stalled()` polls an evaluate.
4. **The TAP is a 180-line JavaScript program in a template string** (fixtures.js:110-292). Neither `node --check`, the editor nor the linters ever see it, and only fixture_tap.spec.js tests it. Move it to `tests/web/tap.js` and load it with `addInitScript({ path })`.
5. **`window.__aur.*` reads are not owned by the fixture:** 27 across the suite, 14 in this area (`audioIn()`, `takes()`, `wb.rack`, `wb.tree`, `marks()`, `getLive()`). Either expose a documented, minimal set through `app` (e.g. `app.debug.audioIn()`) so that a reviewer sees every internal read, or forbid them with a lint and give each one a visible twin.
6. **Adoption is the dominant problem in this area.** 17 of 19 spec files are off the fixture (#170), and each re-implements its own boot, seen flags, page-error collection and Worker tap. That makes five more Worker taps (model_view, keys_are_not_notes, budgets, failure_flows, audio_in_stub), each unseeded.

**shell.js** (the helper): reviewed, keep. `goLevel`, `openKeys`, `bankTab`, `modelView` and `openCatalog` click as a player does, then wait on the app's own hooks (`aria-current`, `aria-selected`, `body.model-view`, the popover's visibility), with no test-only attributes. Two small notes. `modelView` reads `body`'s class with `evaluate` to decide whether to click, which is fine as a branch. `openKeys` and `openCatalog` use `isHidden()`, which is a snapshot, but both are followed by a web-first `toBeVisible`. **audio_in_stub.js** is sound as a boundary stub (it answers as Chrome does, unplug and replug fire `devicechange`). Its INIT, though, is a fifth Worker tap and a fourth output analyser, and belongs in the fixture.

**Helpers the specs keep hand-rolling** (copies in this area):
- an output meter (`__pwPeakDb` / `__pwAt` / `loudest`): 4 copies, including patch_audible;
- opening a preset onto PATCH (bank tab → row → `#rack-subject` → knobs): 6 copies (space_after_a_click, audio_in, audio_in_takes, shell_levels, model_view, responsive). patch_page.js `openPreset` serves only PATCH's specs;
- a patch file import (`openFile` → `#patch-import-input`): 2 copies;
- IndexedDB seeding before boot and reading the record: failure_flows `idb` and its `/__seed` route, audio_in_takes keptSafeVisit. The fixture has only `savedUi()`;
- a MIDI stub: 2 copies (midi_announced, perform_recentre);
- an audio-input stub: audio_in_stub.js, which should be a boot option;
- a platform stub: keys_for_the_platform;
- in-page timing (`until`, `pickAndTime`): budgets and evolve_ahead;
- a quiet-window watcher that observes through the window (a MutationObserver counter, as model_view's `__pwModelSeen` does) rather than reading once at its end. That would fix audio_in:337, booth:34 and keys_are_not_notes:136 in one stroke;
- `warmStart` + `poolRows` and `teach`, which model_view and audio_in:367 rewrite by hand.

**playwright.config.js:**
- The header comment (lines 1-9) describes only smoke and failure_flows.
- `reuseExistingServer: !OWN_PORT` makes reusing :8642 the default locally, which is the footgun tests/web/AGENTS.md warns about. Default to an own port.
- There is no project without a browser, so boot_agrees and (once moved) smoke:79 take a browser ticket for no reason.
- `fullyParallel: true` with `workers: 1` is right for dealing by test.
- `retries: 0`, `forbidOnly` on CI and the trace settings are sound.

## 5. Gaps (clear, important, described in the guide)

| behavior | where it is described | covered? | action |
| --- | --- | --- | --- |
| Booth's **New visitor** (⇧Esc, or ⋯ → New visitor) forgets the visitor's taste, shows the warm start on a new pool, and keeps booth mode and PERFORM's measurements | www/docs/src/getting-started/running-locally.md:91-94 | No spec; booth.spec.js covers attract and the key hand-over only | Add a spec: ⇧Esc in booth mode → warm start shown, picks counted 0, `?seed` gone, booth still on. |
| Booth hands over on a click, touch, wheel or MIDI note, not only a key | running-locally.md:87-88 | Only a key (booth:28) | Add one pointer case beside the key. |
| A sound with AUDIO IN opened with **no** remembered grant asks nothing and shows **ALLOW INPUT** | www/docs/src/playing-through.md:16-19 | Only the granted case (audio_in:289-301); ALLOW INPUT is mentioned only as hidden (audio_in_takes:507) | Add it: open a file with AUDIO IN in a fresh context → `__pwMic.calls` 0, ALLOW INPUT visible. |
| CAPTURE **stops by itself at four seconds** | playing-through.md:147-155 | No spec or unit; worklet-take covers only the buffer's end | Unit (takes.js / worklet) plus the visible line "take · 4.0 s". |

## 6. Recurring patterns (worth a helper, a lint or a rule)

1. **Off the fixture: 17 of 19 files.** Each has its own boot, seen flags, page errors and tap, and is unseeded. Rule: finish #170 for this area. Lint: no `require("@playwright/test")` in `*.spec.js`.
2. **A "nothing happens" window shorter than what it waits for, or read once at its end:** audio_in:337 (2 s vs a 6 s capture), model_view:129 (600 ms), keys_are_not_notes:136 (200 ms), booth:34. Rule for tests/web/AGENTS.md: a negative watches through the window (an observer, or a poll that must stay false), lasts at least as long as the thing it rules out, and goes through `app.quiet`.
3. **Wall-clock bounds under the repo's own 1.5 s rule:**
   - budgets:232-233 (300/150 ms), whose twin is already quarantined;
   - budgets:148 (100 ms);
   - space_after_a_click:128 (400 ms);
   - audio_in_takes:226 (150 ms) and :501 (a "1.x s" take);
   - failure_flows:319 (6 s).

   Above the line but pointless: audio_in:151 and :321 (2 s on a toast behind a held prompt) and responsive:119 and :125 (2-3 s). Those are tagged idiom.
   Lint: flag a numeric `toBeLessThan`/`timeout` under 1500 in specs unless the line carries a `// budget:` tag. Rule: a speed promise lives in budgets.spec.js, with the annotate-when-the-machine-is-slow escape hatch, and nowhere else.
4. **`window.__aur.*` reads where a visible twin exists:** 14 in this area, 27 suite-wide. Lint `__aur\.` in specs against a short allow-list (`getLive` to stage a worklet race; `marks` until the film recorder reads `performance` marks).
5. **Hand-copied lists of what the app can say or do:** text_fits CAPTIONS and CALLOUTS, smoke:79 methods, words.test:390 PALETTE. Rule: import the list from its source, or derive it, so a new entry is checked by default.
6. **Single reads straight after an action** (`expect(await x)`): model_view:96, :105; failure_flows:337, :348; audio_in:531; booth:34. Rule: after an action, assert with `await expect(locator)` or `expect.poll`. Lint `expect\(await ` in specs.

## 7. Deletions recommended, and what keeps the behavior covered

- **model_view:245** "the model view's words say what it is, never a lens". Kept by `www/checkwords.py` (`lens | player`, apps/web baseline 0, `make dev-check`), words.test.mjs:692 and :704, and patch_model_view.spec.js:87. First merge its `#model-btn` title assertion (:257) into model_view:136.
- Delete these assertions (not whole tests). The listed lines keep their behavior:
  - shell_levels:232 → :230;
  - model_view:292 → :294-299;
  - failure_flows:190, :265, :281 → the alarm's words and survival;
  - audio_in's `__aur.audioIn()` reads → their visible twins;
  - audio_in_takes:228-233 → :223-226;
  - fixture_tap:36 → :40-43.
- **Do not delete budgets:188** in favor of evolve_ahead:75. That test is `@quarantine` (#160), so the gate would lose the behavior. Merge as described above.
