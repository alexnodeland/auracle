---
name: changelog
description: >
  Write Auracle's CHANGELOG.md entries under [Unreleased] in the house voice:
  for someone who has never seen the repo, saying what was wrong and what is
  true now. Use for any user-visible change.
---

# Changelog entries

`CHANGELOG.md`'s `[Unreleased]` section becomes the release notes verbatim, so
write for a player or a newcomer, not for the diff.

## Shape

- Sections are `### Added — <theme>`, `### Changed — <theme>`,
  `### Fixed — <theme>`, grouping related entries under one theme.
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

## Example

```markdown
- **A bank row's cut appears on approach again.** Its reveal rules were less
  specific than the rule that hides it, so cut could never be seen or pressed
  (`bank_row.spec.js`).
```

## Where

Add to an existing theme heading when one fits (for instance the film-found
fixes); otherwise start a new `###` section near the top of `[Unreleased]`.
