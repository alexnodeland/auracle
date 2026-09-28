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

  - fills every `<!-- film:NAME -->…<!-- /film:NAME -->` marker in the guide
    and the reference with that film's player, and the landing page's
    `films:cta` / `films:band` markers and the README's `films:readme` marker
    with its buttons and posters — so a page shows a film exactly when the
    film exists, at its real running time, and a film re-rendered to a new
    length is re-timed everywhere by one command;
  - un-hides the app's two film links (apps/web/index.html), each once the
    film it opens is published.

The books and the landing page reach the films at the site's one copy,
site/assets/film/, by relative path; nothing is duplicated into site/docs.
(`mdbook serve` on its own has no assets/, so a film there shows its frame
and no picture — build with `make site` to see them play.)

It refuses a film whose picture and mix disagree about its length by more
than a frame, or whose captions are missing.
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
WWW = os.path.dirname(VIDEO)
DEST = os.path.join(WWW, "landing", "assets", "film")
DOCS = os.path.join(WWW, "docs", "src")

# Where each film belongs, and the order the guide lists them in: the launch
# film, then the films about playing it, then the ones about how it works.
GROUPS = [
    ("Start here", ["launch"]),
    ("The instrument", ["tour", "view-perform", "view-patch", "view-evolve", "view-taste"]),
    ("Playing it", ["playing", "composing", "sounddesign"]),
    ("How it works", ["taste", "engine", "math", "dsp"]),
]
ORDER = [f for _, fs in GROUPS for f in fs]
ROOT = os.path.dirname(WWW)
BOOKS = [os.path.join(WWW, "docs", "src"), os.path.join(WWW, "reference", "src")]
LANDING = os.path.join(WWW, "landing", "index.html")
README = os.path.join(ROOT, "README.md")
APP = os.path.join(ROOT, "apps", "web", "index.html")
SITE_URL = "https://auracle.alexnodeland.com/"
CHAPTER_NAMES = {
    "launch": {"open": "The problem", "title": "Auracle", "duel": "Two patches, one pick", "grow": "Real circuits", "play": "Playing it", "offer": "Offers", "depth": "Underneath", "close": "Every note", "end": "Play it"},
    "taste": {"hook": "Choosing, not describing", "hears": "What it listens for", "evidence": "A pick is evidence", "posterior": "Every taste that still fits", "lenses": "More than one taste", "forecast": "Forecasts, scored", "search": "The search", "reading": "Reading what it learned", "playing": "Learning while you play", "outro": "In the open"},
    "tour": {"title": "A tour of Auracle", "views": "The four views", "bank": "The bank", "dock": "The dock", "header": "Up top", "first": "Your first visit", "next": "Where to go next"},
    "view-evolve": {"title": "EVOLVE", "turn1": "The duel", "turn2": "Play it yourself", "turn3": "Point it", "turn4": "What a pick does", "turn5": "Fair questions", "turn6": "A generation", "turn7": "Stars, save, cut", "turn8": "A working rhythm", "outro": "Next: TASTE"},
    "view-perform": {"open": "PERFORM", "turn-play": "Play it", "turn-named": "Named for what you hear", "turn-honest": "Honest controls", "turn-xy": "The XY pad", "turn-offer": "Offers", "turn-wander": "Wander, Keep and Back", "turn-dock": "The dock", "turn-midi": "MIDI", "turn-together": "All of it at once", "outro": "Next: PATCH"},
    "engine": {"intro": "Five crates", "genome": "The genome", "compile": "Compiling to DSP", "audition": "The audition", "features": "Features", "utility": "Utility", "calibration": "Calibration", "search": "Search", "perform": "PERFORM's wiring", "runtime": "The runtime", "outro": "Read it, run it"},
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
        make_loop(f, files["mp4"])
        # A film with names lists exactly its chapters, so a chapter can open
        # on a wordless turn (its card) and the demo after it stays inside it.
        # Without names, every beat that speaks is a chapter.
        names = CHAPTER_NAMES.get(f)
        chapters = []
        for b in tl["beats"]:
            if names is not None:
                if b["id"] not in names:
                    continue
                name = names[b["id"]]
            elif any(l["beat"] == b["id"] for l in tl["lines"]):
                name = b["id"].replace("_", " ").capitalize()
            else:
                continue
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
    fill_books(reg)
    fill_landing(reg)
    fill_readme(reg)
    unhide_app_links(reg)
    fill_film_chip(reg)


def write_docs_page(reg):
    # Say what the films on the page are, not what the set will be: the
    # walkthroughs' clause only once one is published (the tour and the
    # views' films are recordings of the app too), and the app's film chip
    # only once a view has its film.
    walks = any(f in reg for f in dict(GROUPS)["Playing it"] + CHIP_FILMS)
    views = any(f in reg for f in CHIP_FILMS if f != "tour")
    out = [
        "# Films",
        "",
        '<p class="lede">Short films about Auracle: what it is, how to play it, and how',
        "it works underneath. Captions are on by default, and every film's full",
        "transcript is printed under it.</p>",
        "",
        "Everything you hear in them is Auracle: the music is scored for its own voices",
        "and played by its engine"
        + (", and the walkthroughs record the instrument's own output." if walks else "."),
        "The narration is synthetic (Kokoro-82M, offline).",
        "",
    ]
    if views:
        out += [
            "In the app, **▶ film** in the menu bar opens the film of the view you are",
            "in. The first time you open a view, it says so.",
            "",
        ]
    for group, films in GROUPS:
        present = [f for f in films if f in reg]
        if not present:
            continue
        if len(GROUPS) > 1:
            out += [f"## {group}", ""]
        for f in present:
            out += film_section(f, reg[f])
    os.makedirs(DOCS, exist_ok=True)
    open(os.path.join(DOCS, "films.md"), "w").write("\n".join(out))
    print(f"wrote {os.path.join(DOCS, 'films.md')}")


def film_section(f, r):
    """One film on the guide's page: heading, player, chapters, transcript."""
    out = [
        f'### {r["title"]} <span class="film-len">{fmt(r["duration"])}</span>',
        "",
        f'<figure class="film" id="film-{f}">',
        f'<video controls preload="none" playsinline poster="../assets/film/{f}.jpg">',
        f'<source src="../assets/film/{f}.mp4" type="video/mp4">',
        f'<track kind="captions" src="../assets/film/{f}.vtt" srclang="en" label="English" default>',
        "</video>",
        f"<figcaption>{r['description']}</figcaption>",
        "</figure>",
        "",
    ]
    if len(r["chapters"]) > 1:
        out.append('<ol class="film-chapters">')
        for c in r["chapters"]:
            out.append(f'<li><a href="../assets/film/{f}.mp4#t={c["t"]:.1f}" data-film="{f}" data-t="{c["t"]:.2f}">{fmt(c["t"])}</a> {c["name"]}</li>')
        out += ["</ol>", ""]
    out += ['<details class="film-transcript"><summary>Transcript</summary>', ""]
    out += [" ".join(r["transcript"]), "", "</details>", ""]
    return out


def fill(path, name, body):
    """Replace what sits between `<!-- NAME -->` and `<!-- /NAME -->` in a
    file. Missing markers are not an error: a page opts in by carrying them."""
    text = open(path).read()
    pat = re.compile(r"(<!-- " + re.escape(name) + r" -->)(.*?)(<!-- /" + re.escape(name) + r" -->)", re.S)
    if not pat.search(text):
        return False
    new = pat.sub(lambda m: m.group(1) + body + m.group(3), text)
    if new != text:
        open(path, "w").write(new)
        print(f"  {os.path.relpath(path, ROOT)}: {name}")
    return True


def fill_books(reg):
    """A film's player wherever a page of the guide or the reference asks for
    it. The path climbs out of the book to the site's copy: a page at
    docs/views/perform.html reaches assets/ as ../../assets/."""
    pat = re.compile(r"<!-- film:([\w-]+) -->")
    for book in BOOKS:
        for dirpath, _, names in os.walk(book):
            for n in names:
                if not n.endswith(".md") or n == "films.md":
                    continue
                path = os.path.join(dirpath, n)
                wanted = set(pat.findall(open(path).read()))
                depth = os.path.relpath(path, book).count(os.sep)
                up = "../" * (depth + 1)
                for f in wanted:
                    fill(path, f"film:{f}", "\n" + embed(f, reg.get(f), up + "assets/film/", up_docs(book, depth)) if f in reg else "")


def up_docs(book, depth):
    """The guide's films page, from a page `depth` folders into `book`."""
    up = "../" * depth
    return up + "films.html" if book.endswith(os.path.join("docs", "src")) else "../" * (depth + 1) + "docs/films.html"


def embed(f, r, base, films_page):
    return "\n".join([
        f'<figure class="film" id="film-{f}">',
        f'<video controls preload="none" playsinline poster="{base}{f}.jpg">',
        f'<source src="{base}{f}.mp4" type="video/mp4">',
        f'<track kind="captions" src="{base}{f}.vtt" srclang="en" label="English" default>',
        "</video>",
        f'<figcaption>{r["description"]} <span class="film-len">{fmt(r["duration"])}</span> · '
        f'<a href="{films_page}#film-{f}">chapters and transcript</a></figcaption>',
        "</figure>",
        "",
    ])


def film_link(f, r, cls, inner, extra=""):
    base = "assets/film/"
    return (
        f'<a class="{cls}" href="{base}{f}.mp4" data-film-open="{f}" data-src="{base}{f}.mp4" '
        f'data-vtt="{base}{f}.vtt" data-poster="{base}{f}.jpg" data-title="{r["title"]}"{extra}>{inner}</a>'
    )


# The landing page's rows of films, by the section they sit in: each film
# beside the claim it shows, not all of them in one band.
LANDING_ROWS = {
    # The four views' films sit in their own tabs (PANES), not in this row.
    "instrument": ["playing"],
    "learning": ["taste", "math"],
    "engine": ["engine", "dsp"],
    "making": ["sounddesign", "composing"],
}
# The hero's silent loop: the launch film's opening, which carries its own
# words on screen, so it reads with the sound off.
LOOPS = {"launch": (0.0, 17.2)}
# The four views' films, each in its tab of *Four views, one loop* on the
# landing page (the pane marker `films:pane-<tab>`), playing its own silent
# loop in place of the screenshot. Their loop windows are the films' own
# choices (set in VIEW_LOOPS when each film is published).
PANES = {"view-perform": "perform", "view-patch": "play", "view-evolve": "evolve", "view-taste": "taste"}
VIEW_NAMES = {"view-perform": "PERFORM", "view-patch": "PATCH", "view-evolve": "EVOLVE", "view-taste": "TASTE"}
VIEW_LOOPS = {}
LOOPS.update(VIEW_LOOPS)


def make_loop(f, src):
    """A short, silent, small loop for the hero, cut from the published film."""
    import imageio_ffmpeg

    if f not in LOOPS:
        return
    t0, t1 = LOOPS[f]
    out = os.path.join(DEST, f"{f}-loop.mp4")
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    d = t1 - t0
    vf = f"scale=1280:-2,fade=t=in:st=0:d=0.4,fade=t=out:st={d - 0.7:.2f}:d=0.7"
    subprocess.run([ff, "-y", "-loglevel", "error", "-ss", str(t0), "-t", str(d), "-i", src, "-an",
                    "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", out], check=True)
    # VP9 too, first in the list: a Chromium without the H.264 decoder (some
    # Linux builds) would otherwise show the poster where the hero should move.
    webm = os.path.join(DEST, f"{f}-loop.webm")
    subprocess.run([ff, "-y", "-loglevel", "error", "-ss", str(t0), "-t", str(d), "-i", src, "-an",
                    "-vf", vf, "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0", "-row-mt", "1",
                    "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", webm], check=True)
    print(f"  {os.path.relpath(out, ROOT)}: {os.path.getsize(out) / 1e6:.1f} MB loop "
          f"(+ {os.path.getsize(webm) / 1e6:.1f} MB webm)")


def fill_landing(reg):
    """The launch film is the hero — its opening looping silently in the
    instrument's bezel, the whole screen a button that plays it with sound —
    and every other film sits in the section it explains."""
    if not os.path.exists(LANDING):
        return
    if "launch" in reg:
        r = reg["launch"]
        cta = film_link("launch", r, "btn btn-film",
                        f'<span class="btn-film-play" aria-hidden="true">▶</span>Watch the film'
                        f'<span class="btn-film-len mono">{fmt(r["duration"])}</span>')
        loop = "assets/film/launch-loop.mp4"
        hero = "\n".join([
            "",
            '  <div class="panel hero-film">',
            '    <div class="screws" aria-hidden="true"><i></i><i></i><i></i><i></i></div>',
            "    " + film_link(
                "launch", r, "hero-film-screen",
                f'<video poster="assets/film/launch.jpg" autoplay muted loop playsinline '
                f'preload="metadata" aria-hidden="true" data-hero-loop>'
                f'<source src="assets/film/launch-loop.webm" type="video/webm">'
                f'<source src="{loop}" type="video/mp4"></video>'
                f'<span class="hero-film-play"><span class="btn-film-play" aria-hidden="true">▶</span>'
                f'Watch the film<span class="hfp-more">&nbsp;with sound</span> <span class="btn-film-len mono">{fmt(r["duration"])}</span></span>',
                extra=f' aria-label="Watch the film, {fmt(r["duration"])}, with sound"'),
            "  </div>",
            "  ",
        ])
    else:
        cta = '<a class="btn" href="#try">Try it here</a>'
        hero = ""
    fill(LANDING, "films:cta", cta)
    fill(LANDING, "films:hero", hero)

    def chip(f):
        r = reg[f]
        inner = (
            f'<span class="film-chip-shot"><img src="assets/film/{f}.webp" alt="" width="1920" height="1080" '
            f'loading="lazy" decoding="async"><span class="film-chip-badge" aria-hidden="true">▶</span></span>'
            f'<span class="film-chip-meta"><span class="film-chip-title">{r["title"]}</span>'
            f'<span class="film-chip-len mono">{fmt(r["duration"])}</span></span>'
        )
        return film_link(f, r, "film-chip", inner)

    # The tour, above the four views' tabs: the map before the deep dives.
    if "tour" in reg:
        r = reg["tour"]
        tour = "\n".join(["", '  <div class="tour-cta">', "    " + film_link(
            "tour", r, "btn btn-film",
            f'<span class="btn-film-play" aria-hidden="true">▶</span>Take the tour'
            f'<span class="btn-film-len mono">{fmt(r["duration"])}</span>'), "  </div>", "  "])
    else:
        tour = ""
    fill(LANDING, "films:tour", tour)

    for f, pane in PANES.items():
        if f not in reg:
            fill(LANDING, f"films:pane-{pane}", "")
            continue
        r = reg[f]
        loop = f"assets/film/{f}-loop"
        name = VIEW_NAMES[f]
        block = film_link(
            f, r, "hero-film-screen pane-film",
            f'<video poster="assets/film/{f}.jpg" autoplay muted loop playsinline preload="metadata" '
            f'aria-hidden="true" data-hero-loop>'
            f'<source src="{loop}.webm" type="video/webm"><source src="{loop}.mp4" type="video/mp4"></video>'
            f'<span class="hero-film-play"><span class="btn-film-play" aria-hidden="true">▶</span>'
            f'Watch {name} in depth <span class="btn-film-len mono">{fmt(r["duration"])}</span></span>',
            extra=f' aria-label="Watch {name} in depth, {fmt(r["duration"])}, with sound"')
        fill(LANDING, f"films:pane-{pane}", block)

    for row, films in LANDING_ROWS.items():
        present = [f for f in films if f in reg]
        body = "" if not present else "\n".join(
            ["", '  <div class="film-chips">'] + ["    " + chip(f) for f in present] + ["  </div>", "  "]
        )
        fill(LANDING, f"films:{row}", body)


def fill_readme(reg):
    """GitHub will not play a video from the repo, so the README carries the
    launch film's poster with its play badge baked in (tools/poster.mjs),
    linked to the site, whose hero is the film."""
    if "launch" not in reg or not os.path.exists(README):
        return
    r = reg["launch"]
    img = "www/landing/assets/film/launch-play.jpg"
    if not os.path.exists(os.path.join(ROOT, img)):
        img = "www/landing/assets/film/launch.jpg"
    others = " · ".join(
        f'[{reg[f]["title"]}]({SITE_URL}docs/films.html#film-{f}) ({fmt(reg[f]["duration"])})'
        for f in ORDER if f in reg and f != "launch"
    )
    body = "\n".join([
        "",
        f'<a href="{SITE_URL}"><img src="{img}" alt="Watch the launch film ({fmt(r["duration"])})" width="720"></a>',
        "",
        f'**[▶ Watch the launch film]({SITE_URL})** ({fmt(r["duration"])})' + (f" · {others}" if others else ""),
        "",
    ])
    fill(README, "films:readme", body)


# The app's two ways to the films, and the film each needs before it leads
# anywhere: the menu's "Watch the films" opens the guide's page of them (any
# film writes it); the help card's link opens the film of the view it was
# opened from (main.js), so it waits for the four views' films.
APP_LINKS = {"films-link": None, "help-film": "view-perform", "warm-tour": "tour"}


def unhide_app_links(reg):
    """The app ships its film links hidden, because the page each opens
    exists only once a film is published, and asking the site at runtime
    would log a 404 in every console until then. Un-hide each here instead,
    once its film is in films.json."""
    if not reg or not os.path.exists(APP):
        return
    text = open(APP).read()

    def unhide(tag):
        return re.sub(r'\bclass="([^"]*)"',
                      lambda c: 'class="' + " ".join(w for w in c.group(1).split() if w != "hidden") + '"',
                      tag.group(0))

    new = text
    for link, need in APP_LINKS.items():
        if need is None or need in reg:
            new = re.sub(r'<a\b[^>]*\bid="' + re.escape(link) + r'"[^>]*>', unhide, new)
    if new != text:
        open(APP, "w").write(new)
        print(f"  {os.path.relpath(APP, ROOT)}: film links shown")


# The menu bar's film chip (main.js, pointFilmChip): the tour on a first
# visit, then each view's own film. It reads which are published, and how
# long each runs, from data-films, so it never links a film that isn't out.
CHIP_FILMS = ["tour", "view-perform", "view-patch", "view-evolve", "view-taste"]


def fill_film_chip(reg):
    """Write the published chip films' lengths into the app's film chip and
    un-hide it once any view has its film."""
    if not os.path.exists(APP):
        return
    text = open(APP).read()
    m = re.search(r'<div class="([^"]*)" id="film-chip" data-films="[^"]*"', text)
    if not m:
        return
    lengths = {f: fmt(reg[f]["duration"]) for f in CHIP_FILMS if f in reg}
    shown = any(f != "tour" for f in lengths)
    cls = " ".join(w for w in m.group(1).split() if not (shown and w == "hidden"))
    attr = html.escape(json.dumps(lengths, separators=(",", ":")), quote=True)
    new = text[: m.start()] + f'<div class="{cls}" id="film-chip" data-films="{attr}"' + text[m.end():]
    if new != text:
        open(APP, "w").write(new)
        print(f"  {os.path.relpath(APP, ROOT)}: film chip lists {', '.join(lengths) or 'nothing'}")


if __name__ == "__main__":
    main()
