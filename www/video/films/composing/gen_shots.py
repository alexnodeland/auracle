# The composing walkthrough's shots.json, with the shared set-ups in
# tools/shotgen.py.
#
#   python3 www/video/films/composing/gen_shots.py
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
from shotgen import *  # noqa: E402,F403
BPM84 = {"op": "eval", "js": "const b=document.getElementById('bpm'); b.value='84'; b.dispatchEvent(new Event('change'))"}
BLUR = {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"}
# A bass, a pad and a moving texture: the first card of each on the grid.
PICKS = ("bass", "pad", "texture")
def row(name):
    return f".bank-item.preset-item:has(.bi-name:text-is('{name}')) .bi-name"
spec = {
    "viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT,
    "setup": [{"op": "click", "sel": "#warm-skip"}, FILLED],
    "shots": [
        {
            "id": "co-intro", "beat": "intro", "pre": 1.5,
            "setup": [
                {"op": "preset", "name": "Loom"},
                {"op": "preset", "name": "Glass Pad"},
                {"op": "preset", "name": "First Bass"},
                {"op": "view", "v": "play"},
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"rack": "#rack-scroll", "subject": "#rack-subject", "rail": "#bank-list"},
            "actions": [
                {"at": 0.4, "op": "hold", "keys": ["a"], "ms": 900},
                {"at": 1.6, "op": "hold", "keys": ["a"], "ms": 500},
                {"at": 2.3, "op": "hold", "keys": ["g"], "ms": 400},
                {"at": "intro1:bass", "op": "hold", "keys": ["a"], "ms": 900},
                {"at": "intro1:pad-0.25", "op": "click", "sel": row("Glass Pad")},
                {"at": "intro1:pad+0.35", "op": "hold", "keys": ["a", "d", "g"], "ms": 1300},
                {"at": "intro1:texture-0.25", "op": "click", "sel": row("Loom")},
                {"at": "intro1:texture+0.4", "op": "hold", "keys": ["a", "g"], "ms": "end"},
            ],
        },
        {
            "id": "co-direction", "beat": "direction", "pre": 0.5, "own_setup": True,
            "setup": [
                {"op": "until", "sel": "#warmstart:not(.hidden)", "ms": 180000},
                FILLED,
                QUIET,
            ],
            "clips": [["direction3", "@taught+0.9"]],
            "marks": {"card": "#warmstart .warm-card", "grid": "#warm-grid", "go": "#warm-go"},
            "actions": [
                {"at": "direction1:shows", "op": "click", "sel": pick("bass", " + .wi-play")},
                {"at": "direction2:Pick", "op": "seq", "steps": [
                    {"op": "click", "sel": pick(PICKS[0])}, {"op": "wait", "ms": 250},
                    {"op": "click", "sel": pick(PICKS[1])}, {"op": "wait", "ms": 250},
                    {"op": "click", "sel": pick(PICKS[2])},
                ]},
                {"at": "direction2:eighteen", "op": "click", "sel": "#warm-go"},
                {"at": "direction2:eighteen+0.2", "op": "until", "sel": ".viewtab[data-view='perform'][aria-selected='true']", "ms": 180000, "stamp": "taught"},
                {"at": "@taught+0.2", "op": "view", "v": "evolve"},
                {"at": "@taught+0.8", "op": "mark", "name": "mid", "sel": "#duel-mid"},
                {"at": "direction3:gut", "op": "seq", "steps": [BLUR, {"op": "key", "key": "ArrowRight", "ms": 120}]},
            ],
        },
        {
            "id": "co-evolve", "beat": "evolve", "pre": 0.5, "own_setup": True,
            "setup": taught(votes=6, picks=PICKS) + [{"op": "view", "v": "evolve"}, {"op": "wait", "ms": 1500}, QUIET],
            "clips": [["evolve2", "@bred-0.6"]],
            "marks": {"btn": "#evolve-btn", "lineage": "#lineage-log", "lamp": "#wm-lamp", "bank": "#bank-list"},
            "actions": [
                {"at": "evolve1:Press", "op": "click", "sel": "#evolve-btn"},
                {"at": "evolve1:Press+0.3", "op": "until", "sel": "#evolve-btn:not([disabled])", "ms": 600000, "stamp": "bred"},
                {"at": "evolve2+0.7", "op": "mark", "name": "lineage", "sel": "#lineage-log"},
                {"at": "evolve3", "op": "mark", "name": "fresh", "sel": "#bank-list .bank-item.fresh"},
            ],
        },
        {
            "id": "co-keep", "beat": "keep", "pre": 0.5, "own_setup": True,
            "setup": taught(votes=6, picks=PICKS) + [
                {"op": "view", "v": "play"},
                {"op": "click", "sel": ".bf[data-f='pool']"},
                {"op": "click", "sel": ".bank-item:not(.saved) >> nth=0 >> .bi-name"},
                {"op": "until", "sel": ".bank-item.live", "ms": 30000},
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"rail": "#bank-list", "chips": ".bank-filters", "budget": "#pin-budget"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["h", "k", ";"], "ms": "end"},
                {"at": "keep1:save", "op": "click", "sel": ".bank-item.live .bi-save"},
                {"at": "keep1:save+0.9", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
                {"at": "keep1:Patches", "op": "click", "sel": ".bf[data-f='mine']"},
                {"at": "keep1:Patches+0.4", "op": "mark", "name": "row", "sel": ".bank-item.live"},
                {"at": "keep3:Stars", "op": "click", "sel": ".bank-item.live .star[data-s='4']"},
                {"at": "keep3:Stars+0.2", "op": "mark", "name": "stars", "sel": ".bank-item.live .stars"},
                {"at": "keep3:name", "op": "seq", "steps": [
                    {"op": "dblclick", "sel": ".bank-item.live .bi-name"},
                    {"op": "until", "sel": ".bi-rename", "ms": 5000},
                    {"op": "type", "text": "verse", "ms": 110, "enter": True},
                ]},
            ],
        },
        {
            "id": "co-steps", "beat": "steps", "pre": 0.5,
            "setup": [
                {"op": "preset", "name": "Sub & Sparkle"},
                {"op": "view", "v": "play"},
                BPM84,
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"slot": "#rack-svg .jack[data-modkey='node/1']", "filter": "#rack-svg g.mod-group[data-key='node/1']", "sync": "#sync-btn"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a"], "until": "steps4:restarts-0.3"},
                {"at": "steps1:Steps", "op": "seq", "steps": [
                    {"op": "click", "sel": ".nb-item[data-kind='steps']"},
                    {"op": "mark", "name": "steps", "sel": ".nb-item[data-kind='steps']"},
                ]},
                {"at": "steps1:filter", "op": "click", "sel": "#rack-svg .jack[data-modkey='node/1'] circle:last-of-type"},
                {"at": "steps2:draw", "op": "seq", "steps": [
                    {"op": "until", "sel": "#rack-svg [data-addr='node/1/m#s0']", "ms": 20000},
                    {"op": "drag", "sel": "#rack-svg [data-addr='node/1/m#s0']", "dy": -30, "ms": 300},
                    {"op": "wait", "ms": 60},
                    {"op": "drag", "sel": "#rack-svg [data-addr='node/1/m#s1']", "dy": 25, "ms": 300},
                    {"op": "wait", "ms": 60},
                    {"op": "drag", "sel": "#rack-svg [data-addr='node/1/m#s2']", "dy": -40, "ms": 300},
                    {"op": "wait", "ms": 60},
                    {"op": "drag", "sel": "#rack-svg [data-addr='node/1/m#s3']", "dy": 10, "ms": 300},
                ]},
                {"at": "steps2:eight", "op": "mark", "name": "lane", "sel": "#rack-svg g.mod-group[data-key='node/1/m']"},
                {"at": "steps3:Sync", "op": "click", "sel": "#sync-btn"},
                {"at": "steps3:Sync+0.5", "op": "mark", "name": "bpm", "sel": "#bpm"},
                {"at": "steps3:Sync+0.5", "op": "mark", "name": "drawer", "sel": "#arp-ctl"},
                {"at": "steps4:restarts", "op": "hold", "keys": ["a"], "ms": "end"},
            ],
        },
        {
            "id": "co-arp", "beat": "arp", "pre": 0.5,
            "setup": [
                {"op": "preset", "name": "Acid Line"},
                {"op": "view", "v": "play"},
                BPM84,
                {"op": "click", "sel": "#arp-btn"},
                {"op": "select", "sel": "#arp-div", "value": 4},
                BLUR,
                {"op": "move", "sel": "#arp-ctl", "ms": 400},
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"arp": "#arp-btn", "drawer": "#arp-ctl", "hold": "#hold-btn", "cut": "#rack-svg [data-addr='node#cut']", "tempo": "#bpm"},
            "actions": [
                {"at": 0.1, "op": "move", "sel": "#arp-ctl", "ms": 400},
                {"at": "arp1:arpeggiator", "snap": "beat", "op": "hold", "keys": ["a", "g", "k"], "until": "arp2:Latch-0.25"},
                {"at": "arp2:Latch", "op": "click", "sel": "#hold-btn"},
                {"at": "arp2:Latch+0.15", "snap": "beat", "op": "hold", "keys": ["a", "g", "k"], "ms": 300},
                {"at": "arp2:shape", "op": "drag", "sel": "#rack-svg [data-addr='node#cut']", "dy": -45, "ms": 2400},
            ],
        },
        {
            "id": "co-clock", "beat": "clock", "pre": 0.5,
            "setup": [
                {"op": "midi", "device": "Sequencer"},
                {"op": "preset", "name": "Loom"},
                {"op": "view", "v": "play"},
                {"op": "click", "sel": "#sync-btn"},
                {"op": "click", "sel": "#arp-btn"},
                {"op": "click", "sel": "#hold-btn"},
                {"op": "hold", "keys": ["a", "d", "g"], "ms": 400},
                {"op": "click", "sel": "#midi-ind"},
                BLUR,
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"panel": "#midi-panel", "foot": "#midi-panel .midi-foot", "lane": "#rack-svg g.mod-group[data-key='node/0/m']", "chip": "#arp-chip"},
            "actions": [
                {"at": "clock1:Send", "snap": "beat", "op": "midi", "clock": 84, "beats": 14, "start": "clock2:start", "start_snap": "bar"},
                {"at": "clock1:tempo", "op": "mark", "name": "foot", "sel": "#midi-panel .midi-foot"},
            ],
        },
        {
            "id": "co-scenes", "beat": "scenes", "pre": 0.5,
            # Saved in the order First Bass, Loom, Glass Pad (My Patches lists
            # them so), Glass Pad last, on the bench: [ steps back to Loom,
            # then to First Bass. A step lands when the engine has opened the
            # patch (seconds on a busy machine), so the second waits for the
            # first rather than stepping from the same row twice.
            "setup": [
                {"op": "preset", "name": "First Bass"},
                {"op": "click", "sel": ".bf[data-f='pool']"},
                {"op": "click", "sel": ".bank-item.live .bi-save"},
                {"op": "wait", "ms": 800},
                {"op": "preset", "name": "Loom"},
                {"op": "click", "sel": ".bf[data-f='pool']"},
                {"op": "click", "sel": ".bank-item.live .bi-save"},
                {"op": "wait", "ms": 800},
                {"op": "preset", "name": "Glass Pad"},
                {"op": "click", "sel": ".bf[data-f='pool']"},
                {"op": "click", "sel": ".bank-item.live .bi-save"},
                {"op": "wait", "ms": 800},
                {"op": "click", "sel": ".bf[data-f='mine']"},
                {"op": "log", "name": "mine", "js": "[...document.querySelectorAll('#bank-list .bank-item .bi-name')].map((e) => e.textContent).join(' | ')"},
                {"op": "view", "v": "perform"},
                {"op": "measured", "name": "Glass Pad"},
                WIRING,
                QUIET,
            ],
            "marks": {"rail": "#bank-list", "deck": ".pf-deck", "keep": ".pf-pad:has-text('Keep')", "back": ".pf-pad:has-text('Back')", "name": ".pf-name"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                {"at": "scenes1:Keep", "op": "click", "sel": ".pf-pad:has-text('Keep')"},
                {"at": "scenes1:home", "op": "drag", "sel": ".pf-knob[data-i='0']", "dy": -60, "ms": 700},
                {"at": "scenes1:glides", "op": "click", "sel": ".pf-pad:has-text('Back')"},
                {"at": "scenes2:step-0.3", "op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
                {"at": "scenes2:step", "op": "key", "key": "[", "ms": 120},
                {"at": "scenes2:step+0.2", "op": "seq", "steps": [
                    {"op": "until", "js": "/^Loom/.test(document.querySelector('.pf-name').textContent)", "ms": 30000, "stamp": "loom"},
                    {"op": "wait", "until": "scenes3:carry"},
                    {"op": "key", "key": "[", "ms": 120},
                ]},
                {"at": "scenes3:click+0.8", "op": "log", "name": "after the steps", "js": "document.querySelector('.pf-name').textContent + ' | live ' + document.querySelector('#bank-list .bank-item.live .bi-name')?.textContent"},
            ],
        },
        {
            "id": "co-record", "beat": "record", "pre": 0.5,
            "setup": [
                {"op": "preset", "name": "Glass Pad"},
                {"op": "view", "v": "play"},
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"rec": "#rec-btn", "keybed": "#piano", "rack": "#rack-scroll"},
            "actions": [
                {"at": 0.5, "op": "hold", "keys": ["a", "d", "g"], "ms": 1350},
                {"at": 1.929, "op": "hold", "keys": ["h", "k", ";"], "ms": 1350},
                {"at": 3.357, "op": "hold", "keys": ["f", "h", "k"], "ms": 1350},
                {"at": 4.786, "op": "hold", "keys": ["g", "j", "l"], "ms": 1350},
                {"at": 6.35, "op": "rec", "on": False},
                {"at": 7.0, "op": "mark", "name": "toast", "sel": "#toasts .toast"},
            ],
        },
        {
            "id": "co-share", "beat": "share", "pre": 0.5,
            "setup": [
                {"op": "preset", "name": "Glass Pad"},
                {"op": "view", "v": "play"},
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"ovf": "#ovf-btn", "rack": "#rack-scroll"},
            "actions": [
                {"at": 0.3, "op": "hold", "keys": ["a", "d", "g"], "ms": 1800},
                {"at": "share1:export-0.5", "op": "seq", "steps": [
                    {"op": "click", "sel": "#ovf-btn"},
                    {"op": "mark", "name": "menu", "sel": "#ovf-menu"},
                    {"op": "wait", "ms": 350},
                    {"op": "click", "sel": "#patch-export-btn"},
                ]},
                {"at": "share2:picture", "op": "seq", "steps": [
                    {"op": "click", "sel": "#ovf-btn"},
                    {"op": "wait", "ms": 250},
                    {"op": "click", "sel": "#image-btn"},
                    {"op": "select", "sel": "#ix-fmt", "value": "svg"},
                    {"op": "mark", "name": "panel", "sel": "#image-panel"},
                    {"op": "mark", "name": "note", "sel": "#image-panel .sp-note"},
                ]},
                {"at": "share2:inside", "op": "click", "sel": "#ix-go"},
                {"at": "share3:Drop-0.45", "op": "key", "key": "Escape", "ms": 100},
                {"at": "share3:Drop", "op": "drop", "file": "fixtures/First_Bass.svg", "ms": 1300},
                {"at": "share3:same", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
                {"at": "share3:same", "op": "mark", "name": "subject", "sel": "#rack-subject"},
            ],
        },
        {
            "id": "co-outro", "beat": "outro", "pre": 0.5, "own_setup": True,
            "setup": taught(picks=PICKS) + [
                {"op": "view", "v": "play"},
                {"op": "click", "sel": ".bf[data-f='mine']"},
                {"op": "wait", "ms": 1500},
                QUIET,
            ],
            "marks": {"ovf": "#ovf-btn", "rail": "#bank-list"},
            "actions": [
                {"at": 0.2, "op": "hold", "keys": ["a", "d", "g"], "ms": "end"},
                {"at": "outro1:profile-0.7", "op": "seq", "steps": [
                    {"op": "click", "sel": "#ovf-btn"},
                    {"op": "mark", "name": "menu", "sel": "#ovf-menu"},
                    {"op": "mark", "name": "export", "sel": "#export-btn"},
                    {"op": "wait", "ms": 500},
                    {"op": "click", "sel": "#export-btn"},
                ]},
            ],
        },
    ],
}
dump(spec, os.path.join(HERE, "shots.json"))
print("ok")
