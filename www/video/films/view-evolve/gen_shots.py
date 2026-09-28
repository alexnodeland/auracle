#!/usr/bin/env python3
"""Generate films/view-evolve/shots.json, the footage of EVOLVE: breeding
sounds you like (tools/footage.mjs). Run from anywhere, after the timeline:

    python3 www/video/films/view-evolve/gen_shots.py

One seeded session for every shot (shotgen.INIT). The film-level set-up is
the taught session: the warm start answered with a pad, a texture and one
more of either (see TAG_JS), then EVOLVE, and one note so the "press A–L" coach
goes. Each chapter adds its own picks off camera, so the pair on the cards
differs from chapter to chapter.

A chapter's demo shot starts PRE seconds before its beat: its one-bar turn
beat borrows the shot (film.js, meta.pre = PRE − BAR), so the footage runs on
unbroken under the chapter card. The cold open's shot runs on through the
title, which borrows it the same way (its `dur` comes from the timeline).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
from shotgen import INIT, FILLED, QUIET, CATS, dump  # noqa: E402

OUT = os.path.join(HERE, "shots.json")
TB = {b["id"]: b for b in json.load(open(os.path.join(HERE, "timeline.json")))["beats"]}

# A chapter's shot starts this long before its beat: one bar of the bed at
# 84 BPM for the turn, plus the scene's lead-in and a margin.
PRE = 3.4
BAR = 240 / 84

# The warm start deals one card per family, then fills to nine, so a pad and a
# texture are always on the grid; a second pad is not. The three picks are "the
# three closest to a moving pad": the first pad, the first texture, then a
# second pad, a second texture or the first weird card, whichever the deal
# has. They are tagged first (data-ve-pick 1–3; nothing changes on screen) and
# then clicked for real, one by one.
FAMILIES = json.dumps({
    "pad": CATS["pad"], "texture": CATS["texture"],
    "weird": ["Two Minds", "Ceiling", "Undertow", "Sour Mash", "Wrong Number", "Inside Out"],
})
TAG_JS = (
    f"(() => {{ const F = {FAMILIES}; const items = [...document.querySelectorAll('.warm-item')];"
    " const name = (e) => e.querySelector('.wi-name').textContent.trim();"
    " const of = (f) => items.filter((e) => F[f].includes(name(e)));"
    " const picks = [of('pad')[0], of('texture')[0], of('pad')[1] || of('texture')[1] || of('weird')[0]];"
    " picks.forEach((e, i) => e && (e.dataset.vePick = String(i + 1)));"
    " return picks.map((e) => e ? name(e) : '(none)').join(', '); })()"
)
TAG = {"op": "log", "name": "picks", "js": TAG_JS}
CARD = [f".warm-item[data-ve-pick='{i}']" for i in (1, 2, 3)]
PAD_PLAY = f"{CARD[0]} + .wi-play"

BLUR = {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"}
LOG_DEAL = {"op": "log", "name": "deal", "js": "[...document.querySelectorAll('.warm-item .wi-name')].map((e) => e.textContent).join(', ')"}
WARM = [{"op": "until", "sel": "#warmstart:not(.hidden)", "ms": 180000}, FILLED]
TAUGHT = WARM + [
    LOG_DEAL,
    TAG,
    {"op": "click", "sel": CARD[0]},
    {"op": "wait", "ms": 250},
    {"op": "click", "sel": CARD[1]},
    {"op": "wait", "ms": 250},
    {"op": "click", "sel": CARD[2]},
    {"op": "click", "sel": "#warm-go"},
    {"op": "until", "sel": ".viewtab[data-view='perform'][aria-selected='true']", "ms": 180000},
    {"op": "until", "sel": "#belief .bl-u", "state": "attached", "ms": 180000},
    {"op": "until", "js": "!document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 240000},
    {"op": "view", "v": "evolve"},
    {"op": "wait", "ms": 800},
    BLUR,
    # A first note: the app's "press A–L" coach goes once something is played.
    {"op": "hold", "keys": ["a"], "ms": 150},
    {"op": "wait", "ms": 600},
]

# Pick like a musician after pads: the side whose name sounds like a pad
# (swell, wash, pad, drone), else alternately. Through the app's own button,
# so the app does what a click does; it returns the side it chose.
PICK_JS = (
    "(() => { const n = (s) => document.getElementById('name-' + s).firstChild.textContent.trim();"
    " const pad = /Swell|Wash|Pad|Drone|Bloom/;"
    " const a = pad.test(n('a')), b = pad.test(n('b'));"
    " window.__veFlip = !window.__veFlip;"
    " const side = a && !b ? 'a' : b && !a ? 'b' : (window.__veFlip ? 'a' : 'b');"
    " document.getElementById('choose-' + side).click(); return side + ': ' + n(side); })()"
)
PICK = {"op": "eval", "js": PICK_JS}
STATE_JS = (
    "[document.getElementById('name-a').firstChild.textContent.trim() + ' | ' + document.getElementById('name-b').firstChild.textContent.trim(),"
    " 'picks ' + document.getElementById('duel-count').textContent, 'pips ' + document.querySelectorAll('#teach-pips i.lit').length,"
    " document.getElementById('teach-copy').textContent, 'pred: ' + document.getElementById('duel-pred').textContent].join(' · ')"
)
FRESH_JS = "[...document.querySelectorAll('#bank-list .bank-item.fresh .bi-name')].map((e) => e.textContent).join(', ')"
TOASTS_JS = "[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' || ')"
# Both sides' audio is in, so 1 and 2 play at once.
RENDERS = {"op": "until", "js": "!document.getElementById('play-a').classList.contains('pending') && !document.getElementById('play-b').classList.contains('pending')", "ms": 90000}
SETTLED = {"op": "until", "js": "!document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 240000}
# The first generation in a session offers the bank's tour in a toast of its
# own, which holds the generation's toast back 7 s. Marked as seen, as it would
# be for anyone who has bred before, so "Gen 1: …" is the toast on camera.
TOURED = {"op": "eval", "js": "localStorage.setItem('auracle-bank-toured', '1')"}


# The next pair has landed: while a pair is being dealt the cards are marked
# `dealing` and the choose buttons are disabled, and a pick then is dropped
# (by design: the control is visibly inert). Right after the warm start the
# engine can take seconds to deal, so every pick off camera waits for this.
DEALT = {"op": "until", "js": "!document.getElementById('duel-a').classList.contains('dealing') && !document.getElementById('choose-a').disabled", "ms": 90000}


# How long the next pair took to land after a pick, in ms (a diagnostic).
DEAL_MS = {"op": "log", "name": "deal ms", "js": "Math.round(performance.now() - window.__veT)"}


def votes(n):
    out = []
    for _ in range(n):
        out += [DEALT, RENDERS, {"op": "eval", "js": "window.__veT = performance.now()"}, PICK,
                {"op": "wait", "ms": 400}, DEALT, DEAL_MS, {"op": "wait", "ms": 1100}]
    return out + [SETTLED]


def ready(extra=None):
    """The end of every set-up: the pair can be heard at once, no toast is up,
    nothing has focus (a focused button swallows 1, 2 and the arrows)."""
    return (extra or []) + [DEALT, RENDERS, {"op": "wait", "ms": 1200}, QUIET, BLUR, {"op": "log", "name": "state", "js": STATE_JS}]


def state(at):
    return {"at": at, "op": "log", "name": "state", "js": STATE_JS}


def T(spec, off=0.0):
    """A time spec plus an offset, folded into one offset ("duel2:one+0.8")."""
    if isinstance(spec, (int, float)):
        return round(spec + off, 3)
    m = re.search(r"([+-]\d+(?:\.\d+)?)$", spec)
    base, o = (spec[: m.start()], float(m.group(1))) if m else (spec, 0.0)
    o = round(o + off, 3)
    return base if abs(o) < 1e-9 else f"{base}{'+' if o > 0 else '-'}{abs(o):g}"


def B(x):
    """Shot-clock seconds for x seconds after a chapter beat's start."""
    return round(PRE + x, 3)


MARKS = {
    "meter": "#duel-mid", "pips": "#teach-pips", "copy": "#teach-copy", "pred": "#duel-pred",
    "skip": "#skip-duel", "evolve": "#evolve-btn",
    "cardA": "#duel-a", "cardB": "#duel-b", "nameA": "#name-a", "nameB": "#name-b",
    "scopeA": "#scope-a", "scopeB": "#scope-b",
    "playA": "#play-a", "playB": "#play-b", "chooseA": "#choose-a", "chooseB": "#choose-b",
    "lineage": "#lineage-log", "rail": "#bank-list", "lamp": "#wm-lamp", "picks": "#duel-count", "rule": "#duel-rule",
}


def M(*names, **more):
    d = {k: MARKS[k] for k in names}
    d.update(more)
    return d


# C, Am, F, G in the computer keymap (a = C4), two beats each at 84 BPM.
CHORDS = [["a", "d", "g"], ["h", "k", ";"], ["f", "h", "k"], ["g", "j", "l"]]


def chords(at0):
    return [{"at": T(at0, i * 1.4286), "snap": "beat", "op": "hold", "keys": k, "ms": 1300} for i, k in enumerate(CHORDS)]


def quick(at_a, at_b, at_pick, tag):
    """A quick duel: hear A, hear B, pick."""
    return [
        {"at": at_a, "op": "key", "key": "1", "ms": 100},
        {"at": at_b, "op": "key", "key": "2", "ms": 100},
        {"at": at_pick, "op": "eval", "js": PICK_JS},
        {"at": T(at_pick, 0.4), "op": "log", "name": tag, "js": STATE_JS},
    ]


shots = []

# --- open: the cold open. A, then B, then a pick; the next pair slides in.
shots.append({
    "id": "ve-open", "beat": "open", "pre": 0.5,
    # On through the title, which borrows this shot: the title's end + 2 s.
    "dur": round(TB["title"]["t1"] + 0.5 + 2.0, 1),
    "setup": ready(),
    "marks": M("meter", "pred", "cardA", "cardB", "nameA", "nameB", "playA", "playB", "chooseA", "chooseB"),
    "actions": [
        {"at": 0.8, "op": "key", "key": "1", "ms": 120},
        {"at": 5.9, "op": "key", "key": "2", "ms": 120},
        {"at": 10.55, "op": "eval", "js": PICK_JS},
        {"at": 10.6, "op": "log", "name": "picked", "js": STATE_JS},
        {"at": 11.2, "op": "mark", "name": "pred", "sel": "#duel-pred"},
        state(11.6),
    ],
})

# --- 01 the duel: hear A, hear B, pick.
shots.append({
    "id": "ve-duel", "beat": "duel", "pre": PRE,
    "setup": ready(votes(3)),
    "marks": M("meter", "pred", "cardA", "cardB", "nameA", "nameB", "scopeA", "scopeB", "playA", "playB", "chooseA", "chooseB"),
    "actions": [
        state(B(0.2)),
        {"at": "duel2:one", "op": "key", "key": "1", "ms": 120},
        {"at": "duel3:two", "op": "key", "key": "2", "ms": 120},
        {"at": "duel6:B+0.3", "op": "key", "key": "ArrowRight", "ms": 120},
        {"at": "duel6:B+0.9", "op": "mark", "name": "pred", "sel": "#duel-pred"},
        state("duel7"),
        # The loop goes on: the next pair's A, under the chapter's last seconds.
        {"at": "duel7:in+0.4", "op": "key", "key": "1", "ms": 100},
    ],
})

# --- 02 play it yourself: each card on the keys, the same chords on both.
LIVE_IS = "document.getElementById('live-label').textContent.trim() === document.getElementById('name-{s}').firstChild.textContent.trim()"
shots.append({
    "id": "ve-play", "beat": "play", "pre": PRE,
    "setup": ready(votes(2)),
    "marks": M("meter", "pred", "cardA", "cardB", "nameA", "nameB", "scopeA", "scopeB", "chooseA", "chooseB", label="#live-label", keybed="#piano"),
    "actions": [
        state(B(0.2)),
        {"at": "play1:click", "op": "click", "sel": "#duel-a .scope"},
        {"at": "play1:click+0.1", "op": "until", "js": LIVE_IS.format(s="a"), "ms": 30000, "stamp": "liveA"},
        *chords("play2:That"),
        {"at": "play3:Click", "op": "click", "sel": "#duel-b .scope"},
        {"at": "play3:Click+0.1", "op": "until", "js": LIVE_IS.format(s="b"), "ms": 30000, "stamp": "liveB"},
        *chords("play3:play"),
        {"at": "play5:quick", "op": "eval", "js": PICK_JS},
        {"at": "play5:quick+0.6", "op": "mark", "name": "pred", "sel": "#duel-pred"},
        state("play5:quick+0.8"),
    ],
})

# --- 03 point it: the warm start on a first visit; cut from "teach it" to
# EVOLVE, taught (it takes seconds and switches to PERFORM first).
point_marks = {"card": "#warmstart .warm-card", "grid": "#warm-grid", "go": "#warm-go", "sub": "#warmstart .warm-sub"}
shots.append({
    "id": "ve-point", "beat": "point", "pre": PRE, "own_setup": True,
    "setup": WARM + [LOG_DEAL, TAG, {"op": "wait", "ms": 1000}, QUIET],
    "marks": {**point_marks, "pad": CARD[0], "padplay": PAD_PLAY},
    "clips": [["point4", "@taught+0.9"]],
    "actions": [
        {"at": "point2:Play", "op": "click", "sel": PAD_PLAY},
        {"at": "point2:closest", "op": "seq", "steps": [
            {"op": "click", "sel": CARD[0]}, {"op": "wait", "ms": 300},
            {"op": "click", "sel": CARD[1]}, {"op": "wait", "ms": 300},
            {"op": "click", "sel": CARD[2]},
            {"op": "mark", "name": "go", "sel": "#warm-go"},
        ]},
        {"at": "point3:passed+0.2", "op": "click", "sel": "#warm-go"},
        {"at": "point3:passed+0.4", "op": "until", "sel": ".viewtab[data-view='perform'][aria-selected='true']", "ms": 180000, "stamp": "taught"},
        {"at": "@taught+0.2", "op": "view", "v": "evolve"},
        {"at": "@taught+0.4", "op": "eval", "js": BLUR["js"]},
        {"at": "@taught+0.7", "op": "mark", "name": "copy", "sel": "#teach-copy"},
        {"at": "@taught+0.7", "op": "mark", "name": "picks", "sel": "#duel-count"},
        {"at": "@taught+0.8", "op": "log", "name": "state", "js": STATE_JS},
    ],
})

# --- 04 what a pick does: three quick duels, each heard; the sixth pick since
# the last fit redraws the taste. Three picks off camera, then a skip once the
# forecast's hold is over, so the forecast line starts clear.
SKIP_CLEAR = [{"op": "wait", "ms": 3500}, DEALT, {"op": "click", "sel": "#skip-duel"}, {"op": "wait", "ms": 400}, DEALT]
shots.append({
    "id": "ve-meter", "beat": "meter", "pre": PRE,
    "setup": ready(votes(3) + SKIP_CLEAR),
    "marks": M("meter", "pips", "copy", "pred", "lamp", "cardA", "cardB", "picks"),
    "actions": [
        state(B(0.2)),
        *quick(B(0.0), B(0.8), "meter1:dot", "d1"),
        *quick("meter2", "meter2+0.8", "meter2:away", "d2"),
        {"at": "meter2:away+0.5", "op": "mark", "name": "pred", "sel": "#duel-pred"},
        *quick("meter3:picked", "meter3:picked+0.8", "meter4:sixth+0.2", "d3"),
        {"at": "meter4:sixth+0.5", "op": "until", "js": "document.getElementById('duel-mid').classList.contains('learning')", "ms": 5000, "stamp": "learned"},
        {"at": "meter4:sixth+0.7", "op": "mark", "name": "copy", "sel": "#teach-copy"},
        state("meter4:told"),
        {"at": "meter4:told+0.5", "op": "key", "key": "1", "ms": 100},
    ],
})

# --- 05 fair questions: every pair is dealt at random, so every pick is a
# fair test of the forecast; skip, when you can't choose.
shots.append({
    "id": "ve-fair", "beat": "fair", "pre": PRE,
    "setup": ready(votes(4) + SKIP_CLEAR),
    "marks": M("meter", "pred", "rule", "skip", "cardA", "cardB", "nameA", "nameB", "chooseA", "chooseB", skill="#skill", taste=".viewtab[data-view='taste']"),
    "actions": [
        state(B(0.2)),
        {"at": B(0.3), "op": "log", "name": "rule", "js": "document.getElementById('duel-rule').textContent + ' | ' + document.getElementById('duel-rule').title"},
        # Heard, then picked: the forecast is scored against the answer.
        {"at": "fair2+0.2", "op": "key", "key": "1", "ms": 100},
        {"at": "fair2+2.4", "op": "key", "key": "2", "ms": 100},
        {"at": "fair3:pick", "op": "eval", "js": PICK_JS},
        {"at": "fair3:pick+0.5", "op": "mark", "name": "forecast", "sel": "#duel-pred"},
        state("fair3:pick+0.6"),
        {"at": "fair5:skip", "op": "seq", "steps": [{"op": "click", "sel": "#skip-duel"}, BLUR]},
        {"at": "fair5:skip+0.5", "op": "mark", "name": "pair2", "sel": "#name-a"},
        state("fair5:skip+0.6"),
        {"at": "fair5:recorded+0.4", "op": "key", "key": "1", "ms": 100},
    ],
})

# --- 06 a generation: EVOLVE POOL, a cut over the wait to the children; hear one.
shots.append({
    "id": "ve-breed", "beat": "breed", "pre": PRE,
    "setup": ready(votes(9) + [TOURED]),
    "marks": M("meter", "evolve", "lineage", "rail", "cardA", "cardB"),
    "clips": [["breed3", "@bred-0.4"]],
    "actions": [
        state(B(0.2)),
        {"at": "breed1:press", "op": "click", "sel": "#evolve-btn"},
        {"at": "breed1:press+0.3", "op": "until", "sel": "#evolve-btn:not([disabled])", "ms": 900000, "stamp": "bred"},
        {"at": "breed1:press+0.6", "op": "mark", "name": "evolve", "sel": "#evolve-btn"},
        {"at": "@bred+0.2", "op": "mark", "name": "fresh", "sel": "#bank-list .bank-item.fresh"},
        {"at": "@bred+0.2", "op": "mark", "name": "lineage", "sel": "#lineage-log"},
        {"at": "@bred+0.2", "op": "mark", "name": "line1", "sel": "#lineage-log > div"},
        {"at": "@bred+0.3", "op": "log", "name": "lineage", "js": "document.getElementById('lineage-log').innerText"},
        {"at": "@bred+0.3", "op": "log", "name": "fresh", "js": FRESH_JS},
        {"at": "breed4:room", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
        {"at": "breed4:room", "op": "log", "name": "toast", "js": TOASTS_JS},
        {"at": "breed7:listen", "op": "click", "sel": "#bank-list .bank-item.fresh .bi-hear"},
        state("breed7:listen+0.3"),
    ],
})

# --- 07 stars, save and cut, on the bank's rows.
ROW = "#bank-list .bank-item:not(.saved) >> nth=0"
# The row to cut: the first one neither saved nor just rated (the cursor).
ROW2 = "#bank-list .bank-item:not(.saved):not(.kbd) >> nth=0"
shots.append({
    "id": "ve-keep", "beat": "keep", "pre": PRE,
    "setup": ready(votes(2)),
    "marks": {**M("rail", "meter"), "row": ROW, "stars": f"{ROW} >> .stars", "save": f"{ROW} >> .bi-save", "hear": f"{ROW} >> .bi-hear", "budget": "#pin-budget", "chips": ".bank-filters"},
    "actions": [
        {"at": B(0.2), "op": "log", "name": "rows", "js": "[...document.querySelectorAll('#bank-list .bank-item')].slice(0, 6).map((e) => e.querySelector('.bi-name').textContent + (e.classList.contains('saved') ? ' (saved)' : '')).join(', ')"},
        {"at": "keep1:three", "op": "click", "sel": f"{ROW} >> .bi-hear"},
        {"at": "keep2:teach", "op": "click", "sel": f"{ROW} >> .star[data-s='4']"},
        {"at": "keep2:teach+0.3", "op": "mark", "name": "rated", "sel": "#bank-list .bank-item.kbd"},
        {"at": "keep2:teach+0.4", "op": "mark", "name": "toast1", "sel": "#toasts .toast"},
        {"at": "keep3:keeps", "op": "click", "sel": "#bank-list .bank-item.kbd .bi-save"},
        {"at": "keep3:keeps+0.5", "op": "mark", "name": "saved", "sel": "#bank-list .bank-item.kbd"},
        {"at": "keep3:nothing", "op": "mark", "name": "toast2", "sel": "#toasts .toast"},
        {"at": "keep3:nothing", "op": "mark", "name": "budget", "sel": "#pin-budget"},
        # The cut control shows on approach (hover), as it does for a hand.
        {"at": "keep4:Cut", "op": "seq", "steps": [
            {"op": "mark", "name": "cutrow", "sel": ROW2},
            {"op": "move", "sel": ROW2, "ox": 40, "ms": 300},
            {"op": "wait", "ms": 150},
            {"op": "click", "sel": f"{ROW2} >> .bi-kill"},
        ]},
        {"at": "keep4:back", "op": "mark", "name": "toast3", "sel": "#toasts .toast"},
        {"at": "keep4:back", "op": "log", "name": "toasts", "js": TOASTS_JS},
        # The sound that was saved, once more, as the chapter closes.
        {"at": "keep5:pool+0.4", "op": "click", "sel": "#bank-list .bank-item.kbd .bi-hear"},
    ],
})

# --- 08 a working rhythm: quick duels, EVOLVE POOL (a cut over the wait), a
# new child opened from the bank and played in PATCH, saved; back to a pick.
shots.append({
    "id": "ve-rhythm", "beat": "rhythm", "pre": PRE,
    "setup": ready(votes(3) + [TOURED]),
    "marks": M("meter", "pips", "copy", "evolve", "cardA", "cardB", "rail", label="#live-label"),
    "clips": [["rhythm4", "@bred-0.3"]],
    "actions": [
        *quick(B(0.0), B(0.7), B(1.4), "q1"),
        *quick("rhythm2", "rhythm2+0.7", "rhythm2+1.4", "q2"),
        *quick("rhythm2+2.3", "rhythm2+3.0", "rhythm2+3.7", "q3"),
        *quick("rhythm2+4.6", "rhythm2+5.3", "rhythm2+6.0", "q4"),
        {"at": "rhythm3:Evolve", "op": "click", "sel": "#evolve-btn"},
        {"at": "rhythm3:Evolve+0.3", "op": "until", "sel": "#evolve-btn:not([disabled])", "ms": 900000, "stamp": "bred"},
        {"at": "@bred+0.3", "op": "log", "name": "after", "js": STATE_JS},
        {"at": "@bred+0.3", "op": "log", "name": "fresh", "js": FRESH_JS},
        {"at": "rhythm4:Play", "op": "seq", "steps": [
            {"op": "eval", "js": "window.__veChild = document.querySelector('#bank-list .bank-item.fresh .bi-name').textContent.trim()"},
            {"op": "click", "sel": "#bank-list .bank-item.fresh >> nth=0 >> .bi-name"},
            {"op": "until", "js": "(document.getElementById('rack-subject')?.textContent || '').includes(window.__veChild)", "ms": 60000, "stamp": "child"},
            {"op": "mark", "name": "child", "sel": "#rack-subject"},
            {"op": "mark", "name": "row", "sel": "#bank-list .bank-item.live"},
            {"op": "log", "name": "child", "js": "window.__veChild + ' | live row ' + (document.querySelector('#bank-list .bank-item.live .bi-name')?.textContent || 'none')"},
        ]},
        *chords("rhythm4:children+0.3"),
        {"at": "rhythm4:children+6.1", "op": "seq", "steps": [
            {"op": "until", "js": "(document.querySelector('#bank-list .bank-item.live .bi-name')?.textContent || '').trim() === window.__veChild", "ms": 20000},
            {"op": "click", "sel": "#bank-list .bank-item.live .bi-save"},
            {"op": "wait", "ms": 400},
            {"op": "mark", "name": "row", "sel": "#bank-list .bank-item.live"},
            {"op": "mark", "name": "toast", "sel": "#toasts .toast"},
        ]},
        {"at": "rhythm5:back", "op": "view", "v": "evolve"},
        {"at": "rhythm5:back+0.3", "op": "eval", "js": BLUR["js"]},
        {"at": "rhythm5:round", "op": "eval", "js": PICK_JS},
        state("rhythm5:round+0.4"),
    ],
})

# --- outro: next, TASTE.
shots.append({
    "id": "ve-outro", "beat": "outro", "pre": 0.5,
    "setup": ready(votes(1)),
    "marks": {**M("meter", "cardA", "cardB"), "taste": ".viewtab[data-view='taste']", "tabs": ".viewtabs"},
    "actions": [
        state(0.7),
        {"at": "outro1:TASTE", "op": "move", "sel": ".viewtab[data-view='taste']", "ms": 700},
    ],
})

dump({"viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT, "setup": TAUGHT, "shots": shots}, OUT)
print(f"{os.path.relpath(OUT)}: {len(shots)} shots")
