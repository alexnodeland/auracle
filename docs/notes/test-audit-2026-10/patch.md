# Test-quality audit: PATCH's browser specs

Area: `tests/web/patch_*.spec.js` (14 files, 92 tests counting the two
viewport variants of patch_catalog's last test) and the helper
`tests/web/patch_page.js`, at `main` 42bd322. Read against `apps/web/patch.js`,
the relevant parts of `apps/web/main.js` and `worker.js`, the guide
(`www/docs/src/rack.md`, `wiring.md`, `keyboard.md`, `views/play.md`), ADR-004,
ADR-012, `docs/architecture/testing.md` and `tests/web/AGENTS.md`. Nothing was
run. Times are the mean of the three CI runs in the blob reports of CI runs 37383132211, 37379867024 and 37345520856 (fast tier) and 37381447489 (slow tier)
(the `@slow` ones from `rows-slow.json`).

All paths below are under `tests/web/` unless they say otherwise. In the
table, `\|` is a literal `|` inside quoted code.

## Findings

| file:line | test title or fn name | categories | severity | evidence (quoted) | action |
|---|---|---|---|---|---|
| patch_page.js:183 | legacy tap: `boot`, `warmStartAndFit`, `now`, `holdCrew`, `releaseCrew`, `drawnGuessOnPage`, `init`, `SLOW` | duplicate, idiom | medium | `// Until perform_offer_latency.spec.js is on the fixture (#135), it boots through this file's old tap` — but perform_offer_latency.spec.js:42 now has `require("./fixtures")`, and no file requires these exports | **delete** lines 183–336, the `isApp` branches in `openPreset`/`drawnGuess` (14–15, 24–25, 31, 148) and the five names in `module.exports`. Nothing uses them; the fixture's tap does what they did. |
| patch_page.js:78 | `settled` | idiom | low | `await app.page.waitForTimeout(LANE_QUIET_MS);` with `LANE_QUIET_MS = 700` | rewrite: a second "nothing happens" window below the fixture's `QUIET_MS` (1.5 s) and below the 1.5 s floor in AGENTS. Either use `QUIET_MS`, or say in the comment why 700 ms is enough (a held drag value is sent in the reply's own task, so the counts never agree between the two). |
| patch_audible.spec.js:902 | Space in PERFORM and EVOLVE plays the sound as edited, and waits for an edit still at the engine | flimsy | high | `expect(waits.t - at.space, "within 100 ms of the press").toBeLessThan(100);` | rewrite: the guide (keyboard.md:68, play.md:137) promises the sign stands in *until the edit lands*, not a latency. Assert `waits.t < landed` (it was up before the reply) and keep `whole/onScreen/onTop`. If a press budget is wanted, it belongs in budgets.spec.js with slack. |
| patch_audible.spec.js:930 | a ▶ waiting for an edit is lit at once, and a second press, Space, another ▶ or leaving PATCH takes it back | flimsy | high | `expect(litMs, "lit within 100 ms of the press").toBeLessThan(100);` | rewrite: assert the `pending` mark came before the edit's reply (`__pwPlaySaid` entry `t < benchAt[n]`), which is what "lit at once" means to a player; drop the 100 ms bound (not in the guide). |
| patch_audible.spec.js:768 | a selector whose check fails is not applied and says so, and a knob turned after it is not muted for it | vacuous | high | `expect(await peakDb(page), "still sounding").toBeGreaterThan(-60);` read straight after `pastReply` | rewrite: the analyser holds `fftSize` 16384 samples (≈ 0.37 s) of history, so a read right after the reply still contains the sound from before a wrong mute (`setLiveMuted(true)` runs in the reply's task, main.js:2871). `await app.quiet()` first, then read. (Line 759 is sound: the voices are handed a tree in the reply's own task, main.js:2848.) |
| patch_audible.spec.js:1015 | a ▶ waiting for an edit is lit at once, … | implementation | medium | `await expect(play).toHaveCSS("outline-width", "2px");` | rewrite: keep the documented cue (dotted amber border, play.md:135) and `outline-style: solid` (a focus ring shows); drop the 2 px width, which no description promises. |
| patch_audible.spec.js:911 | a ▶ waiting for an edit is lit at once, … | misnamed | low | the title omits lines 948–959 (`"the waiting ring while playing"` dotted amber over a lit face) and 1005–1018 (the focus ring kept while waiting) | rename to cover both, or split the two ring checks into "a waiting ▶ wears a dotted amber ring, playing or focused". |
| patch_audible.spec.js:291 | `SLOW`, `slow()` (line 340) | idiom, duplicate | low | `if (d && d.type === "__pw_slow") { __pwSlow = d.slow \|\| {}; …` — the fixture's `BUSY` (fixtures.js:310) is the same prefix | rewrite: `app.boot({ busy: true })` and `app.busy({ edit_param: 1500 })`; keep only `__pw_slow_render`, or move it into the fixture as a second `busy` mode. |
| patch_cables.spec.js:56 | cables carry light by the levels the engine measured, … | implementation, level | medium | `expect(w.opacity, …).toBeCloseTo(0.2 + 0.62 * lv, 2);` copies main.js:10738 `wireEl.style.strokeOpacity = (0.2 + 0.62 * lv).toFixed(3);` | rewrite: the guide promises "the brighter the cable, the louder" (rack.md:38), not this formula. Assert order (a louder measured cable is never dimmer) and keep line 58's bars (one bar per third of −54..0 dB is documented, rack.md:40). **Move** the dB→light and dB→bars mapping (patch.js `gainOf`, line 188's thresholds, main.js `paintWireLevel`) into a pure module with a `node:test`. |
| patch_cables.spec.js:84 | cables carry light by the levels …; also 86, 106, 140, 142 | vacuous | high | `(await drawn(page)).marks.every((m) => m.unknown)` — `every` over a list that can be empty (drawMarks skips a wire whose `getTotalLength()` is 0, patch.js:177) | rewrite: `marks.length > 0 && marks.every(…)`, as the same file's @slow test already does (line 291). Low practical risk today (`rackBuilt` repaints the marks in the rebuild's task, patch.js:1254), but the guard costs nothing. |
| patch_cables.spec.js:36 | cables carry light by the levels the engine measured, keyed as the rack draws them, and modulation cables carry none | misnamed, idiom | low | the title names two behaviors; the test also checks one probe per drag (67–90), a new patch's probe (92–106), unlit before measured (108–142) and one probe at a time (143–156) | **split** into "…modulation cables carry none", "a knob drag asks one probe after it settles, its marks hollow until then", and "a new structure is unlit until it is measured, one probe at a time"; or rename to say all of it. |
| patch_cables.spec.js:286 | a knob turned in PATCH lights its cables again while a measurement nobody is waiting on runs (@slow, 112 s) | level, cost | medium | the behavior is worker.js scheduling: `idleOnly`, `laterWaiting()` and `measure`'s yield (`idleOnly(m) && (laterWaiting() \|\| seenFaceWaiting(lanes))`) | **move** to js-unit: add "a cable probe waiting in LATER makes a background `perform_wire` give way, and it resumes" to `apps/web/tests/worker-lanes.test.mjs`, which already lifts `nextLong`/`idleOnly`/`measure` for the faces case. The browser keeps nothing extra: cables relit after a knob turn is :36 lines 67–86. −112 s from the slow tier. |
| patch_cables.spec.js:224 | sounds opened right after arriving in PATCH are not kept waiting behind a cable probe | idiom | low | `page.waitForFunction((x) => window.__aur.wb.subjectId === x, id, { timeout })` | rewrite: `app.reply("bench", { where: { subject: id } })`, the engine's word, not main's private field. |
| patch_cables.spec.js:36 | (gap) the mark's number on hover | gap | — | rack.md:41: "point at it for the number, *measured at rest: −14 dB*"; no spec reads the mark's `<title>` | add to :36: each mark's `title` reads `measured at rest: ` plus the level word for its `rms_db`, and "not measured yet" / "changed since it was measured" while hollow. |
| patch_camera.spec.js:52 | −, + and fit in the corner zoom the camera and frame the patch again | vacuous | high | `expect((await viewBox(page))[2]).toBeLessThan(fitted[2] * 1.5);` after +, −, − (×1.25 each, main.js:16873): the view is 1.25× the fit before FIT is pressed, so this and the every-plate-in-view poll (lines 45–51) both hold without the press | rewrite: zoom **in** until a plate is outside the well (assert one is), press FIT, then assert every plate inside and the width within 2% of `fitted`. |
| patch_camera.spec.js:112 | map shows the minimap, a shift-click bookmarks a spot, and ⇧1 goes back to it | vacuous, misnamed | high | `return Math.abs(v[2] - marked[2]) < 2;` compares only the zoom, which is the fit's zoom; a ⇧1 that only fitted, or restored the zoom but not the spot, passes | rewrite: pan away before ⇧1, and assert the view's centre lands on the bookmarked point (`bmJump` centres on `b.x, b.y`, main.js:13900), plus the zoom. |
| patch_camera.spec.js:148 | zoomed in, the well's edges count the modules past them, and a press brings the nearest in | vacuous | high | `await expect.poll(async () => (await viewBox(page))[0], …).not.toBeCloseTo(x0, 0);` passes for a pan in either direction | rewrite: assert the pressed edge's count falls (or it hides), or that the nearest module past it now has its plate inside the well. |
| patch_camera.spec.js:142 | zoomed in, the well's edges count … | idiom | low | `const n = Number(await edge.locator("b").textContent()); expect(n).toBeGreaterThan(0);` | rewrite: `await expect(edge.locator("b")).toHaveText(/^[1-9]\d*$/)`. |
| patch_canvas.spec.js:88 | the head names the patch and counts what the rack is made of, in signal order | implementation | medium | expected counts come from `window.__aur.wb.rack.modules` (line 41), main's own copy, the data the subtitle is computed from | rewrite: Reese is a fixed preset (crates/auracle-grammar/src/presets.rs:267): `toHaveText(/^4 modules · 1 modulator, in signal order/)`. |
| patch_canvas.spec.js:105 | the face at OUT is the bench's face, past the amp, and a click on it plays the sound | implementation | medium | `for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193);` re-implements main.js `treeRef` | rewrite: take the ref from the `faces` request the page sent with the bench's tree (`app.sent("faces")`, item whose `tree === app.last("bench").treeJson`), as patch_facts.spec.js:62 does, and compare it to `#out-face[data-face]`. |
| patch_canvas.spec.js:132 | the edit bar appears after an edit, counts it, and KEEP AS NEW keeps it as a new sound | duplicate | medium | `expect(committed.outcome).toBe("self_edited");` — the same path (knob, PICK THE EDIT, KEEP AS NEW, outcome) as patch_editing.spec.js:546 | **merge**: keep the edit bar here (hidden at rest, "1 change", hidden after the keep) and assert what the player sees of the keep (the receipt `Kept … as new`); the outcome code stays in patch_editing.spec.js:538. |
| patch_canvas.spec.js:150 | undo to as opened takes every change back in one restore, and ⇧⌘Z brings them back one at a time | implementation | medium | `expect(await sets()).toBe(before + 1);` counts internal `edit_set_tree` requests | rewrite: "one restore" is already shown by `#pt-ed-n` "as opened", the tree equal to `opened`, and the toast "2 changes undone"; drop line 150 and keep 160 (a refused press posts nothing, which is the behavior). |
| patch_canvas.spec.js:207 | L locks the selected module, its edge goes solid amber, and ⚡'s ▾ clears it | misnamed | low | `await expect(edge).toHaveCSS("stroke-dasharray", "none");` — solid, never amber | add the stroke's colour (`tokenRgb("--phos-b")`, as patch_audible does), or drop "amber" from the title. |
| patch_canvas.spec.js:210 | L locks the selected module, … | vacuous, duplicate | high | `await page.keyboard.press("l");` (down and up) then `await expect(page.locator('.pkey[data-note="74"]')).not.toHaveClass(/\bdown\b/);` — the key is up before it is read | **delete** the line: keys_are_not_notes.spec.js:125 "L on a rack knob locks it without playing a note" holds the key down while it checks. |
| patch_canvas.spec.js:340 | undo waits for a sound on its way: ⌘Z and undo to as opened, pressed while another opens, post nothing | misnamed, idiom | low | ↺ is never pressed (only `aria-disabled` and its tooltip are read, 355–358); `await page.waitForFunction(() => window.__aur.wb.subjectId != null);` (363) was already true for Reese | rewrite: force-click ↺ while it waits and assert nothing is posted, or say "is disabled" in the title; drop line 363. |
| patch_catalog.spec.js:97 | a module in hand is priced on the well's top line, can be heard at a socket, and Esc puts it down | vacuous, misnamed | high | `toContainText(/rendering\|hear it/)` — "rendering…" is shown by the dwell before ▶ is pressed (main.js `previewDwell`), and "hear it here" means the render is ready, not that anything played | rewrite: wait for "hear it", then assert ▶ plays (`#pv-play` lit by `playBuffer`, or an output level); or drop "can be heard" from the title and leave it to patch_editing.spec.js:373 once that is fixed. |
| patch_catalog.spec.js:335 | beside the open catalog at ${w} px the armed line stays one line …, and the module in hand is drawn clear of every module | vacuous | high | `if (edge) { … expect(drawn, …).toBeLessThanOrEqual(1); }` — the still-pointer regression check is skipped when no edge point is found | rewrite: `expect(edge, "a lit socket's edge to rest on").not.toBeNull()` and assert unconditionally. |
| patch_catalog.spec.js:215 | which way your taste leans on a module shows under the model view only, in the description and the keyboard's card | vacuous | high | `await expect(page.locator("#nb-spec .sp-model")).toBeHidden();` is never matched by a visible check under the model view, so a renamed class passes | rewrite: after MODEL is on, focus the chorus row again and assert `#nb-spec .sp-model` is visible. |
| patch_catalog.spec.js:141 | θ shows under the model view only, and what is set aside is the catalog's first group | idiom, cost | low | two behaviors; only θ needs `app.warmStart()` | **split**: set-aside-first (and SET ASIDE n) in a test that boots warm, without the warm start. |
| patch_catalog.spec.js:291 | beside the open catalog at ${w} px … | idiom | low | `window.__aur.wb.rack.modules.find((m) => m.key === k)?.title` | rewrite: read the plate's `.mod-title` text for that key. |
| patch_catalog.spec.js:181 | a pointer's ✕ on the catalog or on TEACH leaves the focus nowhere, …; also 203 | idiom | low | `expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);` | rewrite: `expect.poll` (a web-first read that waits). |
| patch_editing.spec.js:370 | the newest edit's receipt replaces the last one's, and ⌘Z takes it down | vacuous | high | `expect(after.filter((t) => /held below\|bypassed/.test(t))).toEqual([]);` — the receipt is "… is set aside below …" (line 359, main.js:15236); "held below" is in no app string, so the undone receipt coming back passes | rewrite: `/set aside below\|bypassed/`. |
| patch_editing.spec.js:373 | ▶ plays the socket the preview was rendering, after the pointer has left it | misnamed, vacuous | high | the only waits are `toContainText(/hear it (after\|in)/)` (render ready) and `expect(await previews()).toEqual([key])`; nothing checks that ▶ played | rewrite: after the render lands, assert ▶ plays it (`preview.playOnArrive` → `previewPlay`, main.js:19244: `#pv-play` lit, or an output level); keep the one-render check. |
| patch_editing.spec.js:171 | a knob's element survives the redraw of a knob edit, and is never rebuilt under a held pointer; also 189 | implementation | medium | `expect(await page.evaluate(() => window.__pwKnob.isConnected)).toBe(true);` — DOM identity | rewrite to what a rebuild costs the player: focus knob b, turn a, and `await expect(b).toBeFocused()` after a's reply; for the held pointer, move on after b's reply lands and assert a's `aria-valuenow` follows the hand. |
| patch_editing.spec.js:245 | once a knob has moved, no reply repaints it at an older value | misnamed | high | `const fromFinal = seen.slice(seen.lastIndexOf(finalText) >= 0 ? seen.indexOf(finalText) : 0);` — only the texts from the final value on are checked; an older value painted mid-drag passes | rewrite: parse every text in `seen` from the first move and assert the sequence never goes down (the drag is upward), which is what the title says. |
| patch_editing.spec.js:264 | arrow-key nudges on a slow engine all count, and are one undo step | implementation | medium | `toBeCloseTo(Math.min(1, was + 0.16), 3)` hard-codes the nudge step (0.02) | rewrite: read `aria-valuenow` after the eighth press (what the hand set) and assert the engine's settled value equals it, as the drag tests do; keep the one-undo check. |
| patch_editing.spec.js:525 | Esc on the comparison card commits nothing, and its sides are A and B until the pick | implementation | medium | `expect(await page.evaluate(() => window.__aur.wb.dirty)).toBe(true);` | rewrite: `await expect(page.locator("#pt-ed-n")).toHaveText("1 change")` (the edit is still on the bench, as the player sees it). |
| patch_editing.spec.js:82 | `commitAndDescribe` | idiom | low | `document.getElementById("improve-check").checked = true;` sets the property, skipping the click | rewrite: `await page.locator("#improve-check").check()`. |
| patch_editing.spec.js:408 | HOLD, the octave buttons and notes leave the arp drawer open; also 433 (SYNC RATE) | idiom | low | `await app.boot({ busy: true });` with no `app.busy` call, in a file about the bench lane (also 501, 538, 557) | **move** 408 and 433 to a keys/arp spec; boot without `busy` where nothing is slowed. |
| patch_editing.spec.js:125 | second drag starts from where the first left it; also 195 (⌘Z after letting go), 211, 249, 294 (bypass waits its turn) | level | medium | each proves an ordering rule of the bench lane (`pumpLane`, `queueStruct`, the restore backlog, main.js:14387), which lives in main.js | **move**, after extracting the lane from main.js into a pure module: a `node:test` with a fake `post` and fake replies proves order, "a drag starts from the hand's value", nudge coalescing and restore-after-queue. Keep :95 and :448 as the browser wiring. Conditional on the refactor: −82 s from the fast tier. |
| patch_facts.spec.js:267 | a bred sound shows what its generation changed: … | vacuous | high | `if (rowParts != null) expect(at.from).toContain(…rowParts… " change");` (line 267) | rewrite: `expect(rowParts, "the bank row's from line").not.toBeNull()` first. |
| patch_facts.spec.js:67 | the face of the patch without the selected module is drawn at OUT, measured by the worker, … | implementation | medium | `const expected = node ? JSON.stringify({ ...bench, root: node.Filter.input }) : null;` re-implements bypass on the tree's serde shape | rewrite: get the expected tree from the engine (press *bypass* in the ⋯ menu, read `app.last("bench").treeJson`, ⌘Z), so the outline is held to the verb it previews. |
| patch_facts.spec.js:289 | the readout names the PERFORM controls that turn the knob under the pointer, and a module's, from PERFORM's measurement | cost | medium | 17.3, 85.6 and 82.0 s on CI, in the fast tier, untagged: the wait is PERFORM measuring the boot sound (`{ ms: FLOOR_MS }`) | rewrite: open a preset whose wiring ships (`app.openOnPerform(name, { wired: true })`, answered from `perform-wirings.json` at once) and read the expected wiring from the shipped file for that preset (or the `perform_wired` the page reads back); otherwise tag `@slow` with `test.setTimeout` (tests/web/AGENTS.md: over 40 s on CI). |
| patch_facts.spec.js:246 | a bred sound shows what its generation changed: … | level | medium | the spec re-derives which knobs get a seed pointer: `Math.abs(Number(b) - knobs[a].value) >= 0.004` and the `latent` regex on `ev.diff` | **move** the rule (LineageEvent diff → ticks and pointers, main.js `paintRackFacts`) into a pure module with a `node:test`; the browser keeps one tick, one pointer, *from Reese · N changes*, gone after an edit and back after the revert. |
| patch_facts.spec.js:161 | What goes here? asks the model's guess for a module's place, … | level | low | `for (const g of atMix.data.guesses) expect(g.op.key, …).toBe(mixKey);` | keep in the browser if wanted, but the claim is `guess_candidates(tree, Some(at))`'s: add it to crates/auracle-session/src/guess/tests.rs, where `node/0` is already used. |
| patch_from_nothing.spec.js:107 | Esc on a plate button in a new patch backs out to its plate and keeps the new patch | idiom | low | `expect(await page.evaluate(() => document.activeElement?.getAttribute("data-kind"))).toBe("capture");` | rewrite: `await expect(page.locator('#rack-svg g.mod-group[data-kind="capture"]')).toBeFocused()`. |
| patch_guess.spec.js:47 | the model's guess is drawn at its socket with its reason and forecast, and is added, skipped, and skipped by an undo | vacuous | high | `if (await row.count()) { await expect(row).toHaveClass(/\bguessed\b/); expect(await railNameX(page)).toEqual(xBefore); }` — the guessed kind follows the fit, so under `AURACLE_SEED=random` the branch can skip | rewrite: `await expect(row).toHaveCount(1)` (every guessable kind is in the catalog), then the two checks. |
| patch_guess.spec.js:224 | a guess skipped after keep as new is still skipped when the kept sound is opened again (@slow, 50 s) | level, duplicate | medium | the rule lives in `WasmEngine::edit_commit` (`self.guesses.carry(from, id)`, crates/auracle-wasm/src/lib.rs:3379) | **delete**: `keep_as_new_carries_the_skips_made_after_it` (lib.rs:4469) proves it through the binding; the page's part (× sends `guess_skip`) is :25. −50 s slow tier. |
| patch_guess.spec.js:141 | a new patch's skips are its own: the sound it was started from does not inherit them (@slow, 38 s) | level, duplicate | medium | `expect(back.data.skipped, "Reese took the new patch's skip").toBe(0);` | **delete**: `a_new_patch_files_its_skips_under_its_own_key` (lib.rs:4432) proves it, BACK TO included. −38 s slow tier. |
| patch_guess.spec.js:201 | a guess asked while the bank is still arriving waits for it, then ranks every candidate on a crew (@slow, 121 s; 168 s by its comment) | level, cost | medium | the rule is one line of worker.js `blocked()`: `case "guess": return !m.crewed && bootCrewLive();` | **move** to js-unit: worker-lanes.test.mjs already lifts `blocked` with `bootCrewLive` (line 29); add "a guess not yet crewed waits while boot's crew is live, and a crewed one does not". Ranking on a crew stays shown by :25 (`planned === total`). −121 s slow tier. |
| patch_guess.spec.js:180 | with no render crew, the guess renders the likeliest eight on the engine's thread (@slow, 31 s) | level, cost | medium | `expect(r.data.planned).toBe(8);` — worker.js:1753 `const limit = m.crew ? 0 : GUESS_FLOOR;` | **move**: the binding's serial ranking is already pinned to `planned <= 8` (`a_taken_guess_undone_is_a_skip_through_the_bindings`, lib.rs:4164); the worker's choice of the floor with no crew is a lift-and-run unit, or a worker-protocol test with `farm=0`. The plate drawn for the top guess is :25. −31 s slow tier. |
| patch_guess.spec.js:70 | the model's guess is drawn at its socket …, and skipped by an undo | duplicate | medium | `expect(again.family === drawn.family && again.socket === drawn.socket, "the undone guess came straight back").toBe(false);` | rewrite: drop 70–78 (one more ranking on a crew); `undoing_a_taken_guess_counts_as_a_skip` (crates/auracle-session/src/guess/tests.rs:336) and the binding test (lib.rs:4164) prove the undo-as-skip. Keep the drawing, the reason line, × → next guess, and the take with `guess` on it. |
| patch_guess.spec.js:127 | nothing is guessed before the warm start (fast tier, 30 s) | level, duplicate | medium | `expect(reply.data).toEqual({ reason: "no_taste" });` and `expect(await app.count("farm_want")).toBe(0);` | **merge**: `no_taste` is proven by `nothing_before_the_warm_start` (guess/tests.rs:173) and the binding test; the page's part (no plate, `#guess-read` hidden, no `.guessed` row) fits in patch_canvas.spec.js:311, which already boots without the warm start. "No crew raised" is worker logic: a lifted unit. −30 s fast tier. |
| patch_keys.spec.js:62 | ←/→ walk the modules in signal order, ↑/↓ go into a modulator and back, … | vacuous | high | `expect((await active(page)).kind).not.toBe("lfo");` passes if ↑ drops the focus | rewrite: `toBe("filter")`, back to the module it came from. |
| patch_keys.spec.js:176 | the keys yield to the catalog's search, and the note keys still play on a module | vacuous | high | `await expect(page.locator("#rack-svg .mod-plate.locked")).toHaveCount(0);` — nothing is selected when `l` is typed, so an `l` that leaked to the canvas would lock nothing either | rewrite: focus a module before `/`, so a leaked L would lock it. |
| patch_keys.spec.js:212 | Home and End are the canvas's: on VOL they stay the slider's, and under the comparison nothing behind it moves | vacuous | high | `expect(await structs()).toBe(s0); await expect(page.locator("#rack-svg .rack-plates g[data-key]")).toHaveCount(modules);` read straight after Delete: a deletion could not have reached the engine and back yet | rewrite: `await app.quiet()` before both reads. |
| patch_keys.spec.js:46 | (all nine tests: 46, 49, 52, 54, 56, 60, 72, 89, 92, 94, 134, 194, 209) | idiom | low | `expect((await active(page)).key).toBe(order[0]);` one-shot reads that do not wait | rewrite: `await expect(page.locator(…)).toBeFocused()`, or `expect.poll(() => active(page))`. |
| patch_model_view.spec.js:117 | the model view in PATCH: … letting go restores the canvas; also 133 | implementation | medium | `window.__pwPlates.every((p) => p.isConnected)` — element identity | rewrite to what a rebuild would cost the player: a focused plate keeps the focus across ⌥ down and up (`toBeFocused`), and no arrival animation runs (`getAnimations()` empty). |
| patch_model_view.spec.js:87 | the model view in PATCH: … | level | low | `expect(copy).not.toMatch(/\blens\b/i);` | move to the voice gate: add "lens" to the banned words `www/checkwords.py` counts in apps/web, which proves it for every view with no boot. |
| patch_model_view.spec.js:65 | the model view in PATCH: … | level | low | `expect(vco.text).toMatch(/^VCOs [+−]\d\.\d\d ± \d\.\d\d a guess · shared by 2$/);` (also 61, 128) | move the sentence formats to a `node:test` on words.js (or wherever the chip text is built); the browser keeps one chip per family and `n = 2`. |
| patch_sheet.spec.js:96 | on touch, a tapped module opens a sheet with every setting, and its steps edit the patch | vacuous | high | `if (named) {` — the choices, `aria-checked` and arrow-key checks run only if the filter has a named setting | rewrite: `expect(named, "Reese's filter has its mode").toBeTruthy()` and drop the `if`. Deterministic on Reese today; silent if the preset changes. |
| patch_sheet.spec.js:162 | on touch, a tap on a plate button presses it and opens no sheet | implementation | medium | `await rec.evaluate((b) => b.addEventListener("click", () => { window.__pwRecTapped = true; }));` proves a click event, not that RECORD acted | rewrite: assert RECORD's lit state (`#rack-svg .take-rec` has `on`), as patch_touch.spec.js:146 does. |
| patch_sheet.spec.js:131 | an AUDIO IN module is drawn as the engine describes it, …; also 155 | idiom | low | `window.__tap.engine.postMessage({ type: "edit_set_tree", json: JSON.stringify(t) });` past main's lane; the comment "(the module rail has no AUDIO IN yet)" is stale (audio_in.spec.js:86 places it from the rail) | rewrite: `app.post(…)`, or place it from the rail with `audio_in_stub.js`; fix the comment. |
| patch_sheet.spec.js:67 | on touch, a tapped module opens a sheet …; also 115 | idiom | low | `expect(await page.evaluate(() => document.getElementById("module-sheet").contains(document.activeElement))).toBe(true);` | rewrite: `await expect(sheet.locator(":focus")).toHaveCount(1)` (waits). |
| patch_sheet.spec.js:29 | `tapPlate` (verbatim in patch_touch.spec.js:28) | idiom | low | the same 25-line bare-panel search in both files | move to patch_page.js. |
| patch_touch.spec.js:91 | on touch, a tapped module's sheet shows the bench's face, as made | duplicate, cost | medium | the same boot, preset and tap on the filter as patch_sheet.spec.js:57 | **merge** into patch_sheet.spec.js:57 (add the `.ms-face img.face` and "as made" checks). −8 s fast tier. |
| patch_touch.spec.js:149 | on touch, AUDIO IN's and CAPTURE's lane buttons are in the sheet and press the lane's own | idiom | low | `const r = window.__aur.takes().rolling; return !!r && !r.waiting;` | rewrite: wait for what the lane shows while it rolls (its state or caption), not the module's private state. |
| patch_truth.spec.js:106 | an unplugged socket goes quiet under a held note, and its plate still reads EMPTY (@quarantine #176) | flimsy | high | `await expect.poll(() => livePeakDb(page), { timeout: 3_000, intervals: [100] }).toBeLessThan(-60);` — its own comment says the margin is "for a loaded machine, not for the behaviour" | rewrite: an engine wait (`app.engine(…, { ms: 30_000 })`, or after `settled(app)`), keep the "stays quiet" reads, and lift the quarantine. |
| patch_truth.spec.js:116 | an unplugged socket goes quiet … | implementation | medium | `const mod = await page.evaluate((k) => window.__aur.wb.rack.modules.find((m) => m.key === k), key); expect(mod.kind).toBe("silence");` | **delete** lines 116–117: lines 118–119 (the plate titled EMPTY, the chip's `data-empty`) say it as the player sees it. |
| patch_truth.spec.js:146 | moving a PERFORM control after a PATCH edit plays from the new base | duplicate | medium | perform_circuit.spec.js:8 "a knob turned in PERFORM is drawn performed in PATCH" is a subset of this path (First Bass, Bright turned, `g.performed[data-addr="node#cut"]` with a ghost) | **merge** perform_circuit's readout check (`.knob-value` Hz) into this test and delete perform_circuit.spec.js (that file's owner decides; it rejoined the gate in #172). |
| patch_truth.spec.js:50 | `wirePerform` | idiom | low | `page.waitForFunction(() => /controls reach/.test(…), …)` | rewrite: `app.level("perform")` then `app.reached()` (fixtures.js:762). |
| (gap) wiring.md:122 | dragging a cable between jacks | gap | — | "Drag from an out jack … Drop it on a lit jack"; "move it here" / "branch here"; no spec drags from an out jack | add one: rewire a cable onto a lit input, and onto a filled socket choosing "branch here". |
| (gap) rack.md:243 | the ⋯ menu's other verbs | gap | — | patch_canvas.spec.js:184 lists *replace with, duplicate, probe this output, swap the two inputs*; no spec presses them | add one test pressing *swap the two inputs* (cables swap sides) and *duplicate* (a second module in series), and one for *probe this output*'s scope. |
| (gap) rack.md:192 | hand positions survive a reload | gap | — | "Positions are kept for each patch, survive a reload and a ⚡ generation" | add: drag a plate by hand, `app.reload()`, the plate is where it was. |
| (gap) wiring.md:200 | SET ASIDE drag back | gap | — | patch_catalog.spec.js:169 opens the shelf; nothing drags a module back onto a socket | add the drag back to :141's set-aside half. |
| (gap) rack.md:178 | KEEP AS NEW with nothing changed | gap | — | "KEEP AS NEW stays disabled, and its tooltip says *Nothing to keep yet: turn a knob first*" | add to patch_canvas.spec.js:82 (at rest). |
| (gap) rack.md:278 | an empty socket is silent, in the gate | gap | — | with patch_truth.spec.js:90 quarantined, "it's silent … the subtitle says *silent: nothing reaches the output*" runs only in the slow suite | fix the flimsy bound (row above) and lift the quarantine. |

### Checked and not flagged

- The bars on a cable's mark (patch_cables.spec.js:58) and the −54 dB floor are
  documented (rack.md:40): behavior.
- The waiting ▶'s dotted amber ring (patch_audible.spec.js:957–958, 1017–1018)
  is documented (play.md:135, keyboard.md:68): behavior. Only its 2 px width is
  flagged.
- patch_audible.spec.js:759 (the voices never took a failed selector) is
  sound: main hands the voices a tree in the reply's own task (main.js:2848),
  so the read after `pastReply` sees it.
- patch_cables.spec.js:189's lower bound on `ARRIVE_MS` is a lower bound: a slow
  runner can only make it later, so it is not a flaky timing check.
- Named pacing waits (`GESTURE_GAP_MS`, `REGRAB_MS`, `SLOW_STEP_MS`,
  `READ_GAP_MS`) are a player's pace or a sampling cadence, bounded and named.

## Per file

| file | tests | on the fixture | keep | rewrite | merge | move | delete | split | test-s (CI mean) |
|---|---|---|---|---|---|---|---|---|---|
| patch_audible.spec.js | 11 | yes | 8 | 3 | 0 | 0 | 0 | 0 | 218.6 |
| patch_cables.spec.js | 4 | yes | 1 | 1 | 0 | 1 | 0 | 1 | 159.3 |
| patch_camera.spec.js | 5 | yes | 2 | 3 | 0 | 0 | 0 | 0 | 49.0 |
| patch_canvas.spec.js | 13 | yes | 7 | 5 | 1 | 0 | 0 | 0 | 133.2 |
| patch_catalog.spec.js | 9 (7 + the 1000/1440 pair) | yes | 3 | 5 | 0 | 0 | 0 | 1 | 107.4 |
| patch_editing.spec.js | 16 | yes | 5 | 6 | 0 | 5 (3 conditional on the lane, 2 to a keys spec) | 0 | 0 | 273.5 |
| patch_facts.spec.js | 4 | yes | 1 | 3 | 0 | 0 | 0 | 0 | 195.8 |
| patch_from_nothing.spec.js | 2 | yes | 1 | 1 | 0 | 0 | 0 | 0 | 33.2 |
| patch_guess.spec.js | 8 | yes | 2 | 1 | 1 | 2 | 2 | 0 | 354.1 |
| patch_keys.spec.js | 9 | yes | 6 | 3 | 0 | 0 | 0 | 0 | 93.8 |
| patch_model_view.spec.js | 1 | yes | 0 | 1 | 0 | 0 | 0 | 0 | 27.8 |
| patch_sheet.spec.js | 3 | yes | 0 | 3 | 0 | 0 | 0 | 0 | 35.6 |
| patch_touch.spec.js | 4 | yes | 2 | 1 | 1 | 0 | 0 | 0 | 36.8 |
| patch_truth.spec.js | 3 | yes | 1 | 1 | 1 (absorbs perform_circuit) | 0 | 0 | 0 | 43.4 |
| **total** | **92** | all 14 | 39 | 37 | 4 | 8 | 2 | 2 | **1761.7** |

A test counts once, by its strongest action. Idiom rows on shared helpers
(`commitAndDescribe`, `busy: true`, patch_keys' focus reads, `SLOW`) do not
move a test out of keep; an idiom row on a test's own lines counts as rewrite. patch_page.js is not a spec: one delete (the legacy tap)
and one low rewrite (`settled`'s window).

## Counts

By category (a row can carry two): vacuous 17, idiom 19, implementation 12,
level 12, duplicate 10, misnamed 8, cost 6, flimsy 3, gap 7.

By severity (70 rated rows; the 7 gaps unrated): high 21, medium 26, low 23.

## Category 9: level

### Where each moves

| test | target level | covering test (exists?) | what stays in the browser | s leaving | tier |
|---|---|---|---|---|---|
| patch_guess.spec.js:224 | wasm-binding | `keep_as_new_carries_the_skips_made_after_it`, lib.rs:4469 (yes) | :25's × → `guess_skip` → next guess drawn | 50.1 | slow |
| patch_guess.spec.js:141 | wasm-binding | `a_new_patch_files_its_skips_under_its_own_key`, lib.rs:4432 (yes) | nothing new | 38.1 | slow |
| patch_guess.spec.js:201 | js-unit (worker.js `blocked`, lifted) | worker-lanes.test.mjs (harness yes, case to add) | :25 shows ranking on a crew | 120.9 | slow |
| patch_guess.spec.js:180 | js-unit / worker-protocol | binding pins `planned <= 8` (yes); the worker's floor choice (case to add) | :25 draws the top guess | 30.8 | slow |
| patch_cables.spec.js:286 | js-unit (worker.js `nextLong`/`idleOnly`/`measure`, lifted) | worker-lanes.test.mjs (harness yes, case to add) | :36 relights cables after a knob turn | 112.2 | slow |
| patch_guess.spec.js:127 | rust-engine + wasm (exists) + js-unit (no crew) | `nothing_before_the_warm_start`; lib.rs:4164 | merged into patch_canvas.spec.js:311 | 29.6 (gross) | fast |
| patch_editing.spec.js:125, 195, 211, 249, 294 | js-unit, after extracting the bench lane from main.js | none yet (refactor first) | :95 and :448 (two knobs; step bars), both under a slow engine | 82.4 | fast |
| patch_cables.spec.js:56 | js-unit (`gainOf`, the bar thresholds, `paintWireLevel`) | none yet | one cable lit by the engine's level, one modulation cable unlit | 0 (same boot) | fast |
| patch_facts.spec.js:246 | js-unit (diff → ticks and pointers) | none yet | one tick, one pointer, *from Reese · N changes* | 0 (same ⚡) | slow |
| patch_model_view.spec.js:65, 87 | js-unit (words), voice gate | none yet | one chip per family | 0 | slow |
| patch_facts.spec.js:161 | rust-engine (`guess_candidates(tree, Some(at))`) | partly (guess/tests.rs uses `node/0`) | drawn at the place; Enter takes the ranked op | 0 | slow |

**Test-seconds leaving the browser tier:** firm (covering test exists, or the
lift harness exists and only the case is missing): **381.7 s**, of which
352.1 s from the slow tier (guess:224, :141, :201, :180, cables:286) and 29.6 s
from the fast tier (guess:127; gross: merging its checks into patch_canvas:311 adds a wait for the `guess` reply there, so net is about 30 s less what :311 gains). Conditional on extracting the bench lane:
**82.4 s** more from the fast tier. Not level, but also off the fast tier:
patch_touch:91's merge (8.3 s), and patch_facts:289 (61.6 s mean, 82–86 s on
two CI runs) once it reads a shipped wiring or is tagged `@slow`.

### A worker-protocol harness

It does not exist. What exists is one level down: `worker-lanes.test.mjs` and
`worker-perform-replies.test.mjs` lift named functions out of worker.js's
source and run them against stubs; `boot_agrees.spec.js` loads `apps/web/pkg`
under Node with `initSync`. A harness that runs worker.js itself is feasible:

- worker.js needs `self.location.href` (three uses), `self.postMessage` and
  `self.onmessage`, one `indexedDB`, one `fetch` (the wirings JSON), and a
  dynamic `import("./pkg/auracle_wasm.js?v=…")`. Node's ESM loader takes a
  query on a `file:` URL; `fetch` has no `file:`, so the wirings fetch needs a
  shim; `indexedDB` can be absent or `fake-indexeddb`.
- It already takes a compiled `m.module` in its init message (worker.js:2746–2752),
  so the harness can pass `new WebAssembly.Module(fs.readFileSync(…_bg.wasm))`.
- Run it in `node:worker_threads` with a `self` shim over `parentPort`. With
  `farm=0` first; crews need farm.js in worker_threads and `MessageChannel`
  ports, which Node has, but it is more work.

If it existed, these would move to it whole: patch_guess:180 (the floor with
no crew), patch_guess:201's crew wait end to end, patch_cables:286 (a probe
answered while a background measurement runs, and the measurement still
answered), patch_guess:127's "no crew raised for `no_taste`", and the probe
half of patch_cables:36 (one probe per drag, at most one at the engine), which
are worker answers to message sequences, not page behavior.

## Patterns worth a helper, a lint or a rule

- **A stillness poll in five places.** Three frames of the same rect:
  patch_page.js `rackAtRest`, patch_canvas.spec.js:53 `knobAtRest`,
  patch_sheet.spec.js:20 `stillAt`, patch_touch.spec.js:29, patch_keys.spec.js:152,
  patch_catalog.spec.js:261; and patch_camera.spec.js:22 polls the viewBox
  instead. One `stillAt(page, selector)` in patch_page.js.
- **Copies of the same gesture helpers.** `tapPlate` is in two files
  verbatim; the `openPreset` plus `settled` wrapper is in three
  (patch_audible:348, patch_editing:32, patch_truth:25); a knob drag is
  written seven ways (`dragDown`, `dragKnob`, `dragUp`, `turnKnob`, and inline
  in cables, guess and facts); `selectPlate` is in canvas and facts. Put
  `openPresetSettled`, `dragKnob(page, addr, dy)`, `selectPlate` and `tapPlate`
  in patch_page.js.
- **26 reads of `window.__aur.wb`** (main's private copy) across ten files, as
  oracles and waits. The bench reply carries the engine's own `rack`
  (worker.js `postBench`), so `app.last("bench").rack` and
  `app.reply("bench", { where: { subject } })` say the same thing from the
  engine. A `benchRack(app)` helper beside `benchTree`, and a line in
  tests/web/AGENTS.md: "read the engine's word through the tap, not
  `__aur.wb`".
- **A negative check read before it could fail.** patch_keys:212,
  patch_audible:768, patch_canvas:210: something that "does not happen" read
  in the same breath as the gesture. tests/web/AGENTS.md already says
  "nothing happens is `app.quiet()`"; a lint for `expect(await …)` straight
  after a press would catch most of them.
- **`every` or a loop over a list that can be empty**, and assertions inside
  an `if`: patch_cables:84, patch_camera:47, patch_catalog:335,
  patch_facts:267, patch_guess:47, patch_sheet:96. A rule: guard every
  `every`/`for…of` with a length, and assert the precondition instead of
  branching on it.
- **One-shot `evaluate` reads of focus** (patch_keys ×13, patch_sheet,
  patch_catalog, patch_from_nothing): `toBeFocused()` waits and reads better.
- **`busy: true` with no `app.busy`** (patch_editing ×5): boot plain.
- **Stale strings in negative checks** (patch_editing:370's "held below"): a
  negative regex should be checked to match the real string once, positively,
  in the same test.
- **testing.md is out of date for this area.** Its spec table has no row for
  patch_canvas, patch_camera, patch_catalog, patch_keys or patch_touch, and
  the patch_facts row stops mid-sentence ("and a module's |").
