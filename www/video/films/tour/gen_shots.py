#!/usr/bin/env python3
"""shots.json for A tour of Auracle, from its timeline.

usage (from the repo root): python3 www/video/films/tour/gen_shots.py

Writes www/video/films/tour/shots.json. Actions are pinned to the narration's
words (timeline.json), so run this again after every timeline.py.

One taught session for every shot: the three-pick warm start answered with
the first bass, pad and texture card on the grid, which is exactly what the
first-visit shot does on camera, so what the tour shows is what a newcomer
sees after picking three. Chords are in the computer keymap (a = C4):
C a d g · Am h k ; · F f h k · G g j l.

Every shot stops its own capture half a second after its beat (`rec` off),
past the last frame the film shows. A recording's sound is unchanged by it;
a rehearsal keeps the capture (www/video/out/tour/dry/ID.dl/), so what the
app played can be measured without anyone listening:
python3 www/video/films/tour/check_audio.py.
"""
import json
import os
import sys

FDIR = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(os.path.dirname(FDIR))
sys.path.insert(0, os.path.join(VIDEO, "tools"))
from shotgen import INIT, FILLED, QUIET, WIRING, CATS, pick, taught, perform, dump  # noqa: E402

TL = json.load(open(os.path.join(FDIR, "timeline.json")))
# The first ▶ of a sound that has not been heard yet loads or renders it on
# the one engine thread first: seconds of silence after the press (the
# warm-start card's ▶, a bank row's ▶). Until the app answers those presses at
# once, the shot hears that sound once in set-up, so the ▶ on camera plays as
# soon as it is pressed. False shows the real first press.
PREHEAR = False
BAR = 60 / 84 * 4  # 2.857 s
C, AM, F, G = ["a", "d", "g"], ["h", "k", ";"], ["f", "h", "k"], ["g", "j", "l"]
TAB = lambda v: ".viewtab[data-view='%s']" % v  # noqa: E731
MIDI_DEV = {"op": "midi", "device": "MIDI keyboard"}
TEACH = taught(picks=("bass", "pad", "texture")) + [MIDI_DEV]
SETTLED = {"op": "until", "js": "!document.getElementById('belief').classList.contains('stale') && !document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 180000}
# The pad among My patches (the warm start saved one of each: bass, pad, texture).
_PAD = ["#bank-list .bank-item:has(.bi-name:text-is('%s'))" % n for n in CATS["pad"]]
PAD_ROW = ", ".join(_PAD)
PAD_HEAR = ", ".join(x + " .bi-hear" for x in _PAD)
PAD_NAME = ", ".join(x + " .bi-name" for x in _PAD)
# The named control a swell rides: the first of the six that reaches this
# patch and can turn up (Bright when it can). Which way each control reaches
# is measured per session, so it is picked by what it does, not by name.
UP = ".pf-knob:is([data-i='0'], [data-i='1'], [data-i='2'], [data-i='3'], [data-i='4'], [data-i='5']):not(.search):not(.unwired):not(.half-hi) >> nth=0"
TABS_LOG = {"op": "log", "name": "view", "js": "document.querySelector('.viewtab.active')?.dataset.view"}
# The job slot in the menu bar (long work only: a generation, ⚡, a refit).
SLOT_JS = "(document.getElementById('job-slot').classList.contains('hidden') ? 'slot empty' : 'slot: ' + document.getElementById('job-text').textContent)"


def perform_settled(name):
    """shotgen.perform: a preset ships wired and PERFORM re-checks it in the
    background; `measured` waits for the re-check, so which controls reach
    the patch (UP, the WIRING log) is the measured wiring in every take."""
    return perform(name)


def key_sel(note):
    """A key on the keybed by MIDI note: white keys are .pkey, black .bkey."""
    return "%s[data-note='%d']" % (".bkey" if note % 12 in (1, 3, 6, 8, 10) else ".pkey", note)


def hold(at, keys, **kw):
    return {"at": at, "op": "hold", "keys": keys, **kw}


shots = []

# ---- open: the cold open, wide. Glass Pad: C, then a Bright swell; Am as
# Blend crosses into the offer in B; F on the offer; G, and Take; C on the
# sound just taken. One chord a bar at 84 BPM, on the score's bar lines.
# The offer is grown in set-up (Offer, until it lands in B): a fresh one takes
# ~10 s of renders. While B holds it the Offer pad reads NEXT ("passes on B");
# Take empties B, and the pad reads Offer again.
shots.append({
    "id": "to-open", "beat": "open", "pre": 0.5,
    "setup": perform_settled("Glass Pad") + [
        {"op": "wait", "ms": 1500},
        {"op": "click", "sel": ".pf-pad.primary"},
        {"op": "until", "sel": ".pf-offer.ready", "ms": 120000},
        {"op": "wait", "ms": 1500},
        {"op": "log", "name": "B", "js": "document.querySelector('.pf-offer').textContent.trim().slice(0, 140)"},
        {"op": "log", "name": "offer pad", "js": "document.querySelector('.pf-pad.primary').textContent + ' · ' + (document.querySelector('.pf-pad.primary').dataset.sub || '')"},
        QUIET,
    ],
    "marks": {"deck": ".pf-deck", "offer": ".pf-offer", "blend": ".pf-knob[data-i='6']", "up": UP, "take": ".pf-pad:has-text('Take')", "name": ".pf-name"},
    "actions": [
        hold(0.55, C, until=0.6, until_snap="bar"),
        {"at": 0.95, "op": "drag", "sel": UP, "dy": -60, "ms": 1900},
        hold(0.6, AM, snap="bar", ms=2830),
        {"at": 0.5 + BAR + 0.35, "op": "drag", "sel": ".pf-knob[data-i='6']", "dy": -120, "ms": 2600},
        hold(0.6 + BAR, F, snap="bar", ms=2830),
        hold(0.6 + 2 * BAR, G, snap="bar", ms=2830),
        {"at": 0.5 + 3 * BAR + 0.45, "op": "click", "sel": ".pf-pad:has-text('Take')"},
        {"at": 0.5 + 3 * BAR + 1.3, "op": "mark", "name": "toast", "sel": "#toasts .toast"},
        {"at": 0.5 + 3 * BAR + 1.3, "op": "log", "name": "after take", "js": "document.querySelector('.pf-name').textContent + ' | ' + document.querySelector('.pf-pad.primary').textContent + ' | ' + document.querySelector('.pf-offer').textContent.trim().slice(0, 100) + ' | ' + document.querySelector('.pf-status').textContent + ' | ' + document.getElementById('toasts').textContent.slice(0, 160)"},
        hold(0.6 + 3 * BAR, C, snap="bar", ms="end"),
    ],
})

# ---- title: the whole instrument, idle, under the title card; then the map.
shots.append({
    "id": "to-map", "beat": "title", "pre": 0.5,
    "setup": perform_settled("Glass Pad") + [QUIET],
    "marks": {"tabs": ".viewtabs", "bank": "aside.bank", "dock": "footer.keybar", "top": ".menubar-right", "piano": "#piano", "filters": ".bank-filters"},
    "actions": [],
})

# ---- views: the four tabs, each in use. The duel's pair is rendered in
# set-up (▶ A and ▶ B, heard once off camera), so ▶ on camera sounds at once.
# Once both are in, EVOLVE deals the next pair ahead, so the pick on camera
# puts it up at once.
shots.append({
    "id": "to-views", "beat": "views", "pre": 0.5,
    "setup": [
        {"op": "preset", "name": "Glass Pad"},
        {"op": "view", "v": "evolve"},
        {"op": "wait", "ms": 1500},
        {"op": "click", "sel": "#play-a"},
        {"op": "until", "sel": "#play-a.playing", "ms": 60000},
        {"op": "wait", "ms": 800},
        {"op": "click", "sel": "#play-b"},
        {"op": "until", "sel": "#play-b.playing", "ms": 60000},
        {"op": "until", "js": "!document.querySelector('#play-b.playing')", "ms": 20000},
        {"op": "log", "name": "duel", "js": "document.getElementById('name-a').textContent + ' vs ' + document.getElementById('name-b').textContent"},
        {"op": "view", "v": "perform"},
        {"op": "measured", "name": "Glass Pad"},
        WIRING,
        QUIET,
    ],
    "marks": {"tabs": ".viewtabs", "perform": TAB("perform"), "patch": TAB("play"), "evolve": TAB("evolve"), "taste": TAB("taste"), "deck": ".pf-deck", "up": UP},
    "actions": [
        hold(0.2, C, until="views2:PERFORM-0.05"),
        hold("views2:PERFORM", AM, until="views3:PATCH-0.1"),
        {"at": "views2:PERFORM+0.25", "op": "drag", "sel": UP, "dy": -55, "ms": 1000},
        {"at": "views3:PATCH-0.25", "op": "click", "sel": TAB("play")},
        hold("views3:PATCH", F, until="views4:EVOLVE-0.3"),
        {"at": "views3:inside", "op": "mark", "name": "rack", "sel": "#rack-scroll"},
        {"at": "views3:every", "op": "drag", "sel": "#rack-svg [data-addr='node/0#cut']", "dy": -45, "ms": 1700},
        {"at": "views4:EVOLVE-0.25", "op": "click", "sel": TAB("evolve")},
        {"at": "views4:plays", "op": "click", "sel": "#play-a"},
        {"at": "views4:plays+0.1", "op": "mark", "name": "cards", "sel": ".duel-row"},
        {"at": "views4:sounds+0.3", "op": "click", "sel": "#play-b"},
        {"at": "views4:like-0.2", "op": "log", "name": "pair", "js": "document.getElementById('name-a').textContent + ' vs ' + document.getElementById('name-b').textContent"},
        {"at": "views4:like", "op": "click", "sel": "#choose-b"},
        # The next pair is up at once: it was dealt ahead while this one played.
        {"at": "views4:like+0.4", "op": "log", "name": "next pair", "js": "document.getElementById('name-a').textContent + ' vs ' + document.getElementById('name-b').textContent"},
        {"at": "views4:breeds", "op": "log", "name": "picks", "js": "document.getElementById('duel-count').textContent + ' picks · ' + document.getElementById('name-a').textContent + ' vs ' + document.getElementById('name-b').textContent + ' · ' + " + SLOT_JS},
        {"at": "views5:TASTE-0.25", "op": "click", "sel": TAB("taste")},
        # C over the map, to the end of the beat: the chapter resolves.
        hold("views5:TASTE+0.3", C, ms="end"),
        {"at": "views5:learned", "op": "mark", "name": "map", "sel": "#taste-crt"},
    ],
})

# ---- bank: three lists, then ▶ one row and open it. A progression on
# Glass Pad under the first four lines; the audition after it. The row opens
# as it is clicked (its sound was just heard, and its wiring came with it):
# no cut, and its chords wait for it to land rather than for a clock.
shots.append({
    "id": "to-bank", "beat": "bank", "pre": 0.5,
    "setup": [
        {"op": "preset", "name": "Glass Pad"},
        {"op": "view", "v": "play"},
        {"op": "until", "sel": "#belief .bl-u", "ms": 90000},
        SETTLED,
        *([{"op": "click", "sel": ".bf[data-f='mine']"},
           {"op": "wait", "ms": 800},
           {"op": "click", "sel": PAD_HEAR},
           {"op": "wait", "ms": 9000},
           {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"}] if PREHEAR else []),
        {"op": "click", "sel": ".bf[data-f='pool']"},
        {"op": "eval", "js": "document.getElementById('bank-list').scrollTop = 0"},
        {"op": "wait", "ms": 1200},
        {"op": "log", "name": "mine", "js": "[...document.querySelectorAll('.bank-item.saved .bi-name')].map((n) => n.textContent).join(', ')"},
        QUIET,
    ],
    "marks": {"rail": "#bank-list", "filters": ".bank-filters", "presets": ".bf[data-f='preset']", "pool": ".bf[data-f='pool']", "mine": ".bf[data-f='mine']", "rack": "#rack-scroll", "pct": "#bank-list .bank-item .bi-pct"},
    "actions": [
        hold(0.2, AM, until="bank2-0.05"),
        hold("bank2", F, until="bank3-0.05"),
        hold("bank3", C, until="bank4-0.05"),
        hold("bank4", G, until="bank5-0.1"),
        {"at": "bank2:Presets-0.2", "op": "click", "sel": ".bf[data-f='preset']"},
        {"at": "bank3:Evolution-0.2", "op": "seq", "steps": [{"op": "click", "sel": ".bf[data-f='pool']"}, {"op": "eval", "js": "document.getElementById('bank-list').scrollTop = 0"}]},
        {"at": "bank3:guess", "op": "mark", "name": "pct", "sel": "#bank-list .bank-item .bi-pct"},
        {"at": "bank4:patches-0.3", "op": "click", "sel": ".bf[data-f='mine']"},
        {"at": "bank4:save", "op": "mark", "name": "row", "sel": "#bank-list .bank-item"},
        {"at": "bank4:save", "op": "log", "name": "rows", "js": "[...document.querySelectorAll('#bank-list .bank-item .bi-name')].map((n) => n.textContent).join(', ')"},
        {"at": "bank5:play-0.15", "op": "click", "sel": PAD_HEAR},
        {"at": "bank5:play+0.1", "op": "mark", "name": "hear", "sel": PAD_HEAR},
        {"at": "bank5:Click-0.25", "op": "seq", "steps": [{"op": "eval", "js": "document.activeElement && document.activeElement.blur()"}, {"op": "key", "key": " ", "ms": 60}]},
        {"at": "bank5:Click-0.1", "op": "seq", "steps": [
            {"op": "eval", "js": "window.__subject = document.getElementById('rack-subject').textContent"},
            {"op": "click", "sel": PAD_NAME},
            {"op": "until", "js": "document.getElementById('rack-subject').textContent !== window.__subject", "ms": 90000, "stamp": "opened"},
            {"op": "log", "name": "opened", "js": "document.getElementById('rack-subject').textContent"},
        ]},
        {"at": "bank5:Click+0.4", "op": "mark", "name": "padrow", "sel": PAD_ROW},
        # The row's own sound, live, the moment it lands.
        hold("@opened+0.35", AM, ms=1300),
        hold("@opened+1.7", F, ms="end"),
    ],
})

# ---- dock: three ways in, then Hold and the arpeggiator at 84, glide on the
# running arpeggio, and ● rec pressed on camera (a real take, and its toast).
shots.append({
    "id": "to-dock", "beat": "dock", "pre": 0.5,
    "setup": perform_settled("Acid Line") + [
        {"op": "eval", "js": "const b=document.getElementById('bpm'); b.value='84'; b.dispatchEvent(new Event('change'))"},
        QUIET,
    ],
    "marks": {"keybar": "footer.keybar", "piano": "#piano", "c3": ".pkey[data-note='48']", "c4": ".pkey[data-note='60']", "hold": "#hold-btn", "arp": "#arp-btn", "glide": "#glide", "rec": "#rec-btn", "midi": "#midi-ind", "vol": "#vol"},
    "actions": [
        # Under the first line, a bass figure on the keys on screen, in eighths
        # at 84 (C3 C3 G3 B♭3 G3 …), where the camera is looking.
        *[{"at": "dock1:bottom%+.2f" % (i * 0.357 - 0.1), "op": "press", "sel": key_sel(n), "fx": 0.5, "fy": 0.8, "ms": 170}
          for i, n in enumerate([48, 48, 55, 58, 55, 48, 48, 55])],
        {"at": "dock2:screen-0.15", "op": "press", "sel": ".pkey[data-note='48']", "fx": 0.5, "fy": 0.85, "ms": 260},
        {"at": "dock2:screen+0.25", "op": "press", "sel": ".pkey[data-note='55']", "fx": 0.5, "fy": 0.85, "ms": 260},
        hold("dock2:computer-0.1", ["a"], ms=180),
        hold("dock2:computer+0.14", ["d"], ms=180),
        hold("dock2:computer+0.38", ["g"], ms=180),
        hold("dock2:computer+0.62", ["h"], ms=260),
        {"at": "dock2:MIDI-0.1", "op": "midi", "note": 57, "vel": 112, "ms": 200},
        {"at": "dock2:MIDI+0.15", "op": "midi", "note": 60, "vel": 96, "ms": 200},
        {"at": "dock2:MIDI+0.4", "op": "midi", "note": 64, "vel": 104, "ms": 320},
        {"at": "dock3:Hold-0.2", "op": "click", "sel": "#hold-btn"},
        hold("dock3:chord-0.1", AM, ms=450),
        {"at": "dock3:arpeggiator-0.3", "op": "seq", "steps": [
            {"op": "click", "sel": "#arp-btn"},
            {"op": "select", "sel": "#arp-mode", "value": 2},
            {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
            {"op": "move", "sel": "#arp-ctl", "ms": 300},
            {"op": "mark", "name": "drawer", "sel": "#arp-ctl"},
            {"op": "mark", "name": "tempo", "sel": "#bpm"},
        ]},
        {"at": "dock3:time", "op": "log", "name": "arp", "js": "[document.getElementById('arp-mode').selectedOptions[0].textContent, document.getElementById('bpm').value + ' bpm', document.getElementById('arp-ctl').classList.contains('open') ? 'drawer open' : 'drawer shut', document.getElementById('hold-btn').classList.contains('lit') ? 'hold lit' : 'hold off', document.getElementById('arp-btn').classList.contains('lit') ? 'arp lit' : 'arp off'].join(' · ')"},
        {"at": "dock4:glide-0.2", "op": "drag", "sel": "#glide", "ox": -18, "dx": 26, "ms": 700},
        {"at": "dock4:slides", "op": "log", "name": "glide", "js": "document.getElementById('glide-val').textContent"},
        {"at": "dock5:Record-0.15", "op": "click", "sel": "#rec-btn"},
        {"at": "dock5:Record+0.8", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
        {"at": "dock5:volume+0.3", "op": "click", "sel": "#rec-btn"},
        {"at": "dock5:volume+1.1", "op": "mark", "name": "saved", "sel": "#toasts .toast:last-child"},
        {"at": "dock5:volume+1.1", "op": "log", "name": "toasts", "js": "document.getElementById('toasts').textContent"},
    ],
})

# ---- up top: the counters, the job slot, the help card, the ⋯ menu. Nothing
# plays: the bed is up under this one. A generation is breeding (EVOLVE POOL,
# pressed in set-up): it takes minutes on the render farm beside the player,
# so the shot waits for its first child and films the slot mid-generation
# ("⚡ breeding 1/10 · about 3 min") and EVOLVE POOL as its amber progress
# bar. The pointer leaves EVOLVE POOL, whose hover marks the rows a
# generation may replace. The counters sit left of the slot, so they are
# measured again as they are named.
shots.append({
    "id": "to-header", "beat": "header", "pre": 0.5,
    "setup": [
        {"op": "preset", "name": "Glass Pad"},
        {"op": "view", "v": "evolve"},
        {"op": "wait", "ms": 1500},
        {"op": "click", "sel": "#evolve-btn"},
        {"op": "move", "sel": ".duel-row", "ms": 300},
        {"op": "until", "js": "/breeding [1-9][0-9]*\\/[0-9]+/.test(document.getElementById('job-text').textContent)", "ms": 300000},
        {"op": "log", "name": "counters", "js": "document.getElementById('duel-count').textContent + ' picks, gen ' + document.getElementById('gen-count').textContent + ' · ' + " + SLOT_JS + " + ' · EVOLVE POOL: ' + document.getElementById('evolve-btn').textContent"},
        QUIET,
    ],
    "marks": {"picks": "#duel-count", "gen": "#gen-count", "slot": "#job-slot", "evolve": "#evolve-wrap", "top": ".menubar-right", "help": "#help-open", "ovf": "#ovf-btn", "lamp": "#wm-lamp"},
    "actions": [
        {"at": "header1:PICKS-0.1", "op": "mark", "name": "picks", "sel": "#duel-count"},
        {"at": "header1:number-0.1", "op": "mark", "name": "gen", "sel": "#gen-count"},
        {"at": "header1b:slot-0.1", "op": "mark", "name": "slot", "sel": "#job-slot"},
        {"at": "header1b:slot", "op": "log", "name": "slot", "js": SLOT_JS + " + ' · EVOLVE POOL: ' + document.getElementById('evolve-btn').textContent + ' · gen ' + document.getElementById('gen-count').textContent"},
        {"at": "header2:question-0.2", "op": "click", "sel": "#help-open"},
        {"at": "header2:question+0.3", "op": "mark", "name": "card", "sel": "#help .help-card"},
        {"at": "header3-0.4", "op": "key", "key": "Escape", "ms": 80},
        {"at": "header3:dots-0.2", "op": "seq", "steps": [
            {"op": "click", "sel": "#ovf-btn"},
            {"op": "mark", "name": "menu", "sel": "#ovf-menu"},
            {"op": "mark", "name": "export", "sel": "#patch-export-btn"},
            {"op": "mark", "name": "profile", "sel": "#export-btn"},
            {"op": "mark", "name": "films", "sel": "#films-link"},
        ]},
        {"at": "header3:files-0.1", "op": "move", "sel": "#patch-export-btn", "ms": 300},
        {"at": "header3:taste-0.1", "op": "move", "sel": "#export-btn", "ms": 300},
        {"at": "header3:films-0.1", "op": "move", "sel": "#films-link", "ms": 300},
        {"at": "header3:films+0.5", "op": "log", "name": "slot at the end", "js": SLOT_JS + " + ' · gen ' + document.getElementById('gen-count').textContent"},
    ],
})

# ---- first visit: the warm start on camera, then PERFORM. A fresh session:
# its own set-up stops at the nine cards. "teach it" takes seconds, then the
# view turns to PERFORM: the beat cuts from the press to just before it.
shots.append({
    "id": "to-first", "beat": "first", "pre": 0.5, "own_setup": True,
    "clips": [["first3-0.15", "@learned-0.4"]],
    "setup": [
        {"op": "until", "sel": "#warmstart:not(.hidden)", "ms": 180000},
        FILLED,
        MIDI_DEV,
        QUIET,
        *([{"op": "click", "sel": pick("bass", " + .wi-play")},
           {"op": "until", "sel": ".wi-play.playing", "ms": 120000},
           {"op": "wait", "ms": 1200},
           {"op": "click", "sel": pick("bass", " + .wi-play")},
           {"op": "until", "js": "!document.querySelector('.wi-play.playing')", "ms": 10000},
           {"op": "eval", "js": "document.activeElement && document.activeElement.blur()"},
           QUIET] if PREHEAR else []),
        {"op": "log", "name": "deal", "js": "[...document.querySelectorAll('.warm-item .wi-name')].map((n) => n.textContent).join(', ')"},
    ],
    "marks": {"card": "#warmstart .warm-card", "grid": "#warm-grid", "go": "#warm-go", "bass": pick("bass")},
    "actions": [
        # ▶ on the bass card as the narrator says "it asks": its five-second
        # phrase runs under "Play them, pick three…" up to the cut.
        {"at": "first1:asks-0.1", "op": "click", "sel": pick("bass", " + .wi-play")},
        {"at": "first1:asks+0.1", "op": "until", "sel": ".wi-play.playing", "ms": 20000, "stamp": "heard"},
        {"at": "first2:pick-0.1", "op": "seq", "steps": [
            {"op": "click", "sel": pick("bass")},
            {"op": "wait", "ms": 220},
            {"op": "click", "sel": pick("pad")},
            {"op": "wait", "ms": 220},
            {"op": "click", "sel": pick("texture")},
        ]},
        {"at": "first2:teach-0.1", "op": "click", "sel": "#warm-go"},
        {"at": "first2:teach+0.2", "op": "seq", "steps": [
            {"op": "until", "sel": ".viewtab[data-view='perform'][aria-selected='true']", "ms": 180000, "stamp": "taught"},
            {"op": "until", "js": "/preferences learned/.test(document.getElementById('toasts').textContent)", "ms": 60000, "stamp": "learned"},
            # PERFORM on the first pick (the bass card), whatever it showed first.
            {"op": "until", "js": "%s.some((n) => (document.querySelector('.pf-name')?.textContent || '').trim().startsWith(n))" % json.dumps(CATS["bass"]), "ms": 60000, "stamp": "landed"},
        ]},
        {"at": "first3:eighteen", "op": "mark", "name": "toast", "sel": "#toasts .toast"},
        {"at": "first3:eighteen", "op": "mark", "name": "picks", "sel": "#duel-count"},
        {"at": "first3:eighteen", "op": "log", "name": "landed", "js": "document.getElementById('duel-count').textContent + ' picks · ' + " + SLOT_JS + " + ' · PICKS at x ' + Math.round(document.getElementById('duel-count').getBoundingClientRect().x) + ' · ' + document.getElementById('toasts').textContent.slice(0, 160)"},
        # The refit after the warm start shows in the job slot beside the
        # counters; if it ends under the "18 picks" callout, PICKS moves.
        {"at": "first4-0.25", "op": "log", "name": "picks moved?", "js": "'PICKS at x ' + Math.round(document.getElementById('duel-count').getBoundingClientRect().x) + ' · ' + " + SLOT_JS},
        # PERFORM is open on the first pick: a soft pulse from the MIDI keyboard
        # (quarters at 84, velocity 64) under the result, before the full
        # figure on "ready to play".
        *[{"at": "first3+%.2f" % (0.5 + i * 0.714), "op": "midi", "note": n, "vel": 64, "ms": 300}
          for i, n in enumerate([48, 48, 55, 57, 48, 48, 55, 53])],
        {"at": "first4:saved", "op": "mark", "name": "mine", "sel": ".bf[data-f='mine']"},
        # The pick's wiring came with it, so its controls work at once while
        # PERFORM re-measures it in the background ("… · re-checking").
        {"at": "first4:ready-0.1", "op": "log", "name": "perform", "js": "(document.querySelector('.pf-name')?.textContent || '') + ' · ' + (document.querySelector('.pf-status')?.textContent || '')"},
        {"at": "first4:ready-0.1", "op": "log", "name": "wiring", "js": WIRING["js"]},
        # A 303 figure on the first pick, in eighths at 84: C C C' C G A C…,
        # with a control turned up under it: ready to play, controls and all.
        *[hold("first4:ready+%.2f" % (i * 0.357), [k], ms=230) for i, k in enumerate(["a", "a", "k", "a", "g", "h", "a", "k"])],
        {"at": "first4:ready+0.6", "op": "drag", "sel": UP, "dy": -50, "ms": 1600},
        hold("first4:ready+%.2f" % (8 * 0.357), ["a"], ms="end"),
    ],
})

# ---- where next: a film per view, each tab clicked as its film is named.
shots.append({
    "id": "to-next", "beat": "next", "pre": 0.5,
    "setup": perform_settled("Glass Pad") + [
        {"op": "view", "v": "taste"},
        {"op": "wait", "ms": 1200},
        QUIET,
    ],
    "marks": {"tabs": ".viewtabs", "perform": TAB("perform"), "patch": TAB("play"), "evolve": TAB("evolve"), "taste": TAB("taste")},
    "actions": [
        {"at": "next2:PERFORM-0.25", "op": "click", "sel": TAB("perform")},
        {"at": "next3:PATCH-0.25", "op": "click", "sel": TAB("play")},
        {"at": "next4:EVOLVE-0.25", "op": "click", "sel": TAB("evolve")},
        {"at": "next5:TASTE-0.25", "op": "click", "sel": TAB("taste")},
    ],
})

# Each shot's capture stops half a second after its beat ends (the film shows
# a beat until 0.25 s past its end; footage.mjs records to 0.8 s past it).
# Keyed to the beat's last line, so the time maps through any cut.
def capture_off(sh):
    beat = next(b for b in TL["beats"] if b["id"] == sh["beat"])
    lines = [l for l in TL["lines"] if l["beat"] == sh["beat"]]
    if not lines:
        return {"at": round(beat["t1"] - beat["t0"] + sh.get("pre", 0) + 0.5, 2), "op": "rec", "on": False}
    last = lines[-1]
    return {"at": "%s+%.2f" % (last["id"], beat["t1"] + 0.5 - last["t0"]), "op": "rec", "on": False}


for sh in shots:
    sh["actions"].append(capture_off(sh))

spec = {"viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": INIT, "setup": TEACH, "shots": shots}
dump(spec, os.path.join(FDIR, "shots.json"))
print(f"{len(shots)} shots → {os.path.relpath(os.path.join(FDIR, 'shots.json'))}")
