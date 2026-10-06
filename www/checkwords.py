#!/usr/bin/env python3
"""The voice check: what `www/brand/voice.md` rules out, counted wherever
Auracle speaks, and held to a baseline that only goes down.

    python3 www/checkwords.py                fail when a count moves (make dev-check, CI)
    python3 www/checkwords.py --summary      the hits on each surface, rule by rule
    python3 www/checkwords.py --where FILE   every hit in one file, with its line
    python3 www/checkwords.py --update       lower the baseline to today's counts
    python3 www/checkwords.py --update --allow-rise
                                             rewrite the baseline, rises and all

It counts three things on every surface in SURFACES:
- the words and phrases in voice.md's `banned` block, read at run time so the
  guide stays the one list. Each line there is `word or phrase | scope | say
  instead`; `player` applies to the app (and the words the engine's Rust
  sends it), the landing page and its figures, the guide and the films, and
  `all` adds the reference, the README and the changelog (with the entries
  waiting in `changelog.d/`);
- em dashes (voice.md: "No em dashes, anywhere");
- the British spellings in BRITISH below (voice.md: "The spelling is
  American").

Only what a reader sees or hears is read: a script's string and template
literals (not its comments, its names, or a literal used as a name: see
`is_name`), a page's text and its `title`, `aria-label`, `placeholder` and
`alt` (and a `<meta>` description or social-card title), Markdown's prose
outside code (an admonish callout is prose), a film script's `text` lines,
and a Rust file's string literals (not its comments, nor what builds only
for tests: `#[cfg(test)]`, `#[test]` and the like; see `rs_raw`). Entities
are decoded everywhere but in Rust. In a script or a Rust file, the comment
`// voice: name` marks its line as names (or a code, or a key): a literal
that starts on that line is not read. A literal that runs over several
lines cannot carry the mark, because its first line ends inside it: put a
name on one line. In
Markdown, text between `<!-- voice: quote -->` and `<!-- /voice -->` quotes
someone else's words (a standard's title, a label the app used to show), and
is not read; the span can wrap a line, never a paragraph.

A word matches whole, in any case, with its plain inflections (`generate`
matches "generated", never "generation"). An entry written in capitals (AI,
HELD) matches only in capitals, except where it is the whole of a label: the
app writes its silk labels in lowercase and sets them in capitals with CSS, so
a text node or a literal that is exactly `held` is the HELD label.

Today's copy predates the guide, so this is a ratchet: `voice-baseline.json`
holds each file's count for each rule. The check fails when a count rises, or
a file it does not list has any hit at all. It also fails when a count falls
below the baseline, so a sweep lowers the baseline in the same change
(`--update`) and the floor can never loosen. Python 3 standard library only.
"""

from __future__ import annotations

import bisect
import fnmatch
import functools
import glob
import html
import json
import os
import re
import subprocess
import sys
from collections import Counter, namedtuple

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
VOICE = "www/brand/voice.md"
BASELINE = "www/brand/voice-baseline.json"
UPDATE = "python3 www/checkwords.py --update"

# Each surface: its name, the scope tier its words come from, and its files
# with the kind of text each holds. `player` surfaces take `player` and `all`
# entries; `all` surfaces take only `all` entries (a `player` word such as
# "duel" is the reference's own term). Em dashes and spellings count on all.
SURFACES = [
    ("app", "player", [("apps/web/index.html", "html"), ("apps/web/*.js", "js")]),
    # The app's words that the engine writes: every Rust file a string reaches
    # the screen from, read whole. The preset library's names and
    # descriptions; the rack's module titles, knob labels and options, and the
    # names the lineage strip gives them; PERFORM's controls and their ends;
    # the bank's sound names; and the reasons an edit is refused, which the
    # app's toast quotes. A code, a JSON key or a panic's message in these
    # files is read too (a panic never reaches the screen: it traps in the
    # browser), and one that trips the check gets `// voice: name` on the
    # line it starts on.
    # Reason codes (`no_move`) and the status the worker posts are not copy,
    # and live in files not read here.
    (
        "engine",
        "player",
        [
            ("crates/auracle-grammar/src/presets.rs", "rust"),
            ("crates/auracle-grammar/src/describe.rs", "rust"),
            ("crates/auracle-grammar/src/term.rs", "rust"),
            ("crates/auracle-grammar/src/prior.rs", "rust"),
            ("crates/auracle-grammar/src/diff.rs", "rust"),
            ("crates/auracle-grammar/src/mutate.rs", "rust"),
            ("crates/auracle-session/src/perform.rs", "rust"),
            ("crates/auracle-session/src/naming.rs", "rust"),
            ("crates/auracle-wasm/src/lib.rs", "rust"),
        ],
    ),
    ("landing", "player", [("www/landing/index.html", "html"), ("www/landing/*.js", "js")]),
    # The live figures the landing page and the guide load: their literals
    # are captions and labels.
    ("figures", "player", [("www/viz/viz.js", "js")]),
    ("guide", "player", [("www/docs/src/**/*.md", "md")]),
    # The spoken lines, and the text each film draws on screen.
    (
        "films",
        "player",
        [("www/video/films/*/script.json", "script"), ("www/video/films/*/film.js", "js"), ("www/video/films/*/cards.js", "js")],
    ),
    ("reference", "all", [("www/reference/src/**/*.md", "md")]),
    ("readme", "all", [("README.md", "md")]),
    # The released notes, and each change's entry waiting in changelog.d/ for
    # the next release (scripts/changelog.py moves them in): the same words.
    ("changelog", "all", [("CHANGELOG.md", "md"), ("changelog.d/*.md", "md")]),
]

# Never read: the guide that quotes every banned word, the dated records, this
# check's own files, and the note on how to write a changelog entry (it is not
# one). Only that note is under a glob above; the list is here so that a wider
# glob one day cannot pull the others in.
EXEMPT = [
    VOICE,
    "docs/**",
    "www/checkwords.py",
    "www/test_checkwords.py",
    BASELINE,
    "changelog.d/README.md",
]

EM_DASH = "em dash"


def ise(stem: str) -> str:
    """The British forms of an -ise verb: optimise, optimised, optimises,
    optimising, optimiser, optimisable, optimisation, and with un- or re-."""
    return rf"(?:un|re)?{stem}is(?:e|es|ed|ing|er|ers|able|ation|ations)"


# The British spellings voice.md rules out ("The spelling is American"), each
# as its headword, the forms it covers (whole words, any case), and the
# American spelling. A list of words, not a suffix: "rise", "precise",
# "promise" and "liaising" are spelled the same on both sides.
BRITISH = [
    ("colour", r"colour\w*", "color"),
    ("centre", r"centre[sd]?|centring", "center"),
    ("behaviour", r"behaviour\w*", "behavior"),
    ("favourite", r"favourites?", "favorite"),
    ("towards", r"towards", "toward"),
    ("maths", r"maths", "math"),
    ("grey", r"grey(?:s|ed|er|est|ish|ing|ness)?", "gray"),
    # The noun; American English spells the noun and the verb "license".
    ("licence", r"licences?", "license"),
    ("catalogue", r"catalogue[sd]?|cataloguing", "catalog"),
    # A spoken "dialogue" (a conversation) is the American spelling too, so
    # it is not counted in a film's spoken lines; on a page it is "dialog".
    ("dialogue", r"dialogues?", "dialog"),
    ("judgement", r"judgements?", "judgment"),
    ("modelling", r"modell(?:ing|ed|er|ers)", "modeling, modeled"),
    ("labelled", r"labell(?:ing|ed|er|ers)", "labeling, labeled"),
    ("travelled", r"travell(?:ing|ed|er|ers)", "traveling, traveled"),
    # "cancellation" is American.
    ("cancelled", r"cancell(?:ed|ing)", "canceled, canceling"),
    # "analyses" is the American plural of analysis too.
    ("analyse", r"analys(?:e|ed|ing|er|ers)", "analyze"),
] + [
    (stem + "ise", ise(stem), stem + "ize")
    for stem in (
        "optim normal organ recogn real penal priorit minim maxim summar util visual categor "
        "character emphas standard synthes quant random parallel marginal serial initial"
    ).split()
]
BRITISH_RE = [(rule, re.compile(pat)) for rule, pat, _ in BRITISH]
SPELLING_RE = re.compile(r"(?<!\w)(?:" + "|".join(pat for _, pat, _ in BRITISH) + r")(?!\w)", re.I)
NOT_IN_SCRIPTS = {"dialogue"}

Entry = namedtuple("Entry", "word scope instead")
Hit = namedtuple("Hit", "line rule text")

# What to write instead, for each rule that is not a banned entry.
INSTEAD = {EM_DASH: "a colon, a comma, a period, or parentheses"}
INSTEAD.update({rule: american for rule, _, american in BRITISH})


# ─── the list ────────────────────────────────────────────────────────────────


def parse_banned(text: str) -> list[Entry]:
    """voice.md's `banned` block, one Entry a line. Raises ValueError on a
    missing block or a line that is not `word | scope | say instead`."""
    m = re.search(r"^```banned[ \t]*\n(.*?)^```", text, re.M | re.S)
    if not m:
        raise ValueError(f"{VOICE}: no ```banned block")
    first = text.count("\n", 0, m.start(1)) + 1
    out, seen = [], set()
    for i, raw in enumerate(m.group(1).split("\n")):
        line = raw.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 3 or not parts[0] or parts[1] not in ("player", "all"):
            raise ValueError(f"{VOICE}:{first + i}: not `word or phrase | player or all | say instead`: {line}")
        if parts[0] in seen:
            raise ValueError(f"{VOICE}:{first + i}: `{parts[0]}` is listed twice")
        seen.add(parts[0])
        out.append(Entry(*parts))
    return out


def capitals(word: str) -> bool:
    return any(c.isalpha() for c in word) and word == word.upper()


def forms(word: str) -> list[str]:
    """A single lowercase word and its plain inflections. The stem never
    loses more than a final e, so `generate` never reaches "generation"."""
    f = {word} | {word + s for s in ("s", "es", "d", "ed", "ing", "ly", "al", "ally")}
    if word.endswith("e"):
        f |= {word[:-1] + "ing", word[:-1] + "ed"}
    elif word[-1] not in "aeiouy":
        f |= {word + word[-1] + "ed", word + word[-1] + "ing"}
    return sorted(f, key=len, reverse=True)


def piece(s: str) -> str:
    """An entry's text as a pattern: either apostrophe, either ellipsis, and
    any run of whitespace (Markdown wraps a phrase across lines)."""
    out = []
    for ch in s:
        if ch in "'’":
            out.append("['’]")
        elif ch == "…":
            out.append(r"(?:…|\.\.\.)")
        elif ch.isspace():
            out.append(r"\s+")
        else:
            out.append(re.escape(ch))
    return "".join(out)


@functools.lru_cache(maxsize=None)
def matcher(e: Entry) -> re.Pattern:
    w = e.word
    if not capitals(w) and re.fullmatch(r"[a-z]+", w):
        body = "|".join(piece(f) for f in forms(w))
    else:
        body = piece(w)
    pre = r"(?<!\w)" if re.match(r"\w", w) else ""
    post = r"(?!\w)" if re.search(r"\w$", w) else ""
    flags = 0 if capitals(w) else re.I
    return re.compile(f"{pre}(?:{body}){post}", flags)


def label(word: str) -> str:
    return re.sub(r"\s+", " ", word.replace("’", "'").replace("...", "…")).lower()


# ─── what a reader sees ──────────────────────────────────────────────────────
# Each reader returns the text a reader sees as (line, text) segments. A
# segment keeps its source's line breaks, so a hit's line is the segment's
# line plus the breaks before it.


def blank(s: str) -> str:
    """Spaces for everything but newlines, so line numbers hold."""
    return re.sub(r"[^\n]", " ", s)


SHOWN_ATTRS = ("title", "aria-label", "placeholder", "alt")
META_SHOWN = ("description", "og:title", "og:description", "twitter:title", "twitter:description")
TAG_RE = re.compile(
    r"<(/?)([A-Za-z][\w:-]*)((?:\s+[^\s=<>\"'/]+(?:\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s\"'=<>`]+))?)*)\s*/?>"
)
ATTR_RE = re.compile(r"([^\s=<>\"'/]+)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s\"'=<>`]+)))?")


def markup(text: str, line: int = 1) -> list[tuple[int, str]]:
    """The text nodes of `text` and the attribute values a reader sees, as
    (line, text), entities decoded. Text without a tag is one text node."""
    text = re.sub(r"<!--.*?-->", lambda m: blank(m.group(0)), text, flags=re.S)
    out = []

    def add(at: int, s: str) -> None:
        if s.strip():
            out.append((line + text.count("\n", 0, at), html.unescape(s)))

    pos = 0
    for m in TAG_RE.finditer(text):
        add(pos, text[pos : m.start()])
        pos = m.end()
        attrs = {}
        base = m.start(3)
        for a in ATTR_RE.finditer(m.group(3)):
            name = a.group(1).lower()
            for g in (2, 3, 4):
                if a.group(g) is not None:
                    attrs[name] = (base + a.start(g), a.group(g))
        tag = m.group(2).lower()
        for name in SHOWN_ATTRS:
            if name in attrs:
                add(*attrs[name])
        if tag == "meta" and "content" in attrs:
            key = (attrs.get("name") or attrs.get("property") or (0, ""))[1].lower()
            if key in META_SHOWN:
                add(*attrs["content"])
    add(pos, text[pos:])
    return out


def html_text(text: str) -> list[tuple[int, str]]:
    """A page: its text nodes and shown attributes, not its comments, scripts
    or styles."""
    text = re.sub(
        r"(<(script|style)\b[^>]*>)(.*?)(</\2\s*>)",
        lambda m: m.group(1) + blank(m.group(3)) + m.group(4),
        text,
        flags=re.S | re.I,
    )
    return markup(text)


FENCE_RE = re.compile(r"\s*(`{3,}|~{3,})(.*)$")
# A quotation: someone else's words, kept as they were written. It may wrap a
# line but not cross a blank one, so a closer left off exempts nothing past
# its paragraph (and an opener with no closer at all exempts nothing).
QUOTE_RE = re.compile(r"<!--\s*voice:\s*quote\s*-->(?:(?!\n[ \t]*\n).)*?<!--\s*/voice\s*-->", re.S)


def md_prose(text: str) -> list[tuple[int, str]]:
    """Markdown's prose: not its code blocks, code spans, math, HTML comments,
    link destinations or mdBook directives, nor a quotation marked
    `<!-- voice: quote -->…<!-- /voice -->`. An admonish callout
    (```admonish) renders as prose, so its body and its title are read.
    Inline HTML is read as a page."""
    out = []
    fences = []  # each open fence: (character, length, is an admonish callout)
    for ln in text.split("\n"):
        m = FENCE_RE.match(ln)
        closes = m and fences and m.group(1)[0] == fences[-1][0] and len(m.group(1)) >= fences[-1][1] and not m.group(2).strip()
        if fences and not fences[-1][2]:
            # Inside code: nothing is read until its fence closes.
            if closes:
                fences.pop()
            out.append("")
        elif closes:
            fences.pop()
            out.append("")
        elif m:
            callout = m.group(2).strip().startswith("admonish")
            fences.append((m.group(1)[0], len(m.group(1)), callout))
            title = re.search(r'\btitle="([^"]*)"', m.group(2)) if callout else None
            out.append(title.group(1) if title else "")
        else:
            out.append(ln)
    t = "\n".join(out)
    sub = lambda pat, s, f=0: re.sub(pat, lambda m: blank(m.group(0)), s, flags=f)  # noqa: E731
    t = sub(QUOTE_RE, t)
    t = sub(r"<!--.*?-->", t, re.S)
    t = sub(r"(`+)(?!`).*?(?<!`)\1(?!`)", t, re.S)
    t = sub(r"\$\$.*?\$\$", t, re.S)
    t = sub(r"(?<![\\$\w])\$(?=\S)[^$\n]*?(?<=\S)\$(?![\w$])", t)
    t = sub(r"\{\{#.*?\}\}", t, re.S)
    t = sub(r"^\s{0,3}\[[^\]\n]+\]:\s*\S.*$", t, re.M)
    t = sub(r"<(?:https?|mailto):[^>\s]*>|\bhttps?://[^\s)\]>]+", t)
    t = re.sub(r"\]\(((?:[^()\s]|\([^()\s]*\))*(?:\s+\"[^\"]*\")?)\)", lambda m: "]" + blank(m.group(0)[1:]), t)
    return markup(t)


JS_ESC = re.compile(r"\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\n|.)", re.S)
JS_REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^")
JS_REGEX_WORDS = {"return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await", "instanceof"}
JS_IDENT = re.compile(r"[A-Za-z_$\u0080-\uffff][\w$\u0080-\uffff]*")
NAME_MARK = re.compile(r"//\s*voice:\s*name\b")


def js_unescape(s: str) -> str:
    def one(m: re.Match) -> str:
        e = m.group(1)
        if e == "\n":
            return "\n"
        if e[0] == "u" and len(e) > 1:
            return chr(int(e.strip("u{}"), 16))
        if e[0] == "x" and len(e) == 3:
            return chr(int(e[1:], 16))
        return " " if e in "nrtbfv0" else e

    return JS_ESC.sub(one, s)


HOLE = "\x00"  # where a template's `${…}` stood: not a word, not a space


def js_raw(t: str) -> tuple[list[tuple[int, int, str]], list[int]]:
    """Every string and template literal in a script, as (start, end, text),
    and the offset of every `// voice: name` comment. Never its comments,
    names, numbers or regexes. A template is one literal with HOLE where each
    `${…}` stood (keeping the hole's line breaks), and any literal inside a
    `${…}` is a literal of its own."""
    raw: list[tuple[int, int, str]] = []
    marks: list[int] = []
    stack: list[dict] = []  # each open template: its parts, and the depth of its open `${`
    i, n, last, word = 0, len(t), "", ""
    while i < n:
        if stack and stack[-1]["depth"] is None:
            # Inside a template's text, up to its end or its next `${`.
            tpl = stack[-1]
            j = i
            while j < n and t[j] != "`" and not (t[j] == "$" and t.startswith("${", j)):
                j += 2 if t[j] == "\\" else 1
            tpl["parts"].append(js_unescape(t[i:j]))
            if j >= n or t[j] == "`":
                stack.pop()
                raw.append((tpl["start"], j + 1, "".join(tpl["parts"])))
                i, last, word = j + 1, "`", ""
            else:
                tpl["depth"], tpl["expr"] = 0, j
                i, last, word = j + 2, "{", ""
            continue
        ch = t[i]
        if ch == "/" and t.startswith("//", i):
            j = t.find("\n", i)
            j = n if j < 0 else j
            if NAME_MARK.match(t, i, j):
                marks.append(i)
            i = j
            continue
        if ch == "/" and t.startswith("/*", i):
            j = t.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if ch in "'\"":
            j = i + 1
            while j < n and t[j] != ch and t[j] != "\n":
                j += 2 if t[j] == "\\" else 1
            raw.append((i, j + 1, js_unescape(t[i + 1 : j])))
            i, last, word = j + 1, ch, ""
            continue
        if ch == "`":
            stack.append({"parts": [], "depth": None, "start": i})
            i += 1
            continue
        if ch in "+-" and t.startswith(ch * 2, i):
            # `i++ / 2` divides: after an operand, ++ and -- leave an operand.
            if not (last and (last.isalnum() or last in "_$)]")):
                last, word = ch, ""
            i += 2
            continue
        if ch == "/" and (last == "" or last in JS_REGEX_AFTER or word in JS_REGEX_WORDS):
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
            i, last, word = j + 1, "/", ""
            continue
        if stack and ch in "{}":
            tpl = stack[-1]
            if ch == "{":
                tpl["depth"] += 1
            elif tpl["depth"] == 0:
                # The `${…}` closes: a hole where it stood, keeping its lines.
                tpl["parts"].append(HOLE + "\n" * t.count("\n", tpl["expr"], i))
                tpl["depth"] = None
                i += 1
                continue
            else:
                tpl["depth"] -= 1
        m = JS_IDENT.match(t, i)
        if m:
            word = m.group(0)
            last = word[-1]
            i = m.end()
            continue
        if not ch.isspace():
            last, word = ch, ""
        i += 1
    return sorted(raw), marks


# Literals that are code, not copy: (file, the text just before the literal,
# why). The literal is the first one that starts after that text.
NOT_COPY = [
    ("apps/web/live-audio.js", "const POLYFILL = ", "the worklet's TextDecoder polyfill, inlined as source"),
    ("apps/web/live-audio.js", "const PROCESSOR = ", "the worklet's processor class, inlined as source"),
]

# When a literal is a name rather than copy (`is_name`).
SELECTOR_BEFORE = re.compile(r"\b(?:querySelector|querySelectorAll|closest|matches)\s*\(\s*$")
# The film kit's cues (`beat("duel")`, `wordTime(l, "posterior")`, `at:
# "change3:HELD"`) name a beat or a spoken word; they are not drawn.
NAME_BEFORE = re.compile(
    r"(?:\bcase|[=!]==?|\b(?:type|kind|replace|error|key|op|cmd|id|class|className|beat|at|until|mark)\s*:|"
    r"\bwordTime\s*\([^()\"'`]*,|"
    r"(?:\$|\b(?:getElementById|getItem|setItem|removeItem|addEventListener|removeEventListener|createElement|"
    r"createElementNS|getAttribute|setAttribute|hasAttribute|removeAttribute|toggleAttribute|add|remove|toggle|"
    r"contains|has|get|set|delete|includes|send|post|beat))\s*\(\s*)\s*$"
)
NAME_AFTER = re.compile(r"\s*[=!]==?")
COPY_BEFORE = re.compile(
    r"(?:\.(?:textContent|innerText|innerHTML|title|placeholder|alt|ariaLabel)\s*\+?=|"
    r"\b(?:title|label|sub|why|blurb|text|caption|hint|placeholder|undoLabel|message)\s*:|"
    r"\b(?:note|announce|nbAnnounce|alert|confirm|prompt)\s*\(|"
    r"setAttribute\(\s*[\"'](?:title|aria-label|aria-valuetext|placeholder|alt)[\"']\s*,)\s*$"
)
# A name's punctuation inside a token: `bench-tour`, `edit_commit`,
# `#play-duel`, `.mod-plate`, `duel:${id}`, `a/b.js`.
NAME_SHAPE = re.compile(r"[_#/=@\[\]" + HOLE + r"]|\w[.:-]\w|^[.#]\w")


def is_name(t: str, start: int, end: int, s: str) -> bool:
    """Whether a script's literal (markup already read) is a name, not copy.
    A selector always is. Otherwise a name has no space, nothing outside
    ASCII and no sentence punctuation at its end, and either the code around
    it uses it as a name (a `case`, a comparison, a message's `type`, a
    toast's `replace` key, an id, a class, a storage key, an event, a film
    cue), or it is lowercase with a name's punctuation inside a token and is
    not being set as text (a `textContent`, a `title`, a `note()`)."""
    if SELECTOR_BEFORE.search(t, max(0, start - 30), start):
        return True
    if re.search(r"\s|[^\x00-\x7f]|[.:,;!?]$", s):
        return False
    if NAME_BEFORE.search(t, max(0, start - 60), start) or NAME_AFTER.match(t, end):
        return True
    if re.search(r"[A-Z]", s) or COPY_BEFORE.search(t, max(0, start - 60), start):
        return False
    return bool(NAME_SHAPE.search(s))


def js_literals(t: str, rel: str = "") -> list[tuple[int, str]]:
    """A script's copy: its string and template literals, as (line, text),
    entities decoded. A literal that holds markup is read as a page; the
    rest, less the names (`is_name`), the literals that start on a line
    marked `// voice: name`, and the code in NOT_COPY, are read whole."""
    starts = [0] + [i + 1 for i, c in enumerate(t) if c == "\n"]
    line_of = lambda at: bisect.bisect_right(starts, at)  # noqa: E731
    raw, marks = js_raw(t)
    marked = {line_of(k) for k in marks}
    skip = set()
    for f, before, _ in NOT_COPY:
        k = t.find(before) if f == rel else -1
        if k >= 0:
            skip.add(next((r for r in raw if r[0] >= k + len(before)), None))
    out = []
    for start, end, s in raw:
        line = line_of(start)
        if (start, end, s) in skip or line in marked:
            continue
        if TAG_RE.search(s):
            out.extend(markup(s, line))
            continue
        s = html.unescape(s)
        if s.strip() and not is_name(t, start, end, s):
            out.append((line, s))
    return out


SCRIPT_TEXT = re.compile(r'"text"\s*:\s*("(?:[^"\\]|\\.)*")')


def script_lines(text: str) -> list[tuple[int, str]]:
    """A film script's spoken lines: every `text` field, and nothing else."""
    return [(text.count("\n", 0, m.start()) + 1, html.unescape(json.loads(m.group(1)))) for m in SCRIPT_TEXT.finditer(text)]


RS_ESC = re.compile(r"\\(\n[ \t\r\n]*|u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)", re.S)
# A raw string's opener (`r"`, `r#"`, `br##"`), or a plain one's prefix.
RS_RAW = re.compile(r"(?:b|c)?r(#*)\"")
RS_PREFIX = re.compile(r"(?:b|c)?\"")
# What follows an attribute, before the thing it marks: space, comments and
# more attributes (skipped by `rs_test_attr`), then a visibility.
RS_GAP = re.compile(r"(?:\s+|//[^\n]*|/\*(?:(?!\*/).)*\*/)*", re.S)
RS_VIS = re.compile(r"pub(?:\s*\([^()]*\))?\s+")
# The words an item starts with. Anything else an attribute marks (a field, a
# variant, a match arm, a statement) is one entry of a list, and ends at its
# comma.
RS_ITEM = {"mod", "fn", "use", "impl", "struct", "enum", "union", "const", "static", "type", "trait", "unsafe", "async", "extern", "default", "macro_rules"}
RS_ATTR = re.compile(r"#(!?)\s*\[")
RS_CFG_TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*|[(),=]')


def rs_attr(t: str, i: int) -> tuple[int, str, bool] | None:
    """The attribute at `i` (`#[…]`, or `#![…]` for the item it sits in) as
    (its end, what is between the brackets, whether it is inner), or None."""
    m = RS_ATTR.match(t, i)
    if not m:
        return None
    j, depth = m.end(), 1
    while j < len(t) and depth:
        if t[j] == '"':
            j += 1
            while j < len(t) and t[j] != '"':
                j += 2 if t[j] == "\\" else 1
        elif t[j] == "[":
            depth += 1
        elif t[j] == "]":
            depth -= 1
        j += 1
    return j, t[m.end() : j - 1], m.group(1) == "!"


def cfg_implies_test(pred: str) -> bool:
    """Whether a `cfg` predicate holds only in a test build: `test`, an
    `all(…)` with such an argument, or an `any(…)` whose every argument is
    one. `any(test, feature = "x")` is not: it builds whenever the feature is
    on, so what it marks can reach a player, and it is read."""
    toks, pos = RS_CFG_TOKEN.findall(pred), 0

    def one() -> bool:
        nonlocal pos
        name = toks[pos]
        pos += 1
        if pos < len(toks) and toks[pos] == "=":
            pos += 2
            return False
        if pos < len(toks) and toks[pos] == "(":
            pos += 1
            args = []
            while toks[pos] != ")":
                args.append(one())
                if toks[pos] == ",":
                    pos += 1
            pos += 1
            return any(args) if name == "all" else bool(args) and all(args) if name == "any" else False
        return name == "test"

    try:
        return one() and pos == len(toks)
    except IndexError:
        return False


def rs_test_attr(t: str, i: int) -> tuple[int, str] | None:
    """The attribute at `i`, as (its end, how far what it marks reaches),
    when what it marks builds only for tests: `#[test]`, or a `cfg` that
    implies `test` (`cfg_implies_test`). The reach is `inner` for `#![…]`
    (the rest of the file or block it sits in), `item` for an item (to its
    `;` or the `}` that closes its body), and `entry` for anything else (to
    its comma, a field's or a variant's or an arm's)."""
    a = rs_attr(t, i)
    if not a:
        return None
    end, body, inner = a
    body = body.strip()
    if body != "test":
        m = re.fullmatch(r"cfg\s*\((.*)\)", body, re.S)
        if not (m and cfg_implies_test(m.group(1))):
            return None
    if inner:
        return end, "inner"
    k = end
    while True:
        k = RS_GAP.match(t, k).end()
        more = rs_attr(t, k) if t.startswith("#", k) else None
        if not more:
            break
        k = more[0]
    v = RS_VIS.match(t, k)
    word = JS_IDENT.match(t, v.end() if v else k)
    return end, "item" if word and word.group(0) in RS_ITEM else "entry"


def rs_unescape(s: str) -> str:
    """A Rust string's text. A line continuation keeps its line breaks, so a
    hit after it is counted on its own line."""

    def one(m: re.Match) -> str:
        e = m.group(1)
        if e[0] == "\n":
            return "\n" * e.count("\n")
        if e[0] == "u" and len(e) > 1:
            return chr(int(e[2:-1].replace("_", ""), 16))
        if e[0] == "x" and len(e) == 3:
            return chr(int(e[1:], 16))
        return " " if e in "nrt0" else e

    return RS_ESC.sub(one, s)


def rs_raw(t: str) -> tuple[list[tuple[int, int, str]], list[int], list[tuple[int, int]]]:
    """Every string literal in a Rust file, as (start, end, text), with the
    offset of every `// voice: name` comment and the span of everything that
    builds only for tests (`rs_test_attr`). Never its comments (nested ones
    too), its char literals or its lifetimes. An attribute's literal is read:
    a refusal's text lives in `#[error("…")]`.

    A test span ends where what its attribute marks ends, and never later: at
    the `;` or the closing `}` of an item; at the comma after a field, a
    variant or a match arm; and, for all of them, just before a `}` that
    closes the block they sit in. A span that ends too early reads a test's
    words (a false hit, which `// voice: name` answers); one that ends too
    late would hide copy without a word."""
    raw: list[tuple[int, int, str]] = []
    marks: list[int] = []
    tests: list[tuple[int, int]] = []
    # An open test span: where it starts, how far it reaches (`rs_test_attr`),
    # its brace depth, and its bracket and paren depth (so the `;` in
    # `[u8; 4]` and the comma in `(a, b)` do not end it).
    test_at, reach, depth, nest = None, "", 0, 0
    i, n = 0, len(t)
    while i < n:
        ch = t[i]
        if t.startswith("//", i):
            j = t.find("\n", i)
            j = n if j < 0 else j
            if NAME_MARK.match(t, i, j):
                marks.append(i)
            i = j
            continue
        if t.startswith("/*", i):
            j, open_ = i + 2, 1
            while j < n and open_:
                if t.startswith("/*", j):
                    open_, j = open_ + 1, j + 2
                elif t.startswith("*/", j):
                    open_, j = open_ - 1, j + 2
                else:
                    j += 1
            i = j
            continue
        word_start = i == 0 or not (t[i - 1].isalnum() or t[i - 1] == "_")
        m = RS_RAW.match(t, i) if word_start else None
        if m:
            close = '"' + m.group(1)
            j = t.find(close, m.end())
            j = n if j < 0 else j
            raw.append((i, j + len(close), t[m.end() : j]))
            i = j + len(close)
            continue
        m = RS_PREFIX.match(t, i) if word_start or ch == '"' else None
        if m:
            j = m.end()
            while j < n and t[j] != '"':
                j += 2 if t[j] == "\\" else 1
            raw.append((i, j + 1, rs_unescape(t[m.end() : j])))
            i = j + 1
            continue
        if ch == "'":
            # A char literal ('"', '\'', '\u{2014}'), or a lifetime ('a).
            c = re.match(r"'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'", t[i : i + 16])
            i += len(c.group(0)) if c else 1
            continue
        if test_at is None and ch == "#":
            a = rs_test_attr(t, i)
            if a:
                test_at, reach, depth, nest = i, a[1], 0, 0
                i = a[0]
                continue
        if test_at is not None:
            end = None
            if ch in "([":
                nest += 1
            elif ch in ")]":
                nest -= 1
            elif ch == "{":
                depth += 1
            elif ch == "}" and depth == 0:
                end = i  # the block it sits in closes, and the brace is not its own
            elif ch == "}":
                depth -= 1
                if depth == 0 and reach != "inner":
                    end = i + 1
            elif depth == 0 and nest == 0 and ((ch == ";" and reach != "inner") or (ch == "," and reach == "entry")):
                end = i + 1
            if end is not None:
                tests.append((test_at, end))
                test_at = None
        i += 1
    if test_at is not None:
        tests.append((test_at, n))
    return raw, marks, tests


def rust_literals(t: str) -> list[tuple[int, str]]:
    """A Rust file's copy: its string literals, as (line, text), less what
    builds only for tests and the literals that start on a line marked
    `// voice: name`."""
    starts = [0] + [i + 1 for i, c in enumerate(t) if c == "\n"]
    line_of = lambda at: bisect.bisect_right(starts, at)  # noqa: E731
    raw, marks, tests = rs_raw(t)
    marked = {line_of(k) for k in marks}
    out = []
    for start, _, s in raw:
        if any(a <= start < b for a, b in tests) or line_of(start) in marked:
            continue
        if s.strip():
            out.append((line_of(start), s))
    return out


@functools.lru_cache(maxsize=512)
def extract(rel: str, kind: str, text: str) -> tuple[tuple[int, str], ...]:
    """The segments a reader sees in one file's text, cached on the text, so
    a file read again unchanged is not read twice."""
    if kind == "js":
        return tuple(js_literals(text, rel))
    return tuple({"html": html_text, "md": md_prose, "script": script_lines, "rust": rust_literals}[kind](text))


def segments(rel: str, kind: str) -> tuple[tuple[int, str], ...]:
    return extract(rel, kind, read(rel))


# ─── the count ───────────────────────────────────────────────────────────────


def british(word: str) -> str | None:
    w = word.lower()
    for rule, pat in BRITISH_RE:
        if pat.fullmatch(w):
            return rule
    return None


def hits_in(segments, entries: list[Entry], kind: str) -> list[Hit]:
    """Every hit in `segments`, given the entries that apply to them."""
    rules = [(e.word, matcher(e), label(e.word) if capitals(e.word) else None) for e in entries]
    out = []
    for line, s in segments:
        at = lambda i: line + s.count("\n", 0, i)  # noqa: E731
        for word, pat, whole in rules:
            found = list(pat.finditer(s))
            for m in found:
                out.append(Hit(at(m.start()), word, m.group(0)))
            if whole and not found and label(s.strip()) == whole:
                out.append(Hit(at(len(s) - len(s.lstrip())), word, s.strip()))
        for m in re.finditer("\u2014", s):
            out.append(Hit(at(m.start()), EM_DASH, "\u2014"))
        for m in SPELLING_RE.finditer(s):
            rule = british(m.group(0))
            if rule and not (kind == "script" and rule in NOT_IN_SCRIPTS):
                out.append(Hit(at(m.start()), rule, m.group(0)))
    return sorted(out)


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def files() -> list[tuple[str, str, str, str]]:
    """Every file read, as (path, surface, tier, kind)."""
    out, seen = [], set()
    for surface, tier, globs in SURFACES:
        for pattern, kind in globs:
            for p in sorted(glob.glob(os.path.join(ROOT, pattern), recursive=True)):
                rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
                if rel in seen or any(fnmatch.fnmatch(rel, e) for e in EXEMPT):
                    continue
                seen.add(rel)
                out.append((rel, surface, tier, kind))
    return out


def scan(entries: list[Entry]) -> dict[str, list[Hit]]:
    """Every file's hits (a file with none is listed, with none)."""
    applies = {
        "player": [e for e in entries if e.scope in ("player", "all")],
        "all": [e for e in entries if e.scope == "all"],
    }
    return {rel: hits_in(segments(rel, kind), applies[tier], kind) for rel, _, tier, kind in files()}


def counts(hits: dict[str, list[Hit]]) -> dict[str, dict[str, int]]:
    return {rel: dict(sorted(Counter(h.rule for h in hs).items())) for rel, hs in sorted(hits.items()) if hs}


# ─── the ratchet ─────────────────────────────────────────────────────────────


def load_baseline() -> dict[str, dict[str, int]]:
    """The baseline, or {} when there is none. Raises ValueError when it is
    not {file: {rule: count}}."""
    try:
        b = json.loads(read(BASELINE))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        raise ValueError(f"{BASELINE} is not JSON: {e}") from None
    if not isinstance(b, dict) or not all(
        isinstance(r, dict) and all(isinstance(c, int) for c in r.values()) for r in b.values()
    ):
        raise ValueError(f"{BASELINE} is not {{file: {{rule: count}}}}")
    return b


def rises(now: dict, base: dict) -> list[tuple[str, str, int, int]]:
    """Each (file, rule, baseline, now) whose count is above the baseline; a
    file the baseline does not list has a baseline of 0."""
    return [
        (rel, rule, base.get(rel, {}).get(rule, 0), c)
        for rel, rules in sorted(now.items())
        for rule, c in rules.items()
        if c > base.get(rel, {}).get(rule, 0)
    ]


def drops(now: dict, base: dict) -> dict[str, int]:
    """Each file the baseline holds more hits for than it has (a file no
    longer read has none), and how many more."""
    out = {}
    for rel, rules in sorted(base.items()):
        k = sum(max(0, c - now.get(rel, {}).get(rule, 0)) for rule, c in rules.items())
        if k:
            out[rel] = k
    return out


def updated(now: dict, base: dict, allow_rise: bool) -> dict[str, dict[str, int]]:
    """The new baseline: today's counts, but no count above the old one unless
    `allow_rise`. A file or rule with no hits left drops out."""
    out = {}
    for rel in sorted(set(now) | set(base)):
        rules = {}
        for rule in sorted(set(now.get(rel, {})) | set(base.get(rel, {}))):
            c = now.get(rel, {}).get(rule, 0)
            if not allow_rise:
                c = min(c, base.get(rel, {}).get(rule, 0))
            if c:
                rules[rule] = c
        if rules:
            out[rel] = rules
    return out


def write_baseline(b: dict) -> None:
    with open(os.path.join(ROOT, BASELINE), "w", encoding="utf-8") as f:
        f.write(json.dumps(b, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def changed_lines(rel: str) -> set[int]:
    """The lines of `rel` that differ from the last commit, if git can say."""
    try:
        d = subprocess.run(
            ["git", "diff", "-U0", "HEAD", "--", rel], cwd=ROOT, capture_output=True, text=True, timeout=20
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    out = set()
    for m in re.finditer(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@", d, re.M):
        start, length = int(m.group(1)), int(m.group(2) or 1)
        out |= set(range(start, start + length))
    return out


def summary(now: dict, surface_of: dict[str, str]) -> list[str]:
    by = {}
    for rel, rules in now.items():
        by.setdefault(surface_of[rel], Counter()).update(rules)
    out = []
    for surface, tier, _ in SURFACES:
        c = by.get(surface, Counter())
        nfiles = sum(1 for s in surface_of.values() if s == surface)
        rules = " · ".join(f"{r} {k}" for r, k in sorted(c.items(), key=lambda x: (-x[1], x[0])))
        out.append(f"  {surface} ({tier}, {nfiles} files): {sum(c.values())} hits" + (f": {rules}" if rules else ""))
    return out


def show(rel: str, hs: list[Hit], limit: int | None = None, first: set[int] = frozenset()) -> list[str]:
    lines = read(rel).split("\n")
    hs = sorted(hs, key=lambda h: (h.line not in first, h.line))
    out = [f"    {rel}:{h.line}: {h.rule}: {lines[h.line - 1].strip()[:110]}" for h in hs[:limit]]
    if limit is not None and len(hs) > limit:
        out.append(f"    … and {len(hs) - limit} more: python3 www/checkwords.py --where {rel}")
    return out


def main(argv: list[str]) -> int:
    flags = {"--summary", "--update", "--allow-rise", "--where"}
    where = None
    if "--where" in argv:
        k = argv.index("--where")
        if k + 1 >= len(argv):
            print(__doc__)
            return 2
        where = argv.pop(k + 1)
    if any(a not in flags for a in argv) or ("--allow-rise" in argv and "--update" not in argv):
        print(__doc__)
        return 2
    try:
        entries = parse_banned(read(VOICE))
        base = load_baseline()
    except ValueError as e:
        print(f"  voice: {e}", file=sys.stderr)
        return 1
    hits = scan(entries)
    now = counts(hits)
    surface_of = {rel: s for rel, s, _, _ in files()}
    instead = {**INSTEAD, **{e.word: e.instead for e in entries}}

    if where is not None:
        if where not in hits:
            print(f"  voice: {where} is not on any surface this check reads", file=sys.stderr)
            return 1
        print("\n".join(show(where, hits[where])) or f"  {where}: no hits")
        return 0

    if "--update" in argv:
        new = updated(now, base, "--allow-rise" in argv)
        totals = []
        for b in (base, new):
            t = Counter()
            for rel, rules in b.items():
                for r, c in rules.items():
                    t[(surface_of.get(rel, "(no longer read)"), r)] += c
            totals.append(t)
        for key in sorted(set(totals[0]) | set(totals[1])):
            if totals[0][key] != totals[1][key]:
                print(f"  {key[0]}: {key[1]} {totals[0][key]} → {totals[1][key]}")
        write_baseline(new)
        print(f"  voice: wrote {BASELINE}")
        base = new

    if "--summary" in argv:
        print("\n".join(summary(now, surface_of)))

    up = rises(now, base)
    for rel, rule, was, c in up:
        what = "a file the baseline does not list" if rel not in base else f"the baseline holds {was}"
        print(f"  {rel}: {rule} ({instead.get(rule, '?')}): {c} hits, and {what}", file=sys.stderr)
        print("\n".join(show(rel, [h for h in hits[rel] if h.rule == rule], 12, changed_lines(rel))), file=sys.stderr)
    if up:
        hint = "; --update --allow-rise takes them into the baseline" if "--update" in argv else ""
        print(f"  voice: {len(up)} rise(s) above {BASELINE}: rewrite the copy as voice.md says{hint}", file=sys.stderr)
    down = drops(now, base)
    if down:
        listed = [f"{rel} ({k})" for rel, k in down.items()]
        where_ = ", ".join(listed[:8]) + (f" and {len(listed) - 8} more files" if len(listed) > 8 else "")
        print(f"  voice: fewer hits than {BASELINE} holds, in {where_}.", file=sys.stderr)
        print(f"  voice: a sweep lowers the baseline in the same change: {UPDATE}", file=sys.stderr)
    if up or down:
        return 1
    total = sum(sum(r.values()) for r in now.values())
    print(f"  voice: {len(hits)} files, {total} hits under baseline, 0 rises")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
