#!/usr/bin/env python3
"""Every relative reference in the built site must resolve to a real file.

    python3 www/checklinks.py site

Four sections cross-link each other — the landing page points at /docs/, the
guide points at /reference/audition/phrase.html, both point at /play/ — and none
of those links can be verified inside a single mdBook build. They only exist once
the site is assembled, which is exactly when nobody is looking. So this runs over
the assembled tree.

It also catches the failure mode that motivated it: a link written as if the site
were served from the domain root (`/docs/`) works locally and 404s on Pages,
which serves from `/auracle/`. Absolute-path references are therefore an error
here, not a warning.

Checks, in the order they tend to fail:
  1. Relative href/src/srcset targets exist (HTML).
  2. Root-absolute references (`/foo`) — always wrong under a project subpath.
  3. url(...) targets in stylesheets exist, including the vendored KaTeX faces.
  4. Fragment targets exist within the page that claims them.
  5. The routes the repo advertises are actually present.
  6. No page still references an external CDN.

Exit code 1 on any failure, with every failure listed rather than the first.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

SKIP_SCHEMES = ("http://", "https://", "mailto:", "data:", "javascript:", "tel:", "//")

# Generated trees this does not audit.
#
# `reference/api/` is rustdoc output — thousands of pages whose internal integrity
# is cargo's problem, not ours. It is skipped for a second, harder reason too:
# rustdoc emits JavaScript template literals inside inline scripts
# (`href="../static.files/${f}"`), which no attribute-level regex can tell apart
# from a real link, and which produced 6 670 confident false positives here. What
# this file *should* guarantee about rustdoc is that its entry points exist, and
# REQUIRED below does exactly that.
SKIP_TREES = ("reference/api/",)


def skipped(rel: Path) -> bool:
    return str(rel).startswith(SKIP_TREES)

# Every route README/DEVELOPMENT/the landing page promise. If one of these stops
# existing, the docs are lying and this is the cheapest place to find out.
REQUIRED = [
    "index.html",
    "404.html",
    "robots.txt",
    ".nojekyll",
    "play/index.html",
    "docs/index.html",
    "docs/introduction.html",
    "reference/index.html",
    "reference/api/auracle_session/index.html",
    "assets/screens/play.webp",
    "assets/og.png",
]

# The site is deliberately self-contained: no CDN, no font service, no analytics.
# A reintroduced external request is a regression in a property the project states
# outright, so it fails the build rather than being noticed later.
#
# SUBRESOURCES ONLY. An `<a href="https://github.com/…">` is a link the reader
# chooses to follow; a `<script src>` or `<link rel=stylesheet>` is a request the
# page makes on its own. Conflating the two flagged every outbound link in the
# books — 28k false positives — and a check that cries wolf gets switched off.
EXTERNAL_SUBRESOURCE = re.compile(
    r"""<(?:script|img|iframe|audio|video|source|embed|track)\b[^>]*\bsrc\s*=\s*["'](?:https?:)?//"""
    r"""|<link\b[^>]*\bhref\s*=\s*["'](?:https?:)?//"""
    r"""|<[^>]*\bsrcset\s*=\s*["'][^"']*(?:https?:)?//""",
    re.I,
)


def find_refs(text: str) -> list[tuple[str, str]]:
    """(attribute, value) for every href/src/srcset in an HTML string."""
    out: list[tuple[str, str]] = []
    for m in re.finditer(r'\b(href|src)\s*=\s*"([^"]*)"', text):
        out.append((m.group(1), m.group(2)))
    for m in re.finditer(r'\bsrcset\s*=\s*"([^"]*)"', text):
        for part in m.group(1).split(","):
            url = part.strip().split(" ")[0]
            if url:
                out.append(("srcset", url))
    return out


def main(root_arg: str) -> int:
    root = Path(root_arg).resolve()
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 2

    problems: list[str] = []
    html_files = [p for p in sorted(root.rglob("*.html")) if not skipped(p.relative_to(root))]
    css_files = [p for p in sorted(root.rglob("*.css")) if not skipped(p.relative_to(root))]

    if not html_files:
        print(f"no HTML under {root} — did the build run?", file=sys.stderr)
        return 2

    # ── 1 & 2: HTML references ───────────────────────────────────────────
    for page in html_files:
        rel = page.relative_to(root)
        text = page.read_text(errors="replace")

        for attr, raw in find_refs(text):
            if not raw or raw.startswith("#") or raw.lower().startswith(SKIP_SCHEMES):
                continue
            if raw.startswith("/"):
                problems.append(
                    f"{rel}: root-absolute {attr}=\"{raw}\" — breaks under the "
                    f"/auracle/ project subpath; use a relative path"
                )
                continue
            path = unquote(urlsplit(raw).path)
            if not path:
                continue
            target = (page.parent / path).resolve()
            if not target.exists():
                problems.append(f"{rel}: {attr}=\"{raw}\" does not resolve")

        for m in EXTERNAL_SUBRESOURCE.finditer(text):
            snippet = text[m.start() : m.start() + 100].replace("\n", " ")
            problems.append(f"{rel}: external subresource — {snippet!r}")

    # ── 3: stylesheet url(...) ───────────────────────────────────────────
    for sheet in css_files:
        rel = sheet.relative_to(root)
        text = sheet.read_text(errors="replace")
        for m in re.finditer(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", text):
            raw = m.group(1).strip()
            if not raw or raw.lower().startswith(SKIP_SCHEMES):
                continue
            if raw.startswith("/"):
                problems.append(f"{rel}: root-absolute url({raw})")
                continue
            target = (sheet.parent / unquote(urlsplit(raw).path)).resolve()
            if not target.exists():
                problems.append(f"{rel}: url({raw}) does not resolve")

    # ── 4: fragments ─────────────────────────────────────────────────────
    # Anchors are cheap to get wrong when a heading is reworded, and a dead
    # fragment lands the reader at the top of a long page with no hint why.
    ids: dict[Path, set[str]] = {}
    for page in html_files:
        text = page.read_text(errors="replace")
        found = set(re.findall(r'\bid\s*=\s*"([^"]+)"', text))
        found |= set(re.findall(r'\bname\s*=\s*"([^"]+)"', text))
        ids[page] = found

    for page in html_files:
        rel = page.relative_to(root)
        text = page.read_text(errors="replace")
        for attr, raw in find_refs(text):
            if attr != "href" or "#" not in raw:
                continue
            if raw.lower().startswith(SKIP_SCHEMES):
                continue
            path, _, frag = raw.partition("#")
            if not frag:
                continue
            if path.startswith("/"):
                continue  # already reported above
            target = page if not path else (page.parent / unquote(path)).resolve()
            if target not in ids:
                continue  # not an HTML page in this tree; existence checked above
            if unquote(frag) not in ids[target]:
                problems.append(
                    f"{rel}: href=\"{raw}\" — #{frag} is not an id in "
                    f"{target.relative_to(root)}"
                )

    # ── 5: advertised routes ─────────────────────────────────────────────
    for want in REQUIRED:
        if not (root / want).exists():
            problems.append(f"missing advertised route: {want}")

    # ── report ───────────────────────────────────────────────────────────
    print(
        f"checked {len(html_files)} pages and {len(css_files)} stylesheets "
        f"under {root.name}/ (skipped: {', '.join(SKIP_TREES)})"
    )
    if problems:
        print(f"\n{len(problems)} problem(s):\n", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    print("all references resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "site"))
