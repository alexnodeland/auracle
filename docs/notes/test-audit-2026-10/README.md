# The test audit, October 2026

Every test in Auracle was read against one standard, on 2026-10-05, at `main`
42bd322:
- **What it checks:** something a player sees, hears or can do; an engine fact
  the app promises to show (ADR-012); or a contract the crates promise.
- **How:** it checks it once, at the lowest level that can prove it, and it
  can neither fail when the app is right nor pass when the app is broken.

The audit was read-only. Nothing was edited, and no browser test was run.

*Status: the findings are being fixed under
[#178](https://github.com/alexnodeland/auracle/issues/178), part of
[#177](https://github.com/alexnodeland/auracle/issues/177), wave 3. The rows
below stay as found; the PR that fixes a row says so in its body.*

## Files

| File | Area | Tests |
| --- | --- | --- |
| [rubric.md](rubric.md) | The standard: categories, severity, actions, and the test levels | |
| [patch.md](patch.md) | `tests/web/patch_*.spec.js`, `patch_page.js` | 92 |
| [perform.md](perform.md) | `perform_*`, `pad_keys`, `explain` specs, `perform_budget.js` | 71 |
| [evolve-bank-taste.md](evolve-bank-taste.md) | `evolve_*`, `bank_*`, `taste_*`, `faces`, `session_seed`, `first_run`, `guide_pill` | 87 |
| [shell-misc-units.md](shell-misc-units.md) | The other specs, the `node:test` units, and a review of the fixture | 87 + 125 |
| [rust-grammar-features-taste.md](rust-grammar-features-taste.md) | `auracle-grammar`, `auracle-features`, `auracle-taste` | 215 |
| [rust-session-wasm.md](rust-session-wasm.md) | `auracle-session`, `auracle-wasm` | 214 |

Each row in a findings file gives:
- the test, by `file:line`;
- its categories;
- its severity;
- the quoted line that is the evidence;
- one action: keep, rewrite, merge, move, split, or delete.

A delete always names the test that keeps the behavior covered.

## What it found

| Area | Findings | High | Vacuous | Flimsy | Wrong level |
| --- | --- | --- | --- | --- | --- |
| PATCH specs | 70 | 21 | 17 | 3 | 12 |
| PERFORM specs | 84 | 18 | 13 | 8 | 9 |
| EVOLVE, bank, TASTE specs | 80 | 35 | 15 | 21 | 18 |
| The shell, the other specs, the node units | 107 | 29 | 8 | 15 | 16 |
| Rust: grammar, features, taste | 40 | 17 | 8 | 8 | 4 |
| Rust: session, wasm | 73 | 9 | 10 | 1 | 20 |

**About severity:** "High" follows the rubric mechanically, so every flimsy or
vacuous finding is high. About a fifth of those, by the auditors' own notes,
have a narrow window or a wide margin in practice.

#178 summarizes the findings and orders their fixes:
- the worst vacuous tests;
- the engine facts held only by browser specs;
- the worker-protocol harness that four of the six audits found feasible;
- the untested promises;
- the rules and lint checks that keep the suite this way.
