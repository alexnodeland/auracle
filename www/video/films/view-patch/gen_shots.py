#!/usr/bin/env python3
"""shots.json for PATCH: inside the sound, from its timeline.

usage (from the repo root): python3 www/video/films/view-patch/gen_shots.py

Chords are laid on the score's bar lines from timeline.json and pinned to the
narration's words, so they stay on the bar lines through a shot's cuts and a
re-timed voice re-times the playing: run this after every timeline.py (or
align_tails.py). Writes www/video/films/view-patch/shots.json.
"""
import json
import math
import os
import re
import sys

FDIR = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(os.path.dirname(FDIR))
sys.path.insert(0, os.path.join(VIDEO, "tools"))
sys.dont_write_bytecode = True  # no __pycache__ beside the tools
from shotgen import INIT, QUIET, taught, dump  # noqa: E402  (the team's shared pieces)

tl = json.load(open(f"{FDIR}/timeline.json"))
BEAT = {b["id"]: b for b in tl["beats"]}
BAR = 60 / tl["grid"]["bpm"] * tl["grid"]["meter"]
PRE = 3.4  # a chapter's shot starts a bar before its beat: its card (cards.js) shows the rack at rest

SETTLED = "!/re-measuring/.test(document.getElementById('belief').textContent) && !document.getElementById('wm-lamp').classList.contains('thinking')"
SUBJ = "document.getElementById('rack-subject').textContent"

# The film's session: taught by the warm start (its first, fifth and eighth
# cards), so the model's guess, the spec card's belief and ⚡ all have a fit.
# The deal is logged, so a rehearsal shows which cards were picked.
SETUP = taught(picks=(0, 4, 7))
SETUP.insert(2, {"op": "log", "name": "deal", "js": "[...document.querySelectorAll('.warm-item .wi-name')].map(x => x.textContent).join(' | ')"})


def bench(name, *extra):
    """Open a preset on the bench in PATCH, settled, with the first-visit aids
    put away (the bench tour's banner, and the keybed's hint, which one note
    dismisses): the tour film covers those."""
    return [
        {"op": "preset", "name": name},
        {"op": "view", "v": "play"},
        {"op": "until", "sel": "#belief .bl-u", "ms": 90000},
        {"op": "until", "js": SETTLED, "ms": 180000},
        {"op": "wait", "ms": 800},
        {"op": "eval", "js": "const b = document.getElementById('bt-close'); if (b && b.offsetParent) b.click();"},
        {"op": "key", "key": "a", "ms": 60},
        {"op": "wait", "ms": 1200},
        *extra,
        {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
        {"op": "until", "js": SETTLED, "ms": 180000},
        QUIET,
        {"op": "log", "name": "rack", "js": "[...document.querySelectorAll('#rack-svg g.mod-group')].map(g => g.dataset.key + ':' + g.dataset.kind).join(' ') + ' || ' + document.getElementById('belief').textContent"},
    ]


TEMPO = {"op": "eval", "js": "const b = document.getElementById('bpm'); b.value = '84'; b.dispatchEvent(new Event('change'))"}

C, AM, F, G = ["a", "d", "g"], ["h", "k", ";"], ["f", "h", "k"], ["g", "j", "l"]
PROG = [C, AM, F, G]


def ftime(spec, beat_id):
    """Film time of a narration spec, as footage.mjs's filmTime resolves it."""
    if isinstance(spec, (int, float)):
        return BEAT[beat_id]["t0"] + spec
    m = re.search(r"([+-]\d+(?:\.\d+)?)$", spec)
    if m:
        return ftime(spec[: m.start()], beat_id) + float(m.group(1))
    lid, _, word = spec.partition(":")
    line = next(l for l in tl["lines"] if l["id"] == lid)
    if not word:
        return line["t0"]
    words = line["text"].split()
    k = next(i for i, w in enumerate(words) if re.sub(r"[^\w']", "", w.lower()).startswith(word.lower()))
    if line.get("words"):
        return line["words"][k]
    return line["t0"] + (line["t1"] - line["t0"]) * len(" ".join(words[:k])) / len(line["text"])


def run(beat_id, frm, to, prog=None, pre=PRE, tail_end=False, gap=0.11):
    """Chords on every bar line from film time `frm` (a spec, snapped on to the
    next bar) up to `to` (a spec; the last chord releases before it), one per
    bar through `prog`; `tail_end` holds the last one to the shot's end."""
    prog = prog or PROG
    b = BEAT[beat_id]
    origin = b["t0"] - pre
    t_from = ftime(frm, beat_id)
    t_to = ftime(to, beat_id) if to is not None else b["t1"]
    g0 = tl["grid"].get("t0", 0.0)
    k = math.ceil((t_from - g0) / BAR - 1e-3)
    out = []
    bars = []
    while g0 + k * BAR < t_to - 0.5:
        bars.append(g0 + k * BAR)
        k += 1
    # A chord asked for mid-bar comes in on the beat, not a bar later.
    spb = BAR / tl["grid"]["meter"]
    tb = g0 + math.ceil((t_from - g0) / spb - 1e-3) * spb
    if bars and bars[0] - tb > 0.9:
        bars.insert(0, tb)
    anchor = next(l for l in tl["lines"] if l["beat"] == beat_id)
    for i, t in enumerate(bars):
        on_bar = abs(((t - g0) / BAR) - round((t - g0) / BAR)) < 1e-3
        a = {"at": f"{anchor['id']}{t - anchor['t0'] - 0.05:+.3f}", "snap": "bar" if on_bar else "beat", "op": "hold", "keys": prog[i % len(prog)]}
        nxt = bars[i + 1] if i + 1 < len(bars) else t + BAR
        end = min(nxt - gap, t_to - 0.05)
        if tail_end and i == len(bars) - 1:
            a["ms"] = "end"
        else:
            a["ms"] = int(round((end - t) * 1000))
        out.append(a)
    return out


# A knob's box, as footage.mjs measures it (label, dial and value), in px: a
# path's points are fractions of the box.
KNOB_H = {"Acid Line": 116.7, "Glass Pad": 86.9}


def sweep(sel, h, moves, ms):
    """One press on a knob, moved by each of `moves` in turn (px; negative is
    up), then let go: a turn one way and back as a hand makes it, and one
    edit on release."""
    pts = [[0.5, 0.5]]
    y = 0.0
    for d in moves:
        y += d
        pts.append([0.5, round(0.5 + y / h, 4)])
    return {"op": "path", "sel": sel, "points": pts, "ms": ms}


def mark(name, sel):
    return {"op": "mark", "name": name, "sel": sel}


def log(name, js):
    return {"op": "log", "name": name, "js": js}


def val(addr):
    """A knob's value as it reads (its aria-valuetext)."""
    return f"document.querySelector(\"#rack-svg [data-addr='{addr}']\")?.getAttribute('aria-valuetext')"


RACK_LOG = log("rack", "[...document.querySelectorAll('#rack-svg g.mod-group')].map(g => g.dataset.key + ':' + g.dataset.kind).join(' ')")
KNOBS_LOG = log("knobs", "[...document.querySelectorAll('#rack-svg [data-addr]')].map(k => k.dataset.addr + '=' + (k.getAttribute('aria-valuetext') || '')).join(' | ')")

shots = []

# ---- cold: an acid line at 84, its filter swept on the rack --------------
# The title borrows this shot (film.js), so it runs on to the title's end.
shots.append({
    "id": "vp-cold", "beat": "cold", "pre": 0.5,
    "dur": round(BEAT["title"]["t1"] - BEAT["cold"]["t0"] + 0.5 + 0.8, 3),
    "setup": bench("Acid Line",
        TEMPO,
        {"op": "click", "sel": "#hold-btn"},
        {"op": "click", "sel": "#arp-btn"},
        {"op": "select", "sel": "#arp-div", "value": 4},
        {"op": "select", "sel": "#arp-mode", "value": 2},
        {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
        {"op": "click", "sel": "#belief"},  # a pointerdown outside folds the arp drawer
        {"op": "wait", "ms": 600},
        KNOBS_LOG,
    ),
    "marks": {"rack": "#rack-scroll", "vco": "#rack-svg g.mod-group[data-key='node/0']", "filter": "#rack-svg g.mod-group[data-key='node']",
              "env": "#rack-svg g.mod-group[data-key='node/m']", "amp": "#rack-svg g.mod-group[data-key='amp']",
              "cut": "#rack-svg [data-addr='node#cut']", "res": "#rack-svg [data-addr='node#res']"},
    "actions": [
        # Fmaj7 latched: the bed's first chord, so the title lands on it.
        {"at": 0.9, "snap": "beat", "op": "hold", "keys": ["f", "h", "k", ";"], "ms": 260},
        # Up over 3 s, then back down over 3 s, in one press.
        {"at": 2.6, **sweep("#rack-svg [data-addr='node#cut']", KNOB_H["Acid Line"], [-64, 50], 6000)},
        {"at": 9.5, "op": "log", "name": "cut", "js": val("node#cut")},
        # Unlatched on the title's downbeat, where the bed comes in.
        {"at": 10.9, "snap": "bar", "op": "click", "sel": "#hold-btn"},
    ],
})

# ---- read: the circuit, heard as chords ----------------------------------
shots.append({
    "id": "vp-read", "beat": "read", "pre": PRE,
    "setup": bench("Glass Pad"),
    "marks": {"rack": "#rack-scroll", "saw": "#rack-svg g.mod-group[data-key='node/0/0']", "filter": "#rack-svg g.mod-group[data-key='node/0']",
              "chorus": "#rack-svg g.mod-group[data-key='node']", "amp": "#rack-svg g.mod-group[data-key='amp']", "lfo": "#rack-svg g.mod-group[data-key='node/0/m']",
              "wire": "#rack-svg path.wire.audio[data-from='node/0/0']", "wire2": "#rack-svg path.wire.audio[data-from='node/0']",
              "modwire": "#rack-svg path.wire.mod", "tab": "#rack-svg .jack[data-modkey='node/0']",
              "cut": "#rack-svg [data-addr='node/0#cut']", "release": "#rack-svg [data-addr='amp#release']", "sustain": "#rack-svg [data-addr='amp#sustain']",
              "lforate": "#rack-svg [data-addr='node/0/m#rate']"},
    "actions": run("read", 0, None, tail_end=True),
})

# ---- hear: the standard sample, then playing it; the guess; the card -------
H = BEAT["hear"]
shots.append({
    "id": "vp-hear", "beat": "hear", "pre": PRE,
    "setup": bench("Glass Pad"),
    "marks": {"play": "#rack-play", "subject": "#rack-subject", "belief": "#belief", "chip": ".nb-chip[data-kind='chorus']", "dock": "#spec-dock"},
    "actions": [
        {"at": "hear1:patch+0.35", "op": "click", "sel": "#rack-play"},
        {"at": "hear1:patch+0.6", "op": "log", "name": "sample", "js": "document.getElementById('rack-play').className"},
        # "To judge a sound, play it": chords from there to the end.
        *run("hear", "hear2:play-0.3", None, tail_end=True),
        {"at": "hear4:Point-0.2", "op": "move", "sel": ".nb-chip[data-kind='chorus']", "ms": 500},
        {"at": "hear4:Point+0.7", "op": "seq", "steps": [
            mark("card", "#spec-dock"), mark("blurb", "#spec-dock .sp-blurb"), mark("heard", "#spec-dock .sp-heard"),
            mark("model", "#spec-dock .sd-model"), mark("params", "#spec-dock .sp-params"),
            log("heard", "document.querySelector('#spec-dock .sp-heard')?.textContent"),
            log("belief", "document.getElementById('belief').textContent"),
        ]},
    ],
})

# ---- change: a knob, a bypass, a pulled cable, ⌘Z ------------------------
# A bypass or an unplug is refused while another structural edit is in flight,
# and every edit re-renders the phrase on the one engine thread, which on a busy
# machine takes seconds. So each step first waits (stamped) until the step
# before it has landed and the engine has settled, and the beat cuts through
# that wait (`clips`); the chords are pinned to film time, so they stay on the
# bar lines through the cuts. On a quiet machine the waits are short and the
# cuts skip nothing.
TRAY_N = "document.querySelectorAll('#tray-items .tray-item').length"
shots.append({
    "id": "vp-change", "beat": "change", "pre": PRE,
    "clips": [["change2-0.6", "@ready2-0.2"], ["change3-1.1", "@ready3-0.2"], ["change4-0.6", "@ready4-0.2"]],
    "setup": bench("Glass Pad"),
    "marks": {"rack": "#rack-scroll", "cut": "#rack-svg [data-addr='node/0#cut']", "chorus": "#rack-svg g.mod-group[data-key='node']",
              "menu": "#rack-svg g.mod-group[data-key='node'] .mod-menu-btn", "filter": "#rack-svg g.mod-group[data-key='node/0']"},
    "actions": [
        *run("change", 0, None, tail_end=True),
        {"at": "change1:knob", **sweep("#rack-svg [data-addr='node/0#cut']", KNOB_H["Glass Pad"], [45, -75], 3000)},
        # The bypass, once the knob's edits have landed.
        {"at": "change1:hand+0.2", "op": "seq", "steps": [
            {"op": "wait", "ms": 1500},
            {"op": "until", "js": SETTLED, "ms": 90000, "stamp": "ready2"},
            log("cut", val("node/0#cut")),
        ]},
        {"at": "change2-0.4", "op": "seq", "steps": [
            {"op": "click", "sel": "#rack-svg g.mod-group[data-key='node'] .mod-menu-btn"},
            {"op": "until", "sel": "#ctx-menu .cm-item", "ms": 5000},
            mark("ctx", "#ctx-menu"),
            {"op": "wait", "ms": 350},
            {"op": "click", "sel": "#ctx-menu .cm-item:has-text('bypass')"},
            {"op": "until", "js": TRAY_N + " === 1 && !document.querySelector(\"#rack-svg g.mod-group[data-kind='chorus']\")", "ms": 60000, "stamp": "bypassed"},
            {"op": "wait", "ms": 300},
            mark("tray", "#tray"), mark("held1", "#tray-items .tray-item"),
            mark("filter2", "#rack-svg g.mod-group[data-key='node']"),
            mark("jack", "#rack-svg .jack[data-childkey='node/0']"),
            RACK_LOG,
            {"op": "until", "js": SETTLED, "ms": 90000, "stamp": "ready3"},
        ]},
        # The cable pulled, once the bypass has landed.
        {"at": "change3-0.9", "op": "seq", "steps": [
            {"op": "drag", "sel": "#rack-svg .jack[data-childkey='node/0'] circle:last-of-type", "dx": -40, "dy": 170, "ms": 800},
            {"op": "until", "js": TRAY_N + " === 2", "ms": 60000, "stamp": "pulled"},
            {"op": "wait", "ms": 300},
            mark("held2", "#tray-items .tray-item >> nth=1"), mark("tray2", "#tray"), mark("hole", "#rack-svg g.mod-group[data-key='node/0']"),
            RACK_LOG,
            log("toast", "document.getElementById('toasts').innerText"),
            {"op": "until", "js": SETTLED, "ms": 90000, "stamp": "ready4"},
        ]},
        # ⌘Z, once the unplug has landed (pressed while an edit is still
        # queued, an undo is overtaken by it).
        {"at": "change4-0.4", "op": "seq", "steps": [
            {"op": "hold", "keys": ["Control", "z"], "ms": 150},
            {"op": "until", "js": TRAY_N + " === 1", "ms": 60000, "stamp": "undone"},
            {"op": "wait", "ms": 300},
            mark("saw2", "#rack-svg g.mod-group[data-kind='supersaw']"),
            RACK_LOG,
        ]},
        {"at": "change4:back+1.2", "op": "log", "name": "after", "js": "document.getElementById('toasts').innerText + ' || held ' + " + TRAY_N},
    ],
})

# ---- add: arm, green sockets, preview, place; amber for a source ---------
A = BEAT["add"]
shots.append({
    "id": "vp-add", "beat": "add", "pre": PRE,
    "setup": bench("Glass Pad",
        log("scrollers", "[...document.querySelectorAll('#nodebank *')].filter(e => e.scrollHeight > e.clientHeight + 20 && getComputedStyle(e).overflowY !== 'visible').map(e => (e.id || e.className) + ':' + e.scrollHeight + '/' + e.clientHeight).join(' | ')"),
    ),
    "marks": {"bank": "#nodebank", "count": "#nb-count", "groups": "#nb-groups", "rack": "#rack-scroll",
              "delay": ".nb-item[data-kind='delay']", "formant": ".nb-item[data-kind='formant']",
              "green": "#rack-svg .jack[data-childkey='node/0']", "filter": "#rack-svg g.mod-group[data-key='node/0']"},
    "actions": [
        # Chords until the preview, which plays alone; again once it is placed.
        *run("add", 0, "add3:Rest-0.1"),
        *run("add", "add4:in+0.3", None, prog=[AM, F, G, C], tail_end=True),
        {"at": "add2:Click", "op": "seq", "steps": [
            {"op": "click", "sel": ".nb-item[data-kind='delay']"},
            {"op": "wait", "ms": 300},
            mark("delay", ".nb-item[data-kind='delay']"), mark("status", "#nb-status"), mark("lit", "#rack-svg .jack.legal"),
        ]},
        {"at": "add2:says-0.3", "op": "seq", "steps": [
            {"op": "move", "sel": "#rack-svg .jack[data-childkey='node/0'] circle:last-of-type", "ms": 450},
            {"op": "wait", "ms": 250},
            mark("status", "#nb-status"),
            log("green", "document.getElementById('nb-status').textContent"),
        ]},
        {"at": "add3:changes+0.35", "op": "seq", "steps": [
            mark("pv", "#pv-play"),
            {"op": "eval", "js": "document.getElementById('pv-play').click()"},
            {"op": "wait", "ms": 600},
            log("pv", "document.querySelector('#spec-dock .pv-label')?.textContent + ' | ' + document.getElementById('pv-play').className"),
        ]},
        {"at": "add4:Click-0.1", "op": "seq", "steps": [
            {"op": "click", "sel": "#rack-svg .jack[data-childkey='node/0'] circle:last-of-type"},
            {"op": "until", "sel": "#rack-svg g.mod-group[data-kind='delay']", "ms": 30000, "stamp": "placed"},
            {"op": "wait", "ms": 300},
            mark("placed", "#rack-svg g.mod-group[data-kind='delay']"),
            mark("toast", "#toasts .toast"),
            RACK_LOG,
        ]},
        {"at": "add5:source-0.4", "op": "seq", "steps": [
            {"op": "click", "sel": ".nb-item[data-kind='formant']"},
            {"op": "wait", "ms": 250},
            {"op": "move", "sel": "#rack-svg .jack[data-childkey='node/0/0/0'] circle:last-of-type", "ms": 450},
            {"op": "wait", "ms": 250},
            mark("amber", "#rack-svg .jack[data-childkey='node/0/0/0']"),
            mark("formant", ".nb-item[data-kind='formant']"),
            mark("status2", "#nb-status"),
            log("amber", "document.getElementById('nb-status').textContent + ' | ' + document.querySelector(\"#rack-svg .jack[data-childkey='node/0/0/0']\")?.getAttribute('class')"),
        ]},
        {"at": "add5:there+0.7", "op": "key", "key": "Escape", "ms": 80},
    ],
})

# ---- move: a chain of modulators playing a melody; a wrap ----------------
shots.append({
    "id": "vp-move", "beat": "move", "pre": PRE,
    "setup": bench("Ask The Dice", KNOBS_LOG),
    "marks": {"rack": "#rack-scroll", "rand": "#rack-svg g.mod-group[data-kind='rand']", "quantize": "#rack-svg g.mod-group[data-kind='quantize']",
              "slew": "#rack-svg g.mod-group[data-kind='slew']", "vco": "#rack-svg g.mod-group[data-kind='vco']",
              "filter": "#rack-svg g.mod-group[data-key='node']", "modenv": "#rack-svg g.mod-group[data-key='node/m']",
              "slot": "#rack-svg .jack[data-modkey='node']", "pitch": "#rack-svg .jack[data-modkey='node/0']", "key": ".pkey[data-note='60']"},
    "actions": [
        {"at": PRE - 0.08, "snap": "bar", "op": "hold", "keys": ["a"], "ms": "end"},
        {"at": "move4:Drop", "op": "seq", "steps": [
            {"op": "click", "sel": ".nb-item[data-kind='slew']"},
            {"op": "wait", "ms": 250},
            mark("slewitem", ".nb-item[data-kind='slew']"),
            {"op": "wait", "until": "move4:busy-0.3"},
            {"op": "move", "sel": "#rack-svg .jack[data-modkey='node'] circle:last-of-type", "ms": 450},
            {"op": "wait", "ms": 250},
            mark("status", "#nb-status"),
            log("slot", "document.getElementById('nb-status').textContent"),
            {"op": "wait", "until": "move4:wraps-0.4"},
            {"op": "click", "sel": "#rack-svg .jack[data-modkey='node'] circle:last-of-type"},
            {"op": "until", "js": "document.querySelectorAll(\"#rack-svg g.mod-group[data-kind='slew']\").length >= 2", "ms": 30000, "stamp": "wrapped"},
            {"op": "wait", "ms": 300},
            mark("wrapped", "#rack-svg g.mod-group[data-key='node/m']"),
            mark("chain", "#rack-svg g.mod-group[data-key='node/m/0']"),
            RACK_LOG,
        ]},
    ],
})

# ---- steps: Loom's filter walks a pattern; draw it; sync it to 84 --------
shots.append({
    "id": "vp-steps", "beat": "steps", "pre": PRE,
    "setup": bench("Loom", TEMPO, {"op": "click", "sel": "#hold-btn"}, KNOBS_LOG),
    "marks": {"rack": "#rack-scroll", "steps": "#rack-svg g.mod-group[data-kind='steps']", "filter": "#rack-svg g.mod-group[data-key='node/0']",
              "s1": "#rack-svg [data-addr='node/0/m#s1']", "s3": "#rack-svg [data-addr='node/0/m#s3']", "len": "#rack-svg [data-addr='node/0/m#slen']",
              "rate": "#rack-svg [data-addr='node/0/m#srate']", "sync": "#sync-btn", "modwire": "#rack-svg path.wire.mod"},
    "actions": [
        # Am, latched by HOLD on the downbeat.
        {"at": PRE - 0.08, "snap": "bar", "op": "hold", "keys": AM, "ms": 260},
        # Two bars, back to back. A bar is set where it is pressed and dragged to
        # (its middle is no push, 31 px either way the most), so ±22 px
        # redraws the second step from +70% to about −70% and the third from
        # −10% to about +70%.
        {"at": "steps2:Draw-0.15", "op": "seq", "steps": [
            {"op": "drag", "sel": "#rack-svg [data-addr='node/0/m#s1']", "dy": 22, "ms": 450},
            {"op": "wait", "ms": 200},
            {"op": "drag", "sel": "#rack-svg [data-addr='node/0/m#s2']", "dy": -22, "ms": 450},
            {"op": "wait", "ms": 200},
            mark("lane", "#rack-svg g.mod-group[data-kind='steps']"),
            {"op": "until", "js": SETTLED, "ms": 60000, "stamp": "s2"},
            KNOBS_LOG,
        ]},
        # HOLD off (the latched chord stops), SYNC on, and the chord struck
        # again on the next bar line, where the pattern restarts at 84.
        {"at": "steps3:Sync-0.1", "op": "click", "sel": "#hold-btn"},
        {"at": "steps3:Sync", "op": "click", "sel": "#sync-btn"},
        {"at": "steps3:Sync+0.5", "op": "seq", "steps": [mark("bpm", "#arp-chip"), mark("rate2", "#rack-svg [data-addr='node/0/m#srate']"),
                                                          log("synced", "document.querySelector(\"#rack-svg [data-addr='node/0/m#srate']\").getAttribute('aria-valuetext') + ' | chip ' + document.getElementById('arp-chip').textContent")]},
        {"at": "steps3:Sync+0.2", "snap": "bar", "op": "hold", "keys": AM, "ms": "end"},
    ],
})

# ---- lock: a knob's dot, a module's square, ⚡; cut to the child -----------
# ⚡'s walk runs on the render farm, beside the player (about 20 s): the
# button reads "⚡ evolving…", the menu bar's job slot "⚡ evolving Glass Pad"
# (with stop, on the farm) and the rack stays live, so the chords play on
# through "Only what you left unlocked can change"; the beat cuts on "and"
# to the moment the child is on the bench.
LOCK_CUT = "lock3:and-0.3"
shots.append({
    "id": "vp-lock", "beat": "lock", "pre": PRE,
    "clips": [[LOCK_CUT, "@benched-0.6"]],
    # This session's first ⚡ from Glass Pad with these locks finds nothing
    # ("⚡ evolution's proposal did not survive the vet or beat its parent —
    # try again", three rehearsals of 29 September in a row): each ⚡ is one
    # draw of the engine's refine stream, and that draw is a miss. So the
    # set-up spends it off camera, with the same locks, then clears them, and
    # the ⚡ on camera is the session's second, which lands a child.
    "setup": bench("Glass Pad",
        {"op": "click", "sel": "#rack-svg [data-addr='node/0#cut'] .lock-dot"},
        {"op": "click", "sel": "#rack-svg g.mod-group[data-key='node'] .mod-lock"},
        {"op": "wait", "ms": 300},
        {"op": "click", "sel": "#rack-evolve"},
        {"op": "until", "sel": "#rack-evolve.evolving", "state": "attached", "ms": 10000},
        {"op": "until", "sel": "#rack-evolve:not(.evolving)", "state": "attached", "ms": 300000},
        log("first ⚡", "document.getElementById('toasts').innerText + ' | ' + " + SUBJ),
        {"op": "click", "sel": "#lock-clear"},
        {"op": "wait", "ms": 400},
    ),
    "marks": {"rack": "#rack-scroll", "cut": "#rack-svg [data-addr='node/0#cut']", "chorus": "#rack-svg g.mod-group[data-key='node']",
              "square": "#rack-svg g.mod-group[data-key='node'] .mod-lock", "evolve": "#rack-evolve", "subject": "#rack-subject"},
    "actions": [
        *run("lock", 0, LOCK_CUT + "-0.05", prog=[AM, F, C, G]),
        {"at": "lock1:dot-0.7", "op": "seq", "steps": [
            {"op": "move", "sel": "#rack-svg [data-addr='node/0#cut']", "ms": 450},
            {"op": "wait", "until": "lock1:dot-0.05"},
            {"op": "click", "sel": "#rack-svg [data-addr='node/0#cut'] .lock-dot"},
            {"op": "wait", "ms": 200},
            mark("dot", "#rack-svg [data-addr='node/0#cut'] .lock-dot"),
        ]},
        {"at": "lock1:square-0.6", "op": "seq", "steps": [
            {"op": "move", "sel": "#rack-svg g.mod-group[data-key='node'] .mod-lock", "ms": 450},
            {"op": "click", "sel": "#rack-svg g.mod-group[data-key='node'] .mod-lock"},
            {"op": "wait", "ms": 200},
            mark("square", "#rack-svg g.mod-group[data-key='node'] .mod-lock"),
            log("locks", "document.querySelectorAll('#rack-svg .locked, #rack-svg .lock-dot.on').length + ' locked marks'"),
        ]},
        {"at": "lock2:Evolve-0.5", "op": "move", "sel": "#rack-evolve", "ms": 400},
        {"at": "lock2:Evolve-0.1", "op": "eval", "js": "window.__subject = " + SUBJ},
        {"at": "lock2:Evolve", "op": "click", "sel": "#rack-evolve"},
        {"at": "lock2:Evolve+0.2", "op": "until", "js": SUBJ + " !== window.__subject", "ms": 300000, "stamp": "benched"},
        # The job slot, once the walk is out (on the farm it says so, and
        # offers stop).
        {"at": "lock2:Evolve+0.3", "op": "seq", "steps": [
            {"op": "until", "sel": "#job-slot:not(.hidden)", "ms": 10000, "stamp": "slot"},
            {"op": "wait", "ms": 500},
            mark("slot", "#job-slot"),
            log("slot", "document.getElementById('job-text').textContent + ' | stop ' + (document.getElementById('job-stop').classList.contains('hidden') ? 'hidden' : 'shown')"
                + " + ' | button ' + document.getElementById('rack-evolve').textContent + ' | lamp ' + document.getElementById('wm-lamp').classList.contains('thinking')"),
        ]},
        # On the child, from the cut.
        *run("lock", "lock3:and+0.05", None, prog=[AM, F, C], tail_end=True),
        {"at": "lock3:new+0.1", "op": "seq", "steps": [
            mark("subject", "#rack-subject"), mark("chorus2", "#rack-svg g.mod-group[data-kind='chorus']"), mark("toast", "#toasts .toast"),
            mark("source", "#rack-svg g.mod-group[data-key='node/0/0']"),
            log("child", SUBJ + " + ' | ' + document.getElementById('rack-meta').textContent + ' | ' + [...document.querySelectorAll('#rack-svg g.mod-group')].map(g => g.dataset.key + ':' + g.dataset.kind).join(' ')"),
            KNOBS_LOG,
        ]},
    ],
})

# ---- keep: the commit duel, heard; then a claim --------------------------
# The comparison is blind: the card shows A and B in a random order and says
# nothing more until the pick, and the receipt then names the side that was
# the edit ("B was your edit — taught: …"). The app exposes the order nowhere
# before the pick (it is Math.random, seeded here), so the shot picks by
# position, B, and logs the reveal. Either answer teaches, and the narration
# and callouts say only that, so the film is true whichever side B turns out
# to be in a take.
PICK_SIDE = "b"
shots.append({
    "id": "vp-keep", "beat": "keep", "pre": PRE,
    "setup": bench("Glass Pad",
        {"op": "drag", "sel": "#rack-svg [data-addr='node/0#cut']", "dy": -50, "ms": 700},
        {"op": "wait", "ms": 2500},
        {"op": "until", "sel": "#rack-commit:not([disabled])", "ms": 30000},
    ),
    "marks": {"commit": "#rack-commit", "tick": "#improve-check", "teach": ".seg-teach", "subject": "#rack-subject", "cut": "#rack-svg [data-addr='node/0#cut']",
              "res": "#rack-svg [data-addr='node/0#res']"},
    "actions": [
        *run("keep", 0, "keep2:Commit-0.1"),
        {"at": "keep2:Commit", "op": "click", "sel": "#rack-commit"},
        {"at": "keep2:Commit+0.2", "op": "until", "sel": "#cduel:not(.hidden)", "ms": 30000, "stamp": "duel"},
        {"at": "keep2:random", "op": "seq", "steps": [mark("card", "#cduel .cduel-card"), mark("sideA", ".cduel-cell >> nth=0"), mark("sideB", ".cduel-cell >> nth=1"),
                                                        log("sides", "[...document.querySelectorAll('.cduel-cell .cd-head')].map((h) => h.textContent.trim()).join(' | ')")]},
        {"at": "keep2:better+0.35", "op": "click", "sel": "#cd-play-a"},
        {"at": "keep2:better+2.75", "op": "click", "sel": "#cd-play-b"},
        {"at": "keep3:Either", "op": "click", "sel": "#cd-pick-" + PICK_SIDE},
        {"at": "keep3:Either+0.6", "op": "seq", "steps": [mark("toast", "#toasts .toast"), log("taught", "document.getElementById('toasts').innerText")]},
        {"at": "keep3:yours", "op": "log", "name": "reveal", "js": "document.getElementById('toasts').innerText"},
        {"at": "keep4", "snap": "beat", "op": "hold", "keys": F, "ms": "end"},
        {"at": "keep4:sure", "op": "seq", "steps": [
            {"op": "until", "js": SETTLED, "ms": 60000},
            {"op": "drag", "sel": "#rack-svg [data-addr='node/0#res']", "dy": -40, "ms": 700},
            {"op": "wait", "until": "keep4:Tick"},
            {"op": "click", "sel": "#improve-check"},
        ]},
        {"at": "keep4:claim", "op": "click", "sel": "#rack-commit"},
        {"at": "keep4:claim+1.4", "op": "seq", "steps": [mark("toast2", "#toasts .toast"),
            log("claim", "(document.getElementById('improve-check').checked ? 'ticked' : 'not ticked') + ' | duel ' + (document.getElementById('cduel').classList.contains('hidden') ? 'closed' : 'OPEN') + ' | ' + document.getElementById('toasts').innerText")]},
    ],
})

# ---- take: a file, a picture, a drop; the lineage ------------------------
shots.append({
    "id": "vp-take", "beat": "take", "pre": PRE,
    "clips": [["take2:opens-0.5", "@opened-0.3"]],
    "setup": bench("Glass Pad",
        {"op": "drag", "sel": "#rack-svg [data-addr='node/0#cut']", "dy": -50, "ms": 700},
        {"op": "wait", "ms": 2500},
        {"op": "until", "js": SETTLED, "ms": 180000},
        {"op": "click", "sel": "#rack-commit"},
        {"op": "until", "sel": "#cduel:not(.hidden)", "ms": 60000},
        {"op": "click", "sel": "#cd-pick-" + PICK_SIDE},
        log("reveal", "document.getElementById('toasts').innerText"),
        {"op": "wait", "ms": 2500},
        {"op": "until", "js": SETTLED, "ms": 180000},
        {"op": "move", "sel": "#rack-svg g.mod-group[data-key='node'] .mod-lock", "ms": 300},
        {"op": "click", "sel": "#rack-svg g.mod-group[data-key='node'] .mod-lock"},
        {"op": "eval", "js": "window.__subject = " + SUBJ},
        {"op": "click", "sel": "#rack-evolve"},
        {"op": "until", "js": SUBJ + " !== window.__subject", "ms": 300000},
        {"op": "wait", "ms": 1500},
        log("lineage", "document.getElementById('lineage-log').innerText"),
    ),
    "marks": {"ovf": "#ovf-btn", "rack": "#rack-scroll", "subject": "#rack-subject"},
    "actions": [
        *run("take", 0, "take1:file-0.8", prog=[AM, F]),
        {"at": "take1:file-0.7", "op": "seq", "steps": [
            {"op": "click", "sel": "#ovf-btn"},
            {"op": "wait", "ms": 300},
            mark("menu", "#ovf-menu"), mark("export", "#patch-export-btn"),
            {"op": "wait", "ms": 350},
            {"op": "click", "sel": "#patch-export-btn"},
        ]},
        {"at": "take1:picture-0.5", "op": "seq", "steps": [
            {"op": "click", "sel": "#ovf-btn"},
            {"op": "wait", "ms": 250},
            {"op": "click", "sel": "#image-btn"},
            {"op": "select", "sel": "#ix-fmt", "value": "svg"},
            mark("panel", "#image-panel"), mark("note", "#image-panel .sp-note"),
        ]},
        {"at": "take2:inside", "op": "click", "sel": "#ix-go"},
        {"at": "take2:Drop-0.45", "op": "key", "key": "Escape", "ms": 100},
        {"at": "take2:Drop", "op": "drop", "file": "fixtures/First_Bass.svg", "ms": 1300},
        # Opened once First Bass is on the rack (its mod env), not when the
        # subject first says "opening First Bass…"; the beat cuts to it.
        {"at": "take2:Drop+0.2", "op": "until", "js": "[...document.querySelectorAll('#rack-svg g.mod-group')].some(g => g.dataset.kind === 'modenv')", "ms": 90000, "stamp": "opened"},
        {"at": "take2:opens", "op": "seq", "steps": [mark("subject2", "#rack-subject"), mark("toast", "#toasts .toast"), RACK_LOG]},
        # A bass figure on First Bass, on the beat.
        {"at": "take2:play+0.1", "snap": "beat", "op": "hold", "keys": ["a"], "ms": 330},
        {"at": "take2:play+0.8", "snap": "beat", "op": "hold", "keys": ["a"], "ms": 330},
        {"at": "take2:play+1.5", "snap": "beat", "op": "hold", "keys": ["g"], "ms": 330},
        {"at": "take2:play+2.2", "snap": "beat", "op": "hold", "keys": ["f"], "ms": 600},
        {"at": "take3:EVOLVE-0.45", "op": "view", "v": "evolve"},
        {"at": "take3:EVOLVE+0.3", "op": "seq", "steps": [mark("lineage", "#lineage-log"), mark("lin1", "#lineage-log > div >> nth=0"), mark("strip", ".lineage-strip"), log("lineage", "document.getElementById('lineage-log').innerText")]},
    ],
})

# ---- together: the acid line again, shaped, grown, locked, committed ------
# The outro borrows this shot (film.js), so it runs on to the film's end.
shots.append({
    "id": "vp-together", "beat": "together", "pre": PRE,
    "dur": round(BEAT["outro"]["t1"] - BEAT["together"]["t0"] + PRE + 0.8, 3),
    "setup": bench("Acid Line",
        TEMPO,
        {"op": "click", "sel": "#hold-btn"},
        {"op": "click", "sel": "#arp-btn"},
        {"op": "select", "sel": "#arp-div", "value": 4},
        {"op": "select", "sel": "#arp-mode", "value": 0},
        {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
        {"op": "click", "sel": "#belief"},
        {"op": "wait", "ms": 600},
    ),
    "marks": {"rack": "#rack-scroll", "cut": "#rack-svg [data-addr='node#cut']", "res": "#rack-svg [data-addr='node#res']", "filter": "#rack-svg g.mod-group[data-key='node']",
              "q": "#nb-q", "dist": ".nb-item[data-kind='distortion']", "green": "#rack-svg .jack[data-childkey='node']", "tick": "#improve-check", "commit": "#rack-commit"},
    "actions": [
        # Am7 latched, on the downbeat.
        {"at": PRE - 0.08, "snap": "bar", "op": "hold", "keys": ["g", "h", "k", ";"], "ms": 260},
        # The cutoff up, then part of the way back, in one press; then the
        # resonance nudged.
        {"at": "together2:Shape", "op": "seq", "steps": [
            sweep("#rack-svg [data-addr='node#cut']", KNOB_H["Acid Line"], [-52, 16], 2600),
            {"op": "wait", "ms": 250},
            {"op": "drag", "sel": "#rack-svg [data-addr='node#res']", "dy": -14, "ms": 900},
        ]},
        {"at": "together3:Add-0.3", "op": "seq", "steps": [
            {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
            {"op": "key", "key": "/", "ms": 60},
            {"op": "wait", "ms": 150},
            {"op": "type", "text": "grit", "ms": 85},
            {"op": "wait", "ms": 350},
            mark("dist", ".nb-item[data-kind='distortion']"),
            {"op": "click", "sel": ".nb-item[data-kind='distortion']"},
            {"op": "wait", "ms": 350},
            {"op": "move", "sel": "#rack-svg .jack[data-childkey='node'] circle:last-of-type", "ms": 400},
            {"op": "wait", "ms": 300},
            log("grit", "document.getElementById('nb-status').textContent"),
            log("shaped", val("node#cut") + " + ' | ' + " + val("node#res")),
            {"op": "click", "sel": "#rack-svg .jack[data-childkey='node'] circle:last-of-type"},
            {"op": "until", "sel": "#rack-svg g.mod-group[data-kind='distortion']", "ms": 30000, "stamp": "grit"},
            {"op": "wait", "ms": 300},
            mark("distplate", "#rack-svg g.mod-group[data-kind='distortion']"),
            mark("filter2", "#rack-svg g.mod-group[data-kind='filter']"),
            RACK_LOG,
        ]},
        {"at": "together4:Lock-0.5", "op": "seq", "steps": [
            {"op": "until", "js": SETTLED, "ms": 60000},
            {"op": "move", "sel": "#rack-svg g.mod-group[data-kind='filter'] .mod-lock", "ms": 400},
            {"op": "click", "sel": "#rack-svg g.mod-group[data-kind='filter'] .mod-lock"},
            mark("square", "#rack-svg g.mod-group[data-kind='filter'] .mod-lock"),
        ]},
        {"at": "together4:commit-0.2", "op": "click", "sel": "#improve-check"},
        {"at": "together4:yours", "op": "click", "sel": "#rack-commit"},
        {"at": "together4:yours+1.2", "op": "seq", "steps": [mark("toast", "#toasts .toast"), log("claim", "document.getElementById('toasts').innerText")]},
        {"at": "together4:yours+2.2", "snap": "bar", "op": "click", "sel": "#hold-btn"},
    ],
})

spec = {"viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT, "setup": SETUP, "shots": shots}
dump(spec, f"{FDIR}/shots.json")
print(f"{len(shots)} shots → {os.path.relpath(os.path.join(FDIR, 'shots.json'))}")
