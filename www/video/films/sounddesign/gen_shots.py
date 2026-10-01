# The sound-design walkthrough's shots.json, with the shared set-ups in
# tools/shotgen.py.
#
#   python3 www/video/films/sounddesign/gen_shots.py
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
from shotgen import *  # noqa: E402,F403
CUT = "#rack-svg [data-addr='node/0#cut']"
RES = "#rack-svg [data-addr='node/0#res']"
CHORUS = "#rack-svg g.mod-group[data-key='node']"
# A socket's hit target is its ring (the last circle): a cabled socket's box
# also holds the plug, so the middle of the box can miss the ring.
def JACK(sel):
    return sel + " circle:last-of-type"
BELIEF = {"op": "until", "sel": "#belief .bl-u", "ms": 90000}
# The engine has caught up with the bench: the guess is no longer being
# re-measured and nothing is thinking (a commit asked of a busy engine waits
# behind it, past the end of a shot).
SETTLED = {"op": "until", "js": "!document.getElementById('belief').classList.contains('stale') && !document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 180000}
def patch(name):
    return [{"op": "preset", "name": name}, {"op": "view", "v": "play"}, BELIEF, SETTLED, {"op": "wait", "ms": 1200}]
LOCKS = [
    {"op": "move", "sel": CUT, "ms": 400},
    {"op": "click", "sel": CUT + " .lock-dot"},
    {"op": "move", "sel": CHORUS + " .mod-lock", "ms": 400},
    {"op": "click", "sel": CHORUS + " .mod-lock"},
]
HEARD_COMMIT = [
    {"op": "drag", "sel": CUT, "dy": -50, "ms": 700},
    {"op": "wait", "ms": 2500},
    SETTLED,
    {"op": "click", "sel": "#rack-commit"},
    {"op": "until", "sel": "#cduel:not(.hidden)", "ms": 60000},
    {"op": "click", "sel": ".cduel-cell:has-text('your edit') .cd-pick"},
    {"op": "wait", "ms": 2500},
]
# ⚡ evolve from this, until the child is on the bench (the bench's name
# changes a moment after the "now on the bench" toast).
EVOLVED = [
    {"op": "eval", "js": "window.__subject = document.getElementById('rack-subject').textContent"},
    {"op": "click", "sel": "#rack-evolve"},
    {"op": "until", "js": "document.getElementById('rack-subject').textContent !== window.__subject", "ms": 300000},
    {"op": "wait", "ms": 1500},
]
spec = {
    "viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT,
    "setup": taught(),
    "shots": [
        {
            "id": "sd-intro", "beat": "intro", "pre": 1.5,
            "setup": patch("Glass Pad") + [QUIET],
            "marks": {"rack": "#rack-scroll", "subject": "#rack-subject"},
            "actions": [
                {"at": 0.3, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
            ],
        },
        {
            "id": "sd-open", "beat": "open", "pre": 0.5,
            "setup": patch("Glass Pad") + [QUIET],
            "marks": {"filter": "#rack-svg g.mod-group[data-key='node/0']", "hz": CUT, "ms": "#rack-svg [data-addr='amp#release']", "db": "#rack-svg [data-addr='amp#sustain']", "belief": "#belief"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                {"at": "open1:edit", "op": "drag", "sel": CUT, "dy": -60, "ms": 1500},
                {"at": "open3:updates", "op": "drag", "sel": RES, "dy": -40, "ms": 1000},
                {"at": "open3:edit", "op": "mark", "name": "belief", "sel": "#belief"},
                {"at": "open3:edit", "op": "log", "name": "belief", "js": "document.getElementById('belief').textContent"},
            ],
        },
        {
            "id": "sd-lock", "beat": "lock", "pre": 0.5,
            "setup": patch("Glass Pad") + [QUIET],
            "marks": {"knobs": "#lock-knobs", "wiring": "#lock-structure", "chorus": CHORUS, "cut": CUT},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["h", "k", ";"], "ms": "end"},
                {"at": "lock1:dot-0.6", "op": "seq", "steps": [
                    {"op": "move", "sel": CUT, "ms": 400},
                    {"op": "click", "sel": CUT + " .lock-dot"},
                ]},
                {"at": "lock1:square-0.5", "op": "seq", "steps": [
                    {"op": "move", "sel": CHORUS + " .mod-lock", "ms": 400},
                    {"op": "click", "sel": CHORUS + " .mod-lock"},
                ]},
                {"at": "lock1:square+0.1", "op": "mark", "name": "square", "sel": CHORUS + " .mod-lock"},
                {"at": "lock2:knob", "op": "move", "sel": "#lock-knobs", "ms": 400},
                {"at": "lock2:wiring", "op": "move", "sel": "#lock-structure", "ms": 400},
            ],
        },
        {
            "id": "sd-evolve", "beat": "evolve", "pre": 0.5,
            "setup": patch("Glass Pad") + LOCKS + [{"op": "wait", "ms": 800}, QUIET],
            "clips": [["evolve2", "@benched-0.5"]],
            "marks": {"evolve": "#rack-evolve", "subject": "#rack-subject", "meta": "#rack-meta"},
            "actions": [
                {"at": 0.1, "op": "hold", "keys": ["a", "d", "g"], "until": "evolve1:Evolve+0.6"},
                {"at": "evolve1:Evolve-0.4", "op": "move", "sel": "#rack-evolve", "ms": 400},
                {"at": "evolve1:Evolve-0.1", **{"op": "eval", "js": "window.__subject = document.getElementById('rack-subject').textContent"}},
                {"at": "evolve1:Evolve", "op": "click", "sel": "#rack-evolve"},
                {"at": "evolve1:Evolve+0.2", "op": "until", "js": "document.getElementById('rack-subject').textContent !== window.__subject", "ms": 300000, "stamp": "benched"},
                {"at": "evolve2+0.6", "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                {"at": "evolve2+0.8", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
                {"at": "evolve2+0.8", "op": "mark", "name": "subject", "sel": "#rack-subject"},
                {"at": "evolve2+0.8", "op": "mark", "name": "chorus", "sel": CHORUS},
                {"at": "evolve2+0.8", "op": "log", "name": "child", "js": "document.getElementById('rack-subject').textContent + ' | ' + document.getElementById('rack-meta').textContent"},
            ],
        },
        {
            "id": "sd-bank", "beat": "bank", "pre": 0.5,
            "setup": patch("Glass Pad") + [QUIET],
            "marks": {"bank": "#nodebank", "green": "#rack-svg .jack[data-childkey='node/0']", "amber": "#rack-svg .jack[data-childkey='node/0/0']", "dock": "#spec-dock"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                {"at": "bank1:click", "op": "click", "sel": ".nb-item[data-kind='delay']"},
                {"at": "bank1:click+0.3", "op": "mark", "name": "delay", "sel": ".nb-item[data-kind='delay']"},
                {"at": "bank2:lights+0.3", "op": "mark", "name": "lit", "sel": "#rack-svg .jack.legal"},
                {"at": "bank2:lights+0.3", "op": "mark", "name": "status", "sel": "#nb-status"},
                {"at": "bank3:Green-0.2", "op": "seq", "steps": [
                    {"op": "move", "sel": JACK("#rack-svg .jack[data-childkey='node/0']"), "ms": 400},
                    {"op": "log", "name": "green", "js": "document.getElementById('nb-status').textContent"},
                ]},
                # In order: put the delay down, take the formant, and rest on
                # the supersaw's socket. Its ▶ is pressed with the pointer still
                # resting there: a render still on its way when the pointer
                # leaves the socket falls back to another socket's audition.
                {"at": "bank3:Amber-0.35", "op": "seq", "steps": [
                    {"op": "key", "key": "Escape", "ms": 80},
                    {"op": "click", "sel": ".nb-item[data-kind='formant']"},
                    {"op": "mark", "name": "formant", "sel": ".nb-item[data-kind='formant']"},
                    {"op": "move", "sel": JACK("#rack-svg .jack[data-childkey='node/0/0']"), "ms": 400},
                    {"op": "log", "name": "amber", "js": "document.getElementById('nb-status').textContent + ' | ' + document.querySelector(\"#rack-svg .jack[data-childkey='node/0/0']\").getAttribute('class')"},
                ]},
                # What the strip said, every half second (the render's progress).
                {"at": "bank3:Amber+0.8", "op": "eval", "js": "window.__pv = []; const t0 = performance.now(); window.__pvI = setInterval(() => window.__pv.push(((performance.now() - t0) / 1000).toFixed(1) + ' ' + (document.querySelector('#spec-dock .pv-label')?.textContent || '-') + (document.getElementById('belief').classList.contains('stale') ? ' (rating)' : '')), 500)"},
                {"at": "bank4:play", "op": "seq", "steps": [
                    {"op": "mark", "name": "play", "sel": "#pv-play"},
                    {"op": "eval", "js": "document.getElementById('pv-play').click()"},
                ]},
                {"at": "bank4:play+2.5", "op": "log", "name": "strip", "js": "clearInterval(window.__pvI); window.__pv.join(' | ')"},
            ],
        },
        {
            "id": "sd-spec", "beat": "spec", "pre": 0.5,
            "setup": patch("Glass Pad") + [QUIET],
            "marks": {"bank": "#nodebank", "dock": "#spec-dock"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                {"at": "spec1:card", "op": "move", "sel": ".nb-item[data-kind='chorus']", "ms": 400},
                {"at": "spec1:card+0.7", "op": "mark", "name": "chorus", "sel": ".nb-item[data-kind='chorus']"},
                {"at": "spec1:card+0.7", "op": "mark", "name": "blurb", "sel": "#spec-dock .sp-blurb"},
                {"at": "spec1:card+0.7", "op": "mark", "name": "params", "sel": "#spec-dock .sp-params"},
                {"at": "spec1:card+0.7", "op": "mark", "name": "model", "sel": "#spec-dock .sd-model"},
                {"at": "spec1:card+0.7", "op": "mark", "name": "heard", "sel": "#spec-dock .sp-heard"},
                {"at": "spec1:card+0.7", "op": "log", "name": "model", "js": "document.querySelector('#spec-dock .sd-model')?.textContent"},
            ],
        },
        {
            "id": "sd-chains", "beat": "chains", "pre": 0.5,
            "setup": patch("Ask The Dice") + [QUIET],
            "marks": {"rand": "#rack-svg g.mod-group[data-kind='rand']", "quantize": "#rack-svg g.mod-group[data-kind='quantize']", "slew": "#rack-svg g.mod-group[data-kind='slew']", "slot": "#rack-svg .jack[data-modkey='node']", "filter": "#rack-svg g.mod-group[data-key='node']", "vco": "#rack-svg g.mod-group[data-key='node/0']"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a"], "ms": "end"},
                # Take the shaper, rest on the modulated slot (it stays green:
                # "put slew after the mod env"), place it: one chain, in order.
                {"at": "chains4:Drop", "op": "seq", "steps": [
                    {"op": "click", "sel": ".nb-item[data-kind='slew']"},
                    {"op": "wait", "until": "chains4:modulated"},
                    {"op": "move", "sel": JACK("#rack-svg .jack[data-modkey='node']"), "ms": 400},
                    {"op": "wait", "ms": 300},
                    {"op": "log", "name": "slot", "js": "document.getElementById('nb-status').textContent"},
                    # Placed just before "wraps", so the wrap lands on the word.
                    {"op": "wait", "until": "chains4:wraps-0.6"},
                    {"op": "click", "sel": JACK("#rack-svg .jack[data-modkey='node']")},
                ]},
                # The shaper now in the filter's slot, with the mod env as its input.
                {"at": "chains4:wraps+0.9", "op": "mark", "name": "wrapped", "sel": "#rack-svg g.mod-group[data-key='node/m']"},
                {"at": "chains4:wraps+0.9", "op": "log", "name": "toast", "js": "document.getElementById('toasts').textContent"},
                {"at": "chains4:wraps+0.9", "op": "log", "name": "chain", "js": "[...document.querySelectorAll('#rack-svg g.mod-group')].map((g) => g.dataset.key + ':' + g.dataset.kind).join(' ')"},
            ],
        },
        {
            "id": "sd-commit", "beat": "commit", "pre": 0.5,
            "setup": patch("Glass Pad") + [
                {"op": "drag", "sel": CUT, "dy": -50, "ms": 700},
                {"op": "wait", "ms": 2500},
                {"op": "until", "sel": "#rack-commit:not([disabled])", "ms": 30000},
                SETTLED,
                QUIET,
            ],
            "marks": {"commit": "#rack-commit", "tick": "#improve-check", "teach": ".seg-teach"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "until": "commit1:Commit-0.1"},
                {"at": "commit1:Commit", "op": "click", "sel": "#rack-commit"},
                {"at": "commit1:Commit+0.2", "op": "until", "sel": "#cduel:not(.hidden)", "ms": 30000, "stamp": "duel"},
                {"at": "commit1:random", "op": "mark", "name": "card", "sel": "#cduel .cduel-card"},
                {"at": "commit1:original", "op": "click", "sel": ".cduel-cell:has-text('the original') .cd-play"},
                {"at": "commit1:edit", "op": "click", "sel": ".cduel-cell:has-text('your edit') .cd-play"},
                {"at": "commit2:Either", "op": "click", "sel": ".cduel-cell:has-text('your edit') .cd-pick"},
                {"at": "commit2:Either+0.5", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
                {"at": "commit3", "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                # The tick after the drag has let go: a click while the drag
                # still holds the pointer is lost, and COMMIT then asks again.
                {"at": "commit3+0.1", "op": "seq", "steps": [
                    {"op": "drag", "sel": RES, "dy": -40, "ms": 700},
                    {"op": "wait", "until": "commit3:tick"},
                    {"op": "click", "sel": "#improve-check"},
                ]},
                {"at": "commit4:claim", "op": "click", "sel": "#rack-commit"},
                {"at": "commit4:claim+2.0", "op": "log", "name": "claim", "js": "(document.getElementById('improve-check').checked ? 'ticked' : 'not ticked') + ' | duel ' + (document.getElementById('cduel').classList.contains('hidden') ? 'closed' : 'OPEN') + ' | ' + document.getElementById('toasts').textContent"},
            ],
        },
        {
            "id": "sd-undo", "beat": "undo", "pre": 0.5,
            "setup": patch("Glass Pad") + [QUIET],
            # ⌘Z lands when the engine has re-rendered the edits before it; on
            # a busy machine that is seconds, so the beat cuts from just after
            # "undo" to just before the knob snaps back (no cut when it is
            # quick: a cut never goes back).
            "clips": [["undo1:undo+0.8", "@undone-0.2"]],
            "marks": {"res": RES, "chorus": CHORUS, "menu": CHORUS + " .mod-menu-btn"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                {"at": "undo1:change-0.3", "op": "eval", "js": "window.__res0 = document.querySelector(\"%s\").textContent" % RES},
                # ⌘Z once the drag's last edit has landed: pressed while that
                # edit is still queued (a busy engine), the undo lands first
                # and the queued edit then puts the knob back where it was
                # dragged, and a bypass after it resurrects the drag.
                {"at": "undo1:change", "op": "seq", "steps": [
                    {"op": "drag", "sel": RES, "dy": -60, "ms": 600},
                    {"op": "until", "js": "!document.getElementById('belief').classList.contains('stale')", "ms": 60000, "stamp": "settled"},
                    {"op": "wait", "until": "undo1:undo"},
                    {"op": "hold", "keys": ["Control", "z"], "ms": 150},
                    # Only after the press: the drag's first reply can show the
                    # old value for a moment on its way to the new one.
                    {"op": "until", "js": "document.querySelector(\"%s\").textContent === window.__res0" % RES, "ms": 60000, "stamp": "undone"},
                ]},
                {"at": "undo2:bypass-0.5", "op": "seq", "steps": [
                    {"op": "click", "sel": CHORUS + " .mod-menu-btn"},
                    {"op": "until", "sel": "#ctx-menu .cm-item", "ms": 5000},
                    {"op": "wait", "ms": 300},
                    {"op": "click", "sel": "#ctx-menu .cm-item:has-text('bypass')"},
                ]},
                # HELD opens when the bypassed chorus lands in it.
                {"at": "undo2:held-0.3", "op": "seq", "steps": [
                    {"op": "until", "sel": "#tray-items .tray-item", "ms": 20000, "stamp": "held"},
                    {"op": "mark", "name": "tray", "sel": "#tray"},
                    {"op": "mark", "name": "item", "sel": "#tray-items .tray-item"},
                ]},
                {"at": "undo2:reload+1.0", "op": "log", "name": "after", "js": "[...document.querySelectorAll('#rack-svg g.mod-group')].map((g) => g.dataset.key + ':' + g.dataset.kind).join(' ') + ' | held ' + document.querySelectorAll('#tray-items .tray-item').length"},
            ],
        },
        {
            "id": "sd-lineage", "beat": "lineage", "pre": 0.5,
            "setup": patch("Glass Pad") + HEARD_COMMIT + [
                {"op": "move", "sel": CHORUS + " .mod-lock", "ms": 400},
                {"op": "click", "sel": CHORUS + " .mod-lock"},
            ] + EVOLVED + [{"op": "view", "v": "evolve"}, {"op": "wait", "ms": 1500}, QUIET,
                {"op": "log", "name": "lineage", "js": "document.getElementById('lineage-log').innerHTML"}],
            "marks": {"lineage": "#lineage-log", "strip": ".lineage-strip"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
            ],
        },
        {
            "id": "sd-outro", "beat": "outro", "pre": 0.5,
            "setup": patch("Glass Pad") + HEARD_COMMIT + [
                {"op": "move", "sel": CHORUS + " .mod-lock", "ms": 400},
                {"op": "click", "sel": CHORUS + " .mod-lock"},
            ] + EVOLVED + [QUIET],
            "marks": {"rack": "#rack-scroll", "subject": "#rack-subject"},
            "actions": [
                # C–Am–F–G: C from the start to the first bar line after 0.6 s,
                # then one bar each, on the score's bar lines.
                {"at": 0.1, "op": "hold", "keys": ["a", "d", "g"], "until": 0.6, "until_snap": "bar"},
                {"at": 0.6, "snap": "bar", "op": "hold", "keys": ["h", "k", ";"], "ms": 2750},
                {"at": 3.457, "snap": "bar", "op": "hold", "keys": ["f", "h", "k"], "ms": 2750},
                {"at": 6.314, "snap": "bar", "op": "hold", "keys": ["g", "j", "l"], "ms": "end"},
            ],
        },
    ],
}
dump(spec, os.path.join(HERE, "shots.json"))
print("ok")
