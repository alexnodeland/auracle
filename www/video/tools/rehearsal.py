#!/usr/bin/env python3
"""Summarise a film's rehearsal (footage.mjs --dry): one line per shot with
its errors, length, worst lateness, stamps and cuts, then what each `log`
read and any action that held the page longer than 4 s.

usage: rehearsal.py FILM      (exit 1 unless every shot passes)
"""
import json, os, sys
VIDEO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
film = sys.argv[1]
d = os.path.join(VIDEO, "out", film, "dry")
spec = json.load(open(os.path.join(VIDEO, "films", film, "shots.json")))
ok = 0
for sh in spec["shots"]:
    p = f"{d}/{sh['id']}.json"
    if not os.path.exists(p):
        print(f"{sh['id']:<14} NOT REHEARSED")
        continue
    m = json.load(open(p))
    errs = m.get("errors", [])
    ok += not errs and not m.get("failed")
    late = max([x.get("late", 0) for x in m.get("late", [])] or [0])
    slow = [f"{x['op'][:28]}@{x['at']} took {x['took']}s" for x in m.get("late", []) if x.get("took", 0) > 4 and not x["op"].startswith(("hold", "until", "midi"))]
    print(f"{sh['id']:<14} {'FAILED ' if m.get('failed') else ''}{'ok' if not errs else str(len(errs)) + ' errors'} · {m.get('dur', 0):.1f}s · late≤{late:.2f}s"
          + (f" · stamps {json.dumps({k: round(v, 1) for k, v in m['stamps'].items()})}" if m.get("stamps") else "")
          + (f" · clips {m['clips']}" if m.get("clips") else ""))
    for e in errs:
        print(f"      ! {e}")
    for l in m.get("logs") or []:
        print(f"      · {l['name']}: {str(l.get('value'))[:150]}")
    for s in slow:
        print(f"      ~ {s}")
print(f"{film}: {ok}/{len(spec['shots'])} shots pass")
sys.exit(0 if ok == len(spec['shots']) else 1)
