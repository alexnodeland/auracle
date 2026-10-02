"""Shared pieces for generating a walkthrough's shots.json (tools/footage.mjs).

A film's generator (films/<film>/gen_shots.py) imports these, builds the spec
as data, and writes it with `dump`, one step per line, so a regenerated file
diffs like a hand-written one:

    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
    from shotgen import INIT, FILLED, QUIET, WIRING, pick, taught, perform, dump

- INIT seeds Math.random before the app boots, so every shot runs the same
  session: the same pool, warm-start deal and duel sides. That is what makes a
  rehearsal predict the recording.
- FILLED waits for a pool of 40; QUIET for the toasts to clear; WIRING logs
  how PERFORM wired this patch (controls move with the session, so pick them
  by what they do, not by name).
- pick() finds a warm-start card by index, by name, as the first card of a
  category, or as the first one on the shortlist ("cast"); taught() answers
  the warm start, re-deals the duel (REDEAL) and optionally votes.
- CAST is the preset each role plays, from the films' shortlist, and dump()
  refuses a shot that plays one off it without a reason (§ the cast, below).
- DEALS (in INIT) keeps every pair the engine deals, in order, in
  `window.__deals`; REDEAL skips until the pair on the table is the fifth one
  dealt (REDEAL_AT), each skip once the pair behind the table has been dealt,
  so the pair on the table is the same in every take.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sound_defaults  # noqa: E402

# The pairs the engine deals ahead (main.js requestAhead), watched passively:
# an extra "message" listener on each worker, so the app's own handlers see the
# same messages in the same order. REDEAL waits on it. It draws nothing from
# Math.random, so it changes no session.
DEALS = ("(() => { const N = window.Worker; const d = (window.__deals = { all: [], ahead: null, aheads: 0 }); "
         "window.Worker = class extends N { constructor(...a) { super(...a); this.addEventListener('message', (e) => { "
         "const m = e.data; if (!m || m.type !== 'duel') return; if (!m.pair) { d.none = (d.none || 0) + 1; return; } d.all.push(m.pair); "
         "if (m.ahead) { d.ahead = m.pair || null; d.aheads += 1; } }); } }; })();")
SEED = "(() => { let s = 20260927 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();"
INIT = SEED + " " + DEALS
FILLED = {"op": "until", "js": "Number(document.querySelector(\".bf-n[data-n='pool']\")?.textContent || 0) >= 40", "ms": 300000}
QUIET = {"op": "until", "js": "!document.querySelector('#toasts .toast')", "ms": 45000}
WIRING = {"op": "log", "name": "wiring", "js": "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.querySelector('.pf-k-name').textContent + ':' + (k.classList.contains('search') ? 'search' : k.classList.contains('half-lo') ? 'up' : k.classList.contains('half-hi') ? 'down' : 'both')).join(' ')"}
# The preset library by category (crates/auracle-grammar/src/presets.rs). The
# warm start deals one card per category, then fills to nine, so a category
# always has a card on the grid, whichever cards the session deals.
CATS = {
    "bass": ["First Bass", "Sub & Sparkle", "Acid Line", "Reese", "Anvil", "Iron Bass", "Held Under"],
    "pad": ["Cathedral", "Glass Pad", "Detune Dream", "Ember", "Slow Weather", "Morph Pad", "Sweep Machine",
            "Sea Change", "Pump Room", "Tidal", "Nine Against Four"],
    "texture": ["Noise Wash", "Dub Echo", "Static Ocean", "Rotor", "Long Room", "Handheld", "Jet Wash",
                "Cloud Chamber", "Vox Machina", "Glass Rain", "One Way", "Loom", "Long Way Down"],
}

# ---- the cast ----------------------------------------------------------------
# A film casts what it plays (RFC-007 part 2, ADR-014): every preset a shot
# loads, opens from the bank or plays from the warm start is on the
# shortlist in www/brand/sound.json (`cast.shortlist`, through
# sound_defaults.SHORTLIST): sixteen presets measured quiet of noise, round
# and low in roughness. Bells, tines and plucks are excluded by name. An
# offer a shot grows is cast by what it grows from: it is grown from a
# shortlisted preset, and the shot logs what grew (B's own description).
# Sounds the session deals (the pool, a duel, the warm start's other cards)
# are not a shot's choice; they are logged, not cast. Later the sonic floor
# (RFC-005) decides those too.
#
# CAST is the preset each role plays, chosen from the shortlist by what the
# shots need of it, and checked against the wiring each preset ships with
# (apps/web/perform-wirings.json): the named controls a shot's gestures pick
# by what they do must reach this patch that way. A session re-measures its
# wiring, so the rehearsal's WIRING log is the final word.
#
# dump() refuses a shot that plays an off-list preset, unless the shot lists
# it in "uncast" with the reason (a line names that preset or describes its
# circuit, so it can only change with the script). It writes what each shot
# plays as the shot's "cast", and prints the exceptions every time it runs.
SHORTLIST = [n for names in sound_defaults.SHORTLIST["roles"].values() for n in names]
_WIRINGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "apps", "web", "perform-wirings.json")
with open(_WIRINGS, encoding="utf-8") as _f:
    _SHIPPED = {p["name"]: p["data"] for p in json.load(_f)["presets"]}
# Mirrors apps/web/perform.js's HALF_OPEN: a half its renders did not confirm is closed.
_HALF_OPEN = 0.075


def shipped_wiring(name):
    """How each named control reaches `name` as it ships: {"Bright": "both" | "up" | "down" | "search", …},
    the classes the shots pick controls by (WIRING logs the same for a session)."""
    out = {}
    for w in _SHIPPED[name]["wiring"]:
        if w["search"]:
            out[w["name"]] = "search"
            continue
        lo = w["down"] is None or w["down"] >= _HALF_OPEN
        hi = w["up"] is None or w["up"] >= _HALF_OPEN
        out[w["name"]] = "both" if lo and hi else "up" if hi else "down" if lo else "search"
    return out


def cast(name, **needs):
    """`name`, if it is on the shortlist and reaches each named control as
    `needs` says (Space="up": Space turns toward far only); else stop."""
    if name not in SHORTLIST:
        raise ValueError(f"shotgen.cast: {name!r} is not on the shortlist (www/brand/sound.json cast.shortlist)")
    wired = shipped_wiring(name)
    wrong = {k: wired.get(k) for k, v in needs.items() if wired.get(k) != v}
    if wrong:
        raise ValueError(f"shotgen.cast: {name} ships wired {wrong}, not {needs} (apps/web/perform-wirings.json)")
    return name


CAST = {
    # Chords and swells (Glass Pad's part until now). It has Glass Pad's
    # layout: a supersaw into a filter an LFO sweeps, with the same knob
    # addresses inside it (node/0#cut, node/0/m#rate…). Its filter is a band
    # pass where Glass Pad's is a low pass, and a reverb holds it where Glass
    # Pad has a chorus. Bright, Snap, Motion and Body ship turning both ways
    # (Grit is a search control, Space turns toward close), so a gesture
    # picked by what it does finds one.
    "pad": cast("Slow Weather", Bright="both", Motion="both"),
    # The honest controls: a pad where Space turns toward far only and Grit
    # cannot reach (it asks for a variant), as the lines say.
    "pad_far": cast("Morph Pad", Space="up", Grit="search"),
    # Runs, accents and touch (Tine's part): a quick attack and a vibrato,
    # with Bright for the touch row.
    "lead": cast("Wobble Board", Bright="both"),
    # A filter swept under an arpeggio (Acid Line's part): a ladder filter at
    # the root over a saw an octave down, Acid Line's circuit, with the same
    # node#cut, node#res and node#mdepth.
    "acid": cast("Ceiling", Bright="both"),
    # The bass: the shortlist's only one.
    "bass": cast("Held Under", Bright="both"),
    # A moving texture: a square through a filter that a random source moves
    # about once a second.
    "texture": cast("Rotor"),
}


def pick(p, then=""):
    """A warm-start card: by index, by name, the first card of a category, or
    "cast", the first card on the grid that is on the shortlist. A card to
    pick (no `then`) is one not picked yet, so a later pick by category can
    never click the cast card again and un-pick it."""
    if isinstance(p, int):
        return ".warm-item >> nth=%d" % p
    names = SHORTLIST if p == "cast" else CATS.get(p, [p])
    card = ".warm-item:not(.picked)" if not then else ".warm-item"
    return ", ".join("%s:has(.wi-name:text-is('%s'))%s" % (card, n, then) for n in names)


# Before a shot plays or picks the warm start's card on the shortlist: the
# deal, logged, and a clear stop when it holds none (the deal moves whenever
# the app draws one more random number at boot).
CAST_DEALT = {"op": "log", "name": "cast card", "js": (
    "(() => { const cast = " + json.dumps(SHORTLIST) + ";"
    " const deal = [...document.querySelectorAll('.warm-item .wi-name')].map((e) => e.textContent.trim());"
    " const c = deal.find((n) => cast.includes(n));"
    " if (!c) throw new Error('shotgen: the warm start dealt no card on the shortlist: ' + deal.join(', '));"
    " return c + ' (deal: ' + deal.join(', ') + ')'; })()")}


def taught(votes=0, picks=(0, 4, 7), redeal=True):
    s = [
        {"op": "until", "sel": "#warmstart:not(.hidden)", "ms": 180000},
        FILLED,
    ] + ([CAST_DEALT] if "cast" in picks else []) + [{"op": "click", "sel": pick(p)} for p in picks] + [
        {"op": "click", "sel": "#warm-go"},
        {"op": "until", "sel": "#belief .bl-u", "state": "attached", "ms": 180000},
    ]
    if redeal:
        s += [REDEAL]
    if votes:
        s += [{"op": "view", "v": "evolve"}, {"op": "wait", "ms": 2000}]
        for i in range(votes):
            s += [{"op": "click", "sel": "#choose-a" if i % 2 == 0 else "#choose-b"}, {"op": "wait", "ms": 1500}]
    # Fitted: the wordmark's E stops thinking, and the one engine thread is free.
    s += [{"op": "until", "js": "!document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 240000}]
    return s
# The duel's first pair is dealt at "playable", while the pool is still
# filling, the pair behind it is dealt ahead as soon as the first pair's sounds
# are in, and a pair is dealt again when one of its patches leaves the pool.
# So how many pairs have been dealt by the time the pool is full depends on
# timing, while the engine's deals come in the same order in every take (its
# duel stream is its own, ADR-001). REDEAL skips (skip records nothing) until
# the pair on the table is the REDEAL_AT-th pair dealt, from the full pool, so
# the table and every later deal are the same in every take. Each skip waits
# for the table's sounds and for the pair behind it to be dealt (a skip before
# that deal lands would race it). One fixed skip was enough while a pair was
# dealt only once the one before it was answered. Run in any view: it presses
# the app's own skip button. Not yet exact: a deal from the filling pool
# draws from the engine's duel stream a number of times that depends on the
# pool's size (rejection sampling), so a take whose early deals met a
# smaller pool can deal other pairs later (the tour rehearsal of 29
# September: 11 taught takes agreed, one did not). Its log lists every deal.
REDEAL_AT = 5
REDEAL = {"op": "log", "name": "redeal", "js": r"""(async () => {
const K = %d;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { let v = false; try { v = fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('redeal: timed out waiting for ' + what); await sleep(150); }
}
const d = window.__deals;
if (!d) throw new Error('redeal: shotgen.DEALS is not in this film\'s init');
const dealt = () => !$('choose-a').disabled && !$('duel-a').classList.contains('dealing');
const ids = () => [...document.querySelectorAll('#name-a .dn-id, #name-b .dn-id')].map((e) => Number(e.textContent.replace(/\D/g, '')));
const same = (p, q) => !!(p && q && p.length === 2 && q.length === 2 && p.includes(q[0]) && p.includes(q[1]));
const names = () => ids().map((i) => '#' + i).join(' | ');
// Which deal the pair on the table is (1-based; 0 if not seen). A reply with
// no pair (a pool too small to deal from) is not counted (DEALS).
const index = () => { const t = ids(); for (let i = d.all.length - 1; i >= 0; i--) if (same(d.all[i], t)) return i + 1; return 0; };
const out = [];
for (let i = 0; i < 12; i++) {
  await until(() => dealt() && !document.querySelector('#play-a.pending, #play-b.pending'), 120000, 'the pair to render');
  const table = ids();
  // The pair behind it. A deal that repeats the table's pair is refused by
  // the app and asked again; after three refusals it stops asking, and so
  // does this wait.
  await until(() => d.ahead && !same(d.ahead, table), 30000, 'the next pair, dealt ahead').catch(() => {});
  const n = index();
  out.push(names() + ' (deal ' + n + ')');
  if (n >= K) break;
  const was = names();
  $('skip-duel').click();
  await until(() => dealt() && names() !== was, 60000, 'a new pair');
}
if (index() !== K) throw new Error('redeal: the table is deal ' + index() + ', not ' + K + ': ' + out.join(' -> '));
return out.join(' -> ') + ' [dealt: ' + d.all.map((p) => p.join('/')).join(' ') + (d.none ? '; ' + d.none + ' with no pair' : '') + ']';
})()""" % REDEAL_AT}
def perform(name):
    return [{"op": "preset", "name": name}, {"op": "view", "v": "perform"}, {"op": "measured", "name": name}, WIRING]
_BY_NAME = re.compile(r"(?:text-is|has-text)\('([^']+)'\)")
WARM_CARD = "a warm-start card the session dealt"
SAVED_ROW = "a bank row the session saved"


def plays(steps):
    """The presets a list of steps loads (`preset`, `measured`), opens from
    the bank by name (`text-is` or `has-text`), opens by dropping a fixture
    file named for one (fixtures/First_Bass.svg), or plays from the warm
    start (a card's ▶). A selector naming several (whichever the session
    dealt or saved) is "the shortlist" when every name is on it, else
    WARM_CARD or SAVED_ROW. A drop of the shot's own export (`download`)
    reopens a patch the shot already plays, so it adds nothing."""
    out = []

    def walk(x):
        if isinstance(x, list):
            for y in x:
                walk(y)
            return
        if not isinstance(x, dict):
            return
        op, sel = x.get("op"), x.get("sel")
        if op in ("preset", "measured") and x.get("name"):
            out.append(x["name"])
        if op == "drop" and isinstance(x.get("file"), str):
            stem = os.path.splitext(os.path.basename(x["file"]))[0].replace("_", " ")
            out.append(stem if stem in _SHIPPED else f"a dropped file ({x['file']})")
        if op in ("click", "press", "dblclick") and isinstance(sel, str):
            names = [n for n in _BY_NAME.findall(sel) if n in _SHIPPED]
            cast_only = bool(names) and all(n in SHORTLIST for n in names)
            if "bank-item" in sel and names:
                out.append(names[0] if len(names) == 1 else "the shortlist" if cast_only else SAVED_ROW)
            elif "warm-item" in sel and "wi-play" in sel:
                out.append("the shortlist" if cast_only else WARM_CARD)
        for y in x.values():
            walk(y)

    walk(steps)
    return list(dict.fromkeys(out))


def casting(spec):
    """Each shot's cast, written into it, and the exceptions; stop on a shot
    that plays an off-list preset it does not list in "uncast" with a reason."""
    bad, excused = [], []
    for sh in [{"id": "(film set-up)", "setup": spec["setup"], "uncast": spec.get("uncast", {})}] + spec["shots"]:
        heard = plays([sh.get("setup", []), sh.get("actions", [])])
        uncast = sh.get("uncast", {})
        for n in heard:
            if n in SHORTLIST or n == "the shortlist":
                continue
            if n in uncast and uncast[n].strip():
                excused.append(f"{sh['id']}: {n} ({uncast[n]})")
            else:
                bad.append(f"{sh['id']}: {n}")
        for n in uncast:
            if n not in heard:
                bad.append(f"{sh['id']}: lists {n!r} in uncast, but does not play it")
        if sh["id"] != "(film set-up)":
            on = [n for n in heard if n in SHORTLIST or n == "the shortlist"]
            if on:
                sh["cast"] = on
            else:
                sh.pop("cast", None)
    if bad:
        raise SystemExit("shotgen: off the shortlist (www/brand/sound.json cast.shortlist), with no reason in the shot's "
                         "\"uncast\":\n  " + "\n  ".join(bad))
    for e in excused:
        print("  uncast " + e)


def dump(spec, path):
    casting(spec)
    # One step per line: readable diffs, and the file stays close to the hand-written films.
    def one(x):
        return json.dumps(x, ensure_ascii=False)
    out = ['{', f'  "viewport": {one(spec["viewport"])},', f'  "dpr": {spec["dpr"]},', f'  "query": {one(spec["query"])},', f'  "init": {one(spec["init"])},', '  "setup": [']
    out.append(',\n'.join('    ' + one(x) for x in spec["setup"]))
    out.append('  ],')
    out.append('  "shots": [')
    shots = []
    for sh in spec["shots"]:
        lines = ['    {']
        keys = [k for k in sh if k not in ("setup", "marks", "actions")]
        for k in keys:
            lines.append(f'      {one(k)}: {one(sh[k])},')
        lines.append('      "setup": [')
        lines.append(',\n'.join('        ' + one(x) for x in sh.get("setup", [])))
        lines.append('      ],')
        lines.append(f'      "marks": {one(sh.get("marks", {}))},')
        lines.append('      "actions": [')
        lines.append(',\n'.join('        ' + one(x) for x in sh.get("actions", [])))
        lines.append('      ]')
        lines.append('    }')
        shots.append('\n'.join(lines))
    out.append(',\n'.join(shots))
    out.append('  ]')
    out.append('}')
    text = '\n'.join(out) + '\n'
    json.loads(text)
    open(path, 'w').write(text)
