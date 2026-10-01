import sys
from pathlib import Path
P = Path(__file__).parent
t = (P / "template.html").read_text()
views = "\n".join((P / f"{v}.js").read_text() for v in ["perform", "patch", "evolve", "taste", "model", "own", "stage", "explain"] if (P / f"{v}.js").exists())
notes = (P / "notes.html").read_text() if (P / "notes.html").exists() else "<h2>Notes</h2>"
out = (t.replace("/*CSS*/", (P / "style.css").read_text())
        .replace("<!--NOTES-->", notes)
        .replace("/*DATA*/", (P / "data.js").read_text())
        .replace("/*CORE*/", (P / "core.js").read_text())
        .replace("/*VIEWS*/", views))
(P / "auracle-vision.html").write_text(out)
# a local preview needs a full document
# the local preview carries the host's reset, as the artifact viewer does, so a
# rule the host outranks shows up in testing and not first on someone's phone
HOST = "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.4 -apple-system,system-ui,sans-serif;background:#f6f5f2;color:#1a1a1a}img{max-width:100%}[hidden]{display:none!important}</style>"
(P / "preview.html").write_text("<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover'>" + HOST + "</head><body>" + out + "</body></html>")
print(round(len(out) / 1e6, 2), "MB")
