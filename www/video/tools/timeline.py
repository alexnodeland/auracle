#!/usr/bin/env python3
"""Lay a film out in time: narration on the music's bar grid.

usage: timeline.py FILM_DIR [--voice MANIFEST.json] [--words WORDS.json]

Reads FILM_DIR/script.json and writes:

  FILM_DIR/timeline.json     every line's and beat's start and end, the music
                             grid, and word times when --words is given. The
                             stage pins every scene to these cues.
  FILM_DIR/arrangement.json  the soundtrack's sections in order with their bar
                             counts, for the score renderer: each beat that
                             names a `music` section starts that section, and
                             it runs until the next one starts. And the bed's
                             `levels`, [[t, dB], …]: a beat's optional
                             `bed_db` sets the bed's level from its start until
                             a later beat changes it (0 is the bed as mixed;
                             -60 or less is out). mix.py applies them, so a
                             walkthrough can keep the bed under its titles and
                             chapter turns and out from under its demos.

Without --voice, line durations are estimated at 2.75 words a second, so the
visuals can be built before the voice exists; with it, the measured durations
from tools/../voice/tts.py are used and nothing else changes.

A beat starts on the next bar line (`snap: "bar"`, the default), the next beat
(`"beat"`), or immediately (`"none"`). Cutting on the bar is what makes an
edit feel played rather than assembled.
"""
import argparse
import json
import math
import os
import re


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("film_dir")
    ap.add_argument("--voice", help="manifest.json from voice/tts.py")
    ap.add_argument("--words", help="per-line word times, {line_id: [t, …]} relative to the line start")
    ap.add_argument("--score", help="the bed's score (sound/*.json): lay the film on its composed sections")
    args = ap.parse_args()

    script = json.load(open(os.path.join(args.film_dir, "script.json")))
    fps = script.get("fps", 30)
    bpm = script["music"]["bpm"]
    meter = script["music"].get("meter", 4)
    spb = 60.0 / bpm
    bar = spb * meter

    durs = {}
    words = json.load(open(args.words)) if args.words else {}
    if args.voice:
        man = json.load(open(args.voice))
        for l in man["lines"]:
            durs[l["id"]] = l["duration_s"]
            # Word start times, measured (asr_check.py) or from the model's own
            # alignment (tts.py): the picture lights each word as it is said.
            if l.get("words") and l["id"] not in words:
                words[l["id"]] = l["words"]

    # Music first, when there is a score: every section keeps the length it
    # was composed at, and a group of beats that needs more gets whole
    # PHRASE-bar steps added, never bars cut (a score anchors its endings to
    # its last bars). Whatever the narration leaves over in a section is the
    # music breathing, at the section's end.
    composed = {}
    if args.score:
        sc = json.load(open(args.score))
        composed = {x["name"]: x["bars"] for x in sc["sections"]}
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

    section_end = {}
    if composed:
        t = 0.0
        for g in groups:
            name = g[0].get("music")
            need = math.ceil(natural(g) / bar - 1e-6)
            have = composed.get(name, need)
            bars = have if need <= have else have + PHRASE * math.ceil((need - have) / PHRASE)
            section_end[g[0]["id"]] = t + bars * bar
            t += bars * bar

    t = 0.0
    lines, beats = [], []
    sections = []  # (name, start_time)
    levels = []  # (start_time, dB): the bed's level, from each beat's bed_db
    default_snap = script.get("snap", "bar")
    group_of = {b["id"]: g[0]["id"] for g in groups for b in g}
    for b in script["beats"]:
        if composed and b.get("music"):
            # A section starts exactly where the previous one ended.
            prev = [section_end[k] for k in section_end if section_end[k] <= t + 1e-6]
            t = max(prev) if prev else 0.0
        snap = b.get("snap", default_snap)
        if snap == "bar":
            t = math.ceil(t / bar - 1e-6) * bar
        elif snap == "beat":
            t = math.ceil(t / spb - 1e-6) * spb
        b0 = t
        if b.get("music"):
            sections.append((b["music"], b0))
        if "bed_db" in b:
            levels.append([round(b0, 3), float(b["bed_db"])])
        t += b.get("lead", 0.0)
        for l in b["lines"]:
            d = durs.get(l["id"]) or est_duration(l["text"])
            entry = {"id": l["id"], "text": l["text"], "beat": b["id"], "t0": round(t, 3), "t1": round(t + d, 3)}
            if l["id"] in words:
                entry["words"] = [round(t + w, 3) for w in words[l["id"]]]
            lines.append(entry)
            t += d + l.get("post", 0.0)
        t += b.get("tail", 0.0)
        # The last beat of a section holds until the section ends.
        if composed:
            g = group_of[b["id"]]
            last = [x for x in script["beats"] if group_of[x["id"]] == g][-1]["id"] == b["id"]
            if last:
                t = max(t, section_end[g])
        beats.append({"id": b["id"], "t0": round(b0, 3), "t1": round(t, 3), "music": b.get("music")})

    # The film ends with the last beat, rounded up to a whole bar so the sting
    # rings out on the grid.
    end = math.ceil(t / bar - 1e-6) * bar
    beats[-1]["t1"] = round(end, 3)
    # The music: each section runs to the next section's start (whole bars).
    arrangement = []
    for i, (name, s0) in enumerate(sections):
        s1 = sections[i + 1][1] if i + 1 < len(sections) else end
        bars = max(1, round((s1 - s0) / bar))
        arrangement.append({"section": name, "bars": bars, "t0": round(s0, 3)})

    timeline = {
        "film": script["film"],
        "fps": fps,
        "duration": round(end, 3),
        "grid": {"bpm": bpm, "meter": meter, "t0": 0.0},
        "estimated": not bool(args.voice),
        "beats": beats,
        "lines": lines,
        "cues": {},
    }
    old = os.path.join(args.film_dir, "timeline.json")
    if os.path.exists(old):
        prev = json.load(open(old))
        if "env" in prev:
            timeline["env"] = prev["env"]
    dump_json(timeline, old)
    json.dump(
        {"film": script["film"], "bpm": bpm, "meter": meter, "bed": script["music"]["bed"], "sections": arrangement,
         **({"levels": levels} if levels else {})},
        open(os.path.join(args.film_dir, "arrangement.json"), "w"),
        indent=1,
    )
    print(f"{script['film']}: {end:.1f} s ({end / bar:.0f} bars at {bpm} BPM), {len(lines)} lines"
          + (" — ESTIMATED durations" if not args.voice else ""))
    for b in beats:
        print(f"  {b['id']:<8} {b['t0']:7.2f} → {b['t1']:7.2f}  {b['music'] or ''}")
    for a in arrangement:
        print(f"  music {a['section']:<10} {a['bars']:3d} bars from {a['t0']:.2f}")
    for t0, db in levels:
        print(f"  bed   {'out' if db <= -60 else f'{db:+.0f} dB':<10} from {t0:.2f}")


if __name__ == "__main__":
    main()
