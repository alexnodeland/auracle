"""The books quote the engine's constants and fields by name, so that when one
moves it can be grepped (CONTRIBUTING § Pull requests). This makes the grep
automatic: every `SOME_CONSTANT` and `Type::field` quoted in the guide or the
reference must still exist in the code. A name that no longer does is a
sentence that is no longer true. Run from the repo root (`make dev-check`).

Only names shaped like code are checked: ALL_CAPS with an underscore, or
`Type::member`. On-screen labels (MORPH, THRESHOLD) and words are not."""
import glob
import re
import sys

BOOKS = glob.glob("www/reference/src/**/*.md", recursive=True) + glob.glob("www/docs/src/**/*.md", recursive=True)
CODE = glob.glob("crates/*/src/**/*.rs", recursive=True) + glob.glob("crates/*/examples/*.rs") + glob.glob("apps/web/*.js")
QUOTED = re.compile(r"`([A-Z][A-Z0-9]*_[A-Z0-9_]+|[A-Z][A-Za-z0-9]+::[A-Za-z_][A-Za-z0-9_]*)`")

src = "\n".join(open(f, encoding="utf-8").read() for f in CODE)
missing = {}
count = 0
for book in BOOKS:
    for m in QUOTED.finditer(open(book, encoding="utf-8").read()):
        count += 1
        name = m.group(1)
        # `Type::member` is present when both halves are (the member may be a
        # field, a method or a variant, declared apart from its type).
        parts = name.split("::")
        if not all(re.search(r"\b" + re.escape(p) + r"\b", src) for p in parts):
            missing.setdefault(name, set()).add(book)
for name, where in sorted(missing.items()):
    print(f"  `{name}` is quoted in {', '.join(sorted(where))} but no longer exists in the code")
print(f"  quoted names: {count} quotes, {len(missing)} stale")
sys.exit(1 if missing else 0)
