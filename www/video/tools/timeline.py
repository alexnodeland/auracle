#!/usr/bin/env python3
"""Lay a film out in time: narration, demos and the marks on the music's clock.

usage: timeline.py FILM_DIR [--voice MANIFEST.json] [--words WORDS.json]
                            [--demos DEMOS.json] [--score SCORE.json]

Reads FILM_DIR/script.json and writes:

  FILM_DIR/timeline.json     every line's and beat's start and end, the music
                             grid, and word times when --words is given. The
                             stage pins every scene to these cues. With demos
                             and marks, their times too (`demos`, `marks`).
  FILM_DIR/arrangement.json  the soundtrack: its sections in order with their
                             bar counts, for the score renderer; the bed's
                             `levels`, [[t, dB], …] (a beat's optional
                             `bed_db` sets the bed's level from its start until
                             a later beat changes it: 0 is the bed as mixed,
                             -60 or less is out); and, when the film has them,
                             its `demos` ([[first note, last note-off], …])
                             and `marks` ({entrance, exit}).

Without --voice, line durations are estimated at 2.75 words a second, so the
visuals can be built before the voice exists; with it, the measured durations
from tools/../voice/tts.py are used and nothing else changes.

A beat starts on the next bar line (`snap: "bar"`, the default), the next beat
(`"beat"`), or immediately (`"none"`). Cutting on the bar is what makes an
edit feel played rather than assembled. On the N3 bed nothing snaps: the
grammar's timings are the rule there, and the voice waits for no bar (a
script's `snap` is ignored, and the timeline says so once).

**A demo.** A line can carry one, `"demo": {"id": "bright", "play_s": 6.5}`:
the instrument plays after the line, never under it (ADR-014; the grammar in
www/brand/sound.json, through sound_defaults.TIMINGS). The line ends; after
`demo_after_line_s` (0.7 s) the demo's first note; `play_s` later its last
note-off; its tail rings out until it has fallen `demo_tail_db` (30 dB) under
its playing level; `voice_after_tail_s` (0.8 s) more on the bed; then the next
line. The tail is measured, not a fixed length: --demos names a JSON file of
{demo id: {"tail_s": …}} (tools/demo_tail.py measures one), and a demo it does
not list is laid out on the script's own estimate (`"tail_s"` in the demo) and
marked `estimated`. A demo with neither stops the timeline. A demo line's
`post` is not used: the demo sets the gap.

**The marks.** A film on the N3 bed (`"music": {"bed": "n3"}`) opens with the
entrance mark and closes with the exit mark (sound.json `marks` and
`grammar`). The entrance starts where the first line would have, and the
first line follows its last note by `first_word_after_entrance_s` (1.75 s);
the exit starts `exit_after_last_word_s` (1.75 s) after the last line ends;
the film ends `exit_ring_out_s` after the exit's last note. Its tempo is
sound.json's (66 BPM), its grid starts on the bed's bar 1, and its end is not
rounded to a bar: the bed waits for no bar or cycle (fit_score.py --film
writes its score from this timeline).
"""
import argparse
import json
import math
import os
import re
import sys

import sound_defaults

# Arrays of numbers (word times, the picture's envelopes) on one line each: a
# timeline pretty-printed one number per line ran to 17 000 lines of diff.
_NUMS = re.compile(r"\[\s*(-?[\d.eE+-]+(?:,\s*-?[\d.eE+-]+)*)\s*\]")


def dump_json(obj, path):
    s = json.dumps(obj, indent=1, ensure_ascii=False)
    s = _NUMS.sub(lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", s)
    with open(path, "w") as f:
        f.write(s + "\n")

WPS = 2.75
# The unit a section may grow by, in bars: half a four-bar phrase still lands
# a cut on a strong beat, and a whole one wastes up to ten seconds of film.
PHRASE = 2


def est_duration(text):
    words = len(re.findall(r"[\w'’-]+", text))
    commas = text.count(",") + text.count(";")
    stops = len(re.findall(r"[.!?:]", text))
    return words / WPS + 0.18 * commas + 0.3 * max(0, stops - 1)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def snaps_asked(script):
    """The `snap` values a script asks for, other than "none"."""
    asked = [script.get("snap")] + [b.get("snap") for b in script["beats"]]
    return sorted({x for x in asked if x not in (None, "none")})


def on_n3(script):
    """Is the film on the bed sound.json names (N3), with the grammar and the marks?"""
    return str(script["music"].get("bed", "")).lower() == sound_defaults.BED["name"].lower()


def demo_slot(line_id, demo, t1, measured):
    """A demo laid out after its line, which ends at t1: (the demo's entry, the
    time the next line may start)."""
    tm = sound_defaults.TIMINGS
    if "play_s" not in demo:
        raise ValueError(f"line {line_id}: its demo has no play_s (how long the instrument plays)")
    m = measured.get(demo.get("id", line_id), {})
    tail = m.get("tail_s", demo.get("tail_s"))
    if tail is None:
        raise ValueError(f"line {line_id}: its demo's tail is neither measured (--demos, tools/demo_tail.py) "
                         "nor estimated (`tail_s` in the script)")
    play = m.get("play_s", demo["play_s"])
    t0 = t1 + tm["demo_after_line_s"]
    off = t0 + play
    nxt = off + tail + tm["voice_after_tail_s"]
    entry = {"line": line_id, "id": demo.get("id", line_id), "pause": round(t1, 3), "t0": round(t0, 3),
             "off": round(off, 3), "tail_s": round(tail, 3), "next": round(nxt, 3)}
    if "tail_s" not in m:
        entry["estimated"] = True
    return entry, nxt


def lay_out(script, durs=None, words=None, composed=None, measured=None):
    """The film laid out: (timeline, arrangement). `durs` and `words` are the
    measured lines (by id), `composed` a score's section lengths in bars, and
    `measured` the demos' measured tails (by demo id)."""
    durs, words, composed, measured = durs or {}, words or {}, composed or {}, measured or {}
    fps = script.get("fps", 30)
    n3 = on_n3(script)
    tempo = sound_defaults.TEMPO
    bpm = tempo["bpm"] if n3 else script["music"]["bpm"]
    meter = tempo["beats_per_bar"] if n3 else script["music"].get("meter", 4)
    spb = 60.0 / bpm
    bar = spb * meter
    marks_s = sound_defaults.MARKS["length_s"]
    tm = sound_defaults.TIMINGS

    groups = []
    for b in script["beats"]:
        if b.get("music") or not groups:
            groups.append([])
        groups[-1].append(b)

    def natural(beat_list):
        d = 0.0
        for b in beat_list:
            d += b.get("lead", 0.0)
            for l in b["lines"]:
                d += (durs.get(l["id"]) or est_duration(l["text"])) + l.get("post", 0.0)
            d += b.get("tail", 0.0)
        return d

    # Music first, when there is a score: every section keeps the length it
    # was composed at, and a group of beats that needs more gets whole
    # PHRASE-bar steps added, never bars cut (a score anchors its endings to
    # its last bars). Whatever the narration leaves over in a section is the
    # music breathing, at the section's end.
    section_end = {}
    if composed and not n3:
        t = 0.0
        for g in groups:
            name = g[0].get("music")
            need = math.ceil(natural(g) / bar - 1e-6)
            have = composed.get(name, need)
            bars = have if need <= have else have + PHRASE * math.ceil((need - have) / PHRASE)
            section_end[g[0]["id"]] = t + bars * bar
            t += bars * bar

    t = 0.0
    lines, beats, demos = [], [], []
    sections = []  # (name, start_time)
    levels = []  # (start_time, dB): the bed's level, from each beat's bed_db
    marks = {}
    default_snap = script.get("snap", "bar")
    group_of = {b["id"]: g[0]["id"] for g in groups for b in g}
    last_line = next((l["id"] for b in reversed(script["beats"]) for l in reversed(b["lines"])), None)
    for b in script["beats"]:
        if section_end and b.get("music"):
            # A section starts exactly where the previous one ended.
            prev = [section_end[k] for k in section_end if section_end[k] <= t + 1e-6]
            t = max(prev) if prev else 0.0
        # On N3 the grammar's timings are the rule: the voice waits for no bar.
        snap = "none" if n3 else b.get("snap", default_snap)
        if snap == "bar":
            t = math.ceil(t / bar - 1e-6) * bar
        elif snap == "beat":
            t = math.ceil(t / spb - 1e-6) * spb
        b0 = t
        if b.get("music") and not n3:
            sections.append((b["music"], b0))
        if "bed_db" in b:
            levels.append([round(b0, 3), float(b["bed_db"])])
        t += b.get("lead", 0.0)
        for l in b["lines"]:
            if n3 and "entrance" not in marks:
                # The entrance mark sits where the first line would have.
                marks["entrance"] = t
                t += marks_s + tm["first_word_after_entrance_s"]["reel"]
            d = durs.get(l["id"]) or est_duration(l["text"])
            entry = {"id": l["id"], "text": l["text"], "beat": b["id"], "t0": round(t, 3), "t1": round(t + d, 3)}
            if l["id"] in words:
                entry["words"] = [round(t + w, 3) for w in words[l["id"]]]
            lines.append(entry)
            if l.get("demo"):
                slot, t = demo_slot(l["id"], l["demo"], t + d, measured)
                demos.append(slot)
            else:
                t += d + l.get("post", 0.0)
            if n3 and l["id"] == last_line:
                # After the last word; after a last demo, where the next line
                # would have come.
                marks["exit"] = entry["t1"] + tm["exit_after_last_word_s"]["reel"]
                if l.get("demo"):
                    marks["exit"] = max(marks["exit"], demos[-1]["next"])
        t += b.get("tail", 0.0)
        # The last beat of a section holds until the section ends.
        if section_end:
            g = group_of[b["id"]]
            last = [x for x in script["beats"] if group_of[x["id"]] == g][-1]["id"] == b["id"]
            if last:
                t = max(t, section_end[g])
        beats.append({"id": b["id"], "t0": round(b0, 3), "t1": round(t, 3), "music": b.get("music")})

    if n3:
        # The film ends when the exit mark has rung out (or with the last
        # beat, if that is later); the bed waits for no bar, and neither does
        # the end.
        end = max(t, marks["exit"] + marks_s + tm["exit_ring_out_s"]) if "exit" in marks else t
        start = marks.get("entrance", 0.0)
        bars = max(1, math.ceil((end - start) / bar - 1e-6))
        arrangement = [{"section": "s", "bars": bars, "t0": round(start, 3)}]
        grid_t0 = start + sound_defaults.MARKS["into_the_bed"]["bed_bar_1_at_s"] if marks else 0.0
    else:
        # The film ends with the last beat, rounded up to a whole bar so the
        # music's last bar rings out on the grid.
        end = math.ceil(t / bar - 1e-6) * bar
        # The music: each section runs to the next section's start (whole bars).
        arrangement = []
        for i, (name, s0) in enumerate(sections):
            s1 = sections[i + 1][1] if i + 1 < len(sections) else end
            arrangement.append({"section": name, "bars": max(1, round((s1 - s0) / bar)), "t0": round(s0, 3)})
        grid_t0 = 0.0
    beats[-1]["t1"] = round(end, 3)

    timeline = {
        "film": script["film"],
        "fps": fps,
        "duration": round(end, 3),
        "grid": {"bpm": bpm, "meter": meter, "t0": round(grid_t0, 3)},
        "estimated": not bool(durs),
        "beats": beats,
        "lines": lines,
        "cues": {},
    }
    arr = {"film": script["film"], "bpm": bpm, "meter": meter, "bed": script["music"]["bed"], "sections": arrangement}
    if levels:
        arr["levels"] = levels
    if demos:
        timeline["demos"] = demos
        arr["demos"] = [[d["t0"], d["off"]] for d in demos]
    if marks:
        timeline["marks"] = {k: round(v, 3) for k, v in marks.items()}
        arr["marks"] = timeline["marks"]
    return timeline, arr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("film_dir")
    ap.add_argument("--voice", help="manifest.json from voice/tts.py")
    ap.add_argument("--words", help="per-line word times, {line_id: [t, …]} relative to the line start")
    ap.add_argument("--score", help="the bed's score (sound/*.json): lay the film on its composed sections")
    ap.add_argument("--demos", help="the demos' measured tails, {demo id: {tail_s}} (tools/demo_tail.py)")
    args = ap.parse_args()

    script = read_json(os.path.join(args.film_dir, "script.json"))
    durs = {}
    words = read_json(args.words) if args.words else {}
    if args.voice:
        for l in read_json(args.voice)["lines"]:
            durs[l["id"]] = l["duration_s"]
            # Word start times, measured (asr_check.py) or from the model's own
            # alignment (tts.py): the picture lights each word as it is said.
            if l.get("words") and l["id"] not in words:
                words[l["id"]] = l["words"]
    composed = {x["name"]: x["bars"] for x in read_json(args.score)["sections"]} if args.score else {}
    if args.demos and not os.path.exists(args.demos):
        sys.exit(f"timeline.py: no {args.demos}: measure the demos' tails into it (tools/demo_tail.py), or leave out --demos")
    measured = read_json(args.demos) if args.demos else {}
    try:
        timeline, arr = lay_out(script, durs, words, composed, measured)
    except ValueError as e:
        sys.exit(f"timeline.py: {e}")

    old = os.path.join(args.film_dir, "timeline.json")
    if os.path.exists(old):
        prev = read_json(old)
        if "env" in prev:
            timeline["env"] = prev["env"]
    dump_json(timeline, old)
    with open(os.path.join(args.film_dir, "arrangement.json"), "w") as f:
        json.dump(arr, f, indent=1)
    end, bpm = timeline["duration"], timeline["grid"]["bpm"]
    bar = 60.0 / bpm * timeline["grid"]["meter"]
    print(f"{script['film']}: {end:.1f} s ({end / bar:.0f} bars at {bpm} BPM), {len(timeline['lines'])} lines"
          + (" (ESTIMATED durations)" if not args.voice else ""))
    if on_n3(script) and snaps_asked(script):
        print(f"  snap: {', '.join(snaps_asked(script))} ignored on {sound_defaults.BED['name']}: the grammar's timings "
              "are the rule, and the voice waits for no bar")
    for b in timeline["beats"]:
        print(f"  {b['id']:<8} {b['t0']:7.2f} → {b['t1']:7.2f}  {b['music'] or ''}")
    for a in arr["sections"]:
        print(f"  music {a['section']:<10} {a['bars']:3d} bars from {a['t0']:.2f}")
    for t0, db in arr.get("levels", []):
        print(f"  bed   {'out' if db <= -60 else f'{db:+.0f} dB':<10} from {t0:.2f}")
    for k, v in timeline.get("marks", {}).items():
        print(f"  mark  {k:<10} {v:7.2f}")
    for d in timeline.get("demos", []):
        print(f"  demo  {d['id']:<10} {d['t0']:7.2f} → {d['off']:7.2f}, tail {d['tail_s']:.2f} s, next line {d['next']:.2f}"
              + (" (ESTIMATED tail: measure it with tools/demo_tail.py)" if d.get("estimated") else ""))


if __name__ == "__main__":
    main()
