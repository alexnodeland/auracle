---
name: changelog
description: >
  Write a change's changelog entry as changelog.d/<topic>.md, in Auracle's
  house voice (www/brand/voice.md): for someone who has never seen the repo,
  saying what was wrong and what is true now. Use for any user-visible change.
---

# Changelog entries

A change writes its entry as a file of its own, `changelog.d/<topic>.md`, and
never edits `CHANGELOG.md`: when every PR added to the top of `[Unreleased]`,
any two open PRs conflicted there, and the merge queue sends back a PR it
can't rebase. A release moves the files into `CHANGELOG.md` in the order they
merged (`scripts/changelog.py --release`), and that section becomes the
release notes verbatim, so write for a player or a newcomer, not for the diff.

## Where

- `<topic>` is the branch's: `claude/<topic>` writes `changelog.d/<topic>.md`.
- The file holds exactly what would have gone under `[Unreleased]`: one or
  more `###` sections, each with its bullets. Nothing comes before the first
  heading, and there is no `#` or `##` heading.
- Write your own file. Don't add to another change's file, or to the entries
  already under `[Unreleased]` (they were written before `changelog.d/`, and
  stay as they are).
- [`changelog.d/README.md`](../../../changelog.d/README.md) is the short
  version of this, for a human contributor.

## Shape

- Sections are `### Added: <theme>`, `### Changed: <theme>`,
  `### Fixed: <theme>` (the assembler also knows Removed and Renamed),
  grouping related entries under one theme. No em dashes
  ([`www/brand/voice.md`](../../../www/brand/voice.md)).
- Each entry is a bullet that opens with a **bold sentence saying what is true
  now**, then what was wrong before and why it matters, in one or two
  sentences.
- Name the test that pins it in parentheses when there is one:
  (`bank_row.spec.js`), (`a_consumer_draws_only_from_its_own_stream`).

## Voice

- Plain words, the app's own names for things (PERFORM, the bank, ⚡ evolve
  from this).
- Concrete: "a rename renamed the other two styles", not "fixed a style
  naming issue".
- No internal jargon without a gloss (φ, lens, lane): say what the player
  noticed.
- Present tense for the fix, past tense for the bug.
- The rest of the voice (the word table, American spelling, sound for what you
  hear and patch for how it's built) is [`www/brand/voice.md`](../../../www/brand/voice.md)'s.

## Example

`changelog.d/bank-row-cut.md`:

```markdown
### Fixed: the bank's cut

- **A bank row's cut appears on approach again.** Its reveal rules were less
  specific than the rule that hides it, so cut could never be seen or pressed
  (`bank_row.spec.js`).
```

## Check it

- `python3 scripts/changelog.py --check`: the file's shape, with the file and
  line of anything wrong.
- `python3 www/checkwords.py`: the voice. The file is new, so any banned word,
  em dash or British spelling in it fails.
- `make dev-check` runs both, and CI runs both on every PR.
- `python3 scripts/changelog.py --preview` prints `[Unreleased]` as the next
  release would hold it, with every waiting entry in.

## When not

A change no player, listener or reader of the site can notice gets no entry:
CI and workflows, specs, refactors, agent docs and `docs/` (the process,
ADRs, plans). Its PR body says what changed. A fix to something a player saw
(a stuck status, a toast that never came) gets one, even when a test found it.
