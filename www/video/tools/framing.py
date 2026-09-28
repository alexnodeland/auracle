#!/usr/bin/env python3
"""Contact sheets of a walkthrough's framing, from its rehearsal screenshots:
each camera keyframe's crop, with the callouts drawn where they will land.
Reports a callout outside its frame or pinned to a mark its shot never
measured. Sheets go to www/video/out/FILM/framing/BEAT.jpg.

usage: framing.py FILM [BEAT]
"""
import json, subprocess, sys, os
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
film = sys.argv[1]
beat = sys.argv[2] if len(sys.argv) > 2 else ""
data = json.loads(subprocess.check_output(["node", os.path.join(HERE, "framing.mjs"), film] + ([beat] if beat else [])))
odir = os.path.join(os.path.dirname(HERE), "out", film, "framing")
os.makedirs(odir, exist_ok=True)
sheets = {}
for p in data:
    if not os.path.exists(p["img"]):
        print(f"  {p['beat']} cam{p['i']}: no screenshot {os.path.basename(p['img'])}")
        continue
    im = Image.open(p["img"]).convert("RGB")
    d = ImageDraw.Draw(im)
    x0, y0, w, h = p["crop"]
    for c in p["calls"]:
        if "missing" in c:
            print(f"  {p['beat']} cam{p['i']}: '{c['text']}' has no mark {c['missing']}")
            continue
        lw = len(c["text"]) * 11 + 28
        lx = c["tx"] - lw if c["tx"] < c["x"] else c["tx"]
        d.line([c["x"], c["y"], c["tx"], c["ty"]], fill=(255, 180, 84), width=3)
        d.rectangle([lx, c["ty"] - 17, lx + lw, c["ty"] + 17], outline=(255, 180, 84), width=3)
        d.text((lx + 10, c["ty"] - 7), c["text"], fill=(255, 180, 84))
        out = lx < x0 or lx + lw > x0 + w or c["ty"] - 17 < y0 or c["ty"] + 17 > y0 + h or not (x0 <= c["x"] <= x0 + w and y0 <= c["y"] <= y0 + h)
        if out:
            print(f"  {p['beat']} cam{p['i']}: '{c['text']}' is OUTSIDE the frame")
    crop = im.crop((round(x0), round(y0), round(x0 + w), round(y0 + h))).resize((640, 360))
    sheets.setdefault(p["beat"], []).append(crop)
for b, crops in sheets.items():
    sheet = Image.new("RGB", (640, 360 * len(crops)))
    for i, c in enumerate(crops):
        sheet.paste(c, (0, 360 * i))
    sheet.save(f"{odir}/{b}.jpg", quality=72)
print(f"{film}: {len(sheets)} beats → {odir}/")
