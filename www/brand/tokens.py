#!/usr/bin/env python3
"""Auracle's colour tokens: one source, generated into every surface.

    python3 www/brand/tokens.py            write each consumer's generated block
    python3 www/brand/tokens.py --check    fail on a stale block or a stray colour
    python3 www/brand/tokens.py --map SURFACE
                                           every value a surface can name, and its token

`www/brand/tokens.json` holds the palettes (the rack, and the docs' Paper), the
font families, and each surface's own named shades and opacities. This script
writes them as custom properties between `/* tokens:begin … */` and
`/* tokens:end */` in each consumer's stylesheet. The blocks are committed, like
the film blocks `publish.py` fills, so the app and the site still serve with no
build step.

`--check` (run by `make dev-check`) fails when:
- a generated block differs from what tokens.json makes (run `make tokens`);
- a colour literal (hex, rgb()/rgba(), hsl()/hsla(), or an "r,g,b" string in
  a script) appears in a scanned file outside its generated block; comments
  are not scanned;
- a script reads a token (`tok("--x")`, `ink("--x")`, `inkA("--x", a)`) its
  surface does not define, or a stylesheet uses a token another surface owns;
- a `<meta name="theme-color">` is not the rack, or a hex quoted in `<code>`
  is not a token's value (prose may name a colour, but only a true one).

Python 3 standard library only.
"""

from __future__ import annotations

import fnmatch
import glob
import json
import os
import re
import sys
import textwrap
from decimal import Decimal

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SOURCE = "www/brand/tokens.json"

# Each consumer: its stylesheet, and the rules its block holds, as
# (selector, surface). A rule with no surface holds the font families only;
# otherwise the families go in the first rule. `indent` is the rule's own
# indentation inside the file (a <style> element indents its rules).
CONSUMERS = [
    {"file": "apps/web/style.css", "rules": [(":root", "app")], "indent": "", "step": "  "},
    {"file": "www/landing/style.css", "rules": [(":root", "landing")], "indent": "", "step": "  "},
    {
        "file": "www/theme/css/variables.css",
        "rules": [(":root", None), ("html.coal", "docs"), ("html.light", "docs-paper")],
        "indent": "",
        "step": "    ",
    },
    {"file": "www/brand/index.html", "rules": [(":root", "brand")], "indent": "", "step": "  "},
    {"file": "www/404.html", "rules": [(":root", "404")], "indent": "  ", "step": "  "},
    {"file": "www/video/stage/stage.css", "rules": [(":root", "stage")], "indent": "", "step": "  "},
]

# The files scanned for stray colours, and the surface whose tokens each may
# read. Stylesheets with a block are scanned outside it.
SCANNED = [
    ("apps/web/*.css", "app"),
    ("apps/web/*.js", "app"),
    ("apps/web/index.html", "app"),
    ("www/landing/*.css", "landing"),
    ("www/landing/*.js", "landing"),
    ("www/theme/css/*.css", "docs"),
    ("www/brand/*.html", "brand"),
    ("www/404.html", "404"),
    ("www/video/stage/*.css", "stage"),
    ("www/video/stage/*.js", "stage"),
    ("www/video/films/*/*.js", "stage"),
]

# Never scanned, whatever a glob above matches. Keep this short.
EXEMPT = [
    ("www/brand/*.svg", "the marks are assets: a favicon cannot read a custom property"),
    ("www/brand/render.html", "rasterises the marks, the lockup and the social card"),
    ("docs/notes/**", "dated records"),
]

# Text that looks like a colour and is not one. (file, exact text, why)
NOT_COLOURS = [
    ("apps/web/main.js", 'endsWith("#dec")', "a knob's address"),
    ("apps/web/main.js", 'fill: "rgb(0, 0, 0)"', "the initial `fill` as getComputedStyle reports it; compared, never painted"),
]

BEGIN = "/* tokens:begin: generated from www/brand/tokens.json by `make tokens`. Edit the JSON, not this block. */"
END = "/* tokens:end */"
BLOCK_RE = re.compile(r"(?P<indent>[ \t]*)/\* tokens:begin\b.*?\*/\n.*?/\* tokens:end \*/", re.S)

HEX_RE = re.compile(r"(?<![\w#&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])")
FUNC_RE = re.compile(r"\b(?:rgba?|hsla?)\(\s*[\d.]")
TRIPLET_RE = re.compile(r"""(["'`])\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\1""")
READ_RE = re.compile(r"""\b(?:tok|ink|inkA)\(\s*["'](--[\w-]+)["']""")
VAR_RE = re.compile(r"var\(\s*(--[\w-]+)")
THEME_RE = re.compile(r"""<meta\s+name=["']theme-color["']\s+content=["']([^"']+)["']""")
CODE_HEX_RE = re.compile(r"<code>\s*(#[0-9a-fA-F]{3,8})\s*</code>")


# ─── the source ──────────────────────────────────────────────────────────────


def load() -> dict:
    with open(os.path.join(ROOT, SOURCE), encoding="utf-8") as f:
        return json.load(f)


def rgba_of(value: str) -> tuple[int, int, int, Decimal] | None:
    """A colour value as (r, g, b, alpha), or None if it is not one."""
    v = value.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3,8})", v)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) not in (6, 8):
            return None
        a = Decimal(int(h[6:8], 16)) / 255 if len(h) == 8 else Decimal(1)
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a
    m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", v)
    if m:
        a = Decimal(m.group(4)) if m.group(4) is not None else Decimal(1)
        return int(m.group(1)), int(m.group(2)), int(m.group(3)), a
    return None


def alpha_name(base: str, pct) -> str:
    """`phos-b`, 30 -> `phos-b-30`; 4.5 -> `-045`; 1.2 -> `-012`."""
    s = format(Decimal(str(pct)).normalize(), "f")
    whole, _, frac = s.partition(".")
    return f"{base}-{whole.zfill(2)}{frac}"


def alpha_value(hexv: str, pct) -> str:
    r, g, b, _ = rgba_of(hexv)
    a = format((Decimal(str(pct)) / 100).normalize(), "f")
    return f"rgba({r}, {g}, {b}, {a})"


def sections(src: dict, surface: str) -> list[tuple[str, list[tuple[str, str, str]]]]:
    """A surface's colour tokens, as titled groups of (name, value, note)."""
    s = src["surfaces"][surface]
    pal = src["palettes"][s["palette"]]
    out = []
    for g in pal["groups"]:
        out.append((g["title"], [(n, t["value"], t.get("note", "")) for n, t in g["tokens"].items()]))
    light = src["light"]
    out.append((light["title"], [(n, t["value"], t.get("note", "")) for n, t in light["tokens"].items()]))
    if s["tokens"]:
        out.append((f"{surface}: shades only this surface uses", [(n, t["value"], t.get("note", "")) for n, t in s["tokens"].items()]))
    named = {n: v for _, toks in out for n, v, _ in toks}
    alphas = []
    for base, pcts in s.get("alpha", {}).items():
        if base not in named:
            raise SystemExit(f"tokens.json: {surface} has opacities of `{base}`, which it does not define")
        for p in sorted(pcts, key=lambda x: Decimal(str(x))):
            alphas.append((alpha_name(base, p), alpha_value(named[base], p), ""))
    if alphas:
        out.append(("opacities: `--phos-b-30` is --phos-b at 30%; a third digit is a tenth (`--phos-a-045` is 4.5%)", alphas))
    return out


def names_of(src: dict, surface: str) -> dict[str, str]:
    return {n: v for _, toks in sections(src, surface) for n, v, _ in toks}


def check_source(src: dict) -> list[str]:
    """A value has one name per surface; every value is a colour."""
    errs = []
    for surface in src["surfaces"]:
        seen: dict[tuple, str] = {}
        for _, toks in sections(src, surface):
            for n, v, _ in toks:
                c = rgba_of(v)
                if c is None:
                    errs.append(f"{SOURCE}: {surface}: --{n}: `{v}` is not a colour")
                    continue
                if c in seen:
                    errs.append(f"{SOURCE}: {surface}: --{n} and --{seen[c]} are both {v}; name a colour once and refer to it")
                seen[c] = n
    return errs


# ─── generation ──────────────────────────────────────────────────────────────


def render_rule(src: dict, selector: str, surface: str | None, fonts: bool, indent: str, step: str) -> list[str]:
    d = indent + step
    lines = [f"{indent}{selector} {{"]
    groups = sections(src, surface) if surface else []
    first = True
    for title, toks in groups:
        if not first:
            lines.append("")
        first = False
        for i, ln in enumerate(textwrap.wrap(title, 76 - len(d))):
            lead = "/* " if i == 0 else "   "
            lines.append(f"{d}{lead}{ln}")
        lines[-1] += " */"
        # Notes line up within a group, up to a point.
        width = [len(f"--{n}: {v};") for n, v, note in toks if note]
        col = min(max(width, default=0) + 1, 32)
        for n, v, note in toks:
            decl = f"--{n}: {v};"
            if note:
                lines.append(f"{d}{decl.ljust(max(col, len(decl) + 1))}/* {note} */")
            else:
                lines.append(f"{d}{decl}")
    if fonts:
        if groups:
            lines.append("")
        lines.append(f"{d}/* families */")
        for n, t in src["fonts"].items():
            decl = f"--font-{n}: {t['value']};"
            lines.append(f"{d}{decl}")
    lines.append(f"{indent}}}")
    return lines


def render_block(src: dict, c: dict) -> str:
    ind, step = c["indent"], c["step"]
    fonts_rule = next((i for i, (_, s) in enumerate(c["rules"]) if s is None), 0)
    out = [f"{ind}{BEGIN}"]
    for i, (sel, surface) in enumerate(c["rules"]):
        out += render_rule(src, sel, surface, i == fonts_rule, ind, step)
    out.append(f"{ind}{END}")
    return "\n".join(out)


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def generate(check: bool) -> list[str]:
    src = load()
    errs = check_source(src)
    if errs:
        return errs
    for c in CONSUMERS:
        text = read(c["file"])
        m = BLOCK_RE.search(text)
        if not m:
            errs.append(f"{c['file']}: no `tokens:begin` … `tokens:end` block")
            continue
        want = render_block(src, c)
        if m.group(0) != want:
            if check:
                errs.append(f"{c['file']}: the generated block is stale; run `make tokens`")
            else:
                text = text[: m.start()] + want + text[m.end() :]
                with open(os.path.join(ROOT, c["file"]), "w", encoding="utf-8") as f:
                    f.write(text)
                print(f"  tokens: wrote {c['file']}")
    return errs


# ─── the scan ────────────────────────────────────────────────────────────────


def blank(s: str) -> str:
    """Spaces for everything but newlines, so offsets and line numbers hold."""
    return re.sub(r"[^\n]", " ", s)


def strip_css(t: str) -> str:
    return re.sub(r"/\*.*?\*/", lambda m: blank(m.group(0)), t, flags=re.S)


def strip_html(t: str) -> str:
    return strip_css(re.sub(r"<!--.*?-->", lambda m: blank(m.group(0)), t, flags=re.S))


REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^")


def strip_js(t: str) -> str:
    """Blank out a script's comments, keeping its strings and regexes."""
    out = []
    i, n = 0, len(t)
    stack = []  # template literal nesting: brace depth at each `${`
    last = ""  # last significant character of code
    while i < n:
        ch = t[i]
        nx = t[i + 1] if i + 1 < n else ""
        if ch == "/" and nx == "/":
            j = t.find("\n", i)
            j = n if j < 0 else j
            out.append(blank(t[i:j]))
            i = j
            continue
        if ch == "/" and nx == "*":
            j = t.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(blank(t[i:j]))
            i = j
            continue
        if ch in "'\"":
            j = i + 1
            while j < n and t[j] != ch and t[j] != "\n":
                j += 2 if t[j] == "\\" else 1
            out.append(t[i : j + 1])
            i, last = j + 1, ch
            continue
        if ch == "`" or (ch == "}" and stack and stack[-1] == 0):
            if ch == "}":
                stack.pop()
            j = i + 1
            while j < n:
                if t[j] == "\\":
                    j += 2
                    continue
                if t[j] == "`":
                    break
                if t[j] == "$" and j + 1 < n and t[j + 1] == "{":
                    stack.append(0)
                    j += 1
                    break
                j += 1
            out.append(t[i : j + 1])
            i, last = j + 1, "`"
            continue
        if ch == "/" and (last == "" or last in REGEX_AFTER or re.search(r"\b(?:return|typeof|case|in|of)\s*$", "".join(out[-3:]))):
            j, cls = i + 1, False
            while j < n and t[j] != "\n":
                if t[j] == "\\":
                    j += 2
                    continue
                if t[j] == "[":
                    cls = True
                elif t[j] == "]":
                    cls = False
                elif t[j] == "/" and not cls:
                    break
                j += 1
            out.append(t[i : j + 1])
            i, last = j + 1, "/"
            continue
        if stack:
            if ch == "{":
                stack[-1] += 1
            elif ch == "}":
                stack[-1] -= 1
        out.append(ch)
        if not ch.isspace():
            last = ch
        i += 1
    return "".join(out)


def scanned_files() -> list[tuple[str, str]]:
    out, seen = [], set()
    for pattern, surface in SCANNED:
        for p in sorted(glob.glob(os.path.join(ROOT, pattern))):
            rel = os.path.relpath(p, ROOT)
            if rel in seen or any(fnmatch.fnmatch(rel, e) for e, _ in EXEMPT):
                continue
            seen.add(rel)
            out.append((rel, surface))
    return out


def scan(src: dict) -> list[str]:
    errs = []
    blocks = {c["file"]: c for c in CONSUMERS}
    owned = {}  # every generated name, and the surfaces that define it
    for s in src["surfaces"]:
        for n in names_of(src, s):
            owned.setdefault(n, set()).add(s)
    rack = src["palettes"]["rack"]["groups"][0]["tokens"]["rack"]["value"].lower()
    for rel, surface in scanned_files():
        text = read(rel)
        if rel in blocks:
            m = BLOCK_RE.search(text)
            if m:
                text = text[: m.start()] + blank(m.group(0)) + text[m.end() :]
        for f, snippet, _ in NOT_COLOURS:
            if f == rel:
                text = text.replace(snippet, blank(snippet))
        if rel.endswith(".js"):
            body = strip_js(text)
        elif rel.endswith(".html"):
            body = strip_html(text)
        else:
            body = strip_css(text)
        mine = set()
        for sel, s in blocks[rel]["rules"] if rel in blocks else [(None, surface)]:
            if s:
                mine |= set(names_of(src, s))
        for m in THEME_RE.finditer(body):
            if m.group(1).lower() != rack:
                errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: theme-color {m.group(1)} is not the rack ({rack})")
            body = body[: m.start(1)] + blank(m.group(1)) + body[m.end(1) :]
        values = {rgba_of(v) for s in src["surfaces"] for v in names_of(src, s).values()}
        for m in CODE_HEX_RE.finditer(body):
            if rgba_of(m.group(1)) not in values:
                errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: `{m.group(1)}` in prose is not a token's value")
            body = body[: m.start(1)] + blank(m.group(1)) + body[m.end(1) :]
        pats = [HEX_RE, FUNC_RE] + ([TRIPLET_RE] if rel.endswith(".js") else [])
        for pat in pats:
            for m in pat.finditer(body):
                line = body.count("\n", 0, m.start()) + 1
                shown = text.split("\n")[line - 1].strip()
                errs.append(f"{rel}:{line}: a colour outside the tokens: {shown[:110]}")
        if rel.endswith(".js"):
            want = names_of(src, surface)
            for m in READ_RE.finditer(body):
                if m.group(1)[2:] not in want:
                    errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: reads {m.group(1)}, which {surface} does not define")
        else:
            defined = set(re.findall(r"(--[\w-]+)\s*:", body))
            for m in VAR_RE.finditer(body):
                n = m.group(1)[2:]
                if n in owned and n not in mine and m.group(1) not in defined:
                    errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: var(--{n}) belongs to {', '.join(sorted(owned[n]))}")
    return errs


def show_map(src: dict, surface: str) -> None:
    for n, v in names_of(src, surface).items():
        print(f"{v:24s} --{n}")


def main(argv: list[str]) -> int:
    if argv[:1] == ["--map"] and len(argv) == 2:
        show_map(load(), argv[1])
        return 0
    check = argv[:1] == ["--check"]
    if argv and not check:
        print(__doc__)
        return 2
    errs = generate(check)
    if check and not errs:
        errs = scan(load())
    for e in errs:
        print(f"  {e}", file=sys.stderr)
    if errs:
        print(f"  tokens: {len(errs)} problem(s)", file=sys.stderr)
        return 1
    if check:
        n = len(scanned_files())
        print(f"  tokens: {len(CONSUMERS)} generated blocks current, {n} files carry no stray colour")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
