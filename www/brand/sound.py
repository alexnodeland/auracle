#!/usr/bin/env python3
"""The films' sound: one source, generated into the scores and the mix.

    python3 www/brand/sound.py            write every generated file
    python3 www/brand/sound.py --check    fail on a stale file, an unknown
                                          preset, or a mix level written
                                          outside the source

`www/brand/sound.json` holds the films' sound as ADR-014 and
docs/notes/sound-2026-09/SPEC.md set it: the key, tempo and form; the cast
with its knob tweaks; the marks and the bed; each part's EQ, pan and level;
the voice chain; the loudness ladder; the duck, the carve and the pad's dip;
and the grammar's timings. This script writes:

- **the scores** in `www/video/sound/`: `bloom.json` and `reach.json` (the
  marks) and `n3.json` (the bed). The notes are the score each one names under
  `docs/notes/sound-2026-09/scores/` (the finals, as auditioned); the cast is
  sound.json's. Every track gets its part's preset, voices, trim, transpose and
  knobs, the lead's bend times, and the drone's breath, so a knob changed in
  sound.json reaches every score that plays it;
- **the mix's defaults**, `www/video/tools/sound_defaults.py`: the ladder, the
  voice chain, the duck, the carve and the dip, each part's EQ, pan and level,
  the grammar's timings, and the level and duck the films are mixed with today
  (`mix_now`), which `mix.py` reads.

Each generated file says so at its top. They are committed, like the token
blocks, so the film tools run with no build step. Edit sound.json, never a
generated file.

`--check` (run by `make dev-check`) fails when:
- sound.json lacks a value the generator needs, or a knob is outside 0-1;
- a preset in the cast or the shortlist is not in the bank
  (`crates/auracle-grammar/src/presets.rs`);
- a score's track maps to no part, or the bed's drone breathes on values the
  generator cannot map;
- a generated file differs from what sound.json makes (run `make sound`);
- a mix level is written outside the source: a number as the default of
  `mix.py`'s `--music-db` or `--duck-db`, or a numeric fallback for `MUSIC_DB`
  or `DUCK_DB` (or a numeric `--music-db`/`--duck-db`) in a film tool's shell
  script. That is how the duck came to have three values in three places.

Python 3 standard library only.
"""

from __future__ import annotations

import copy
import fnmatch
import glob
import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SOURCE = "www/brand/sound.json"
DEFAULTS = "www/video/tools/sound_defaults.py"
PRESETS = "crates/auracle-grammar/src/presets.rs"
GENERATED = "generated from www/brand/sound.json by www/brand/sound.py (make sound); do not edit"

# Where a mix level must not be written as a number: it belongs in sound.json.
LEVEL_FILES = ["www/video/tools/*.py", "www/video/tools/*.sh"]
LEVEL_RULES = [
    (re.compile(r"add_argument\(\s*[\"']--(music|duck)-db[\"'][^)]*\bdefault\s*=\s*[-+]?\d"),
     "a number as the default of --{0}-db; read it from sound_defaults (sound.json `mix_now`)"),
    (re.compile(r"\b(MUSIC|DUCK)_DB:-\s*[\"']?[-+]?\d"),
     "a numeric fallback for {0}_DB; leave it to mix.py's default (sound.json `mix_now`)"),
    (re.compile(r"--(music|duck)-db[\s=]+[\"']?[-+]?\d"),
     "a numeric --{0}-db; leave it to mix.py's default (sound.json `mix_now`)"),
]


class SourceError(Exception):
    pass


def path(rel: str) -> str:
    return os.path.join(ROOT, rel)


def read(rel: str) -> str:
    with open(path(rel), encoding="utf-8") as f:
        return f.read()


def load() -> dict:
    return json.loads(read(SOURCE))


def need(src: dict, dotted: str):
    """The value at a dotted path in sound.json, or a SourceError naming it."""
    cur = src
    for k in dotted.split("."):
        if not isinstance(cur, dict) or k not in cur:
            raise SourceError(f"{SOURCE}: no `{dotted}`")
        cur = cur[k]
    return cur


def scores(src: dict) -> list[tuple[str, dict]]:
    """Each generated score: its place in sound.json, and its block."""
    return [("marks.bloom", need(src, "marks.bloom")), ("marks.reach", need(src, "marks.reach")), ("bed", need(src, "bed"))]


def bank() -> set[str]:
    return set(re.findall(r'^\s*name:\s*"([^"]+)"', read(PRESETS), re.M))


# ─── the checks on the source ────────────────────────────────────────────────


def validate(src: dict) -> list[str]:
    errs = []
    try:
        for k in ("tempo.bpm", "tempo.beats_per_bar", "tempo.marks_bpm", "cast.parts", "cast.shortlist.roles",
                  "ladder", "duck", "duck.carve", "duck.pad_dip", "voice_chain.stages", "grammar", "mix.parts",
                  "mix_now.music_db", "mix_now.duck_db"):
            need(src, k)
        for where, block in scores(src):
            for k in ("title", "score", "out", "tracks"):
                if k not in block:
                    errs.append(f"{SOURCE}: no `{where}.{k}`")
    except SourceError as e:
        return [str(e)]
    presets = bank()
    parts = src["cast"]["parts"]
    for name, part in parts.items():
        if "preset" not in part:
            errs.append(f"{SOURCE}: `cast.parts.{name}` has no preset")
        elif part["preset"] not in presets:
            errs.append(f"{SOURCE}: `cast.parts.{name}`: no preset {part['preset']!r} in the bank ({PRESETS})")
        for knob, v in (part.get("knobs") or {}).items():
            for side in ("stock", "used"):
                x = v.get(side) if isinstance(v, dict) else None
                if not isinstance(x, (int, float)) or not 0 <= x <= 1:
                    errs.append(f"{SOURCE}: `cast.parts.{name}.knobs.{knob}.{side}` is not a knob value (0-1)")
    for role, names in src["cast"]["shortlist"]["roles"].items():
        for n in names:
            if n not in presets:
                errs.append(f"{SOURCE}: `cast.shortlist.roles.{role}`: no preset {n!r} in the bank ({PRESETS})")
    for where, block in scores(src):
        for part in set(block.get("tracks", {}).values()):
            if part not in parts:
                errs.append(f"{SOURCE}: `{where}.tracks` names no part {part!r} in `cast.parts`")
    return errs


# ─── the scores ──────────────────────────────────────────────────────────────


def part_of(track: str, tracks: dict) -> str | None:
    if track in tracks:
        return tracks[track]
    for pattern, part in tracks.items():
        if fnmatch.fnmatchcase(track, pattern):
            return part
    return None


def breathe(track: dict, breath: dict, where: str) -> None:
    """The drone's breath: the template's lowest point becomes `low`, its highest `high`."""
    for auto in track.get("automation") or []:
        if auto.get("param") != breath["param"]:
            continue
        values = sorted({p[3] for p in auto["points"]})
        if len(values) != 2:
            raise SourceError(f"{where}: the drone's {breath['param']} automation should move between two values, "
                              f"not {values}")
        lo, hi = values
        for p in auto["points"]:
            p[3] = breath["low"] if p[3] == lo else breath["high"]


def build_score(src: dict, where: str, block: dict) -> dict:
    tpl = json.loads(read(block["score"]))
    parts = src["cast"]["parts"]
    marks = where.startswith("marks.")
    out = {"_generated": f"{GENERATED}. The notes are {block['score']}'s; the cast is sound.json's."}
    for k, v in tpl.items():
        # The record's own notes on its cast (`_final`) would go stale here:
        # the cast is sound.json's. Its `_about` describes the notes, and stays.
        if k.startswith("_") and k != "_about":
            continue
        out[k] = copy.deepcopy(v)
    out["title"] = block["title"]
    out["tempo"] = src["tempo"]["marks_bpm"] if marks else src["tempo"]["bpm"]
    out["beats_per_bar"] = src["tempo"]["beats_per_bar"]
    for t in out["tracks"]:
        name = part_of(t["name"], block["tracks"])
        if name is None:
            raise SourceError(f"{block['score']}: track {t['name']!r} maps to no part in `{where}.tracks`")
        part = parts[name]
        t["preset"] = part["preset"]
        for k in ("voices", "trim_db", "transpose"):
            if k in part:
                t[k] = part[k]
            else:
                t.pop(k, None)
        t["params"] = {k: v["used"] for k, v in (part.get("knobs") or {}).items()}
        if "pitch_drop" in t and "bend" in part:
            t["pitch_drop"]["tau_ms"] = part["bend"]["tau_ms"]
            t["pitch_drop"]["pre_ms"] = part["bend"]["pre_ms"]
        if "breath" in part:
            breathe(t, part["breath"], f"{block['score']} track {t['name']!r}")
    return out


# ─── the mix's defaults ──────────────────────────────────────────────────────


def defaults(src: dict) -> dict:
    """The names sound_defaults.py exports, in order, with their values."""
    tempo = src["tempo"]
    beat = 60.0 / tempo["bpm"]
    return {
        "MIX_NOW": {"music_db": src["mix_now"]["music_db"], "duck_db": src["mix_now"]["duck_db"]},
        "TEMPO": {
            "bpm": tempo["bpm"],
            "beats_per_bar": tempo["beats_per_bar"],
            "beat_s": round(beat, 6),
            "bar_s": round(beat * tempo["beats_per_bar"], 6),
            "marks_bpm": tempo["marks_bpm"],
            "cycle_bars": src["form"]["cycle_bars"],
        },
        "SCORES": {
            key.split(".")[-1]: {"score": block["out"], "title": block["title"]} for key, block in scores(src)
        },
        "LADDER": strip(src["ladder"]),
        "VOICE_CHAIN": strip(src["voice_chain"]["stages"]),
        "DUCK": {k: strip(v) for k, v in src["duck"].items() if k not in ("about", "carve", "pad_dip")},
        "CARVE": strip(src["duck"]["carve"]),
        "PAD_DIP": strip(src["duck"]["pad_dip"]),
        "MARKS": {k: strip(src["marks"][k]) for k in ("length_s", "lead_over_pad_db", "drone_under_pad_lu", "drone_fade_in")},
        "PARTS": strip(src["mix"]["parts"]),
        "MIX": {k: src["mix"][k] for k in ("filter_order", "band_split_order", "center_below_hz")},
        "TIMINGS": {k: strip(v) for k, v in src["grammar"].items() if k not in ("about", "rules")},
    }


def strip(v):
    """A value without its prose: `about` and `note` stay in sound.json."""
    if isinstance(v, dict):
        return {k: strip(x) for k, x in v.items() if k not in ("about", "note")}
    if isinstance(v, list):
        return [strip(x) for x in v]
    return v


DEFAULTS_DOC = {
    "MIX_NOW": "The bed's level against the voice and its duck under it, in dB, as the films are mixed today:\n"
               "mix.py's --music-db and --duck-db defaults. Kept so that no film's mix changes before Plan-006\n"
               "task 3 moves the mix to LADDER and DUCK below (the bed at -3 LU, a 2 dB duck); task 3 removes it.",
    "TEMPO": "The bed's tempo and cycle; the marks are written at marks_bpm and placed by time.",
    "SCORES": "The generated scores (repo-relative), and their titles: the score example renders each into <out>/<slug(title)>/.",
    "LADDER": "The loudness ladder (SPEC section 7). bed_rest_lu is against the narration, bed_under_demo_lu against the demo.",
    "VOICE_CHAIN": "The narration's chain, in order, before it is normalized to LADDER['narration_lufs'] (SPEC section 6).",
    "DUCK": "The bed under the voice (SPEC section 8): the detector, the follower all three moves share, and the broadband duck.",
    "CARVE": "A further cut on the whole bed in band_hz, times the follower.",
    "PAD_DIP": "A further cut on the pad only in band_hz, times the follower.",
    "MARKS": "The marks' own balance (SPEC section 3); LADDER['marks_lufs'] is their level in a film.",
    "PARTS": "Each part's EQ, pan and level on stems (SPEC section 5). A level is against the pad unless it names LUFS.",
    "MIX": "Filter orders, and the frequency below which every stem's side signal is removed.",
    "TIMINGS": "The grammar's timings, in seconds and dB (SPEC section 9).",
}


def render_defaults(src: dict) -> str:
    lines = [
        f"# {GENERATED[0].upper()}{GENERATED[1:]}.",
        "# `make dev-check` fails when this file differs from what sound.json makes.",
        '"""The films\' sound as the mix reads it: www/brand/sound.json, generated.',
        "",
        "ADR-014; the values are docs/notes/sound-2026-09/SPEC.md's. Their prose (what each",
        "value is for, and where it was measured) stays in sound.json.",
        '"""',
    ]
    for name, value in defaults(src).items():
        lines.append("")
        for d in DEFAULTS_DOC[name].split("\n"):
            lines.append(f"# {d}")
        lines.append(f"{name} = {py_literal(value, 0)}")
    return "\n".join(lines) + "\n"


# ─── deterministic writers (the drift check compares bytes) ─────────────────


def _scalar(v) -> bool:
    return v is None or isinstance(v, (bool, int, float, str))


def json_text(v, ind: int = 0) -> str:
    """JSON, two-space indented, with an array of scalars on one line."""
    pad, inner = "  " * ind, "  " * (ind + 1)
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {json_text(x, ind + 1)}" for k, x in v.items()]
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(v, list):
        if all(_scalar(x) for x in v):
            return "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in v) + "]"
        return "[\n" + ",\n".join(f"{inner}{json_text(x, ind + 1)}" for x in v) + f"\n{pad}]"
    return json.dumps(v, ensure_ascii=False)


def py_literal(v, ind: int = 0) -> str:
    """A Python literal, four-space indented, with a list of scalars on one line."""
    pad, inner = "    " * ind, "    " * (ind + 1)
    if v is None or isinstance(v, bool):
        return repr(v)
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {py_literal(x, ind + 1)}," for k, x in v.items()]
        return "{\n" + "\n".join(items) + f"\n{pad}}}"
    if all(_scalar(x) for x in v):
        return "[" + ", ".join(py_literal(x) for x in v) + "]"
    return "[\n" + "\n".join(f"{inner}{py_literal(x, ind + 1)}," for x in v) + f"\n{pad}]"


# ─── generate and check ──────────────────────────────────────────────────────


def outputs(src: dict) -> dict[str, str]:
    """Every generated file, repo-relative, and the text it should hold."""
    out = {}
    for where, block in scores(src):
        out[block["out"]] = json_text(build_score(src, where, block)) + "\n"
    out[DEFAULTS] = render_defaults(src)
    return out


def scan() -> list[str]:
    errs = []
    files = sorted({os.path.relpath(f, ROOT) for g in LEVEL_FILES for f in glob.glob(path(g))})
    for rel in files:
        if rel == DEFAULTS or os.path.basename(rel).startswith("test_"):
            continue
        for n, line in enumerate(read(rel).splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            for rule, why in LEVEL_RULES:
                for m in rule.finditer(line):
                    errs.append(f"{rel}:{n}: {why.format(m.group(1))}")
    return errs


def generate(check: bool) -> list[str]:
    try:
        src = load()
        errs = validate(src)
        if errs:
            return errs
        want = outputs(src)
    except (SourceError, OSError, json.JSONDecodeError) as e:
        return [str(e)]
    for rel, text in want.items():
        have = read(rel) if os.path.exists(path(rel)) else None
        if have == text:
            continue
        if check:
            errs.append(f"{rel}: stale or edited by hand; run `make sound`" if have is not None
                        else f"{rel}: missing; run `make sound`")
        else:
            os.makedirs(os.path.dirname(path(rel)), exist_ok=True)
            with open(path(rel), "w", encoding="utf-8") as f:
                f.write(text)
            print(f"  sound: wrote {rel}")
    return errs


def main(argv: list[str]) -> int:
    check = argv[:1] == ["--check"]
    if argv and not check:
        print(__doc__)
        return 2
    errs = generate(check)
    if check and not errs:
        errs = scan()
    for e in errs:
        print(f"  {e}", file=sys.stderr)
    if errs:
        print(f"  sound: {len(errs)} problem(s)", file=sys.stderr)
        return 1
    if check:
        n = len(outputs(load()))
        print(f"  sound: {n} generated files current, no mix level written outside {SOURCE}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
