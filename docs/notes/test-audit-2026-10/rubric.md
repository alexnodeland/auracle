# Test-quality audit: rubric

**Goal:** every test in Auracle checks behavior that matters, once, in an idiomatic way, and cannot be flimsy or vacuous.

**Rules:**
- This is a READ-ONLY audit. Don't edit, commit or run browser tests: a shared one-browser queue is in use by builders.
- You may run Rust tests only with `--profile test-fast` and only if you need to (prefer reading).
- Work from the main checkout (`main` at 42bd322), and don't touch any `auracle-wt-*` worktree.

## What "behavior" means here

Read these first; they define what this repo's tests are for:
- `AGENTS.md` (root)
- `docs/architecture/testing.md` (§ The gates, § Rules, § Flakes)
- `tests/web/AGENTS.md`
- `crates/AGENTS.md`
- `docs/decisions/004-descriptions-stay-true.md`
- `docs/decisions/012-motion-shows-what-the-engine-does.md`

Two kinds of assertion count as behavior:
- **What a player sees, hears or can do.** Text, controls, what a key or click does, audio levels, what is kept or lost.
- **An engine fact the app promises to show** (ADR-012: every mark and motion is an engine fact). A test that a mark reflects the engine's reply is a behavior test, not an implementation detail.
- **Engine contracts the crates promise:** seeded reproducibility, φ as a measurement contract, the taste model's statistical properties, wire formats that are persisted (profiles, observation logs). These are behavior too.

**Implementation detail** is anything a refactor that keeps all of the above could break:
- private fields;
- exact internal call or message sequences that aren't a promise;
- CSS class names or DOM nesting that carry no meaning;
- the count of internal requests;
- internal data-structure shapes;
- intermediate values that aren't observable.

## Categories

Tag each finding with one or more:

1. **implementation**: asserts internals rather than behavior (above). Say what behavior the test was really after and how to assert that instead.
2. **duplicate**: asserts the same behavior through the same path as another test, in any file, including a node unit test or a Rust test. Name the other test.
3. **flimsy**: can fail when the app is right. Includes:
   - a wall-clock bound (a promise about speed);
   - a fixed wait (`waitForTimeout`, sleep) standing in for a state;
   - a pixel read of something still redrawing;
   - an exact count of something a slow runner may do twice;
   - reading before state settles;
   - an unseeded or nondeterministic setup;
   - dependence on test order or shared state;
   - in Rust, a float compared exactly where a tolerance is right, or a statistical test with too few seeds or a threshold with no margin.
4. **vacuous**: can pass when the feature is broken. Includes:
   - asserting a value the test itself set;
   - an always-truthy check;
   - a loop or `every` over a list that can be empty;
   - an assertion inside a branch that may not run;
   - try/catch that swallows the failure;
   - a `poll` whose predicate is satisfied before the action;
   - a mock that makes the assertion trivially true.
5. **idiom**: works but fights the tools.
   - In Playwright: not the shared fixture (`tests/web/fixtures.js`); CSS or XPath selectors where a role, label or test id would carry meaning; `evaluate` reads where a web-first assertion (`toHaveText`, `toBeVisible`, `toHaveCount`) would auto-wait; `expect(await x)` instead of `await expect(locator)`; `page.waitForFunction` where `expect.poll` reads better; logic duplicated across specs that belongs in a helper.
   - In Rust: setup copy-pasted across tests that wants a helper; assertions with no message where failure would be opaque; a test that does three unrelated things; `unwrap` noise; a missing `#[should_panic]` or `Result` return where it fits.
6. **misnamed**: the title or test name doesn't say what the test asserts, or says more than it checks. Titles are descriptions too (ADR-004).
7. **cost**: worth less than it costs. Examples:
   - a full browser boot to check arithmetic that belongs in a `node:test` unit (`apps/web/tests`, the rule in `tests/web/AGENTS.md`; #137 lists ten known cases);
   - a Rust test rendering minutes of audio to check something a smaller input proves.
8. **gap**: an obvious behavior described in the guide (`www/docs`) or the reference with no test. Note only clear, important gaps; don't attempt an exhaustive coverage map.

## Severity
- **high:** flimsy or vacuous, or a misnamed test that claims coverage it doesn't have.
- **medium:** implementation, duplicate, or cost.
- **low:** idiom, or a naming nit.

## Action
Choose one, and be specific:
- **keep:** say nothing.
- **rewrite:** say the new assertion (e.g. "assert the toast's text with `toHaveText`, not the lane's internal queue length").
- **merge:** into which test; the merged test keeps every behavior both checked.
- **move:** to a unit test (`node:test` module X), or to a smaller Rust test.
- **delete:** only when the behavior is covered elsewhere; name where. Deleting a test must never drop coverage of a behavior.
- **split:** one test asserting unrelated behaviors.

## Output

### 1. The findings file
Write every finding to `<area>.md` in this directory as a table, one row per finding:

`file:line | test title or fn name | categories | severity | evidence (quote the line) | action`

Then add a per-file summary: tests, on the fixture yes or no, keep/rewrite/merge/move/delete/split counts, and test-seconds if known.


Browser timings, for the cost category: per-test durations come from the blob reports of CI runs 37383132211, 37379867024 and 37345520856 (fast tier) and 37381447489 (slow tier).

### 2. Your reply
A short summary, under about 900 words:
- counts by category and severity;
- the 10 most important findings, with file:line;
- patterns that recur across files, which are worth a helper, a lint rule or a rule in `tests/web/AGENTS.md` or `crates/AGENTS.md`;
- any test whose deletion you recommend, and the test that keeps its behavior covered.

## Be fair and specific
- Don't flag a test for checking an engine fact the app is meant to show.
- Don't flag a deliberate pacing wait for a human gesture, if it is named and bounded.
- Quote evidence. A finding without a quoted line and a concrete action is not useful.
- When you're unsure whether something is a promise or an implementation detail, check the guide, the reference or an ADR, and cite it.

## Added: category 9, **level**: the test lives at the wrong level

A behavior is tested at the lowest level that can prove it. The levels, from lowest:

| Level | What it is | Where it lives |
| --- | --- | --- |
| **rust-unit** | One module's logic | Tests in the module |
| **rust-engine** | Engine behavior through the public API of `auracle-session` (or grammar, features or taste): pool, duels, fits, walks, PERFORM's offers and measurements, naming, persistence | The crates' tests |
| **wasm-binding** | What `WasmEngine` and `LivePoly` return to their callers: the shapes, the errors | `crates/auracle-wasm` tests |
| **worker-protocol** | `worker.js` answering a message with a reply, with no page | Possible only if a Node harness can load the wasm and worker, e.g. how `boot_agrees` runs. Check whether this level exists, and whether it could. |
| **js-unit** | Pure logic in an `apps/web` module | `node:test` in `apps/web/tests` |
| **browser** | Only what needs the page: the wiring from a gesture to the engine and back, what a player sees and hears, layout, focus and keys, audio output, the worklet | Specs |

**Flag a test as `level` when its assertion could be proved one or more levels lower.** Examples:
- a spec that boots the app to check what the engine computes: a fit's ranking, an offer's direction, a name, a lineage record, a measurement;
- a spec that checks arithmetic or formatting in `main.js`;
- a wasm test that re-checks engine logic the session crate already tests;
- a Rust integration test that only needs one module.

**Give the target level**, and say what remains at the original level, if anything. Usually a thin wiring check stays in the browser: one spec showing the engine's answer reaches the screen, not one spec per engine case.

**Also report:**
- which tests would move if a worker-protocol harness existed, and its feasibility (a Node harness loading `apps/web/pkg` with wasm-bindgen's web target);
- the test-seconds that would leave the browser tier.
