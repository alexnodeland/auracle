# changelog.d

The entries for `CHANGELOG.md` that wait for the next release, one file per
change, so two open PRs never edit the same lines.

- **A change a player, a listener or a reader of the site can notice** writes
  `changelog.d/<topic>.md`, `<topic>` being its branch's (`claude/<topic>`).
  It holds what would have gone under `[Unreleased]`: one or more
  `### Kind: title` sections (Added, Changed, Fixed, Removed or Renamed), each
  with its bullets, in the house voice (the `changelog` skill,
  [`www/brand/voice.md`](../www/brand/voice.md)). Nothing comes before the
  first heading, and no `#` or `##` heading at all.
- **Check it:** `python3 scripts/changelog.py --check` (in `make dev-check`
  and CI) and `python3 www/checkwords.py` (the voice).
  `python3 scripts/changelog.py --preview` prints `[Unreleased]` with every
  file here folded in.
- **At a release,** `python3 scripts/changelog.py --release X.Y.Z YYYY-MM-DD`
  moves them into `CHANGELOG.md` in the order they merged, oldest first, and
  deletes them ([`CONTRIBUTING.md` § Cutting a release](../CONTRIBUTING.md#cutting-a-release)).

This README is not an entry: the assembler and the voice check skip it.
