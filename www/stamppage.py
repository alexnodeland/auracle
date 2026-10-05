#!/usr/bin/env python3
"""Stamp the instrument page's own cache-busters into a built copy of it.

    python3 www/stamppage.py <dir>     (run by `make site-play` and `make bundle`)

In the repo, `apps/web/index.html` names `style.css` and `main.js` plainly:
the dev server (`apps/web/serve.py`) sends `no-store`, so nothing there is
served stale, and no PR has a number to bump (two PRs that both bumped one
used to conflict on that line, #157). The copies the site and the bundle ship
are served by hosts that cache, so they carry `?v=` and the first 12 hex digits
of the file's SHA-256: the same bytes keep the same URL across deploys, and a
changed file gets a new one. The modules `main.js` imports, the worker and the
engine are stamped at run time from `pkg/build.json` (`make wasm-stamp`).

Each name must appear exactly once in the page, as written below, or this
stops the build: a page that lost its stamp would be cached across deploys.
Python 3 standard library only.
"""
import hashlib
import pathlib
import sys

# What the page says in the repo, and the file each one names.
REFS = (
    ('href="style.css"', "style.css"),
    ('s.src = "main.js"', "main.js"),
)


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def stamp(text: str, root: pathlib.Path) -> str:
    for ref, name in REFS:
        n = text.count(ref)
        if n != 1:
            raise SystemExit(f"stamppage: index.html has {n} of {ref!r}, not one; the page's stamp would be lost")
        quoted = ref[ref.index('"'):]
        text = text.replace(ref, ref.replace(quoted, f'"{name}?v={digest(root / name)}"'))
    return text


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        raise SystemExit("usage: python3 www/stamppage.py <dir>")
    root = pathlib.Path(argv[1])
    page = root / "index.html"
    page.write_text(stamp(page.read_text(encoding="utf-8"), root), encoding="utf-8")
    print(f"  {page}: style.css and main.js stamped")


if __name__ == "__main__":
    main(sys.argv)
