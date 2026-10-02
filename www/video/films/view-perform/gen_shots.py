# view-perform's shots.json, generated from its timeline: one shot per demo
# beat, with the one-bar turn before each demo borrowing that demo's shot.
#
#   python3 www/video/films/view-perform/gen_shots.py      (from the repo root)
#   VP_DIAG=1 python3 www/video/films/view-perform/gen_shots.py   (with the
#       rehearsal-only diagnostics: see DIAG below)
#
# Writes films/view-perform/shots.json, and the /*borrow*/ block in film.js.
# Rerun it after every timeline change (timeline.py --voice, fill_tails.py),
# then node validate.mjs (the rehearsal checker) and lint_plan.mjs.
#
# Every chapter is a one-bar turn beat (a card over the instrument, the bed
# only) and a demo beat. The turn's plan entry reuses the demo's shot, so a
# demo shot's `pre` covers its turn: pre = demo.t0 - turn.t0 + 0.5, exact to
# the millisecond. The title reuses the cold open's shot and the outro reuses
# the together shot the same way (film.js's BORROW gives their meta.pre).
import json
import os
import re
import sys

FILM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(FILM, "..", "..", "tools"))
from shotgen import INIT as SEED_INIT, FILLED, QUIET, CAST, taught, dump  # noqa: E402

# Cast from the films' shortlist (shotgen.CAST), each for what its chapter
# shows, by the wiring it ships with:
# - CHORDS, Slow Weather, where Glass Pad played: Bright, Snap, Motion and
#   Body ship turning both ways (so the XY pad's Bright and Motion both move
#   it; Grit is a search control), and Wander and Offer grow from it;
# - FAR, Morph Pad, for the honest controls: Space turns toward far only and
#   Grit cannot reach this patch, as honest2 to honest5 say;
# - LEAD, Wobble Board, where Tine played the keys: a quick attack for runs
#   and accents, and Bright for the touch row;
# - ACID, Ceiling, where Acid Line played the arpeggio: a ladder filter over
#   a saw an octave down, Acid Line's circuit.
# Two chapters keep a preset their lines name: named9 is "On Bell Jar…", and
# dock5 is Sync putting "Loom's filter" in time (Loom is the one preset with a
# step sequencer). They change with the script (Plan-006 task 8).
CHORDS, FAR, LEAD, ACID = CAST["pad"], CAST["pad_far"], CAST["lead"], CAST["acid"]

tl = json.load(open(os.path.join(FILM, "timeline.json")))
B = {b["id"]: b for b in tl["beats"]}
BAR = 4 * 60 / 84

# The seeded session every shot opens, as a returning player's: the first-run
# coach and PERFORM's first-steps strip are done (the tour film shows them),
# so neither sits over the keybed or pushes the deck down. Neither key draws
# from Math.random or changes the session; they are UI hints only.
INIT = (
    "(() => { try { localStorage.setItem('auracle-played', '1'); "
    "localStorage.setItem('auracle-perform-steps', JSON.stringify(['play', 'turn', 'offer'])); } catch (e) {} })(); "
    + SEED_INIT
)
DEV = {"op": "midi", "device": "MIDI keyboard"}
WIRING = {"op": "log", "name": "wiring", "js": "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.querySelector('.pf-k-name').textContent + ':' + (k.classList.contains('search') ? 'search' : k.classList.contains('half-lo') ? 'up' : k.classList.contains('half-hi') ? 'down' : 'both')).join(' ')"}
STATUS = "document.querySelector('.pf-status').textContent"
# Wander's own state ("drift · next in 9 s", "drift · gliding", "paused 3 s",
# "held") is on the line under its dial; the status line keeps to the patch.
WSUB = "document.querySelector(\".pf-knob[data-i='7'] .pf-k-sub\").textContent"
# Every preset ships wired (apps/web/perform-wirings.json), so it plays at
# once with "… controls reach this patch · re-checking" while PERFORM measures
# it again under this session's own pool. shotgen's `measured` waits that out
# off camera: a shot starts on the session's own wiring, as rehearsed, and
# nothing re-wires under its first gesture.


def perform(name, extra=()):
    return [{"op": "preset", "name": name}, {"op": "view", "v": "perform"}, {"op": "measured", "name": name}, WIRING, *extra, QUIET]


def taught_perform(name, extra=()):
    return taught() + [DEV] + perform(name, [{"op": "wait", "ms": 9000}, *extra])


def turn_pre(demo, turn):
    """A demo shot's pre when its turn beat reuses it (starts 0.5 s before the turn)."""
    return round(B[demo]["t0"] - B[turn]["t0"] + 0.5, 3)


L = {l["id"]: l for l in tl["lines"]}


def word_t(line, word=None):
    """Film time of a word in a line (as footage.mjs resolves "line:word"), or the line's start."""
    l = L[line]
    if not word:
        return l["t0"]
    words = l["text"].split()
    k = next(i for i, w in enumerate(words) if re.sub(r"[^\w']", "", w.lower()).startswith(word.lower()))
    return l["words"][k]


# Knob selectors.
K = lambda i: f".pf-knob[data-i='{i}']"  # noqa: E731
BRIGHT, SNAP, MOTION, BODY, GRIT, SPACE, BLEND, WANDER = (K(i) for i in range(8))
PAD = lambda name: f".pf-pad:has-text('{name}')"  # noqa: E731
OFFER = ".pf-pad.primary"


def hold(at, keys, ms=None, until=None, snap=None):
    a = {"at": at, "op": "hold", "keys": keys}
    if until is not None:
        a["until"] = until
    else:
        a["ms"] = ms
    if snap:
        a["snap"] = snap
    return a


def run(at, keys, step=0.17, ms=150, start=0.0):
    """A run of single notes, one after another from the word `at` + start."""
    return [{"at": f"{at}+{start + i * step:.2f}", "op": "hold", "keys": [k], "ms": ms} for i, k in enumerate(keys)]


# Diagnostics, for rehearsals only: `VP_DIAG=1 python3 …/gen_shots.py` puts
# them in; by default they are left out, because they wrap app functions and
# a recording must run the app as it is.
DIAG = os.environ.get("VP_DIAG") == "1"
_diag_ids = set()


def _diag(a):
    _diag_ids.add(id(a))
    return a


# Diagnostics (rehearsal evidence for the app's authors, harmless on camera):
# when held notes drop and why, and what the status line did. A page listener
# records blur, focus, keyup and visibility events; the live engine's
# noteOff, allOff and setPatch are wrapped to record who called them; the
# status line's changes are recorded as they happen. `lit` reads the keybed
# and the page clock, and empties the record, so each log holds only what
# happened since the one before.
DIAG_JS = (
    "(() => { const D = window.__diag = []; const t = () => (performance.now() / 1000).toFixed(2); "
    "const who = () => (new Error().stack || '').split('\\n').slice(3, 6).map((s) => s.trim().replace(/^at /, '')"
    ".replace(/https?:\\/\\/[^/]+\\//, '').replace(/\\?v=[^:]*/, '')).join(' < '); "
    "window.addEventListener('blur', () => D.push('blur@' + t())); "
    "window.addEventListener('focus', () => D.push('focus@' + t())); "
    "const el = (n) => n && n.tagName ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : String(n); "
    "window.addEventListener('keydown', (e) => D.push('kd ' + e.key + (e.repeat ? ' (repeat)' : '') + ' on ' + el(e.target) + '@' + t()), true); "
    "window.addEventListener('keydown', (e) => D.push('kd-end ' + e.key + (e.defaultPrevented ? ' (prevented)' : '')), false); "
    "document.addEventListener('keyup', (e) => D.push('keyup ' + e.key + '@' + t()), true); "
    "document.addEventListener('visibilitychange', () => D.push('vis ' + document.visibilityState + '@' + t())); "
    "const L = window.__aur && window.__aur.getLive(); "
    "if (L) { const off = L.noteOff.bind(L), all = L.allOff.bind(L), set = L.setPatch.bind(L); "
    "L.noteOff = (n) => { D.push('off ' + n + '@' + t() + ' ' + who()); return off(n); }; "
    "L.allOff = () => { D.push('allOff@' + t() + ' ' + who()); return all(); }; "
    "L.setPatch = (a, b) => { D.push('setPatch@' + t() + ' ' + who()); return set(a, b); }; } "
    # The engine worker's traffic that PERFORM drives: each perform_* or
    # edit_* request and its reply, and whether a drift's tree has the kept
    # tree's structure (perform.js's structureDiffers: Back glides only then).
    "const shape = (j) => j.replace(/-?\\d+(\\.\\d+)?(e-?\\d+)?/g, '#'); const wp = Worker.prototype.postMessage; const tapped = new WeakSet(); "
    "Worker.prototype.postMessage = function (m, ...r) { try { if (m && /^(perform_|edit_)/.test(m.type || '')) D.push('>' + m.type + (m.req != null ? '#' + m.req : '') + '@' + t()); } catch (e) {} "
    "if (!tapped.has(this)) { tapped.add(this); this.addEventListener('message', (e) => { try { const d = e.data, ty = (d && d.type) || ''; "
    "if (!/^(perform_|edit_rejected)/.test(ty) && !(ty === 'tree_json' && d.edited)) return; "
    "D.push('<' + ty + (d.req != null ? '#' + d.req : '') + (d.edited ? '(' + d.edited + ')' : '') + (d.error ? ' ERR ' + String(d.error).slice(0, 80) : '') + '@' + t()); "
    "if (ty === 'perform_applied' && d.json) window.__kept = d.json; "
    "if (ty === 'perform_drifted' && d.drift && d.drift.tree && window.__kept) { const a = shape(window.__kept), b = shape(JSON.stringify(d.drift.tree)); let i = 0; while (i < a.length && a[i] === b[i]) i++; "
    "D.push(a === b ? 'drift: same structure as kept' : 'drift: structure DIFFERS from kept at ' + i + ': kept ' + a.slice(Math.max(0, i - 60), i + 40) + ' / drift ' + b.slice(Math.max(0, i - 60), i + 40)); } "
    "} catch (err) { D.push('tap error ' + err); } }); } return wp.call(this, m, ...r); }; "
    "const st = document.querySelector('.pf-status'); let last = st.textContent; "
    "new MutationObserver(() => { const s = st.textContent; if (s !== last) { last = s; D.push('status \"' + s.slice(0, 56) + '\"@' + t()); } })"
    ".observe(st, { childList: true, subtree: true, characterData: true }); "
    # Wander's own line: its state changes, but not every second of a countdown.
    "const ws = document.querySelector(\".pf-knob[data-i='7'] .pf-k-sub\"); let lastW = ws.textContent.replace(/\\d+ s/, '# s'); "
    "new MutationObserver(() => { const s = ws.textContent.replace(/\\d+ s/, '# s'); if (s !== lastW) { lastW = s; D.push('wander \"' + ws.textContent + '\"@' + t()); } })"
    ".observe(ws, { childList: true, subtree: true, characterData: true }); })()"
)
DIAG_ON = _diag({"at": 0.1, "op": "eval", "js": DIAG_JS})
# Every toast as it comes and goes, in shot seconds (the eval runs at 0.1 s),
# so a confirmation's wait behind the toast before it can be measured.
TOASTS_ON = _diag({"at": 0.1, "op": "eval", "js": (
    "(() => { const T = window.__toasts = []; const t0 = performance.now() / 1000 - 0.1; "
    "const t = () => (performance.now() / 1000 - t0).toFixed(2); "
    "const toast = (n) => n.classList && n.classList.contains('toast'); "
    "new MutationObserver((ms) => { for (const m of ms) { "
    "for (const n of m.addedNodes) if (toast(n)) T.push('+' + t() + ' ' + n.textContent.slice(0, 64)); "
    "for (const n of m.removedNodes) if (toast(n)) T.push('-' + t() + ' ' + n.textContent.slice(0, 20)); } })"
    ".observe(document.getElementById('toasts'), { childList: true }); })()"
)})


def toasts(at):
    return _diag({"at": at, "op": "log", "name": "toasts", "js": "(window.__toasts || []).join(' | ')"})
LIT = (
    "'lit ' + [...document.querySelectorAll('#piano .down')].map((k) => k.dataset.note).join(',') "
    "+ ' | now ' + (performance.now() / 1000).toFixed(2) "
    "+ ' | focus ' + (document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? '#' + document.activeElement.id : '') + (typeof document.activeElement.className === 'string' && document.activeElement.className ? '.' + document.activeElement.className.trim().split(/\\s+/)[0] : '') : 'none') "
    "+ ' | ' + (window.__diag || []).splice(0).join(' ; ') "
    "+ ' | ' + document.querySelector('.pf-status').textContent "
    "+ ' | wander ' + " + WSUB + " "
    "+ ' | ' + [...document.querySelectorAll('.pf-knob')].slice(0, 3).map((k) => k.getAttribute('aria-valuetext')).join(', ')"
)


def lit(at, name):
    return _diag({"at": at, "op": "log", "name": name, "js": LIT})


shots = []

# ---------------------------------------------------------------- cold open
# Slow Weather, the bed's own changes (F Lydian: Fmaj7 | G/F | Em7 | Am7),
# one chord a bar from the film's first frame; from the second bar an XY
# gesture brings in Bright and Motion, in the pad's upper half (toward
# bright and restless). The shot runs on
# through the title, which reuses it (the app is silent there: app_audio.py
# places its sound over the open beat only).
o = B["open"]
chords = [["f", "h", "k", ";"], ["f", "g", "j", "l"], ["d", "g", "j", "l"], ["d", "g", "h", "k"]]
open_actions = [hold(round(0.5 + i * BAR, 3), c, ms=int(BAR * 1000) - 40) for i, c in enumerate(chords)]
open_actions += [
    {"at": round(0.5 + BAR - 0.2, 3), "op": "path", "sel": ".pf-xy-field", "points": [[0.5, 0.5], [0.72, 0.32], [0.9, 0.12], [0.68, 0.26]], "ms": int(3 * BAR * 1000 - 300)},
    {"at": round(0.5 + 4 * BAR + 0.6, 3), "op": "log", "name": "after", "js": "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.getAttribute('aria-valuetext')).join(' | ')"},
]
shots.append({
    "id": "vp-open", "beat": "open", "pre": 0.5,
    "dur": round(B["title"]["t1"] + 0.25 - (o["t0"] - 0.5) + 0.8, 3),
    "setup": perform(CHORDS),
    "marks": {"xy": ".pf-xy-field", "deck": ".pf-deck", "hood": ".pf-hood", "keybed": "#piano", "bright": BRIGHT, "motion": MOTION},
    "actions": open_actions,
})

# ---------------------------------------------------------------- play it
# Wobble Board (a lead with a quick attack), so runs, accents and touch speak clearly.
shots.append({
    "id": "vp-play", "beat": "play", "pre": turn_pre("play", "turn-play"),
    "setup": perform(LEAD),
    "marks": {"keybed": "#piano", "oct": "#oct-label", "e4": ".pkey[data-note='64']", "midi": "#midi-ind", "touch": ".pf-touch", "tsel": "#pf-touch-sel", "scope": ".pf-scope", "deck": ".pf-deck"},
    "actions": [
        *run("play1:notes", ["a", "s", "d", "f", "g", "h", "j", "k", "l"], step=0.17, start=0.35),
        *run("play1:black", ["w", "e", "t", "y", "u", "o", "p"], step=0.17),
        {"at": "play2:Z", "op": "key", "key": "z", "ms": 110},
        hold("play2:Z+0.3", ["a", "d", "g"], ms=420),
        {"at": "play2:octave-0.1", "op": "key", "key": "x", "ms": 110},
        hold("play2:octave+0.2", ["a", "d", "g"], ms=420),
        hold("play2:Hold", ["a"], ms=300),
        hold("play2:accent", ["Shift", "a"], ms=380),
        {"at": "play3:strike", "op": "press", "sel": ".pkey[data-note='64']", "fx": 0.62, "fy": 0.08, "ms": 380},
        {"at": "play3:harder", "op": "press", "sel": ".pkey[data-note='64']", "fx": 0.62, "fy": 0.97, "ms": 420},
        {"at": "play4:velocity", "op": "midi", "note": 67, "vel": 34, "ms": 260},
        {"at": "play4:velocity+0.34", "op": "midi", "note": 67, "vel": 122, "ms": 300},
        {"at": "play4:bend-0.1", "op": "midi", "note": 72, "vel": 96, "ms": 1500},
        {"at": "play4:bend+0.15", "op": "midi", "bend": [0, 0.9, 0], "ms": 1100},
        {"at": "play5:timbre", "op": "move", "sel": "#pf-touch-sel", "ms": 420},
        {"at": "play6:soft", "op": "midi", "note": [60, 64, 67], "vel": 28, "ms": 650},
        {"at": "play6:hard", "op": "midi", "note": [60, 64, 67], "vel": 124, "ms": 1300},
        {"at": "play6:hard+0.2", "op": "log", "name": "touch", "js": "document.getElementById('pf-touch-sel').selectedOptions[0].textContent + ' / ' + document.querySelector('.pf-touch-n').textContent"},
    ],
})

# ---------------------------------------------------------------- named controls
# Slow Weather under a held Fmaj7: Bright ridden up, then down with the hood in
# frame, then a long press on Bright; then Bell Jar is opened from the bank.
# It ships wired, so it plays at once (no cut: there is no wait to skip)
# while the status line says "re-checking" as PERFORM measures it again under
# this session's pool; then Bright, on that patch a wavefolder's fold, is
# ridden under a struck figure.
figure = ["k", "g", ";", "k", "l", "g", "k", ";", "k", "g", ";", "l"]
BELL = "/Bell Jar/.test(document.querySelector('.pf-name')?.textContent || '')"
BELL_WIRING = "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.querySelector('.pf-k-name').textContent + ' [' + k.querySelector('.pf-k-sub').textContent + ']').join(' | ') + ' || ' + " + STATUS
# Bell Jar in quarter notes from named6 until the figure: the bell's
# figure, one beat at 84 BPM apart, each let go before the next.
bell = ["k", "g", ";", "k", "l", "g", "k", ";"]
t6, t9 = word_t("named6"), word_t("named9", "Bright")
quarters = []
while t6 + 0.3 + len(quarters) * 0.714 + 0.6 <= t9 - 0.05:
    quarters.append(len(quarters))
shots.append({
    "id": "vp-named", "beat": "named", "pre": turn_pre("named", "turn-named"),
    "uncast": {"Bell Jar": "named9 names it: on Bell Jar, Bright folds the wave"},
    "setup": perform(CHORDS),
    "marks": {"deck": ".pf-deck", "bright": BRIGHT, "hood": ".pf-hood", "status": ".pf-status", "name": ".pf-name"},
    "actions": [
        hold("named1-0.3", ["f", "h", "k", ";"], until="named5-0.15"),
        {"at": "named2:ride", "op": "drag", "sel": BRIGHT, "dy": -100, "ms": 2300},
        {"at": "named3:Underneath", "op": "drag", "sel": BRIGHT, "dy": 75, "ms": 2300},
        {"at": "named4:Long", "op": "press", "sel": BRIGHT, "ms": 700},
        {"at": "named5:wiring", "op": "seq", "steps": [
            {"op": "click", "sel": ".bank-item.preset-item:has(.bi-name:text-is('Bell Jar'))"},
            {"op": "mark", "name": "row", "sel": ".bank-item.preset-item:has(.bi-name:text-is('Bell Jar'))"},
            # Wired from the file the app ships: at once, and re-checking.
            {"op": "until", "js": BELL + " && /controls reach/.test(" + STATUS + " || '')", "ms": 30000, "stamp": "wired"},
            {"op": "log", "name": "bell wiring (shipped)", "js": BELL_WIRING},
            {"op": "until", "js": BELL + " && /controls reach/.test(" + STATUS + " || '') && !/re-checking/.test(" + STATUS + " || '')", "ms": 120000, "stamp": "rechecked"},
            {"op": "log", "name": "bell wiring (re-checked)", "js": BELL_WIRING},
        ]},
        # Bell Jar, heard at once and all through its re-check, then the
        # figure in eighths under the Bright ride.
        *[{"at": f"named6+{0.3 + i * 0.714:.3f}", "op": "hold", "keys": [bell[i % len(bell)]], "ms": 600} for i in quarters],
        {"at": "named6:nudges", "op": "log", "name": "status at nudges", "js": STATUS},
        {"at": "named8:wired", "op": "log", "name": "status at wired", "js": STATUS},
        *[{"at": f"named9:Bright+{i * 0.357:.3f}", "op": "hold", "keys": [k], "ms": 300} for i, k in enumerate(figure)],
        {"at": "named9:Bright+0.2", "op": "drag", "sel": BRIGHT, "dy": -110, "ms": 3200},
        {"at": "named9:knobs", "op": "log", "name": "hood", "js": "[...document.querySelectorAll('.pf-hood-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).join(' ; ') + ' || ' + " + STATUS},
    ],
})

# ---------------------------------------------------------------- honest controls
# Morph Pad: Space reaches only toward far ("turns toward far only"); Grit is a
# search control. A short chord before and after Space goes up, so the tail
# is heard; then a held chord while Grit is turned: it springs back, the
# toast says a grittier offer is growing, B counts while it grows (the beat
# cuts from "growing" to it landing), then B says how far it went
# ("grittier by 3.9σ" in this session), heard on Peek.
shots.append({
    "id": "vp-honest", "beat": "honest", "pre": turn_pre("honest", "turn-honest"),
    "clips": [["honest6", "@offered-0.1"]],
    # Off camera: Space dragged the closed way (the guide says it will not go
    # past the centre), where the dial and the sound end up logged, then
    # double-clicked back to the centre.
    "setup": perform(FAR, [
        {"op": "drag", "sel": SPACE, "dy": 60, "ms": 500},
        {"op": "log", "name": "space dragged down", "js": "document.querySelector(\"" + SPACE + "\").getAttribute('aria-valuenow') + ' / ' + document.querySelector(\"" + SPACE + "\").getAttribute('aria-valuetext') + ' / pointer ' + document.querySelector(\"" + SPACE + " .pf-k-ptr\").getAttribute('transform')"},
        {"op": "dblclick", "sel": SPACE},
        {"op": "log", "name": "space re-centred", "js": "document.querySelector(\"" + SPACE + "\").getAttribute('aria-valuenow')"},
    ]),
    "marks": {"space": SPACE, "grit": GRIT, "deck": ".pf-deck", "offer": ".pf-offer", "peek": PAD("Peek")},
    "actions": [
        hold("honest1-0.2", ["f", "h", "k"], ms=1100),
        hold("honest2:This", ["f", "h", "k"], ms=900),
        {"at": "honest2:close", "op": "drag", "sel": SPACE, "dy": 55, "ms": 650},
        {"at": "honest2:far-0.2", "op": "drag", "sel": SPACE, "dy": -80, "ms": 800},
        hold("honest2:line-0.3", ["f", "h", "k"], ms=900),
        {"at": "honest2:line", "op": "log", "name": "space", "js": "document.querySelector(\"" + SPACE + "\").getAttribute('aria-valuetext') + ' / ' + document.querySelector(\"" + SPACE + " .pf-k-sub\").textContent"},
        hold("honest3:amber", ["d", "g", "h", "k"], until="honest6:take+0.6"),
        {"at": "honest4:Turn", "op": "drag", "sel": GRIT, "dy": -70, "ms": 800},
        {"at": "honest4:Turn+1.1", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
        {"at": "honest4:Turn+1.1", "op": "log", "name": "asked", "js": "document.querySelector('#toasts .toast')?.textContent || ''"},
        {"at": "honest4:Turn+1.0", "op": "until", "sel": ".pf-offer.ready", "ms": 90000, "stamp": "offered"},
        {"at": "honest5:growing", "op": "log", "name": "growing", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 200)"},
        {"at": "honest6:says", "op": "log", "name": "B", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 200)"},
        {"at": "honest6:Listen", "op": "press", "sel": PAD("Peek"), "ms": 1500},
    ],
})

# ---------------------------------------------------------------- the XY pad
shots.append({
    "id": "vp-xy", "beat": "xy", "pre": turn_pre("xy", "turn-xy"),
    "setup": perform(CHORDS),
    "marks": {"xy": ".pf-xy-field", "xyhead": ".pf-xy-head", "ysel": ".pf-xy-head select >> nth=1", "bright": BRIGHT, "motion": MOTION, "deck": ".pf-deck"},
    "actions": [
        {"at": "xy2:Choose", "op": "select", "sel": ".pf-xy-head select >> nth=1", "value": 4},
        {"at": "xy2:tells", "op": "mark", "name": "note", "sel": ".pf-xy-note"},
        {"at": "xy2:tells", "op": "log", "name": "note", "js": "document.querySelector('.pf-xy-note').textContent"},
        {"at": "xy2:patch+0.5", "op": "select", "sel": ".pf-xy-head select >> nth=1", "value": 2},
        hold("xy1-0.3", ["f", "h", "k", ";"], until="xy3:Hold-0.05"),
        hold("xy3:Hold", ["d", "g", "h", "k"], until="xy4:centre+0.5"),
        {"at": "xy3:draw", "op": "path", "sel": ".pf-xy-field", "points": [[0.5, 0.5], [0.24, 0.3], [0.5, 0.12], [0.84, 0.22], [0.78, 0.42], [0.6, 0.3]], "ms": 3600},
        {"at": "xy4:Double", "op": "dblclick", "sel": ".pf-xy-field"},
    ],
})

# ---------------------------------------------------------------- offers (taught)
# A spare grown ahead lands at once on Offer; Peek, then Blend past half, so
# B is heard. While B holds an offer the pad reads NEXT · passes on B, and
# pressing it is the pass (its toast, with undo; Blend glides home). The next
# one has been growing as a spare while B was held, so it too lands at once:
# no cut (the old one skipped ~10 s of growing). It is heard on Peek, then
# taken. A Take counts only for an offer heard for a second (Peek or Blend
# past half), so the new one is peeked before Take, not taken unheard.
shots.append({
    "id": "vp-offer", "beat": "offer", "pre": turn_pre("offer", "turn-offer"), "own_setup": True,
    "setup": taught_perform(CHORDS),
    "marks": {"offer-pad": OFFER, "offer": ".pf-offer", "blend": BLEND, "peek": PAD("Peek"), "take": PAD("Take"), "deck": ".pf-deck"},
    "actions": [
        hold("offer1-0.3", ["f", "h", "k", ";"], ms="end"),
        DIAG_ON,
        TOASTS_ON,
        lit("offer1:Press-0.1", "lit before offer"),
        {"at": "offer1:Press", "op": "click", "sel": OFFER},
        lit("offer2:follows", "lit after offer"),
        lit("offer3:Peek-0.1", "lit before peek"),
        lit("offer4:ride-0.1", "lit before blend"),
        lit("offer5:Press-0.2", "lit before pass"),
        {"at": "offer1:Press+0.2", "op": "until", "sel": ".pf-offer.ready", "ms": 60000, "stamp": "ready"},
        {"at": "offer2:follows", "op": "log", "name": "B", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 200)"},
        {"at": "offer3:Peek", "op": "press", "sel": PAD("Peek"), "ms": 1600},
        {"at": "offer4:ride", "op": "drag", "sel": BLEND, "dy": -120, "ms": 1900},
        {"at": "offer5:reads", "op": "log", "name": "pad", "js": "(() => { const p = document.querySelector('" + OFFER + "'); return p.textContent + ' · ' + (p.dataset.sub || ''); })()"},
        {"at": "offer5:Press", "op": "seq", "steps": [
            {"op": "click", "sel": OFFER},
            {"op": "wait", "ms": 300},
            {"op": "mark", "name": "passed", "sel": "#toasts .toast"},
            {"op": "log", "name": "pass", "js": "document.querySelector('#toasts .toast')?.textContent || ''"},
            {"op": "until", "sel": ".pf-offer.ready", "ms": 120000, "stamp": "next"},
            {"op": "log", "name": "B2", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 200)"},
        ]},
        {"at": "offer6", "op": "press", "sel": PAD("Peek"), "ms": 1350},
        {"at": "offer6+0.3", "op": "log", "name": "blend after pass", "js": "document.querySelector(\"" + BLEND + "\").getAttribute('aria-valuetext')"},
        {"at": "offer6:sound", "op": "click", "sel": PAD("Take")},
        {"at": "offer6:sound+0.5", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
        {"at": "offer6:sound+0.5", "op": "log", "name": "take", "js": "document.querySelector('#toasts .toast')?.textContent || ''"},
        {"at": "offer7:model", "op": "log", "name": "after take", "js": STATUS + " + ' / ' + [...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.querySelector('.pf-k-sub').textContent).join(' | ')"},
        lit("offer6:sound-0.2", "lit before take"),
        lit("offer7", "lit after take"),
        toasts("offer7:model"),
    ],
})

# ---------------------------------------------------------------- wander, keep, back (taught)
# Keep marks home; Wander a little into ideas: let go in a new zone, it asks
# 1.5 s later, and the spare grown ahead lands in B at once (no cut: there is
# no wait left to skip). Then into drift: its first move is asked for 1.5 s
# after letting go, but the walk itself renders a step at a time ("drift ·
# walking…" under the dial), so the cut skips from "knobs" to just before the
# glide ("drift · gliding"). Then roam; a touch (the line under Wander reads
# "paused 3 s") and Freeze ("held"); Back glides home.
shots.append({
    "id": "vp-wander", "beat": "wander", "pre": turn_pre("wander", "turn-wander"), "own_setup": True,
    "clips": [["wander4:knobs", "@drift-0.4"]],
    "setup": taught_perform(CHORDS),
    "marks": {"wander": WANDER, "offer": ".pf-offer", "hood": ".pf-hood", "freeze": PAD("Freeze"), "keep": PAD("Keep"), "back": PAD("Back"), "deck": ".pf-deck"},
    "actions": [
        hold("wander1-0.3", ["f", "h", "k", ";"], ms="end"),
        DIAG_ON,
        lit("wander1:Keep-0.1", "lit before keep"),
        {"at": "wander1:Keep", "op": "click", "sel": PAD("Keep")},
        lit("wander2:Wander-0.2", "lit before wander"),
        lit("wander3:ideas", "lit at idea"),
        lit("wander4:Further-0.1", "lit before drift"),
        lit("wander7:Touch-0.1", "lit before touch"),
        lit("wander8:Back-0.1", "lit before back"),
        {"at": "wander2:Wander-0.1", "op": "drag", "sel": WANDER, "dy": -45, "ms": 450},
        {"at": "wander2:Wander+0.6", "op": "until", "sel": ".pf-offer.ready", "ms": 60000, "stamp": "offered"},
        {"at": "wander3:ideas", "op": "log", "name": "ideas", "js": WSUB},
        {"at": "wander4:Further", "op": "seq", "steps": [
            {"op": "drag", "sel": WANDER, "dy": -85, "ms": 700},
            {"op": "log", "name": "B", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 200)"},
            {"op": "log", "name": "let go in drift", "js": WSUB},
            {"op": "until", "js": "/^drift · gliding/.test(" + WSUB + ")", "ms": 120000, "stamp": "drift"},
            {"op": "log", "name": "drift", "js": WSUB + " + ' || ' + " + STATUS},
        ]},
        {"at": "wander5:way", "op": "drag", "sel": WANDER, "dy": -50, "ms": 600},
        {"at": "wander5:roams+0.2", "op": "log", "name": "roam", "js": WSUB + " + ' || ' + " + STATUS},
        {"at": "wander7:Touch", "op": "drag", "sel": BRIGHT, "dy": -25, "ms": 500},
        {"at": "wander7:waits", "op": "log", "name": "waits", "js": WSUB + " + ' || ' + " + STATUS},
        {"at": "wander7:Freeze", "op": "click", "sel": PAD("Freeze")},
        {"at": "wander7:is+0.3", "op": "log", "name": "held", "js": WSUB + " + ' || ' + " + STATUS},
        {"at": "wander8:Back", "op": "click", "sel": PAD("Back")},
        lit("wander8:kept+0.3", "lit after back"),
        lit("wander8+5.2", "lit at the end"),
        {"at": "wander8:kept+0.4", "op": "log", "name": "home", "js": "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.getAttribute('aria-valuetext')).join(' | ') + ' || ' + " + STATUS},
    ],
})

# ---------------------------------------------------------------- the dock
# Loom at 84 (its one step sequencer is what Sync puts on the tempo; dock5
# names it).
shots.append({
    "id": "vp-dock", "beat": "dock", "pre": turn_pre("dock", "turn-dock"),
    "uncast": {"Loom": "dock5 names Loom's filter, and Loom is the one preset with a step sequencer for Sync"},
    "setup": perform("Loom", [
        {"op": "eval", "js": "const b=document.getElementById('bpm'); b.value='84'; b.dispatchEvent(new Event('change'))"},
        {"op": "eval", "js": "const g=document.getElementById('arp-gate'); g.value='0.85'; g.dispatchEvent(new Event('input'))"},
    ]),
    "marks": {"hold": "#hold-btn", "uni": "#uni-btn", "glide": "#glide", "arp": "#arp-btn", "sync": "#sync-btn", "rec": "#rec-btn", "keybed": "#piano", "hood": ".pf-hood"},
    "actions": [
        TOASTS_ON,
        {"at": "dock1:Hold+0.1", "op": "click", "sel": "#hold-btn"},
        hold("dock1:latches", ["a", "d", "g", "j"], ms=500),
        {"at": "dock2:Unison-0.2", "op": "seq", "steps": [{"op": "click", "sel": "#hold-btn"}, {"op": "click", "sel": "#uni-btn"}]},
        hold("dock2:four", ["a"], ms=1600),
        {"at": "dock3:Glide", "op": "drag", "sel": "#glide", "ox": -18, "dx": 14, "ms": 500},
        {"at": "dock3:Glide+0.4", "op": "log", "name": "glide", "js": "document.getElementById('glide-val')?.textContent || ''"},
        hold("dock3:line", ["a"], ms=520),
        hold("dock3:line+0.42", ["g"], ms=520),
        hold("dock3:line+0.84", ["k"], ms=700),
        {"at": "dock3:chords-0.2", "op": "click", "sel": "#uni-btn"},
        hold("dock3:clean-0.2", ["a", "d", "g"], ms=1000),
        {"at": "dock4:arpeggiator-0.4", "op": "seq", "steps": [
            {"op": "click", "sel": "#hold-btn"},
            {"op": "click", "sel": "#sync-btn"},
            {"op": "click", "sel": "#arp-btn"},
            {"op": "select", "sel": "#arp-mode", "value": 2},
            {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
            {"op": "move", "sel": "#arp-ctl", "ms": 300},
            {"op": "mark", "name": "drawer", "sel": "#arp-ctl"},
            {"op": "mark", "name": "tempo", "sel": "#bpm"},
        ]},
        hold("dock4:chord", ["a", "d", "g", "j"], ms=300, snap="beat"),
        {"at": "dock5:Sync", "op": "log", "name": "arp", "js": "[document.getElementById('arp-mode').selectedOptions[0].textContent, document.getElementById('bpm').value, document.getElementById('sync-btn').classList.contains('lit') ? 'sync lit' : 'sync off', document.getElementById('hold-btn').classList.contains('lit') ? 'hold lit' : 'hold off'].join(' · ')"},
        {"at": "dock6:like", "op": "click", "sel": "#rec-btn"},
        {"at": "dock6:like+0.3", "op": "mark", "name": "recording", "sel": "#toasts .toast"},
        {"at": "dock6:WAV", "op": "click", "sel": "#rec-btn"},
        {"at": "dock6:WAV+0.8", "op": "mark", "name": "saved", "sel": "#toasts .toast"},
        {"at": "dock6:WAV+0.8", "op": "log", "name": "saved", "js": "document.querySelector('#toasts .toast')?.textContent || ''"},
        {"at": "dock6:WAV+2.6", "op": "click", "sel": "#hold-btn"},
        toasts("dock6:WAV+3.4"),
    ],
})

# ---------------------------------------------------------------- MIDI
shots.append({
    "id": "vp-midi", "beat": "midi", "pre": turn_pre("midi", "turn-midi"),
    "setup": perform(CHORDS),
    "marks": {"ind": "#midi-ind", "bright": BRIGHT, "motion": MOTION, "hood": ".pf-hood", "deck": ".pf-deck"},
    "actions": [
        hold("midi1-0.3", ["a", "d", "g"], ms="end"),
        TOASTS_ON,
        {"at": "midi1:Plug", "op": "click", "sel": "#midi-ind"},
        {"at": "midi1:Plug+0.4", "op": "mark", "name": "panel", "sel": "#midi-panel"},
        {"at": "midi1:Plug+0.4", "op": "mark", "name": "rows", "sel": "#midi-panel .midi-rows"},
        {"at": "midi1:first", "op": "midi", "cc": 74, "values": [44, 100], "ms": 650},
        {"at": "midi1:first+0.75", "op": "midi", "cc": 71, "values": [80, 30], "ms": 650},
        {"at": "midi1:first+1.5", "op": "midi", "cc": 73, "values": [30, 96], "ms": 650},
        {"at": "midi2:Learn", "op": "click", "sel": "#midi-panel .midi-row:has-text('Space') button:has-text('learn')"},
        {"at": "midi2:Learn+0.6", "op": "midi", "cc": 20, "values": [50, 92], "ms": 700},
        {"at": "midi2:knob-0.1", "op": "mark", "name": "spacerow", "sel": "#midi-panel .midi-row:has-text('Space')"},
        {"at": "midi2:knob-0.1", "op": "log", "name": "space row", "js": "document.querySelector('#midi-panel').textContent.replace(/\\s+/g, ' ').slice(0, 160)"},
        {"at": "midi3:Pressure", "op": "midi", "pressure": [0, 115, 115, 0], "ms": 1900},
        {"at": "midi3:wheel", "op": "midi", "cc": 1, "values": [0, 110, 110, 0], "ms": 1800},
        {"at": "midi4:pedal", "op": "midi", "cc": 64, "value": 127},
        {"at": "midi4:pedal+0.05", "op": "midi", "note": [72, 76, 79], "vel": 92, "ms": 260},
        {"at": "midi4:clock-0.3", "op": "midi", "cc": 64, "value": 0},
        {"at": "midi4:clock", "op": "midi", "clock": 84, "beats": 5},
        {"at": "midi4:tempo+0.6", "op": "mark", "name": "clock", "sel": "#midi-panel .midi-foot"},
        {"at": "midi4:tempo+0.6", "op": "log", "name": "clock", "js": "document.querySelector('#midi-panel').textContent.replace(/\\s+/g, ' ').slice(-80)"},
        {"at": "midi5:open", "op": "eval", "js": "(() => { const c = new BroadcastChannel('auracle-midi'); c.postMessage({ type: 'claim', id: 'zzzzzzzzzzzzzz', at: Date.now() + 1e7 }); setTimeout(() => c.close(), 1000); })()"},
        {"at": "midi5:open+0.6", "op": "log", "name": "aside", "js": "document.getElementById('midi-ind').textContent + ' / ' + (document.querySelector('#midi-panel .midi-why')?.textContent || '')"},
        {"at": "midi5:aside", "op": "mark", "name": "why", "sel": "#midi-panel .midi-why"},
        toasts("midi5:aside+0.5"),
    ],
})

# ---------------------------------------------------------------- together (taught)
# Ceiling at 84, 1/16 up·down, latched on the beat's first downbeat (as the
# card clears); Wander up to drift; Offer (the spare lands at once) and Blend
# ridden past half; Take on the downbeat. Wander in drift asks for its first
# move 1.5 s after it is let go, but the Offer, Blend and Take that follow are
# hands on, so it waits ("paused N s" under the dial) and moves only after the
# Take; the logs say when. The latch stays on, so the arpeggio
# plays the taken sound to the end of the beat, where the bed takes over. The
# shot runs on under the outro, which reuses it: the PATCH tab is clicked on
# "PATCH" (silent there: bed only).
tg = B["together"]
pre_tg = turn_pre("together", "turn-together")
shots.append({
    "id": "vp-together", "beat": "together", "pre": pre_tg, "own_setup": True,
    "dur": round(B["outro"]["t1"] + 0.3 - (tg["t0"] - pre_tg) + 0.8, 3),
    "setup": taught_perform(ACID, [
        {"op": "eval", "js": "const b=document.getElementById('bpm'); b.value='84'; b.dispatchEvent(new Event('change'))"},
        {"op": "click", "sel": "#hold-btn"},
        {"op": "click", "sel": "#arp-btn"},
        {"op": "select", "sel": "#arp-mode", "value": 2},
        {"op": "select", "sel": "#arp-div", "value": 4},
        {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
        {"op": "log", "name": "arp", "js": "[document.getElementById('arp-mode').selectedOptions[0].textContent, document.getElementById('arp-div').selectedOptions[0].textContent, document.getElementById('bpm').value].join(' · ')"},
    ]),
    "marks": {"wander": WANDER, "offer": ".pf-offer", "blend": BLEND, "take": PAD("Take"), "hold": "#hold-btn", "arp": "#arp-btn", "status": ".pf-status", "deck": ".pf-deck", "patch": ".viewtab[data-view='play']"},
    "actions": [
        DIAG_ON,
        TOASTS_ON,
        hold("together1-0.8", ["a", "d", "g"], ms=300, snap="bar"),
        {"at": "together1-0.5", "op": "move", "sel": "#arp-btn", "ms": 300},
        {"at": "together2:Wander", "op": "drag", "sel": WANDER, "dy": -125, "ms": 800},
        {"at": "together2:offer", "op": "click", "sel": OFFER},
        {"at": "together2:offer+0.2", "op": "until", "sel": ".pf-offer.ready", "ms": 60000, "stamp": "ready"},
        {"at": "together2:growing+0.4", "op": "drag", "sel": BLEND, "dy": -110, "ms": 2200},
        {"at": "together3:downbeat", "op": "click", "sel": PAD("Take"), "snap": "bar"},
        {"at": "together3:downbeat+1.2", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
        {"at": "together3:downbeat+1.2", "op": "log", "name": "take", "js": "document.querySelector('#toasts .toast')?.textContent || ''"},
        {"at": "together3:downbeat+4.0", "op": "log", "name": "after take", "js": STATUS + " + ' / ' + [...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.querySelector('.pf-k-sub').textContent).join(' | ') + ' / wander ' + " + WSUB},
        lit("together3:downbeat-0.2", "lit before take"),
        lit("together3:downbeat+4.0", "lit after take"),
        lit("outro2:PATCH-0.4", "lit at outro"),
        toasts("outro2:PATCH-0.3"),
        {"at": "outro2:PATCH-0.2", "op": "click", "sel": ".viewtab[data-view='play']"},
        {"at": "outro2:PATCH+0.8", "op": "log", "name": "patch", "js": "document.getElementById('rack-subject')?.textContent || ''"},
    ],
})

if not DIAG:
    for sh in shots:
        sh["actions"] = [a for a in sh["actions"] if id(a) not in _diag_ids]

spec = {
    "viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT,
    "setup": [{"op": "click", "sel": "#warm-skip"}, FILLED, DEV],
    "shots": shots,
}
dump(spec, os.path.join(FILM, "shots.json"))
for s in shots:
    print(f"{s['id']:<12} beat {s['beat']:<9} pre {s['pre']}" + (f" dur {s['dur']}" if "dur" in s else ""))
print("diagnostics:", "in (VP_DIAG=1)" if DIAG else "out")

# film.js: where the title and the outro's borrowed shots start (their plan
# entries' meta.pre), between the /*borrow*/ markers.
borrow = {
    "title": round(B["title"]["t0"] - (B["open"]["t0"] - 0.5), 3),
    "outro": round(B["outro"]["t0"] - (tg["t0"] - pre_tg), 3),
}
fj = os.path.join(FILM, "film.js")
src = open(fj).read()
new = re.sub(r"/\*borrow\*/.*?/\*/borrow\*/", "/*borrow*/ " + json.dumps(borrow).replace('"', "").replace("{", "{ ").replace("}", " }") + " /*/borrow*/", src, flags=re.S)
if new != src:
    open(fj, "w").write(new)
print("borrow", borrow)
