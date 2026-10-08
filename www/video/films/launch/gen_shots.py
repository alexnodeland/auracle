# The launch film's shots.json: its three takes of the real app, timed from
# its timeline.
#
#   python3 www/video/films/launch/gen_shots.py      (from the repo root)
#
# Run it again after every re-voice (voice.sh) and every measured tail
# (demo_tail.py, then timeline.py --demos): the demos' notes are placed on
# the timeline's demo windows, so a new timeline moves them. illustrated.sh
# records a take again when shots.json is newer than it.
#
# The film is illustrated (film.js draws every frame) and cuts to these takes
# for three of its beats. Its sound is ADR-014's: the takes are heard only in
# their demos (the instrument alone, after a line: Bright opening up, Wander
# drifting, Blend into an offer and Take), and are a picture under the
# narration everywhere else (app_audio.py --demos).
#
# Every take opens the same taught session (shotgen.taught: the warm start's
# three picks, the first fit, then six picks in EVOLVE, so LEARNING has
# forecasts of its own to show), so TAUGHT and the model's state are the same
# in every take and run forward from the film's drawn duel, as a returning
# player's: the first-run coach and the
# guide pill are done, so neither covers the keys or the well. Cast: Tidal,
# from the shortlist's pads (shotgen.cast): its Bright is a filter that opens
# from about 240 Hz to 580 Hz of spectral centroid with a 2-6 kHz share under
# 4% at the top of its turn, where Slow Weather (the films' pad) reached
# 2.4 kHz and 46%; the launch film's demos are heard alone, so they are cast
# soft. Each take logs what the app showed (the sound's head, controls, hood,
# faces and bank) for the drawing around it, so the drawn screen is the
# take's sound.
import json
import os
import sys

FILM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(FILM, "..", "..", "tools"))
from shotgen import INIT as SEED_INIT, QUIET, WIRING, cast, taught, dump  # noqa: E402

SOUND = cast("Tidal", Bright="both")
tl = json.load(open(os.path.join(FILM, "timeline.json")))
DEMO = {d["id"]: d for d in tl.get("demos", [])}
LINE = {l["id"]: l for l in tl["lines"]}

INIT = (
    "(() => { try { localStorage.setItem('auracle-played', '1'); "
    "localStorage.setItem('auracle-guide', JSON.stringify({ done: [], closed: ['perform', 'patch', 'evolve', 'taste', 'learning'] })); } catch (e) {} })(); "
    + SEED_INIT
)

K = lambda i: f".pf-knob[data-i='{i}']"  # noqa: E731
BRIGHT, WANDER = K(0), K(7)
PAD = lambda n: f".pf-pad:has-text('{n}')"  # noqa: E731
WSUB = "document.querySelector(\".pf-knob[data-i='7'] .pf-k-sub\").textContent"
STATUS = "document.querySelector('.pf-status').textContent"
KNOBS = "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.getAttribute('aria-valuetext')).join(' | ')"
TAUGHT = "document.getElementById('duel-count')?.textContent + ' (' + document.getElementById('taught')?.title + ')'"
CHORD = ["a", "d", "g"]


def demo_at(demo_id, dt=0.0):
    """A time `dt` seconds into a demo, as footage.mjs reads one: its line's
    start plus the offset to the demo's first note."""
    d = DEMO[demo_id]
    line = LINE[d["line"]]
    return f"{d['line']}+{d['t0'] - line['t0'] + dt:.2f}"


def play_ms(demo_id):
    d = DEMO[demo_id]
    return int(round((d["off"] - d["t0"]) * 1000))


# What the app showed, for film.js's drawing of it.
FACE_A = {"op": "log", "name": "face", "js": "document.querySelector('.pf-faces > .pf-face .face')?.src || ''"}
HOOD = {"op": "log", "name": "hood", "js": "[...document.querySelectorAll('.pf-hood-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')"}
SUBS = {"op": "log", "name": "controls", "js": "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.querySelector('.pf-k-name').textContent + ': ' + k.querySelector('.pf-k-sub').textContent + (k.classList.contains('search') ? ' (search)' : '')).join(' | ')"}
# The head and the controls as PERFORM drew them: name, family, blurb and
# status; each control's name, ends, caption, search, the amber dot's place
# (.pf-k-where's cx, cy) and the "vel" tick; the hood's rows with their fills.
HEAD = {"op": "log", "name": "sound", "js": (
    "JSON.stringify({ name: document.querySelector('.pf-name').textContent, cap: document.querySelector('.pf-cap').textContent, "
    "blurb: document.querySelector('.pf-blurb').textContent, status: document.querySelector('.pf-status').textContent, "
    "controls: [...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => { const w = k.querySelector('.pf-k-where'); "
    "return { name: k.querySelector('.pf-k-name').textContent, ends: k.querySelector('.pf-k-ends').textContent, sub: k.querySelector('.pf-k-sub').textContent, "
    "search: k.classList.contains('search'), vel: k.classList.contains('vel'), "
    "where: w && w.style.display !== 'none' ? [+w.getAttribute('cx'), +w.getAttribute('cy')] : null }; }), "
    "hood: [...document.querySelectorAll('.pf-hood-row')].map((r) => [r.querySelector('.pf-hood-mod').textContent, "
    "r.querySelector('.pf-hood-name').textContent.slice(r.querySelector('.pf-hood-mod').textContent.length).trim(), "
    "r.querySelector('.pf-hood-val').textContent, parseFloat(r.querySelector('.pf-hood-fill').style.width) / 100 || 0]) })")}
CHROME = {"op": "log", "name": "chrome", "js": (
    "JSON.stringify({ taught: document.getElementById('duel-count')?.textContent || '0', "
    "teach: document.getElementById('pt-teach')?.textContent || '', "
    "tabs: [...document.querySelectorAll('.btab')].map((t) => t.innerText.trim().split(/\\s+/)), "
    "bank: [...document.querySelectorAll('.bank-list > *')].map((e) => [Math.round(e.getBoundingClientRect().y), e.classList.contains('bank-group') ? 'group' : e.classList.contains('live') ? 'live' : 'row', ...e.innerText.trim().split('\\n').map((s) => s.trim()).filter(Boolean)]).filter(([y]) => y > 120 && y < 1010) })")}


def perform():
    return [{"op": "preset", "name": SOUND}, {"op": "view", "v": "perform"}, {"op": "measured", "name": SOUND}, WIRING, QUIET]


# The session every take opens: taught, with six picks after the first fit.
TAUGHT_SETUP = taught(votes=6)
RAIL = lambda level: f".rail-stop[data-level='{level}']"  # noqa: E731

shots = []

# ---- play: Bright opening up, then Wander drifting (two demos) --------------
# Bright is turned in its demo, with the chord down; Wander is let go into
# drift on "Let it wander", under the line (seen, not heard), so its walk is
# under way when its demo's chord comes in. The glide is logged (`glide`).
shots.append({
    "id": "l-play", "beat": "play", "pre": 1.0, "own_setup": True,
    "setup": TAUGHT_SETUP + perform() + [SUBS, HOOD, HEAD, FACE_A, CHROME],
    "marks": {"bright": BRIGHT, "wander": WANDER, "hood": ".pf-hood", "well": ".pf-well", "deck": ".pf-deck"},
    "actions": [
        {"at": demo_at("bright"), "op": "hold", "keys": CHORD, "ms": play_ms("bright")},
        {"at": demo_at("bright", 0.5), "op": "drag", "sel": BRIGHT, "dy": -70, "ms": 3000},
        {"at": demo_at("bright", 3.7), "op": "log", "name": "bright", "js": "document.querySelector(\".pf-knob[data-i='0']\").getAttribute('aria-valuetext') + ' || ' + document.querySelector('.pf-hood-row').textContent.replace(/\\s+/g, ' ').trim()"},
        {"at": "play3:Let", "op": "drag", "sel": WANDER, "dy": -95, "ms": 700},
        {"at": "play3:Let+0.8", "op": "until", "js": WSUB + ".includes('gliding')", "ms": 60000, "stamp": "glide"},
        {"at": demo_at("wander"), "op": "hold", "keys": CHORD, "ms": play_ms("wander")},
        {"at": demo_at("wander", 0.3), "op": "log", "name": "wander", "js": WSUB + " + ' || ' + " + KNOBS},
        {"at": demo_at("wander", play_ms("wander") / 1000 - 0.3), "op": "log", "name": "wander after", "js": WSUB + " + ' || ' + " + KNOBS + " + ' || ' + " + STATUS},
    ],
})

# ---- offer: Offer under offer1, then Blend past half and Take (one demo) ----
# Offer is pressed on "Press" (under the line); B is ready before offer2. In
# the demo the chord comes in, Blend goes past half and stays there well over
# a second (PERFORM counts an offer heard after 1 s past half with notes
# sounding, perform.js HEARD_MS), then Take: a heard Take is a pick ("Took B.
# That counts as a pick over what you had."), counted once its 8 s window
# closes (TAKE_SETTLE_MS).
shots.append({
    "id": "l-offer", "beat": "offer", "pre": 1.0, "own_setup": True,
    "setup": TAUGHT_SETUP + perform() + [SUBS, HOOD, HEAD, FACE_A, CHROME],
    "marks": {"offer": ".pf-pad.primary", "take": PAD("Take"), "pass": PAD("Pass"), "well": ".pf-well"},
    "actions": [
        {"at": "offer1:Press", "op": "click", "sel": ".pf-pad.primary"},
        {"at": "offer1:Press+0.2", "op": "until", "sel": ".pf-offer.ready", "ms": 90000, "stamp": "ready"},
        {"at": "@ready+0.4", "op": "log", "name": "offer", "js": "document.querySelector('.pf-offer-body')?.textContent || ''"},
        {"at": "@ready+0.4", "op": "log", "name": "face b", "js": "document.querySelector('.pf-offer .face')?.src || ''"},
        {"at": "@ready+0.4", "op": "mark", "name": "blend", "sel": ".pf-blend-in"},
        {"at": demo_at("blend"), "op": "hold", "keys": CHORD, "ms": play_ms("blend")},
        {"at": demo_at("blend", 0.4), "op": "seq", "steps": [
            {"op": "drag", "sel": ".pf-blend-in", "ox": -140, "dx": 215, "ms": 1400},
            {"op": "wait", "until": demo_at("blend", 4.2)},
            {"op": "click", "sel": PAD("Take")},
        ]},
        {"at": demo_at("blend", 4.6), "op": "log", "name": "after take", "js": "document.querySelector('.pf-name').textContent + ' || ' + (document.querySelector('#toasts .toast')?.textContent || '') + ' || ' + " + TAUGHT},
        {"at": demo_at("blend", 4.6), "op": "mark", "name": "toast", "sel": "#toasts .toast"},
    ],
})

# ---- depth: the levels, in and out, the face carried (no demo) ------------
# Under depth1, from PERFORM in to PATCH by the levels' cross: the face flies
# from PERFORM's well to PATCH's face at OUT (shell.js's move, .zoom-face).
# A MIDI pot claimed PERFORM's first free control, Bright, off camera (its
# toast gone before the shot); in PATCH its turns move the cutoff's amber
# reading and ghost. Under depth2, out to TASTE (the sound's mark on the
# map), then LEARNING (its forecasts, from the session's picks). Seen, not
# heard: no notes.
shots.append({
    "id": "l-circuit", "beat": "depth", "pre": 1.0, "own_setup": True,
    "setup": TAUGHT_SETUP + [{"op": "midi", "device": "MIDI keyboard"}] + perform() + [
        {"op": "midi", "cc": 74, "values": [64, 72], "ms": 300},
        {"op": "log", "name": "cc", "js": "document.querySelector('#toasts .toast')?.textContent || ''"},
        QUIET,
        SUBS, HOOD, HEAD, FACE_A, CHROME,
    ],
    "marks": {"patch": RAIL("patch"), "taste": RAIL("taste"), "learning": RAIL("learning"), "well": ".pf-well"},
    "actions": [
        {"at": "depth1:Open", "op": "click", "sel": RAIL("patch")},
        {"at": "depth1:Open+1.2", "op": "log", "name": "face", "js": "document.querySelector('#out-face .face')?.src || ''"},
        {"at": "depth1:Open+1.2", "op": "mark", "name": "filter", "sel": "#rack-svg g[data-mid]:has(text:text-is('filter'))"},
        {"at": "depth1:Every", "op": "midi", "cc": 74, "values": [72, 112, 52], "ms": 2600},
        {"at": "depth1:watch", "op": "midi", "cc": 74, "values": [52, 118, 30, 90], "ms": 2400},
        {"at": "depth1:Every+1.3", "op": "log", "name": "performed", "js": "[...document.querySelectorAll('#rack-svg g.performed')].map((g) => g.dataset.addr + ' ' + (g.querySelector('.knob-value')?.textContent || '')).join(' | ')"},
        {"at": "depth2:Underneath", "op": "click", "sel": RAIL("taste")},
        {"at": "depth2:bets", "op": "log", "name": "taste", "js": "document.querySelector('#view-taste')?.innerText.slice(0, 200) || ''"},
        {"at": "depth2:keeps-0.8", "op": "click", "sel": RAIL("learning")},
        {"at": "depth2:public", "op": "log", "name": "learning", "js": "document.querySelector('#view-learning')?.innerText.slice(0, 400) || ''"},
    ],
})

spec = {
    "about": ("The launch film's three takes of the real app, written by gen_shots.py from the timeline: run it again after a "
              "re-voice or a measured tail. Heard only in their demos (app_audio.py --demos)."),
    "viewport": [1920, 1080],
    "dpr": 1,
    "query": "?film",
    "init": INIT,
    "setup": [{"op": "click", "sel": "#warm-skip"}],
    "shots": shots,
}
dump(spec, os.path.join(FILM, "shots.json"))
