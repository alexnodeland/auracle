# The playing walkthrough's shots.json, regenerated from gen_base.json (the
# hand-written shots it started from) with the shared set-ups in tools/shotgen.py.
#
#   python3 www/video/films/playing/gen_shots.py
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
from shotgen import *  # noqa: E402,F403
DEV = {"op": "midi", "device": "MIDI keyboard"}
TAUGHT = taught() + [DEV]
old = json.load(open(os.path.join(HERE, "gen_base.json")))
shots = {s["id"]: s for s in old["shots"]}
# PERFORM measures its wiring per session, and which named control reaches
# which way moves with the pool (Body has been a search control in some
# sessions and not others). So the gestures pick controls by what they do in
# this session: NAMED is Snap to Space; REACH is one that reaches the patch
# (not a search control, which grows an offer when turned); UP is one that
# can turn upward from home.
NAMED = ".pf-knob:is([data-i='1'], [data-i='2'], [data-i='3'], [data-i='4'], [data-i='5'])"
REACH = NAMED + ":not(.search):not(.unwired)"
UP = REACH + ":not(.half-hi)"
# Every preset ships wired (apps/web/perform-wirings.json), so `measured`
# returns at once with "… controls reach this patch · re-checking" while
# PERFORM measures it again under this session's pool. Off camera, a shot
# waits that out, so it starts on the session's own wiring (the one the
# gestures above pick controls by) and nothing re-wires under its first
# gesture. Replaces shotgen's perform(), which logs the wiring before this.
STATUS = "document.querySelector('.pf-status').textContent"
# Wander's own state is on the line under its dial, not the status line.
WSUB = "document.querySelector(\".pf-knob[data-i='7'] .pf-k-sub\").textContent"
RECHECKED = {"op": "until", "js": "(() => { const s = " + STATUS + " || ''; return /controls reach/.test(s) && !/re-checking/.test(s); })()", "ms": 120000}
def perform(name):  # noqa: F811
    return [{"op": "preset", "name": name}, {"op": "view", "v": "perform"}, {"op": "measured", "name": name}, RECHECKED, WIRING]
def plain(name, extra=()):
    return perform(name) + list(extra) + [QUIET]
spec = {
    "viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT,
    "setup": [{"op": "click", "sel": "#warm-skip"}, FILLED, DEV],
    "shots": [],
}
def add(id_, setup, own=False, **over):
    s = dict(shots[id_])
    s.pop("own_setup", None)
    out = {"id": s["id"], "beat": s["beat"], "pre": s["pre"]}
    if own:
        out["own_setup"] = True
    if "clips" in over:
        out["clips"] = over["clips"]
    out["setup"] = setup
    out["marks"] = over.get("marks", s["marks"])
    out["actions"] = over.get("actions", s["actions"])
    spec["shots"].append(out)
add("pl-intro", plain("Glass Pad"))
add("pl-keys", plain("Glass Pad"))
add("pl-touch", plain("Glass Pad"))
ctl = shots["pl-controls"]["actions"]
ctl = [a for a in ctl if not (a["op"] == "drag" and a["sel"] in (".pf-knob[data-i='1']", ".pf-knob[data-i='2']", ".pf-knob[data-i='3']"))]
# The first two named controls that turn upward in this session, up and back.
nudges = [
    {"at": "controls1:named", "op": "drag", "sel": UP + " >> nth=0", "dy": -30, "ms": 450},
    {"at": "controls1:named+0.55", "op": "drag", "sel": UP + " >> nth=0", "dy": 30, "ms": 450},
    {"at": "controls1:named+1.15", "op": "drag", "sel": UP + " >> nth=1", "dy": -30, "ms": 450},
    {"at": "controls1:named+1.70", "op": "drag", "sel": UP + " >> nth=1", "dy": 30, "ms": 450},
]
# One gesture after another: on a busy machine a drag outlasts its plan.
nudges = [{"at": "controls1:named", "op": "seq", "steps": [dict({k: v for k, v in a.items() if k != "at"}) for a in nudges]}]
# The long press: on the first control that reaches (a search control has
# nothing to play).
ctl = [dict(a, sel=REACH + " >> nth=0") if a["op"] == "press" and a["sel"] == ".pf-knob[data-i='3']" else a for a in ctl]
marks = dict(shots["pl-controls"]["marks"], body=REACH + " >> nth=0")
add("pl-controls", plain("Glass Pad"), actions=ctl[:1] + nudges + ctl[1:], marks=marks)
add("pl-xy", plain("Glass Pad"))
wander = [dict(a) for a in shots["pl-wander"]["actions"]]
for a in wander:
    # Early and short: let go in the ideas zone, Wander asks 1.5 s later (a
    # spare grown ahead is handed over at once), and it must be in B before
    # "More" turns Wander past ideas, where no offer is asked for.
    if a["op"] == "drag" and a["at"] == "wander1:Wander":
        a["at"], a["ms"] = "wander1:Wander-0.15", 450
    # "Touch anything": a control that reaches (turning a search control
    # would grow an offer).
    if a["op"] == "drag" and a["at"] == "wander4:waits":
        a["sel"] = REACH + " >> nth=0"
i = next(k for k, a in enumerate(wander) if a["at"] == "wander2:More")
wander[i:i] = [
    {"at": "wander1:Wander+0.8", "op": "until", "sel": ".pf-offer.ready", "ms": 30000, "stamp": "offered"},
    {"at": "wander2:ideas", "op": "log", "name": "ideas", "js": WSUB},
    {"at": "wander2:More-0.1", "op": "log", "name": "B", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 120)"},
]
# Into drift on "More": the first move is asked for 1.5 s after letting go,
# and the walk renders a step at a time ("drift · walking…" under the dial),
# so the stamp is the glide itself ("drift · gliding").
i = next(k for k, a in enumerate(wander) if a["at"] == "wander2:More") + 1
wander[i:i] = [
    {"at": "wander2:More+1.0", "op": "until", "js": "/^drift · gliding/.test(" + WSUB + ")", "ms": 120000, "stamp": "drift"},
    {"at": "@drift+0.3", "op": "log", "name": "drift", "js": WSUB + " + ' || ' + " + STATUS},
]
wander += [
    {"at": "wander3:roams+0.2", "op": "log", "name": "roam", "js": WSUB},
    {"at": "wander4:waits+0.4", "op": "log", "name": "waits", "js": WSUB},
    {"at": "wander4:Freeze+0.6", "op": "log", "name": "held", "js": WSUB},
    {"at": "wander4:Freeze+0.6", "op": "log", "name": "B at the end", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 120)"},
]
# The idea lands at once (Wander asks 1.5 s after letting go and hands over
# the spare), so there is no cut there any more. The walk into drift still
# renders for a few seconds: the beat cuts from "taste" to just before the
# glide, so the knobs are seen to drift (no cut if it is already gliding).
add("pl-wander", TAUGHT + perform("Glass Pad") + [{"op": "wait", "ms": 9000}, QUIET], own=True, actions=wander,
    clips=[["wander2:taste+0.2", "@drift-0.3"]])
add("pl-offer", TAUGHT + perform("Glass Pad") + [{"op": "wait", "ms": 9000}, QUIET], own=True)
keep = shots["pl-keep"]["actions"]
# One chain of gestures, in order, each on its word when the machine keeps up.
keep = [keep[0], {"at": "keep1:Keep", "op": "seq", "steps": [
    {"op": "click", "sel": ".pf-pad:has-text('Keep')"},
    {"op": "drag", "sel": UP + " >> nth=0", "dy": -60, "ms": 550},
    {"op": "drag", "sel": ".pf-knob[data-i='0']", "dy": -60, "ms": 550},
    {"op": "wait", "until": "keep2:Back"},
    {"op": "click", "sel": ".pf-pad:has-text('Back')"},
    {"op": "wait", "until": "keep2:wander"},
    {"op": "drag", "sel": ".pf-knob[data-i='0']", "dy": -80, "ms": 900},
    {"op": "wait", "until": "keep2:come"},
    {"op": "click", "sel": ".pf-pad:has-text('Back')"},
]}]
add("pl-keep", plain("Glass Pad"), actions=keep)
dock = [a for a in shots["pl-dock"]["actions"] if not (a["op"] == "click" and a["sel"] == "#hold-btn" and str(a["at"]).startswith("dock3"))]
i = next(k for k, a in enumerate(dock) if a["at"] == "dock3:arpeggiator")
# HOLD first: a click on it folds the arp drawer (only the arp and sync
# controls keep it open), so the latch goes on before the drawer opens.
dock = [a for a in dock if not (str(a["at"]).startswith("dock3:arpeggiator") and a["op"] in ("click", "select", "eval", "move", "mark"))
        and not (str(a["at"]).startswith("dock1:Unison") and a["op"] == "click")]
i = next(k for k, a in enumerate(dock) if a["at"] == "dock1:Unison+0.45")
dock.insert(i, {"at": "dock1:Unison-0.1", "op": "seq", "steps": [
    {"op": "click", "sel": "#hold-btn"},
    {"op": "click", "sel": "#uni-btn"},
]})
i = next(k for k, a in enumerate(dock) if str(a["at"]).startswith("dock3:arpeggiator+1.4"))
# HOLD first: a click on it folds the arp drawer (only the arp and sync
# controls keep it open), so the latch goes on before the drawer opens.
dock.insert(i, {"at": "dock3:arpeggiator-0.35", "op": "seq", "steps": [
    {"op": "click", "sel": "#hold-btn"},
    {"op": "click", "sel": "#arp-btn"},
    {"op": "select", "sel": "#arp-mode", "value": 2},
    {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
    {"op": "move", "sel": "#arp-ctl", "ms": 300},
    {"op": "mark", "name": "drawer", "sel": "#arp-ctl"},
    {"op": "mark", "name": "tempo", "sel": "#bpm"},
]})
dock += [
    {"at": "dock2:Glide+0.8", "op": "log", "name": "glide", "js": "document.getElementById('glide-val').textContent"},
    {"at": "dock3:tempo", "op": "log", "name": "arp", "js": "[document.getElementById('arp-mode').selectedOptions[0].textContent, document.getElementById('arp-ctl').classList.contains('open') ? 'drawer open' : 'drawer shut', document.getElementById('hold-btn').classList.contains('lit') ? 'hold lit' : 'hold off'].join(' · ')"},
]
add("pl-dock", plain("Acid Line", [{"op": "eval", "js": "const b=document.getElementById('bpm'); b.value='84'; b.dispatchEvent(new Event('change'))"}]), actions=dock)
add("pl-midi", plain("Glass Pad"))
add("pl-booth", [
    {"op": "click", "sel": "#ovf-btn"},
    {"op": "click", "sel": "#booth-btn"},
    {"op": "wait", "ms": 64000},
    {"op": "until", "sel": "#booth-attract:not(.hidden)", "ms": 120000},
    {"op": "until", "js": "/under one hand/.test(document.getElementById('ba-cap')?.textContent || '')", "ms": 180000},
    {"op": "wait", "ms": 1500},
])
outro = [a for a in shots["pl-outro"]["actions"] if a["op"] != "hold"]
# C–Am–F–G: C from the start to the first bar line after 0.6 s, then one
# bar each, on the score's bar lines (they move with the timeline).
outro = [
    {"at": 0.1, "op": "hold", "keys": ["a", "d", "g"], "until": 0.6, "until_snap": "bar"},
    {"at": 0.6, "snap": "bar", "op": "hold", "keys": ["h", "k", ";"], "ms": 2750},
    {"at": 3.457, "snap": "bar", "op": "hold", "keys": ["f", "h", "k"], "ms": 2750},
    {"at": 6.314, "snap": "bar", "op": "hold", "keys": ["g", "j", "l"], "ms": "end"},
] + outro
add("pl-outro", TAUGHT + perform("Glass Pad") + [{"op": "wait", "ms": 9000}, QUIET], own=True, actions=outro)
dump(spec, os.path.join(HERE, "shots.json"))
print("ok", len(spec["shots"]))
