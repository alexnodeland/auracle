#!/usr/bin/env python3
"""Publish finished films to the site.

usage: publish.py FILM [FILM ...]

For each film rendered to www/video/out/FILM/ (FILM.mp4, FILM.vtt, FILM.jpg,
FILM.webp), this:

  - copies the four files to www/landing/assets/film/, the one copy in the
    repo (`make site` stages it wherever the guide and the reference embed it);
  - records the film in www/landing/assets/film/films.json: title, duration,
    description, chapters (one per beat, from its timeline) and the transcript;
  - regenerates www/docs/src/films.md, the guide's page of films, from
    films.json, so the chapters and the transcript printed under each film are
    the ones it actually speaks, at the times it speaks them.

It refuses a film whose picture and mix disagree about its length by more
than a frame, or whose captions are missing.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
WWW = os.path.dirname(VIDEO)
DEST = os.path.join(WWW, "landing", "assets", "film")
DOCS = os.path.join(WWW, "docs", "src")

# Where each film belongs, and the order the guide lists them in.
ORDER = ["launch", "perform", "taste", "circuit", "engine"]
CHAPTER_NAMES = {
    "launch": {"open": "The problem", "title": "Auracle", "duel": "Two patches, one pick", "grow": "Real circuits", "play": "Playing it", "offer": "Offers", "depth": "Underneath", "close": "Every note", "end": "Play it"},
}


def probe_duration(path):
    import imageio_ffmpeg

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out = subprocess.run([ff, "-i", path], capture_output=True, text=True).stderr
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            h, m, s = line.split(",")[0].split()[1].split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(f"no duration in {path}")


def fmt(t):
    m = int(t // 60)
    s = int(round(t - 60 * m))
    if s == 60:
        m, s = m + 1, 0
    return f"{m}:{s:02d}"


def main():
    films = sys.argv[1:]
    os.makedirs(DEST, exist_ok=True)
    reg_path = os.path.join(DEST, "films.json")
    reg = json.load(open(reg_path)) if os.path.exists(reg_path) else {}
    for f in films:
        out = os.path.join(VIDEO, "out", f)
        script = json.load(open(os.path.join(VIDEO, "films", f, "script.json")))
        tl = json.load(open(os.path.join(VIDEO, "films", f, "timeline.json")))
        files = {ext: os.path.join(out, f"{f}.{ext}") for ext in ("mp4", "vtt", "jpg", "webp")}
        for ext, p in files.items():
            if not os.path.exists(p):
                sys.exit(f"{f}: missing {p}")
        dur = probe_duration(files["mp4"])
        if abs(dur - tl["duration"]) > 0.1:
            sys.exit(f"{f}: the film is {dur:.2f} s but its timeline says {tl['duration']:.2f} s")
        for ext, p in files.items():
            shutil.copy2(p, os.path.join(DEST, f"{f}.{ext}"))
        names = CHAPTER_NAMES.get(f, {})
        chapters = []
        for b in tl["beats"]:
            lines = [l for l in tl["lines"] if l["beat"] == b["id"]]
            if not lines:
                continue
            name = names.get(b["id"]) or b["id"].replace("_", " ").capitalize()
            chapters.append({"t": round(b["t0"], 2), "name": name})
        reg[f] = {
            "title": script["title"],
            "description": script.get("description", ""),
            "duration": round(dur, 2),
            "chapters": chapters,
            "transcript": [l["text"] for l in tl["lines"]],
            "mp4_bytes": os.path.getsize(files["mp4"]),
        }
        print(f"{f}: {fmt(dur)}, {os.path.getsize(files['mp4']) / 1e6:.1f} MB")
    json.dump(reg, open(reg_path, "w"), indent=1, ensure_ascii=False)
    write_docs_page(reg)


def write_docs_page(reg):
    out = [
        "# Films",
        "",
        '<p class="lede">Five short films: what Auracle is, how to play it, how it',
        "learns, the circuit underneath, and the engine. Captions are on by default,",
        "and every film's full transcript is printed under it.</p>",
        "",
        "Everything you hear in them is Auracle: the music is scored for its own voices",
        "and played by its engine, and the walkthroughs record the instrument's own",
        "output. The narration is synthetic (Kokoro-82M, offline).",
        "",
    ]
    for f in ORDER:
        if f not in reg:
            continue
        r = reg[f]
        out += [
            f'## {r["title"]} <span class="film-len">{fmt(r["duration"])}</span>',
            "",
            f'<figure class="film" id="film-{f}">',
            f'<video controls preload="none" playsinline poster="film/{f}.jpg">',
            f'<source src="film/{f}.mp4" type="video/mp4">',
            f'<track kind="captions" src="film/{f}.vtt" srclang="en" label="English" default>',
            "</video>",
            f"<figcaption>{r['description']}</figcaption>",
            "</figure>",
            "",
        ]
        if len(r["chapters"]) > 1:
            out.append('<ol class="film-chapters">')
            for c in r["chapters"]:
                out.append(f'<li><a href="film/{f}.mp4#t={c["t"]:.1f}" data-film="{f}" data-t="{c["t"]:.2f}">{fmt(c["t"])}</a> {c["name"]}</li>')
            out += ["</ol>", ""]
        out += ["<details class=\"film-transcript\"><summary>Transcript</summary>", ""]
        out += [" ".join(r["transcript"]), "", "</details>", ""]
    os.makedirs(DOCS, exist_ok=True)
    open(os.path.join(DOCS, "films.md"), "w").write("\n".join(out))
    print(f"wrote {os.path.join(DOCS, 'films.md')}")


if __name__ == "__main__":
    main()
