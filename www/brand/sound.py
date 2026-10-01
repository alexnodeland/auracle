#!/usr/bin/env python3
"""The films' sound: one source, generated into the scores and the mix.

    python3 www/brand/sound.py            write every generated file
    python3 www/brand/sound.py --check    fail on a stale file, an unknown
                                          preset, a value the records'
                                          notes do not bear out, or a
                                          number as a film tool's level
                                          default

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
  the grammar's timings, the marks' levels and hand-overs, the shortlist and
  the room, which `mix.py` and `timeline.py` read; and the bed's notes and how
  the lead plays a line, which `fit_score.py --film` writes a film's bed from.

The rest of sound.json's numbers and pitches describe the records' notes
rather than being written into them: the pedal, the marks' length, the lead's
legato, bends and swell, the bed's voicings, burble and sighs, and the demo
(which only the reel plays). Those are checked against the records, so a
change in sound.json that the scores do not make fails the check rather than
drifting from them unseen. Strings are prose.

Each generated file says so at its top. They are committed, like the token
blocks, so the film tools run with no build step. Edit sound.json, never a
generated file.

`--check` (run by `make dev-check`) fails when:
- sound.json lacks a value the generator needs, a knob is outside 0-1, or
  the drone's breath does not run low <= stock <= high;
- a part turns one of the room's knobs;
- a preset in the cast or the shortlist is not in the bank
  (`crates/auracle-grammar/src/presets.rs`);
- a score's track maps to no part, or the bed's drone breathes on values the
  generator cannot map;
- a value that describes the records' notes is not what they play;
- a generated file differs from what sound.json makes (run `make sound`);
- a number is the default of a film tool's `--music-db`, `--duck-db` or
  `--gain-db` (read from its syntax tree, so a docstring or help string may
  quote one), or a film tool's shell code (comments, inline ones too, left
  out) has a numeric fallback for `MUSIC_DB`, `DUCK_DB` or `APP_DB` or a
  numeric `--music-db`/`--duck-db`/`--gain-db`. Those are the ways the duck
  came to have three values in three places, and the app's gain to live in a
  pipeline; the scan does not try to catch every way a level could be
  written.

Python 3 standard library only.
"""

from __future__ import annotations

import ast
import copy
import fnmatch
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SOURCE = "www/brand/sound.json"
DEFAULTS = "www/video/tools/sound_defaults.py"
PRESETS = "crates/auracle-grammar/src/presets.rs"
GENERATED = "generated from www/brand/sound.json by www/brand/sound.py (make sound); do not edit"

# The two ways the duck came to have three values, looked for where they
# happened: a number as an argparse default for --music-db, --duck-db or
# --gain-db in a film tool's Python, read from its syntax tree so that a
# docstring or a help string that quotes a level is not read (mix.py and
# app_audio.py read them from sound_defaults); and a numeric fallback or flag
# in its shell scripts, read with their comments, inline ones too, taken out.
# It does not try to catch every way a level could be planted.
LEVEL_FILES = ["www/video/tools/*.py", "www/video/tools/*.sh"]
LEVEL_FLAGS = ("--music-db", "--duck-db", "--gain-db")
SHELL_RULES = [
    (re.compile(r"\b(MUSIC|DUCK|APP)_DB:-\s*[\"']?[-+]?\d"),
     "a numeric fallback for {0}_DB; leave it to the tool's default (sound.json)"),
    (re.compile(r"--(music|duck|gain)-db[\s=]+[\"']?[-+]?\d"),
     "a numeric --{0}-db; leave it to the tool's default (sound.json)"),
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


NEEDED = (
    "key.pedal", "tempo.bpm", "tempo.beats_per_bar", "tempo.marks_bpm",
    "form.cycle", "form.cycle_bars", "form.bars_per_chord",
    "cast.shortlist.roles", "cast.shortlist.criteria", "cast.room.preset", "cast.room.stock",
    "cast.parts.drone.breath", "cast.parts.lead.bend", "cast.parts.lead.legato.s", "cast.parts.lead.swell",
    "cast.parts.demo.heard_in", "cast.parts.demo.bright",
    "marks.length_s", "marks.lead_over_pad_db", "marks.drone_under_pad_lu", "marks.drone_fade_in",
    "marks.bloom.into_the_bed", "marks.reach.out_of_the_bed.passing_chord_beats",
    "bed.parts.drone.pitches", "bed.parts.pad.voicings", "bed.parts.burble.cells", "bed.parts.burble.velocity",
    "bed.parts.melody.sighs", "bed.parts.melody.shape_beats",
    "mix.parts", "voice_chain.stages", "ladder.bed_rest_lu", "duck.broadband_db", "duck.carve", "duck.pad_dip",
    "grammar.exit_ring_out_s", "grammar.demo_tail_hop_s", "before_the_grammar.app_gain_db",
    "before_the_grammar.app_duck_db", "cast.parts.lead.release.tail_s",
    "marks.reach.out_of_the_bed.hold_bars", "mix.sounding.part_lufs", "mix.sounding.pad_lufs", "bed.name",
    "bed.parts.pad.under_demo.hold_before_s", "bed.parts.melody.placement",
)


def validate(src: dict) -> list[str]:
    errs = []
    try:
        for k in NEEDED:
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
    breath = parts["drone"]["breath"]
    if not 0 <= breath["low"] <= breath["stock"] <= breath["high"] <= 1 or breath["low"] >= breath["high"]:
        errs.append(f"{SOURCE}: `cast.parts.drone.breath` must run 0 <= low <= stock <= high <= 1, low below high")
    room = src["cast"]["room"]
    for name, part in parts.items():
        for knob in set(part.get("knobs") or {}) & set(room["stock"]):
            errs.append(f"{SOURCE}: `cast.parts.{name}` turns {knob}, but the room (`cast.room`) stays at its stock")
    for role, preset_names in src["cast"]["shortlist"]["roles"].items():
        for n in preset_names:
            if n not in presets:
                errs.append(f"{SOURCE}: `cast.shortlist.roles.{role}`: no preset {n!r} in the bank ({PRESETS})")
    for where, block in scores(src):
        for part in set(block.get("tracks", {}).values()):
            if part not in parts:
                errs.append(f"{SOURCE}: `{where}.tracks` names no part {part!r} in `cast.parts`")
    under = src["bed"]["parts"]["pad"]["under_demo"]
    if under["counts_as"] not in src["form"]["cycle"]:
        errs.append(f"{SOURCE}: `bed.parts.pad.under_demo.counts_as` is {under['counts_as']!r}, not a chord of `form.cycle`")
    if under["on"] not in parts:
        errs.append(f"{SOURCE}: `bed.parts.pad.under_demo.on` names no part {under['on']!r} in `cast.parts`")
    for p in under["voicing"]:
        try:
            midi(p)
        except SourceError as e:
            errs.append(f"{SOURCE}: `bed.parts.pad.under_demo.voicing`: {e}")
    for k, v in strip(src["bed"]["parts"]["melody"]["placement"]).items():
        if not isinstance(v, (int, float)) or v < 0:
            errs.append(f"{SOURCE}: `bed.parts.melody.placement.{k}` should be a number, 0 or more")
    # The film tools' numbers that no record checks: each within its sense.
    checks = [
        ("marks.reach.out_of_the_bed.hold_bars", lambda v: isinstance(v, int) and v >= 0, "a whole number of bars, 0 or more"),
        ("grammar.exit_ring_out_s", lambda v: _num(v) and v >= 0, "a number of seconds, 0 or more"),
        ("grammar.demo_tail_hop_s", lambda v: _num(v) and 0 < v <= 1, "a frame length in seconds, over 0 and at most 1"),
        ("grammar.demo_tail_db", lambda v: _num(v) and v < 0, "a negative number of dB"),
        ("cast.parts.lead.release.tail_s", lambda v: _num(v) and v >= 0, "a number of seconds, 0 or more"),
        ("before_the_grammar.app_gain_db", lambda v: _num(v) and v <= 0, "a gain in dB, 0 or less"),
        ("before_the_grammar.app_duck_db", lambda v: _num(v) and v <= 0, "a duck in dB, 0 or less"),
        ("bed.parts.pad.under_demo.hold_before_s", lambda v: _num(v) and v >= 0, "a number of seconds, 0 or more"),
        ("mix.sounding.part_lufs", lambda v: _num(v) and -70 <= v < 0, "a loudness from -70 LUFS (the gate) to 0"),
        ("mix.sounding.pad_lufs", lambda v: _num(v) and -70 <= v < 0, "a loudness from -70 LUFS (the gate) to 0"),
    ]
    for dotted, ok, what in checks:
        v = need(src, dotted)
        if not ok(v):
            errs.append(f"{SOURCE}: `{dotted}` is {v!r}; it should be {what}")
    return errs


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


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


# ─── what the records hold ───────────────────────────────────────────────────
#
# Some of sound.json describes the notes rather than being written into them:
# the pedal, the marks' length, how the lead plays a line (legato, bends,
# swell), the bed's voicings, burble and sighs, and the demo. The notes are the
# records', so these are checked against them: a change in sound.json that the
# scores do not make fails the check instead of drifting from them unseen.

STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PITCH = re.compile(r"^([A-G])([#b]?)(-?\d+)$")
NEAR_S = 0.0015  # seconds: the records round beats to three places


def midi(p) -> int:
    if isinstance(p, int):
        return p
    m = PITCH.match(str(p))
    if not m:
        raise SourceError(f"not a pitch: {p!r}")
    return 12 * (int(m.group(3)) + 1) + STEPS[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]


def names(pitches) -> str:
    return " ".join(str(p) for p in pitches)


def events(score: dict, track: dict, section: str) -> list[dict]:
    """A track's notes in a section: start and length in beats from the
    section's start, MIDI pitch, velocity."""
    bpb = score["beats_per_bar"]
    out = [{"start": (bar - 1) * bpb + (beat - 1), "dur": dur, "pitch": midi(p), "name": p, "vel": vel, "track": track}
           for bar, beat, dur, p, vel in (track.get("notes") or {}).get(section, [])]
    return sorted(out, key=lambda e: (e["start"], e["pitch"]))


def at_beats(score: dict, point) -> float:
    return (point[1] - 1) * score["beats_per_bar"] + (point[2] - 1)


def check_records(src: dict) -> list[str]:
    errs = []
    parts = src["cast"]["parts"]
    lead = parts["lead"]
    for where, block in scores(src):
        score = build_score(src, where, block)
        rec = block["score"]
        marks = where.startswith("marks.")
        bpb = score["beats_per_bar"]
        sec = score["sections"][0]["name"]
        bars = score["sections"][0]["bars"]
        by_part = {}
        for t in score["tracks"]:
            by_part.setdefault(part_of(t["name"], block["tracks"]), []).append(t)

        # The pedal.
        pedal = sorted(midi(p) for p in src["key"]["pedal"])
        for t in by_part.get("drone", []):
            got = sorted({e["pitch"] for e in events(score, t, sec)})
            if got != pedal:
                errs.append(f"{SOURCE}: `key.pedal` is {names(src['key']['pedal'])}, but {rec}'s drone plays "
                            f"{names(e['name'] for e in events(score, t, sec))}")
        if sorted(midi(p) for p in src["bed"]["parts"]["drone"]["pitches"]) != pedal:
            errs.append(f"{SOURCE}: `bed.parts.drone.pitches` is not `key.pedal`")

        # A mark's length.
        if marks:
            end = max(e["start"] + e["dur"] for t in score["tracks"] for e in events(score, t, sec))
            if abs(end * 60 / score["tempo"] - src["marks"]["length_s"]) > NEAR_S:
                errs.append(f"{SOURCE}: `marks.length_s` is {src['marks']['length_s']}, but {rec} lasts "
                            f"{end * 60 / score['tempo']:.3f} s")

        # The lead's lines: legato, bends and the swell; in the bed, the sighs.
        notes = []
        for t in by_part.get("lead", []):
            ev = events(score, t, sec)
            if len(ev) != 1:
                errs.append(f"{rec}: lead track {t['name']!r} holds {len(ev)} notes; the lead is one track per note")
            notes += ev
        notes.sort(key=lambda e: e["start"])
        lines, line = [], []
        for e in notes:
            if line and e["start"] > line[-1]["start"] + line[-1]["dur"] + 1e-6:
                lines.append(line)
                line = []
            line.append(e)
        if line:
            lines.append(line)
        sec_s = 60 / score["tempo"]
        swell = lead["swell"]
        swell_beats = swell["marks_s"] / sec_s if marks else swell["bed_beats"]
        for line in lines:
            for a, b in zip(line, line[1:]):
                held = (a["start"] + a["dur"] - b["start"]) * sec_s
                if abs(held - lead["legato"]["s"]) > NEAR_S:
                    errs.append(f"{SOURCE}: `cast.parts.lead.legato.s` is {lead['legato']['s']}, but in {rec} "
                                f"{a['name']} is held {held:.3f} s into {b['name']}")
                drop = b["track"].get("pitch_drop")
                if not drop or abs(drop["semis"] - (a["pitch"] - b["pitch"])) > 1e-9:
                    errs.append(f"{rec}: {b['name']} ({b['track']['name']}) should bend in from {a['name']} "
                                f"(`pitch_drop.semis` {a['pitch'] - b['pitch']}), per `cast.parts.lead.bend`")
            if line[0]["track"].get("pitch_drop"):
                errs.append(f"{rec}: {line[0]['name']} starts a line and should not bend in")
            last = line[-1]
            fader = last["track"].get("fader") or []
            want = [(last["start"], swell["from_db"]), (last["start"] + swell_beats, swell["to_db"])]
            got = [(at_beats(score, p), p[3]) for p in fader]
            if len(got) != 2 or any(abs(g[0] - w[0]) > 1e-6 or g[1] != w[1] for g, w in zip(got, want)):
                errs.append(f"{SOURCE}: `cast.parts.lead.swell` is {swell['from_db']} to {swell['to_db']} dB over "
                            f"{swell_beats:g} beats from the onset, but {rec}'s {last['name']} "
                            f"({last['track']['name']}) has the fader {fader}")
            for e in line[:-1]:
                if e["track"].get("fader"):
                    errs.append(f"{rec}: only a line's last note swells, not {e['name']} ({e['track']['name']})")
            if not marks:
                errs += check_sigh(src, score, rec, line)

        if not marks:
            errs += check_bed(src, score, rec, sec, bars, by_part)

    errs += check_demo(src)
    return errs


def chord_at(src: dict, bar: float) -> str:
    form = src["form"]
    return form["cycle"][int((bar - 1) % form["cycle_bars"]) // form["bars_per_chord"]]


def check_sigh(src: dict, score: dict, rec: str, line: list[dict]) -> list[str]:
    melody = src["bed"]["parts"]["melody"]
    chord = chord_at(src, line[0]["start"] // score["beats_per_bar"] + 1)
    want = melody["sighs"][chord]
    errs = []
    if [e["pitch"] for e in line] != [midi(p) for p in want]:
        errs.append(f"{SOURCE}: `bed.parts.melody.sighs.{chord}` is {names(want)}, but {rec}'s sigh on {chord} is "
                    f"{names(e['name'] for e in line)}")
    elif (abs(line[1]["start"] - line[0]["start"] - melody["shape_beats"][0]) > 1e-6
          or abs(line[1]["dur"] - melody["shape_beats"][1]) > 1e-6):
        errs.append(f"{SOURCE}: `bed.parts.melody.shape_beats` is {melody['shape_beats']}, but {rec}'s sigh on "
                    f"{chord} is {line[1]['start'] - line[0]['start']:g} + {line[1]['dur']:g} beats")
    return errs


def check_bed(src: dict, score: dict, rec: str, sec: str, bars: int, by_part: dict) -> list[str]:
    errs = []
    bpb = score["beats_per_bar"]
    form = src["form"]
    bed = src["bed"]["parts"]
    for where, table in (("pad.voicings", bed["pad"]["voicings"]), ("burble.cells", bed["burble"]["cells"]),
                         ("melody.sighs", bed["melody"]["sighs"])):
        if list(table) != form["cycle"]:
            errs.append(f"{SOURCE}: `bed.parts.{where}` should name the chords of `form.cycle`, in order")
    if errs:
        return errs
    pad = [e for t in by_part.get("bed_pad", []) for e in events(score, t, sec)]
    burble = sorted((e for t in by_part.get("burble", []) for e in events(score, t, sec)), key=lambda e: e["start"])
    b = bed["burble"]
    vel = b["velocity"]
    for k, e in enumerate(burble):
        want = vel["base"] * (1 + vel["depth"] * math.sin(2 * math.pi * k / vel["period_notes"]))
        if abs(e["vel"] - want) > 0.0006:
            errs.append(f"{SOURCE}: `bed.parts.burble.velocity` gives note {k + 1} {want:.3f}, but {rec} has {e['vel']}")
            break
    span = form["bars_per_chord"] * bpb
    for w in range(bars // form["bars_per_chord"]):
        w0, w1 = w * span, (w + 1) * span
        bar = w * form["bars_per_chord"] + 1
        chord = chord_at(src, bar)
        sounding = sorted((e for e in pad if e["start"] <= w0 + 1e-6 < e["start"] + e["dur"]), key=lambda e: e["pitch"])
        voicing = bed["pad"]["voicings"][chord]
        if [e["pitch"] for e in sounding] != sorted(midi(p) for p in voicing):
            errs.append(f"{SOURCE}: `bed.parts.pad.voicings.{chord}` is {names(voicing)}, but {rec}'s pad sounds "
                        f"{names(e['name'] for e in sounding)} at bar {bar}")
        cell = b["cells"][chord]
        here = [e for e in burble if w0 - 1e-6 <= e["start"] < w1 - 1e-6]
        want = [(w0 + k * b["step_beats"], min(b["held_beats"], w1 - (w0 + k * b["step_beats"])), midi(cell[k % len(cell)]))
                for k in range(math.ceil(span / b["step_beats"] - 1e-9))]
        got = [(e["start"], e["dur"], e["pitch"]) for e in here]
        if len(got) != len(want) or any(abs(g[0] - x[0]) > 1e-6 or abs(g[1] - x[1]) > 1e-6 or g[2] != x[2]
                                        for g, x in zip(got, want)):
            errs.append(f"{SOURCE}: `bed.parts.burble` (cell {names(cell)} on {chord}, every "
                        f"{b['step_beats']} beat held {b['held_beats']}) is not what {rec}'s burble plays at bar {bar}")
    return errs


def check_demo(src: dict) -> list[str]:
    demo = src["cast"]["parts"]["demo"]
    rec = demo["heard_in"]
    reel = json.loads(read(rec))
    tracks = [t for t in reel["tracks"] if t["preset"] == demo["preset"]]
    if len(tracks) != 1:
        return [f"{SOURCE}: `cast.parts.demo` is {demo['preset']}, but {rec} has {len(tracks)} tracks of it"]
    t = tracks[0]
    errs = []
    if t.get("voices") != demo["voices"]:
        errs.append(f"{SOURCE}: `cast.parts.demo.voices` is {demo['voices']}, but {rec}'s demo has {t.get('voices')}")
    used = {k: v["used"] for k, v in demo["knobs"].items()}
    if t.get("params") != used:
        errs.append(f"{SOURCE}: `cast.parts.demo.knobs` are {used}, but {rec}'s demo has {t.get('params')}")
    bright = demo["bright"]
    autos = [a for a in t.get("automation") or [] if a["param"] == bright["param"]]
    pts = autos[0]["points"] if autos else []
    bpb = reel["beats_per_bar"]
    ok = len(pts) == 2 and pts[0][3] == bright["from"] and pts[1][3] == bright["to"] and abs(
        ((pts[1][1] - pts[0][1]) * bpb + pts[1][2] - pts[0][2]) - bright["over_beats"]) < 1e-6
    if not ok:
        errs.append(f"{SOURCE}: `cast.parts.demo.bright` is {bright['from']} to {bright['to']} over "
                    f"{bright['over_beats']} beats, but {rec}'s demo automates {bright['param']} {pts}")
    return errs


# ─── the mix's defaults ──────────────────────────────────────────────────────


def defaults(src: dict) -> dict:
    """The names sound_defaults.py exports, in order, with their values."""
    tempo = src["tempo"]
    beat = 60.0 / tempo["bpm"]
    return {
        "TEMPO": {
            "bpm": tempo["bpm"],
            "beats_per_bar": tempo["beats_per_bar"],
            "beat_s": round(beat, 6),
            "bar_s": round(beat * tempo["beats_per_bar"], 6),
            "marks_bpm": tempo["marks_bpm"],
            "cycle_bars": src["form"]["cycle_bars"],
            "bars_per_chord": src["form"]["bars_per_chord"],
        },
        "SCORES": {
            key.split(".")[-1]: {"score": block["out"], "title": block["title"]} for key, block in scores(src)
        },
        "LADDER": strip(src["ladder"]),
        "VOICE_CHAIN": strip(src["voice_chain"]["stages"]),
        "DUCK": {k: strip(v) for k, v in src["duck"].items() if k not in ("about", "carve", "pad_dip")},
        "CARVE": strip(src["duck"]["carve"]),
        "PAD_DIP": strip(src["duck"]["pad_dip"]),
        "MARKS": {
            **{k: strip(src["marks"][k]) for k in ("length_s", "lead_over_pad_db", "drone_under_pad_lu", "drone_fade_in")},
            "into_the_bed": numbers(src["marks"]["bloom"]["into_the_bed"]),
            "passing_chord_beats": src["marks"]["reach"]["out_of_the_bed"]["passing_chord_beats"],
            "hold_bars": src["marks"]["reach"]["out_of_the_bed"]["hold_bars"],
        },
        "BED": bed_defaults(src),
        "LEAD": {
            "legato_s": src["cast"]["parts"]["lead"]["legato"]["s"],
            "swell": strip(src["cast"]["parts"]["lead"]["swell"]),
            "bend": numbers(src["cast"]["parts"]["lead"]["bend"]),
            "tail_s": src["cast"]["parts"]["lead"]["release"]["tail_s"],
        },
        "SHORTLIST": {"roles": src["cast"]["shortlist"]["roles"], "criteria": numbers(src["cast"]["shortlist"]["criteria"])},
        "ROOM": {"preset": src["cast"]["room"]["preset"], "stock": src["cast"]["room"]["stock"]},
        "PARTS": strip(src["mix"]["parts"]),
        "MIX": {**{k: src["mix"][k] for k in ("filter_order", "band_split_order", "center_below_hz")},
                "sounding": strip(src["mix"]["sounding"])},
        "TIMINGS": {k: strip(v) for k, v in src["grammar"].items() if k not in ("about", "rules")},
        "BEFORE_THE_GRAMMAR": numbers(src["before_the_grammar"]),
    }


def bed_defaults(src: dict) -> dict:
    """The bed's notes as fit_score.py --film writes a film's bed from them."""
    bed = src["bed"]["parts"]
    b = bed["burble"]
    return {
        "name": src["bed"]["name"],
        "cycle": src["form"]["cycle"],
        "pedal": src["key"]["pedal"],
        "voicings": bed["pad"]["voicings"],
        "under_demo": strip(bed["pad"]["under_demo"]),
        "burble": {"step_beats": b["step_beats"], "held_beats": b["held_beats"], "cells": b["cells"],
                   "velocity": numbers(b["velocity"])},
        "sighs": bed["melody"]["sighs"],
        "shape_beats": bed["melody"]["shape_beats"],
        "placement": strip(bed["melody"]["placement"]),
    }


def numbers(d: dict) -> dict:
    """A block's values that are not prose."""
    return {k: v for k, v in d.items() if not isinstance(v, str)}


def strip(v):
    """A value without its prose: `about` and `note` stay in sound.json."""
    if isinstance(v, dict):
        return {k: strip(x) for k, x in v.items() if k not in ("about", "note")}
    if isinstance(v, list):
        return [strip(x) for x in v]
    return v


DEFAULTS_DOC = {
    "TEMPO": "The bed's tempo and cycle; the marks are written at marks_bpm and placed by time.",
    "SCORES": "The generated scores (repo-relative), and their titles: the score example renders each into <out>/<slug(title)>/.",
    "LADDER": "The loudness ladder (SPEC section 7). bed_rest_lu is against the narration, bed_under_demo_lu against the demo.",
    "VOICE_CHAIN": "The narration's chain, in order, before it is normalized to LADDER['narration_lufs'] (SPEC section 6).",
    "DUCK": "The bed under the voice (SPEC section 8): the detector, the follower all three moves share, and the broadband duck.",
    "CARVE": "A further cut on the whole bed in band_hz, times the follower.",
    "PAD_DIP": "A further cut on the pad only in band_hz, times the follower.",
    "MARKS": "The marks' own balance (SPEC section 3), and how Bloom meets the bed and the bed hands over to Reach;\n"
             "LADDER['marks_lufs'] is their level in a film.",
    "SHORTLIST": "The presets a film casts from, by role, and the measured limits they were shortlisted by (RFC-007).",
    "ROOM": "The one room: Cathedral's reverb at its stock settings. No part turns these, and no outside reverb is added.",
    "PARTS": "Each part's EQ, pan and level on stems (SPEC section 5). A level is against the pad unless it names LUFS.",
    "MIX": "Filter orders, the frequency below which every stem's side signal is removed, and what `while it sounds`\n"
           "means (momentary loudness above part_lufs, with the pad above pad_lufs).",
    "TIMINGS": "The grammar's timings, in seconds and dB (SPEC section 9).",
    "BEFORE_THE_GRAMMAR": "A film laid out before the grammar (no demos): the app's gain (app_audio.py's --gain-db) and\n"
                          "its duck under the voice, as mixed before ADR-014, until the film is re-timed.",
    "BED": "The bed's notes (SPEC section 4), which fit_score.py --film writes a film's bed from: the cycle and its\n"
           "voicings, the pad under a demo, the burble, and the sighs with the rule that places them.",
    "LEAD": "How the lead plays a line (SPEC section 2): held into the next note, the last note swelling, each note\n"
            "bending in, and its release (note-off to -30 dB).",
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
        errs += scan_python(rel) if rel.endswith(".py") else scan_shell(rel)
    return errs


def _number(node) -> bool:
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        node = node.operand
    return isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool)


def scan_python(rel: str) -> list[str]:
    """`add_argument("--duck-db", ..., default=<a number>)`, from the syntax tree."""
    try:
        tree = ast.parse(read(rel), rel)
    except SyntaxError as e:
        return [f"{rel}:{e.lineno}: does not parse ({e.msg})"]
    errs = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_argument"):
            continue
        flags = [a.value for a in node.args if isinstance(a, ast.Constant) and isinstance(a.value, str)]
        flag = next((f for f in flags if f in LEVEL_FLAGS), None)
        if flag is None:
            continue
        for kw in node.keywords:
            if kw.arg == "default" and _number(kw.value):
                errs.append(f"{rel}:{node.lineno}: a number as the default of {flag}; "
                            "read it from sound_defaults (sound.json)")
    return errs


def shell_code(line: str) -> str:
    """A shell line without its comment: a `#` that starts a word outside
    quotes (not `$#` or `${#x}`) ends the code."""
    quote, i = None, 0
    while i < len(line):
        c = line[i]
        if c == "\\" and quote != "'":
            i += 2  # an escaped character is never a quote or a comment
            continue
        if quote:
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
        elif c == "#" and (i == 0 or line[i - 1] in " \t;(|&"):
            return line[:i]
        i += 1
    return line


def scan_shell(rel: str) -> list[str]:
    errs = []
    for n, line in enumerate(read(rel).splitlines(), 1):
        code = shell_code(line)
        for rule, why in SHELL_RULES:
            for m in rule.finditer(code):
                errs.append(f"{rel}:{n}: {why.format(m.group(1))}")
    return errs


def generate(check: bool) -> list[str]:
    try:
        src = load()
        errs = validate(src)
        if errs:
            return errs
        errs = check_records(src)
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
        print(f"  sound: {n} generated files current, the records' notes as sound.json describes them, "
              "no number as a film tool's level default or a pipeline's fallback")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
