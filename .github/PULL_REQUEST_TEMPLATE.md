<!-- How a change lands: docs/process.md. Delete what doesn't apply.

     The title is the squash commit's subject on main, so it starts with a
     type, as a commit's does: `fix(web): what is true now`, `tests: …`,
     `ci: …` (AGENTS.md rule 8). The `PR checks` workflow checks the title and
     the issue lines under Why; the merge queue takes a PR once it is green. -->

## What

<!-- What is true now, for a player, a reader of the site or a contributor. -->

## Why

<!-- What was wrong or missing. Then the issues, one per line: `Closes #n`
     for each issue this PR finishes, one keyword per issue (GitHub reads
     one issue per keyword, so a list after one closes only its first), and
     `Refs #n` for each issue it advances, which gets a comment naming this
     PR once it merges. No issue? Delete both lines and say why on a line
     that starts `No issue:`. -->

Closes #
Refs #

## How

<!-- The decisions a reviewer should look at closely; anything moved or
     retired, with where it lives now (by mouse, keyboard and touch). -->

## Checks

<!-- The gates and specs you ran, with counts; the review before this PR and
     what it found. -->

- [ ] Reviewed before this PR (the `reviewer` agent or a person); its findings are fixed, or declined here with the reason
- [ ] The fast gates for what changed pass (the `check` skill), and the specs it reaches (`make browser-changed`); CI runs the rest
- [ ] A test that fails without this change, named for the behaviour (a browser spec for what a player sees; a unit test for logic)
- [ ] Descriptions are true in this change: guide, reference, in-app copy, films' claims, the plan's as-built, a changelog entry as `changelog.d/<topic>.md` for anything a player notices (ADR-004)
- [ ] Nothing dropped: everything moved or retired still works by mouse, keyboard and touch
- [ ] New player-facing words are in `www/brand/voice.md`, approved by the maintainer (ADR-013)
- [ ] Rust the app calls changed: `make wasm` rebuilt it
- [ ] No test was retried to pass; a flaky one is fixed or quarantined with an issue (`docs/process.md` § Flakes)
