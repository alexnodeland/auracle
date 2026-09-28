"""Generate films/view-taste/shots.json: one shot per beat, for tools/footage.mjs.

    python3 www/video/films/view-taste/gen_shots.py

Two seeded sessions, each built off camera in a shot's set-up (session.py):

- FRESH (open, title): the warm start skipped and five picks by the listener,
  so the map is its pre-fit self and the sixth pick, on camera, is the
  model's first fit. The pair on the table is re-dealt with skip (which
  records nothing) until it is two kinds of sound, one the listener likes
  and neither one it dislikes.
- RICH (every chapter): the warm start, thirty duels and five stars by the
  listener, a first note to retire the keybed coach, then duels to the edge
  of a refit ("1 more pick and it redraws your taste map"), so a chapter can
  land the refit on camera.

Everything a shot points at on the canvas is found from the engine's own
taste views and marked with an invisible marker, so a pointer op or a
callout lands on it wherever the seeded session puts it.
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the film
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
from shotgen import INIT, FILLED, QUIET, dump  # noqa: E402
from session import (  # noqa: E402
    WATCH, WARM, REDEAL, NICE_PAIR, PICK, BEST, DIR_MARKS, TRUST_MARKS, STYLE_MARKS, STYLE_PICK, MAP_TARGETS, WRONG_PAIR,
    MARK_WRONG, WALK_TARGETS, WALK_TO, HEADER, SUMMARY, BANK, BENCHED, LABEL_SNAP, LABEL_MOVED, teach, teach_to_edge,
    stars_by_taste,
)

# Chords on the computer keys (a = C4), in the bed's F Lydian. Chords that
# follow each other share no key, so a release can never cut the next chord.
FMAJ7 = ["f", "h", "k", ";"]   # F4 A4 C5 E5
EM7 = ["d", "g", "j", "l"]     # E4 G4 B4 D5
AM7 = ["g", "h", "k", ";"]     # G4 A4 C5 E5
AM = ["h", "k", ";"]           # A4 C5 E5
FIFTH = ["a", "g"]             # C4 G4

# The name typed for the style the STYLES chapter plays first. It has to fit
# that style's example, which the seeded session decides: vt-styles logs it
# ("pick"), so check it there whenever the session changes.
RENAME = "warm washes"

IDLE = {"op": "until", "js": "!document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 300000}
FITTED = lambda stamp: {"op": "until", "js": "!document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 120000, "stamp": stamp}


def hold(at, keys, ms=None, until=None, until_snap=None, snap=None):
    a = {"at": at, "op": "hold", "keys": keys}
    if snap:
        a["snap"] = snap
    if ms is not None:
        a["ms"] = ms
    if until is not None:
        a["until"] = until
    if until_snap:
        a["until_snap"] = until_snap
    return a


def open_dot(mid, stamp, glide=450):
    """Hover a marked dot (its tooltip), click it, and wait for the bench."""
    return [
        {"op": "move", "sel": f"#{mid}", "ms": glide},
        {"op": "press", "sel": f"#{mid}", "ms": 110},
        {"op": "until", "js": BENCHED(mid), "ms": 30000, "stamp": stamp},
    ]


def marks(*names):
    return [{"op": "mark", "name": n, "sel": s} for n, s in names]


FRESH = [
    {"op": "until", "sel": "#warmstart:not(.hidden)", "ms": 180000},
    {"op": "click", "sel": "#warm-skip"},
    FILLED,
    {"op": "hold", "keys": ["a"], "ms": 300},
    {"op": "view", "v": "evolve"},
    {"op": "wait", "ms": 1500},
    {"op": "log", "name": "redeal", "js": REDEAL},
    {"op": "log", "name": "five", "js": teach_to_edge(8)},
    {"op": "log", "name": "pair", "js": NICE_PAIR},
]

RICH = [
    {"op": "until", "sel": "#warmstart:not(.hidden)", "ms": 180000},
    FILLED,
    {"op": "log", "name": "warm", "js": WARM},
    {"op": "until", "sel": "#belief .bl-u", "state": "attached", "ms": 180000},
    IDLE,
    {"op": "view", "v": "evolve"},
    {"op": "wait", "ms": 1500},
    {"op": "log", "name": "redeal", "js": REDEAL},
    {"op": "log", "name": "teach", "js": teach(30)},
    {"op": "log", "name": "stars", "js": stars_by_taste()},
    {"op": "hold", "keys": ["a"], "ms": 300},
    {"op": "wait", "ms": 8000},
    IDLE,
    {"op": "log", "name": "edge", "js": teach_to_edge()},
    {"op": "wait", "ms": 8000},
    IDLE,
    {"op": "view", "v": "taste"},
    {"op": "click", "sel": ".tab[data-tab='map']"},
    {"op": "wait", "ms": 1500},
    QUIET,
    {"op": "log", "name": "header", "js": HEADER},
]

shots = []

# ------------------------------------------------------------------ open (no words)
# The map before the model has fitted anything, a pair heard in EVOLVE, the
# sixth pick, "see what changed", and the map lit; then a bright dot, played:
# two chords on the bar. The cut skips the fit if it is slow.
shots.append({
    "id": "vt-open", "beat": "open", "pre": 0.3, "own_setup": True,
    "clips": [[7.9, "@lit-0.9"]],
    "setup": FRESH + [
        {"op": "view", "v": "taste"},
        {"op": "click", "sel": ".tab[data-tab='map']"},
        {"op": "wait", "ms": 1200},
        QUIET,
        {"op": "log", "name": "header", "js": HEADER},
    ],
    "marks": {"crt": "#taste-crt", "empty": "#crt-empty", "evolve-tab": ".viewtab[data-view='evolve']"},
    "actions": [
        {"at": 1.6, "op": "seq", "steps": [
            {"op": "view", "v": "evolve"},
            {"op": "wait", "ms": 150},
            *marks(("play-a", "#play-a"), ("play-b", "#play-b"), ("mid", "#duel-mid")),
        ]},
        {"at": 2.0, "op": "click", "sel": "#play-a"},
        {"at": 4.2, "op": "click", "sel": "#play-b"},
        {"at": 6.2, "op": "seq", "steps": [
            {"op": "log", "name": "pick", "js": PICK},
            {"op": "click", "sel": "[data-vt='pick']"},
            {"op": "until", "sel": "#teach-copy .teach-link", "ms": 30000, "stamp": "learned"},
            {"op": "mark", "name": "link", "sel": "#teach-copy .teach-link"},
        ]},
        {"at": "@learned+0.5", "op": "click", "sel": "#teach-copy .teach-link"},
        {"at": "@learned+0.6", **FITTED("lit")},
        {"at": "@lit+0.5", "op": "seq", "steps": [
            {"op": "log", "name": "best", "js": BEST},
            {"op": "mark", "name": "best", "sel": "#vt-best"},
            *open_dot("vt-best", "best", glide=700),
        ]},
        # Fmaj7 as soon as the bench has it, to the first bar line a second
        # on; Em7 on that bar, held to the end.
        hold("@best+0.05", FMAJ7, until="@best+1.0", until_snap="bar"),
        hold("@best+1.0", EM7, ms="end", snap="bar"),
    ],
})

# ------------------------------------------------------------------ title
# The same session, the frame the cold open ends on: the first fit, the
# brightest dot on the bench.
shots.append({
    "id": "vt-title", "beat": "title", "pre": 0.3, "own_setup": True,
    "setup": FRESH + [
        {"op": "log", "name": "pick", "js": PICK},
        {"op": "click", "sel": "[data-vt='pick']"},
        {"op": "until", "sel": "#teach-copy .teach-link", "ms": 30000},
        {"op": "click", "sel": "#teach-copy .teach-link"},
        {"op": "wait", "ms": 800},
        IDLE,
        {"op": "click", "sel": ".tab[data-tab='map']"},
        {"op": "wait", "ms": 1200},
        {"op": "log", "name": "best", "js": BEST},
        {"op": "press", "sel": "#vt-best", "ms": 110},
        {"op": "until", "js": BENCHED("vt-best"), "ms": 30000},
        {"op": "move", "sel": "#style-chips", "oy": 400, "ms": 200},
        QUIET,
        {"op": "log", "name": "header", "js": HEADER},
    ],
    "marks": {"crt": "#taste-crt", "chips": "#style-chips", "best": "#vt-best"},
    "actions": [],
})

# ------------------------------------------------------------------ tabs
shots.append({
    "id": "vt-tabs", "beat": "tabs", "pre": 0.4, "own_setup": True,
    "setup": RICH,
    "marks": {"tab-map": ".tab[data-tab='map']", "tab-styles": ".tab[data-tab='styles']",
              "tab-dir": ".tab[data-tab='dir']", "tab-trust": ".tab[data-tab='trust']", "chips": "#style-chips", "picks": "#duel-count"},
    "actions": [
        {"at": "tabs2:map", "op": "click", "sel": ".tab[data-tab='map']"},
        {"at": "tabs2:Styles", "op": "click", "sel": ".tab[data-tab='styles']"},
        {"at": "tabs3:Directions", "op": "click", "sel": ".tab[data-tab='dir']"},
        {"at": "tabs3:Trust", "op": "click", "sel": ".tab[data-tab='trust']"},
    ],
})

# ------------------------------------------------------------------ map
shots.append({
    "id": "vt-map", "beat": "map", "pre": 0.4, "own_setup": True,
    "setup": RICH + [
        {"op": "log", "name": "targets", "js": MAP_TARGETS},
        {"op": "log", "name": "bank", "js": BANK},
    ],
    "marks": {"crt": "#taste-crt", "legend": "#map-legend", "row0": "#bank-list .bank-item >> nth=0",
              "yes": "#vt-yes", "maybe": "#vt-maybe", "n1": "#vt-n1", "n2": "#vt-n2", "n3": "#vt-n3", "n4": "#vt-n4"},
    "actions": [
        {"at": "map2:Nearby", "op": "seq", "steps": [
            {"op": "move", "sel": "#vt-n1", "ms": 500}, {"op": "wait", "ms": 350},
            {"op": "move", "sel": "#vt-n2", "ms": 300}, {"op": "wait", "ms": 350},
            {"op": "move", "sel": "#vt-n3", "ms": 350}, {"op": "wait", "ms": 350},
            {"op": "move", "sel": "#vt-n4", "ms": 300}, {"op": "wait", "ms": 500},
        ]},
        {"at": "map3:Glow-0.2", "op": "move", "sel": "#map-legend", "oy": -60, "ms": 600},
        {"at": "map4:small", "op": "move", "sel": "#vt-yes", "ms": 700},
        {"at": "map5:big", "op": "move", "sel": "#vt-maybe", "ms": 800},
    ],
})

# ------------------------------------------------------------------ hear (bed out)
shots.append({
    "id": "vt-hear", "beat": "hear", "pre": 0.4, "own_setup": True,
    "setup": RICH + [
        {"op": "log", "name": "targets", "js": MAP_TARGETS},
    ],
    "marks": {"crt": "#taste-crt", "yes": "#vt-yes", "maybe": "#vt-maybe", "dim": "#vt-dim", "keys": "#piano", "live": "#live-label"},
    "actions": [
        {"at": "hear1", "op": "seq", "steps": open_dot("vt-yes", "yes")},
        hold("@yes+0.1", FMAJ7, ms=2100),
        hold("@yes+2.3", EM7, ms=2300),
        {"at": "hear2", "op": "seq", "steps": open_dot("vt-maybe", "maybe", glide=600)},
        hold("@maybe+0.1", FIFTH, ms=1900),
        hold("@maybe+2.1", AM, ms=2000),
        {"at": "hear3", "op": "seq", "steps": open_dot("vt-dim", "dim", glide=700)},
        hold("@dim+0.1", FMAJ7, ms=2800),
    ],
})

# ------------------------------------------------------------------ styles (bed out)
# The rename is the last thing: no refit follows it on camera.
shots.append({
    "id": "vt-styles", "beat": "styles", "pre": 0.4, "own_setup": True,
    "setup": RICH,
    "marks": {"tab": ".tab[data-tab='styles']", "chips": "#style-chips"},
    "actions": [
        {"at": "styles1:taste", "op": "seq", "steps": [
            {"op": "click", "sel": ".tab[data-tab='styles']"},
            {"op": "wait", "ms": 400},
            {"op": "log", "name": "styles", "js": STYLE_MARKS},
            {"op": "log", "name": "pick", "js": STYLE_PICK},
            *marks(("lens0", "#vt-lens0"), ("lens1", "#vt-lens1"), ("lens2", "#vt-lens2"),
                   ("first", ".style-chip[data-vt='first']"), ("second", ".style-chip[data-vt='second']"),
                   ("play-first", ".style-chip[data-vt='first'] .sc-play"), ("play-second", ".style-chip[data-vt='second'] .sc-play")),
        ]},
        {"at": "styles4:plays", "op": "click", "sel": ".style-chip[data-vt='first'] .sc-play"},
        {"at": "styles4:plays+2.9", "op": "click", "sel": ".style-chip[data-vt='second'] .sc-play"},
        {"at": "styles5:Name", "op": "seq", "steps": [
            {"op": "click", "sel": ".style-chip[data-vt='first'] .sc-name"},
            {"op": "type", "text": RENAME, "ms": 95, "enter": True},
        ]},
        {"at": "styles5:sticks", "op": "seq", "steps": [
            # The rename redraws the chips: the renamed one is found by its name.
            {"op": "eval", "js": "[...document.querySelectorAll('#style-chips .style-chip')].forEach((c) => { "
                                 "if (c.querySelector('.sc-name').value === %s) c.dataset.vt = 'named'; })" % json.dumps(RENAME)},
            {"op": "mark", "name": "named", "sel": ".style-chip[data-vt='named']"},
            {"op": "log", "name": "renamed", "js": STYLE_MARKS},
        ]},
    ],
})

# ------------------------------------------------------------------ directions
shots.append({
    "id": "vt-dir", "beat": "directions", "pre": 0.4, "own_setup": True,
    "setup": RICH,
    "marks": {"tab": ".tab[data-tab='dir']", "crt": "#taste-crt"},
    "actions": [
        {"at": "dir1:Directions", "op": "seq", "steps": [
            {"op": "click", "sel": ".tab[data-tab='dir']"},
            {"op": "wait", "ms": 400},
            {"op": "log", "name": "rows", "js": DIR_MARKS},
            *marks(("shimmer", "#vt-shimmer"), ("brightness", "#vt-brightness"), ("reverbs", "#vt-reverbs"),
                   ("agree", "#vt-agree"), ("right", "#vt-right"), ("left", "#vt-left"), ("guess", "#vt-guess")),
        ]},
    ],
})

# ------------------------------------------------------------------ trust
shots.append({
    "id": "vt-trust", "beat": "trust", "pre": 0.4, "own_setup": True,
    "setup": RICH,
    "marks": {"tab": ".tab[data-tab='trust']", "crt": "#taste-crt", "skill": "#skill"},
    "actions": [
        {"at": "trust1:believe", "op": "seq", "steps": [
            {"op": "click", "sel": ".tab[data-tab='trust']"},
            {"op": "wait", "ms": 400},
            {"op": "log", "name": "trust", "js": TRUST_MARKS},
            *marks(("honest", "#vt-honest"), ("xaxis", "#vt-xaxis"), ("head", "#vt-head"), ("check", "#vt-check"), ("bin", "#vt-bin")),
        ]},
    ],
})

# ------------------------------------------------------------------ wrong (bed out)
# Noisy Wash: the model is sure the listener likes it, and it is dealt against
# Noisy Bell at the edge of the refit, so the correction lands on camera.
shots.append({
    "id": "vt-wrong", "beat": "wrong", "pre": 0.4, "own_setup": True,
    "clips": [["wrong6-0.3", "@fitted-0.7"]],
    "setup": RICH + [
        {"op": "view", "v": "evolve"},
        {"op": "log", "name": "pair", "js": WRONG_PAIR},
        {"op": "view", "v": "taste"},
        {"op": "wait", "ms": 800},
        QUIET,
        {"op": "log", "name": "dot", "js": MARK_WRONG("vt-wrong")},
        {"op": "log", "name": "before", "js": SUMMARY},
    ],
    "marks": {"crt": "#taste-crt", "wrong": "#vt-wrong", "evolve-tab": ".viewtab[data-view='evolve']"},
    "actions": [
        {"at": "wrong2:thinks", "op": "move", "sel": "#vt-wrong", "ms": 700},
        {"at": "wrong2:one", "op": "seq", "steps": [
            {"op": "press", "sel": "#vt-wrong", "ms": 110},
            {"op": "until", "js": BENCHED("vt-wrong"), "ms": 30000, "stamp": "benched"},
            *marks(("row", ".bank-item.live"), ("star1", ".bank-item.live .star[data-s='1']")),
        ]},
        hold("@benched+0.1", FMAJ7, ms=1800),
        {"at": "wrong3:one", "op": "seq", "steps": [
            {"op": "until", "js": BENCHED("vt-wrong"), "ms": 30000},
            {"op": "click", "sel": ".bank-item.live .star[data-s='1']"},
        ]},
        {"at": "wrong4", "op": "seq", "steps": [
            {"op": "view", "v": "evolve"},
            {"op": "wait", "ms": 150},
            *marks(("against", "[data-vt='against']"), ("mid", "#duel-mid"), ("a", "#duel-a"), ("b", "#duel-b")),
        ]},
        {"at": "wrong4:other", "op": "seq", "steps": [
            {"op": "click", "sel": "[data-vt='against']"},
            {"op": "until", "sel": "#teach-copy .teach-link", "ms": 30000, "stamp": "learned"},
            *marks(("link", "#teach-copy .teach-link"), ("pred", "#duel-pred")),
            {"op": "log", "name": "forecast", "js": "document.getElementById('duel-pred').textContent"},
        ]},
        {"at": "@learned+1.0", "op": "click", "sel": "#teach-copy .teach-link"},
        {"at": "@learned+1.2", **FITTED("fitted")},
        {"at": "@fitted+0.3", "op": "seq", "steps": [
            {"op": "log", "name": "after", "js": MARK_WRONG("vt-wrong2")},
            {"op": "log", "name": "after-map", "js": SUMMARY},
            {"op": "mark", "name": "wrong2", "sel": "#vt-wrong2"},
            {"op": "move", "sel": "#vt-wrong2", "ms": 800},
        ]},
    ],
})

# ------------------------------------------------------------------ profile
# The system's file picker is not part of the page and cannot be filmed, so
# the load is shown from the moment a file is chosen: the file is handed to
# the input the picker fills, which is when the app asks its question.
CHOOSE_FILE = ("(() => { const inp = document.getElementById('import-input'); const dt = new DataTransfer(); "
               "dt.items.add(new File(['{}'], 'auracle-profile.json', { type: 'application/json' })); inp.files = dt.files; "
               "inp.dispatchEvent(new Event('change', { bubbles: true })); })()")
LOAD_ITEM = "#ovf-menu label.ovf-item:has(#import-input)"
shots.append({
    "id": "vt-profile", "beat": "profile", "pre": 0.4, "own_setup": True,
    "setup": RICH,
    "marks": {"ovf": "#ovf-btn"},
    "actions": [
        {"at": "profile1:stays", "op": "seq", "steps": [
            {"op": "click", "sel": "#ovf-btn"},
            {"op": "wait", "ms": 300},
            *marks(("menu", "#ovf-menu"), ("save", "#export-btn"), ("load", LOAD_ITEM), ("reset", "#taste-reset-btn")),
        ]},
        {"at": "profile2:save", "op": "move", "sel": "#export-btn", "ms": 500},
        {"at": "profile2:profile", "op": "click", "sel": "#export-btn"},
        {"at": "profile2:load-0.6", "op": "seq", "steps": [
            {"op": "click", "sel": "#ovf-btn"},
            {"op": "move", "sel": LOAD_ITEM, "ms": 450},
        ]},
        {"at": "profile3:Loading", "op": "seq", "steps": [
            {"op": "eval", "js": CHOOSE_FILE},
            {"op": "until", "sel": "#alarm:not(.hidden)", "ms": 5000},
            {"op": "mark", "name": "alarm-load", "sel": "#alarm"},
            {"op": "log", "name": "load-question", "js": "document.getElementById('alarm').textContent"},
        ]},
        {"at": "profile3:first+0.3", "op": "click", "sel": "#alarm .toast-undo:has-text('keep mine')"},
        {"at": "profile4:Reset", "op": "seq", "steps": [
            {"op": "click", "sel": "#ovf-btn"},
            {"op": "move", "sel": "#taste-reset-btn", "ms": 350},
            {"op": "click", "sel": "#taste-reset-btn"},
            {"op": "until", "sel": "#alarm:not(.hidden)", "ms": 5000},
            {"op": "mark", "name": "alarm", "sel": "#alarm"},
            {"op": "log", "name": "reset-question", "js": "document.getElementById('alarm').textContent"},
        ]},
        {"at": "profile4:asks+0.4", "op": "click", "sel": "#alarm .toast-undo:has-text('keep it')"},
    ],
})

# ------------------------------------------------------------------ together (bed out)
# The map walked with the arrow keys to a bright dot the listener likes, Enter
# opens it; then on to a maybe, opened, starred.
shots.append({
    "id": "vt-together", "beat": "together", "pre": 0.4, "own_setup": True,
    "setup": RICH + [
        {"op": "log", "name": "walk", "js": WALK_TARGETS},
    ],
    "marks": {"crt": "#taste-crt", "t1": "#vt-t1", "t2": "#vt-t2", "evolve-tab": ".viewtab[data-view='evolve']"},
    "actions": [
        {"at": "together2:walk", "op": "seq", "steps": [
            {"op": "log", "name": "to-t1", "js": WALK_TO("t1")},
            {"op": "wait", "ms": 350},
            {"op": "eval", "js": LABEL_SNAP},
            {"op": "key", "key": "Enter", "ms": 100},
            {"op": "until", "js": BENCHED("vt-t1"), "ms": 30000, "stamp": "t1"},
            {"op": "log", "name": "t1", "js": "document.getElementById('live-label').textContent"},
        ]},
        hold("@t1+0.1", FMAJ7, until="@t1+2.6", until_snap="bar"),
        # On to the maybe while the chord rings, so it opens on "Try a maybe".
        {"at": "together3-1.4", "op": "seq", "steps": [
            {"op": "log", "name": "to-t2", "js": WALK_TO("t2")},
            {"op": "wait", "ms": 250},
            {"op": "key", "key": "Enter", "ms": 100},
            {"op": "until", "js": BENCHED("vt-t2"), "ms": 30000, "stamp": "t2"},
            {"op": "log", "name": "t2", "js": "document.getElementById('live-label').textContent"},
            {"op": "mark", "name": "star5", "sel": ".bank-item.live .star[data-s='5']"},
        ]},
        hold("@t2+0.1", EM7, ms=1700),
        hold("@t2+1.9", AM7, ms=2300),
        {"at": "together3:Star+0.2", "op": "seq", "steps": [
            {"op": "until", "js": BENCHED("vt-t2"), "ms": 30000},
            # Measured again here: the bank scrolls its row into view after the bench has it.
            {"op": "log", "name": "row-top", "js": "Math.round(document.querySelector('.bank-item.live').getBoundingClientRect().top) + ' in list from ' + Math.round(document.getElementById('bank-list').getBoundingClientRect().top)"},
            {"op": "mark", "name": "star5", "sel": ".bank-item.live .star[data-s='5']"},
            {"op": "click", "sel": ".bank-item.live .star[data-s='5']"},
        ]},
        {"at": "together3:back", "op": "view", "v": "evolve"},
    ],
})

# ------------------------------------------------------------------ outro
shots.append({
    "id": "vt-outro", "beat": "outro", "pre": 0.4, "own_setup": True,
    "setup": RICH,
    "marks": {"crt": "#taste-crt", "evolve-tab": ".viewtab[data-view='evolve']"},
    "actions": [
        {"at": "outro2:EVOLVE", "op": "view", "v": "evolve"},
    ],
})

spec = {"viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT + " " + WATCH, "setup": [], "shots": shots}
dump(spec, os.path.join(HERE, "shots.json"))
print(f"{os.path.relpath(os.path.join(HERE, 'shots.json'))}: {len(shots)} shots")
