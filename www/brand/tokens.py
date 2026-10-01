#!/usr/bin/env python3
"""Auracle's design tokens: one source, generated into every surface.

    python3 www/brand/tokens.py            write each consumer's generated block
    python3 www/brand/tokens.py --check    fail on a stale block, a stray color,
                                           or a rise in a file's literal sizes
    python3 www/brand/tokens.py --map SURFACE
                                           every value a surface can name, and its token
    python3 www/brand/tokens.py --where FILE
                                           every literal size and duration in one file
    python3 www/brand/tokens.py --update   lower the sizes baseline to today's counts
    python3 www/brand/tokens.py --update --allow-rise
                                           rewrite the sizes baseline, rises and all

`www/brand/tokens.json` holds the palettes (the rack, and the docs' Paper), the
font families, the type scale, spacing, radii and motion, and each surface's
own named shades, opacities and sizes. This script writes them as custom
properties between `/* tokens:begin … */` and `/* tokens:end */` in each
consumer's stylesheet, with the reduced-motion rule. The blocks are committed,
like the film blocks `publish.py` fills, so the app and the site still serve
with no build step.

`--check` (run by `make dev-check`) fails when:
- tokens.json holds a color that is not a color, or an opacity of one; a
  type, space or radius value that is not a length, a duration that is not in
  ms, an easing that is not a cubic-bezier(), or a type step off the ratio;
- a generated block differs from what tokens.json makes (run `make tokens`);
- a colour literal (hex, rgb()/rgba(), hsl()/hsla(), or an "r,g,b" string in
  a script) appears in a SCANNED file outside its generated block, or a CSS
  named colour (`white`, `rebeccapurple` …) is used as a colour there: in a
  declaration's value, an SVG colour attribute, an inline style, or a
  script's colour property. `transparent`, `currentColor` and `inherit`
  pass, and comments are not read;
- a script reads a token (`tok("--x")`, `ink("--x")`, `inkA("--x", a)`) its
  surface does not define, or a stylesheet uses a token another surface owns;
- a `<meta name="theme-color">` is not the rack, or a hex quoted in `<code>`
  is not a token's value (prose may name a colour, but only a true one);
- a SCANNED stylesheet defines, outside its block, a custom property any
  block defines (its own block's would be silently overridden, and another
  surface's name would be borrowed);
- a SCANNED file's count of literal sizes and durations moves from
  SIZES_BASELINE (see "The sizes ratchet" below).

The files in NOT_YET below still hold colours of their own and are not
scanned yet; `--check` lists them every time it runs.

The sizes ratchet. Every SCANNED file is counted, outside its generated block,
for four kinds of literal (units in any case: `PX` is `px`):
- font: a font size in px, rem, em or % (`font-size`, the `font` shorthand),
  but not 100% or 1em, which are the parent's size; an SVG `font-size="N"`
  attribute; and every assignment to a canvas context's `.font` (a name
  ending in ctx or Ctx, or `context`) that is not `canvasFont(…)`, whatever
  its form (a string, a template, a sum, a variable);
- space: a px or rem `padding`, `margin` or `gap` of 4 px or more (under the
  first step is an optical nudge);
- radius: a px or rem `border-radius` from 4 px up to 99 px (under it is a
  hairline's rounding, 999px is a pill and 50% a circle: shapes, not steps);
- time: a `transition` or `animation` duration or delay; in a script, a
  `duration: N` or a bare number inside an `.animate(…)` call's arguments.
These are read in stylesheets, `<style>` blocks and `style` attributes; in a
script's string literals, its `.style.*` assignments, its style objects
(`{ fontSize: "12px" }`) and its `style.setProperty()` calls; and through a
custom property: a literal in `--x: 10px` (or `setProperty("--x", "10px")`)
counts when `var(--x)` is used in one of the declarations above in a file
of the same surface. A `token-exempt: why` comment exempts only the
declaration it trails (past a string's closing quote or another comment),
and the why is required. Not counted: a script's other durations (a
`duration:` outside `.animate()`, timers, dwells, settles: when something
happens, not how long it moves), a `.font` on anything but a canvas
context, lengths that are not one of the four kinds (widths, heights,
offsets, shadows), and spacing in em.

Today's surfaces predate the scale, so this is a ratchet, as the voice check
is: the check fails when a file's count rises, when a file the baseline does
not list has any, and when a count falls below the baseline (a move lowers
the baseline in the same change, with `--update`), so the floor only goes
down. `--check` lists the files not yet moved every time it runs.

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
SIZES_BASELINE = "www/brand/sizes-baseline.json"
UPDATE = "python3 www/brand/tokens.py --update"

# The groups every surface shares beside the families, in the order the block
# writes them, and the kind of value each holds.
SIZE_GROUPS = ("type", "space", "radius", "motion")
SIZE_KINDS = ("font", "space", "radius", "time")

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

# The files scanned for stray colours, and the surfaces whose tokens each may
# read. Stylesheets with a block are scanned outside it.
DOCS = ("docs", "docs-paper")
SCANNED = [
    ("apps/web/*.css", ("app",)),
    ("apps/web/*.js", ("app",)),
    ("apps/web/index.html", ("app",)),
    ("www/landing/*.css", ("landing",)),
    ("www/landing/*.js", ("landing",)),
    ("www/landing/index.html", ("landing",)),
    ("www/theme/css/*.css", DOCS),
    ("www/theme/highlight.css", DOCS),
    ("www/theme/index.hbs", DOCS),
    ("www/brand/*.html", ("brand",)),
    ("www/404.html", ("404",)),
    ("www/video/stage/*.css", ("stage",)),
    ("www/video/stage/*.js", ("stage",)),
    ("www/video/stage/*.html", ("stage",)),
    ("www/video/films/*/*.js", ("stage",)),
    ("www/video/films/*/index.html", ("stage",)),
]

# Never scanned, because they are not styled pages. Keep this short.
EXEMPT = [
    ("www/brand/*.svg", "the marks are assets: a favicon cannot read a custom property"),
    ("docs/notes/**", "dated records"),
]

# NOT YET: pages and stylesheets that still hold colours of their own, each
# waiting on a decision rather than a substitution. They are not scanned, and
# `--check` names them every time it runs so they are not forgotten.
NOT_YET = [
    # The live figures, loaded by both books and the landing page. The grammar
    # figure fills its audio and model tiles with the dark theme's phosphors
    # as rgba literals (viz.js, near line 1614), so on the docs' Paper theme
    # they glow in the rack's hues under Paper's strokes; and the var()
    # fallbacks are literals. Needs a token per figure role, on both palettes.
    ("www/viz/viz.js", "tile glows in the dark theme's phosphors, wrong on Paper; literal fallbacks"),
    ("www/viz/viz.css", "var() fallbacks and a print colour"),
    # The docs' layer over mdBook: a film's ground is `var(--bezel, #07080a)`,
    # and Paper defines no --bezel, so on Paper the literal is what shows (on
    # purpose: films stay dark). Needs a token that says so on both palettes.
    ("www/theme/fonts/auracle.css", "a literal fallback for --bezel, which Paper lacks"),
    # The raster source of lockup.png and og.png: a hand copy of seven tokens and
    # a grey workbench. Belongs with the marks work (Plan-004 task 3).
    ("www/brand/render.html", "a hand copy of seven tokens; rasterises the lockup and the social card"),
]

# CSS's named colours. A name in a declaration's value, an SVG colour
# attribute or a script's colour property is a colour written outside the
# tokens; `transparent`, `currentColor` and `inherit` are not colours and pass.
NAMED = frozenset("""
aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown
burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro
ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab
orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru
pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen
""".split())

# Text that looks like a colour and is not one. (file, exact text, why)
NOT_COLOURS = [
    ("apps/web/main.js", 'endsWith("#dec")', "a knob's address"),
    ("apps/web/main.js", 'fill: "rgb(0, 0, 0)"', "the initial `fill` as getComputedStyle reports it; compared, never painted"),
    ("apps/web/main.js", '{ Noise: { color: "White" } }', "the Noise module's colour of noise, a grammar value"),
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
# Where a named colour would be a colour: a declaration's value, an SVG or
# HTML colour attribute, an inline style, and a script's colour properties.
DECL_RE = re.compile(r"(?<![\w-])-?-?[a-zA-Z][\w-]*\s*:\s*([^;{}]*)")
ATTR_RE = re.compile(r"""\b(?:fill|stroke|stop-color|flood-color|lighting-color|color|bgcolor)\s*=\s*\\?(["'])(.*?)\\?\1""")
STYLE_RE = re.compile(r"""\bstyle\s*=\s*\\?(["'])(.*?)\\?\1""", re.S)
JS_COLOUR_RE = re.compile(
    r"""(?<![\w$-])(?:fill|stroke|color|background|backgroundColor|border(?:Top|Right|Bottom|Left)?(?:Color)?|outline(?:Color)?"""
    r"""|fillStyle|strokeStyle|shadowColor|textShadow|boxShadow|caretColor|accentColor|textDecorationColor"""
    r"""|["'](?:stop-color|flood-color)["'])\s*(?:[:]|=(?!=))\s*(["'`])((?:(?!\1).)*)\1"""
)
JS_SETATTR_RE = re.compile(r"""setAttribute\(\s*["'](?:fill|stroke|stop-color|flood-color|color)["']\s*,\s*(["'`])((?:(?!\1).)*)\1""")
WORD_RE = re.compile(r"(?<![\w.#$-])([a-zA-Z]+)(?![\w-])")


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
        for p in sorted(pcts, key=lambda x: Decimal(str(x))):
            alphas.append((alpha_name(base, p), alpha_value(named[base], p), ""))
    if alphas:
        out.append(("opacities: `--phos-b-30` is --phos-b at 30%; a third digit is a tenth (`--phos-a-045` is 4.5%)", alphas))
    return out


def names_of(src: dict, surface: str) -> dict[str, str]:
    return {n: v for _, toks in sections(src, surface) for n, v, _ in toks}


def validate(src: dict) -> list[str]:
    """Every value is a colour and every opacity has an opaque base, checked
    before anything is derived from them, so a typo reads as one."""
    errs = []

    def tokens_in(where: str, toks: dict) -> None:
        for n, t in toks.items():
            v = t.get("value") if isinstance(t, dict) else None
            if not isinstance(v, str) or rgba_of(v) is None:
                errs.append(f"{SOURCE}: {where}: --{n}: `{v}` is not a colour")

    for p, pal in src.get("palettes", {}).items():
        for g in pal.get("groups", []):
            tokens_in(p, g.get("tokens", {}))
    tokens_in("light", src.get("light", {}).get("tokens", {}))
    for surface, s in src.get("surfaces", {}).items():
        if s.get("palette") not in src.get("palettes", {}):
            errs.append(f"{SOURCE}: {surface}: no palette `{s.get('palette')}`")
            continue
        tokens_in(surface, s.get("tokens", {}))
        named = {n: t.get("value") for g in src["palettes"][s["palette"]]["groups"] for n, t in g["tokens"].items()}
        named.update({n: t.get("value") for n, t in src["light"]["tokens"].items()})
        named.update({n: t.get("value") for n, t in s.get("tokens", {}).items()})
        for base, pcts in s.get("alpha", {}).items():
            c = rgba_of(named[base]) if isinstance(named.get(base), str) else None
            if base not in named:
                errs.append(f"{SOURCE}: {surface} has opacities of --{base}, which it does not define")
            elif c is None:
                pass  # already reported: not a colour
            elif c[3] != 1:
                errs.append(f"{SOURCE}: {surface}: opacities of --{base} need an opaque colour, not `{named[base]}`")
            for p in pcts:
                if isinstance(p, bool) or not isinstance(p, (int, float)) or not 0 <= p <= 100:
                    errs.append(f"{SOURCE}: {surface}: --{base} at `{p}`% is not an opacity")
    return errs


def check_source(src: dict) -> list[str]:
    """A value has one name per surface (the values are valid by now)."""
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


# ─── sizes: type, space, radius, motion ─────────────────────────────────────

LENGTH = r"-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vw|vh|%)"
EASING_RE = re.compile(r"cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)")
WHOLE_PX_RE = re.compile(r"\d+px")
MS_RE = re.compile(r"\d+ms")


def is_length(v: str) -> bool:
    """A length, or a clamp()/min()/max() of lengths."""
    v = v.strip()
    if re.fullmatch(LENGTH, v):
        return True
    m = re.fullmatch(r"(?:clamp|min|max)\((.*)\)", v)
    return bool(m) and all(re.fullmatch(LENGTH, a.strip()) for a in m.group(1).split(","))


def sizes_surface(c: dict) -> str | None:
    """The surface whose own sizes a consumer writes: its families' rule's."""
    i = next((i for i, (_, s) in enumerate(c["rules"]) if s is None), 0)
    return c["rules"][i][1]


def size_sections(src: dict, surface: str | None) -> list[tuple[str, list[tuple[str, str, str]]]]:
    """The shared size groups, with the surface's restatements in place, then
    the sizes only it uses; as titled groups of (name, value, note)."""
    own = src["surfaces"][surface].get("sizes", {}) if surface else {}
    out, shared = [], set()
    for key in SIZE_GROUPS:
        g = src[key]
        row = []
        for n, t in g["tokens"].items():
            shared.add(n)
            if n in own:
                row.append((n, own[n]["value"], f"{surface}: {own[n].get('note', '')}"))
            else:
                row.append((n, t["value"], t.get("note", "")))
        out.append((g["title"], row))
    extra = [(n, t["value"], t.get("note", "")) for n, t in own.items() if n not in shared]
    if extra:
        out.append((f"{surface}: sizes only this surface uses", extra))
    return out


def size_names(src: dict, surface: str | None) -> dict[str, str]:
    return {n: v for _, toks in size_sections(src, surface) for n, v, _ in toks}


def reduced_motion(src: dict) -> list[tuple[str, str]]:
    return list(src["motion"].get("reduced", {}).items())


def validate_sizes(src: dict) -> list[str]:
    """Type, space and radius are whole px, durations ms, easings
    cubic-bezier(); each type step sits on the ratio; a surface's own sizes
    are lengths, and one that restates a shared token says why."""
    errs = []
    taken = {n for p in src.get("palettes", {}).values() for g in p.get("groups", []) for n in g.get("tokens", {})}
    taken |= set(src.get("light", {}).get("tokens", {})) | {f"font-{n}" for n in src.get("fonts", {})}
    shared: dict[str, str] = {}
    for key in SIZE_GROUPS:
        g = src.get(key)
        if not isinstance(g, dict) or not isinstance(g.get("tokens"), dict) or not g.get("title"):
            errs.append(f"{SOURCE}: no `{key}` group with a title and tokens")
            continue
        for n, t in g["tokens"].items():
            v = t.get("value") if isinstance(t, dict) else None
            where = f"{SOURCE}: {key}: --{n}"
            if n in shared or n in taken:
                errs.append(f"{where} is already a token's name")
            shared[n] = key
            if not isinstance(v, str):
                errs.append(f"{where}: `{v}` is not a value")
            elif key != "motion":
                if not WHOLE_PX_RE.fullmatch(v):
                    errs.append(f"{where}: `{v}` is not a whole number of px")
            elif n.startswith("d-"):
                if not MS_RE.fullmatch(v):
                    errs.append(f"{where}: `{v}` is not a duration in ms")
            elif n.startswith("e-"):
                if not EASING_RE.fullmatch(v):
                    errs.append(f"{where}: `{v}` is not a cubic-bezier()")
            else:
                errs.append(f"{where}: a motion token is a duration (d-) or an easing (e-)")
    if errs:
        return errs
    # The ratio: a step's size is the base's times the ratio to the step, rounded.
    ty = src["type"]
    ratio, base = ty.get("ratio"), ty["tokens"].get(ty.get("base"), {})
    if not isinstance(ratio, (int, float)) or isinstance(ratio, bool) or base.get("step") != 0:
        errs.append(f"{SOURCE}: type needs a ratio, and a base token at step 0")
    else:
        b = int(base["value"][:-2])
        for n, t in ty["tokens"].items():
            s = t.get("step")
            if s is None:
                continue
            want = round(b * ratio**s) if isinstance(s, int) and not isinstance(s, bool) else None
            if want is None or t["value"] != f"{want}px":
                errs.append(f"{SOURCE}: type: --{n} is step {s} up from {b}px at {ratio}, which is {want}px, not {t['value']}")
    steps = [int(t["value"][:-2]) for t in src["space"]["tokens"].values()]
    if steps != sorted(set(steps)):
        errs.append(f"{SOURCE}: space: each step is wider than the one before")
    for n, v in reduced_motion(src):
        if shared.get(n) != "motion" or not n.startswith("d-"):
            errs.append(f"{SOURCE}: motion: `reduced` names --{n}, which is not a duration")
        elif not isinstance(v, str) or not MS_RE.fullmatch(v):
            errs.append(f"{SOURCE}: motion: reduced --{n}: `{v}` is not a duration in ms")
    writes = {sizes_surface(c) for c in CONSUMERS}
    for surface, s in src.get("surfaces", {}).items():
        own = s.get("sizes", {})
        if own and surface not in writes:
            errs.append(f"{SOURCE}: {surface} has sizes, but no consumer writes them (they go in the rule that holds the families)")
        mine = taken | set(s.get("tokens", {}))
        for n, t in own.items():
            v = t.get("value") if isinstance(t, dict) else None
            if not isinstance(v, str) or not is_length(v):
                errs.append(f"{SOURCE}: {surface}: --{n}: `{v}` is not a length")
            if n in shared and not t.get("note"):
                errs.append(f"{SOURCE}: {surface}: --{n} restates a shared {shared[n]} token; a note says why")
            if n in mine:
                errs.append(f"{SOURCE}: {surface}: --{n} is already a token's name")
    return errs


# ─── generation ──────────────────────────────────────────────────────────────


def render_group(title: str, toks: list[tuple[str, str, str]], d: str) -> list[str]:
    lines = []
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
    return lines


def render_rule(src: dict, selector: str, surface: str | None, fonts: bool, indent: str, step: str) -> list[str]:
    d = indent + step
    lines = [f"{indent}{selector} {{"]
    groups = sections(src, surface) if surface else []
    first = True
    for title, toks in groups:
        if not first:
            lines.append("")
        first = False
        lines += render_group(title, toks, d)
    if fonts:
        # The rule that holds the families holds the sizes too: every surface
        # shares them, and a surface's own go with it.
        if groups:
            lines.append("")
        lines.append(f"{d}/* families */")
        for n, t in src["fonts"].items():
            decl = f"--font-{n}: {t['value']};"
            lines.append(f"{d}{decl}")
        for title, toks in size_sections(src, surface):
            lines.append("")
            lines += render_group(title, toks, d)
    lines.append(f"{indent}}}")
    return lines


def render_block(src: dict, c: dict) -> str:
    ind, step = c["indent"], c["step"]
    fonts_rule = next((i for i, (_, s) in enumerate(c["rules"]) if s is None), 0)
    out = [f"{ind}{BEGIN}"]
    for i, (sel, surface) in enumerate(c["rules"]):
        out += render_rule(src, sel, surface, i == fonts_rule, ind, step)
    still = " ".join(f"--{n}: {v};" for n, v in reduced_motion(src))
    out += [
        f"{ind}@media (prefers-reduced-motion: reduce) {{",
        f"{ind}{step}{c['rules'][fonts_rule][0]} {{ {still} }}",
        f"{ind}}}",
    ]
    out.append(f"{ind}{END}")
    return "\n".join(out)


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def generate(check: bool) -> list[str]:
    src = load()
    errs = validate(src) or check_source(src) or validate_sizes(src)
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


def scanned_files() -> list[tuple[str, tuple[str, ...]]]:
    out, seen = [], set()
    skip = [e for e, _ in EXEMPT] + [e for e, _ in NOT_YET]
    for pattern, surfaces in SCANNED:
        for p in sorted(glob.glob(os.path.join(ROOT, pattern))):
            rel = os.path.relpath(p, ROOT)
            if rel in seen or any(fnmatch.fnmatch(rel, e) for e in skip):
                continue
            seen.add(rel)
            out.append((rel, surfaces))
    return out


def named_colours(body: str, kind: str) -> list[int]:
    """Offsets of CSS named colours used as colours in `body` (comments
    already blanked). `kind` is "css", "html" or "js"."""
    hits = []

    def values(text: str, base: int) -> None:
        # A declaration's value, strings and url()s blanked first.
        for m in DECL_RE.finditer(text):
            v = re.sub(r"\"[^\"]*\"|'[^']*'|url\([^)]*\)|\$\{[^}]*\}", lambda x: blank(x.group(0)), m.group(1))
            words(v, base + m.start(1))

    def words(v: str, base: int) -> None:
        for w in WORD_RE.finditer(v):
            if w.group(1).lower() in NAMED:
                hits.append(base + w.start(1))

    if kind == "css":
        values(body, 0)
        return hits
    if kind == "html":
        for m in re.finditer(r"(<style[^>]*>)(.*?)</style>", body, re.S):
            values(m.group(2), m.start(2))
    for m in STYLE_RE.finditer(body):
        values(m.group(2), m.start(2))
    for m in ATTR_RE.finditer(body):
        words(re.sub(r"\$\{[^}]*\}", lambda x: blank(x.group(0)), m.group(2)), m.start(2))
    if kind == "js":
        for pat in (JS_COLOUR_RE, JS_SETATTR_RE):
            for m in pat.finditer(body):
                v = re.sub(r"\$\{[^}]*\}", lambda x: blank(x.group(0)), m.group(2))
                words(v, m.start(2))
    return sorted(set(hits))


def scan(src: dict) -> list[str]:
    errs = []
    blocks = {c["file"]: c for c in CONSUMERS}
    owned = {}  # every generated name, and the surfaces that define it
    for s in src["surfaces"]:
        for n in list(names_of(src, s)) + list(size_names(src, s)):
            owned.setdefault(n, set()).add(s)
    families = {f"font-{n}" for n in src["fonts"]}
    rack = src["palettes"]["rack"]["groups"][0]["tokens"]["rack"]["value"].lower()
    for rel, surfaces in scanned_files():
        text = read(rel)
        if rel in blocks:
            m = BLOCK_RE.search(text)
            if m:
                text = text[: m.start()] + blank(m.group(0)) + text[m.end() :]
        for f, snippet, _ in NOT_COLOURS:
            if f == rel:
                text = text.replace(snippet, blank(snippet))
        if rel.endswith(".js"):
            kind, body = "js", strip_js(text)
        elif rel.endswith((".html", ".hbs")):
            kind, body = "html", strip_html(text)
        else:
            kind, body = "css", strip_css(text)
        mine = set(families)
        for s in surfaces:
            mine |= set(names_of(src, s)) | set(size_names(src, s))
        if kind != "js":
            # A definition after the block would silently win over it, and one
            # of another surface's names would borrow it outside the source.
            for m in re.finditer(r"(?<![\w-])--([\w-]+)\s*:", body):
                n = m.group(1)
                if n in mine or n in families:
                    errs.append(
                        f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: defines --{n}, which the tokens block already does; "
                        f"change it in {SOURCE}"
                    )
                elif n in owned:
                    errs.append(
                        f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: defines --{n}, which belongs to {', '.join(sorted(owned[n]))}; "
                        f"a size or shade this surface needs is a token of its own in {SOURCE}"
                    )
        for m in THEME_RE.finditer(body):
            if m.group(1).lower() != rack:
                errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: theme-color {m.group(1)} is not the rack ({rack})")
            body = body[: m.start(1)] + blank(m.group(1)) + body[m.end(1) :]
        values = {rgba_of(v) for s in src["surfaces"] for v in names_of(src, s).values()}
        for m in CODE_HEX_RE.finditer(body):
            if rgba_of(m.group(1)) not in values:
                errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: `{m.group(1)}` in prose is not a token's value")
            body = body[: m.start(1)] + blank(m.group(1)) + body[m.end(1) :]
        pats = [HEX_RE, FUNC_RE] + ([TRIPLET_RE] if kind == "js" else [])
        at = [m.start() for pat in pats for m in pat.finditer(body)]
        for i in sorted(at):
            line = body.count("\n", 0, i) + 1
            shown = text.split("\n")[line - 1].strip()
            errs.append(f"{rel}:{line}: a colour outside the tokens: {shown[:110]}")
        for i in named_colours(body, kind):
            line = body.count("\n", 0, i) + 1
            word = re.match(r"[a-zA-Z]+", body[i:]).group(0)
            errs.append(f"{rel}:{line}: a named colour outside the tokens ({word}): {text.split(chr(10))[line - 1].strip()[:100]}")
        if kind == "js":
            for m in READ_RE.finditer(body):
                if m.group(1)[2:] not in mine:
                    errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: reads {m.group(1)}, which {'/'.join(surfaces)} does not define")
        else:
            defined = set(re.findall(r"(--[\w-]+)\s*:", body))
            for m in VAR_RE.finditer(body):
                n = m.group(1)[2:]
                if n in owned and n not in mine and m.group(1) not in defined:
                    errs.append(f"{rel}:{body.count(chr(10), 0, m.start()) + 1}: var(--{n}) belongs to {', '.join(sorted(owned[n]))}")
    return errs


# ─── the sizes ratchet ───────────────────────────────────────────────────────

PROP_RE = re.compile(r"(?<![\w-])(-?-?[a-zA-Z][\w-]*)\s*:\s*([^;{}]*)")
SPACE_PROP_RE = re.compile(r"(?:padding|margin|scroll-padding|scroll-margin)(?:-[a-z-]+)?|(?:row-|column-|grid-|grid-row-|grid-column-)?gap")
RADIUS_PROP_RE = re.compile(r"border(?:-[a-z]+)*-radius")
TIME_PROP_RE = re.compile(r"(?:transition|animation)(?:-duration|-delay)?")
QUANTITY_RE = re.compile(r"(?<![\w.#$-])(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|ms|s|%)(?![\w-])", re.I)
JS_PROPS = (
    r"font|fontSize|font-size|padding\w*|padding-[a-z-]+|margin\w*|margin-[a-z-]+|gap|rowGap|row-gap|columnGap|column-gap"
    r"|border\w*Radius|border(?:-[a-z]+)*-radius|transition\w*|transition-[a-z]+|animation\w*|animation-[a-z]+"
)
# `el.style.fontSize = "12px"`, and `{ fontSize: "12px" }` or `{ "font-size": "12px" }`
# in an object (Object.assign(el.style, …), a style map).
JS_STYLE_RE = re.compile(r"""\.style\.(%s)\s*=\s*(["'`])((?:(?!\2).)*)\2""" % JS_PROPS)
JS_OBJ_STYLE_RE = re.compile(r"""(?<![\w$.-])(["']?)(%s)\1\s*:\s*(["'`])((?:(?!\3).)*)\3""" % JS_PROPS)
SET_PROPERTY_RE = re.compile(r"""setProperty\(\s*(["'])(--[\w-]+|[a-z-]+)\1\s*,([^;)]*)\)""")
# Any assignment to a canvas context's font (a name ending in ctx or Ctx, or
# `context`) but the one sanctioned path. Its form does not matter: a
# string, a template, a sum or a variable all set a size.
CANVAS_FONT_RE = re.compile(r"""\b(?:\w*[cC]tx|context)\.font\s*=(?!=)\s*([^;\n]*)""")
SVG_FONT_SIZE_RE = re.compile(r"""\bfont-size\s*=\s*\\?["']\s*(-?\d+(?:\.\d+)?)""")
# Inside an `.animate(…)` call's arguments only: its options' `duration`, or a
# number passed as the options. A `duration:` anywhere else is a toast's
# dwell or a sound's length.
JS_DURATION_RE = re.compile(r"""(?<![\w$.-])["']?duration["']?\s*:\s*(\d+(?:\.\d+)?)(?![\w.])""")
JS_ANIMATE_LAST_RE = re.compile(r""",\s*(\d+(?:\.\d+)?)\s*$""")
STRING_RE = re.compile(r""""(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`""")
CUSTOM_DEF_RE = re.compile(r"(?<![\w-])(--[\w-]+)\s*:\s*([^;{}]*)")
EXEMPT_RE = re.compile(r"(/\*|//)\s*token-exempt:(.*?)(?:\*/|$)", re.M)


def kind_of(prop: str) -> str | None:
    """The kind of literal a CSS property's value counts as, if any."""
    p = prop.lower()
    if p in ("font", "font-size"):
        return "font"
    if SPACE_PROP_RE.fullmatch(p):
        return "space"
    if RADIUS_PROP_RE.fullmatch(p):
        return "radius"
    if TIME_PROP_RE.fullmatch(p):
        return "time"
    return None


def counted(kind: str, num: str, unit: str) -> bool:
    """Whether a quantity in a value of this kind is a literal the scale owns."""
    unit = unit.lower()
    v = abs(float(num)) * (16 if unit == "rem" else 1)
    if kind == "font":
        # 100% and 1em are the parent's size: no size of their own.
        if (unit, float(num)) in (("em", 1.0), ("%", 100.0)):
            return False
        return unit in ("px", "rem", "em", "%")
    if kind == "space":
        return unit in ("px", "rem") and v >= 4
    if kind == "radius":
        return unit in ("px", "rem") and 4 <= v < 100
    return unit in ("ms", "s") and v > 0


# A hit is (offset, kind, text, end): `end` is where the declaration (or the
# script's construct) it sits in ends, which is what an exemption trails.
Hit = tuple[int, str, str, int]


def value_hits(kind: str, value: str, at: int) -> list[Hit]:
    """The counted literals in one declaration's value."""
    end = at + len(value.rstrip())
    if kind == "font":
        # The shorthand's size is the length before the line height or the
        # family; a font-size holds one, or a clamp() of them.
        value = value.split("/")[0]
    return [(at + m.start(), kind, m.group(0), end) for m in QUANTITY_RE.finditer(value) if counted(kind, m.group(1), m.group(2))]


def css_size_hits(body: str, base: int = 0, usage: dict | None = None) -> list[Hit]:
    hits = []
    for m in PROP_RE.finditer(body):
        prop = m.group(1)
        kind = None if prop.startswith("-") else kind_of(prop)
        if kind:
            hits += value_hits(kind, m.group(2), base + m.start(2))
    # A literal reaches a counted property through a custom property.
    for m in CUSTOM_DEF_RE.finditer(body):
        kind = (usage or {}).get(m.group(1))
        if kind:
            hits += value_hits(kind, m.group(2), base + m.start(2))
    return hits


def js_size_hits(body: str, usage: dict | None = None) -> list[Hit]:
    """Sizes and durations in a script: CSS in its strings, its `.style.*`
    assignments, style objects and setProperty() calls, its canvas fonts, an
    SVG `font-size` attribute in a template, and an animation's duration."""
    hits = []
    # A string's own text, inside its quotes, so a declaration in it ends
    # where its value does and an exemption after the string attaches.
    for m in STRING_RE.finditer(body):
        hits += css_size_hits(m.group(0)[1:-1], m.start() + 1, usage)
    for pat, p, v in ((JS_STYLE_RE, 1, 3), (JS_OBJ_STYLE_RE, 2, 4)):
        for m in pat.finditer(body):
            kind = kind_of(re.sub(r"[A-Z]", lambda c: "-" + c.group(0).lower(), m.group(p)))
            if kind:
                hits += value_hits(kind, m.group(v), m.start(v))
    for m in SET_PROPERTY_RE.finditer(body):
        name = m.group(2)
        kind = (usage or {}).get(name) if name.startswith("--") else kind_of(name)
        if kind:
            hits += value_hits(kind, m.group(3), m.start(3))
    for m in CANVAS_FONT_RE.finditer(body):
        rhs = m.group(1).strip()
        if rhs and not rhs.startswith("canvasFont("):
            hits.append((m.start(1), "font", rhs[:40], m.start(1) + len(m.group(1).rstrip())))
    hits += [(m.start(1), "font", m.group(1), m.end()) for m in SVG_FONT_SIZE_RE.finditer(body)]
    for at, args in animate_args(body):
        found = list(JS_DURATION_RE.finditer(args)) + list(JS_ANIMATE_LAST_RE.finditer(args))
        hits += [(at + m.start(1), "time", m.group(1), at + m.end(1)) for m in found if float(m.group(1)) > 0]
    return hits


def animate_args(body: str) -> list[tuple[int, str]]:
    """Each `.animate(…)` call's argument text and where it starts, its
    parentheses balanced (strings are not parsed: a paren inside one ends it
    early, which only loses a count)."""
    out = []
    for m in re.finditer(r"\.animate\(", body):
        i, depth = m.end(), 1
        while i < len(body) and depth:
            depth += {"(": 1, ")": -1}.get(body[i], 0)
            i += 1
        out.append((m.end(), body[m.end() : i - 1]))
    return out


def css_bodies(rel: str) -> list[tuple[str, str, int]]:
    """A scanned file's text, its generated block blanked, as (kind, body,
    offset) pieces: "css" for a stylesheet, a <style> block or a style
    attribute, "js" for a script or an inline <script>. Comments blanked."""
    text = read(rel)
    if rel in {c["file"] for c in CONSUMERS}:
        m = BLOCK_RE.search(text)
        if m:
            text = text[: m.start()] + blank(m.group(0)) + text[m.end() :]
    if rel.endswith(".js"):
        return [("js", strip_js(text), 0)]
    if rel.endswith((".html", ".hbs")):
        body = strip_html(text)
        out = [("css", m.group(1), m.start(1)) for m in re.finditer(r"<style[^>]*>(.*?)</style>", body, re.S)]
        out += [("css", m.group(2), m.start(2)) for m in STYLE_RE.finditer(body)]
        out += [("js", strip_js(m.group(1)), m.start(1)) for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", body, re.S)]
        # An SVG `font-size` attribute in the markup itself.
        out += [("svg", m.group(0), m.start()) for m in SVG_FONT_SIZE_RE.finditer(re.sub(r"<script.*?</script>", lambda x: blank(x.group(0)), body, flags=re.S))]
        return out
    return [("css", strip_css(text), 0)]


def custom_usage() -> dict[tuple[str, ...], dict[str, str]]:
    """For each surface (the surface tuple SCANNED gives a file), each custom
    property `var()`'d in a counted declaration in its files, and the kind of
    that declaration. Per surface, so a name two pages happen to share (the
    brand page's `--frame` is a width) cannot make one page's literal count
    for the other's use; the app's stylesheet and scripts are one surface."""
    usage: dict[tuple[str, ...], dict[str, str]] = {}

    def from_css(u: dict, body: str) -> None:
        for m in PROP_RE.finditer(body):
            kind = None if m.group(1).startswith("-") else kind_of(m.group(1))
            if kind:
                for v in VAR_RE.finditer(m.group(2)):
                    u.setdefault(v.group(1), kind)

    for rel, surfaces in scanned_files():
        u = usage.setdefault(surfaces, {})
        for kind, body, _ in css_bodies(rel):
            if kind == "css":
                from_css(u, body)
            elif kind == "js":
                for s in STRING_RE.finditer(body):
                    from_css(u, s.group(0)[1:-1])
    return usage


def size_hits(rel: str, usage: dict | None = None) -> tuple[list[tuple[int, str, str]], list[str]]:
    """A scanned file's counted literals, as (line, kind, text), and its
    problems (a token-exempt that does not say why)."""
    text = read(rel)
    if usage is None:
        usage = custom_usage()
    usage = usage.get(dict(scanned_files()).get(rel, ()), {})
    hits: list[Hit] = []
    for kind, body, at in css_bodies(rel):
        found = css_size_hits(body, 0, usage) if kind == "css" else js_size_hits(body, usage) if kind == "js" else []
        if kind == "svg":
            m = SVG_FONT_SIZE_RE.match(body)
            found = [(m.start(1), "font", m.group(1), m.end())]
        hits += [(at + o, k, t, at + e) for o, k, t, e in found]
    # An exemption trails the declaration it is for: what it covers ends where
    # the comment's own line, back past `;`, `,`, `}`, quotes and any other
    # comment, stops.
    plain = strip_js(text) if rel.endswith(".js") else strip_html(text) if rel.endswith((".html", ".hbs")) else strip_css(text)
    problems, trailed = [], set()
    for m in EXEMPT_RE.finditer(text):
        if not m.group(2).strip():
            problems.append(f"{rel}:{text.count(chr(10), 0, m.start()) + 1}: a token-exempt says why")
        p = m.start()
        while p > 0 and plain[p - 1] in " \t;,}\"'`":
            p -= 1
        trailed.add(p)
    out = []
    for o, kind, lit, end in sorted(set(hits)):
        if end not in trailed:
            out.append((text.count("\n", 0, o) + 1, kind, lit))
    return out, problems


def size_counts() -> tuple[dict[str, dict[str, int]], list[str]]:
    now, problems = {}, []
    usage = custom_usage()
    for rel, _ in scanned_files():
        hits, p = size_hits(rel, usage)
        problems += p
        c = {k: 0 for k in SIZE_KINDS}
        for _, kind, _ in hits:
            c[kind] += 1
        if any(c.values()):
            now[rel] = {k: v for k, v in c.items() if v}
    return now, problems


def load_size_baseline() -> dict[str, dict[str, int]]:
    p = os.path.join(ROOT, SIZES_BASELINE)
    if not os.path.exists(p):
        return {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def size_problems(now: dict, base: dict) -> list[str]:
    errs = []
    for rel in sorted(set(now) | set(base)):
        for k in SIZE_KINDS:
            n, b = now.get(rel, {}).get(k, 0), base.get(rel, {}).get(k, 0)
            if n > b:
                what = "a file the baseline does not list" if rel not in base else f"the baseline holds {b}"
                errs.append(f"{rel}: {n} literal {k} sizes, and {what}; use a token, or say why with `token-exempt:`")
            elif n < b:
                errs.append(f"{rel}: {n} literal {k} sizes, under the baseline's {b}; lower it in the same change: {UPDATE}")
    return errs


def updated_baseline(now: dict, base: dict, allow_rise: bool) -> dict:
    out = {}
    for rel in sorted(set(now) | set(base)):
        row = {}
        for k in SIZE_KINDS:
            n = now.get(rel, {}).get(k, 0)
            if not allow_rise:
                n = min(n, base.get(rel, {}).get(k, 0))
            if n:
                row[k] = n
        if row:
            out[rel] = row
    return out


def show_map(src: dict, surface: str) -> None:
    for n, v in list(names_of(src, surface).items()) + list(size_names(src, surface).items()):
        print(f"{v:24s} --{n}")


def write_size_baseline(b: dict) -> None:
    with open(os.path.join(ROOT, SIZES_BASELINE), "w", encoding="utf-8") as f:
        json.dump(b, f, indent=2, sort_keys=True)
        f.write("\n")


def main(argv: list[str]) -> int:
    if argv[:1] == ["--map"] and len(argv) == 2:
        src = load()
        errs = validate(src) or validate_sizes(src)
        if errs or argv[1] not in src["surfaces"]:
            print("\n".join(errs) or f"no surface {argv[1]}: {', '.join(src['surfaces'])}", file=sys.stderr)
            return 1
        show_map(src, argv[1])
        return 0
    if argv[:1] == ["--where"] and len(argv) == 2:
        hits, problems = size_hits(argv[1])
        for line, kind, lit in hits:
            print(f"{argv[1]}:{line}: {kind} {lit}")
        for p in problems:
            print(p, file=sys.stderr)
        return 1 if problems else 0
    if argv[:1] == ["--update"] and set(argv[1:]) <= {"--allow-rise"}:
        now, problems = size_counts()
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        base = load_size_baseline()
        new = updated_baseline(now, base, "--allow-rise" in argv)
        write_size_baseline(new)
        left = size_problems(now, new)
        print(f"  tokens: wrote {SIZES_BASELINE} ({len(new)} files, {sum(sum(r.values()) for r in new.values())} literals)")
        for e in left:
            print(f"  {e}", file=sys.stderr)
        if left:
            print("  tokens: those rose; --update --allow-rise takes them into the baseline", file=sys.stderr)
        return 1 if left or problems else 0
    check = argv[:1] == ["--check"]
    if argv and not check:
        print(__doc__)
        return 2
    errs = generate(check)
    if check and not errs:
        errs = scan(load())
        now, problems = size_counts()
        errs += problems + size_problems(now, load_size_baseline())
    for e in errs:
        print(f"  {e}", file=sys.stderr)
    if errs:
        print(f"  tokens: {len(errs)} problem(s)", file=sys.stderr)
        return 1
    if check:
        n = len(scanned_files())
        print(f"  tokens: {len(CONSUMERS)} generated blocks current, {n} files carry no stray colour")
        print(f"  tokens: not yet checked: {', '.join(f for f, _ in NOT_YET)} (tokens.py NOT_YET)")
        total = sum(sum(r.values()) for r in now.values())
        print(f"  tokens: sizes not yet moved onto the scale ({total} literals, {SIZES_BASELINE}): {', '.join(f'{rel} ({sum(r.values())})' for rel, r in now.items())}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
