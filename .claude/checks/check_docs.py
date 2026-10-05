"""Keep the agent-facing docs from rotting: every relative link and anchor in
AGENTS.md / CLAUDE.md files, docs/ and .claude/ resolves, every skill and
agent has its frontmatter, every ADR and proposal carries the fields the
principled-docs hooks require, and the site's Markdown holds no control
characters. Run from the repo root (`make dev-check`)."""
import glob
import os
import re
import sys


FILES = sorted(
    set(glob.glob("**/AGENTS.md", recursive=True) + glob.glob("**/CLAUDE.md", recursive=True))
    | set(glob.glob("docs/**/*.md", recursive=True))
    | set(glob.glob(".claude/skills/*/SKILL.md") + glob.glob(".claude/agents/*.md"))
    | set(glob.glob(".claude/README.md"))
)
SKIP = ("node_modules/", "target/", ".claude/worktrees/", "www/video/out/")
FILES = [f for f in FILES if not f.startswith(SKIP) and not any(s in f for s in SKIP)]

LINK = re.compile(r"\]\(([^)#\s]+)(#[^)\s]*)?\)")


def slug(heading):
    return re.sub(r"[^\w -]", "", heading.strip().lower()).replace(" ", "-")


def frontmatter(path):
    """Top-level keys of a file's frontmatter. Flat `key: value` lines and
    folded blocks are all it holds, so no YAML parser is needed (and CI need
    not install one)."""
    text = open(path).read()
    if not text.startswith("---\n"):
        return None
    block = text.split("---\n")[1]
    return {m.group(1): True for m in re.finditer(r"^([A-Za-z_][\w-]*):", block, re.M)}


problems = []
for f in FILES:
    text = open(f).read()
    for m in LINK.finditer(text):
        target, anchor = m.group(1), m.group(2)
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        path = os.path.normpath(os.path.join(os.path.dirname(f), target))
        if not os.path.exists(path):
            problems.append(f"{f}: link to missing {target}")
        elif anchor and path.endswith(".md"):
            heads = [slug(h) for h in re.findall(r"^#+ (.+)$", open(path).read(), re.M)]
            if anchor[1:] not in heads:
                problems.append(f"{f}: no heading #{anchor[1:]} in {target}")

REQUIRED = {
    ".claude/skills/": ["name", "description"],
    ".claude/agents/": ["name", "description"],
    "docs/decisions/": ["title", "number", "status"],
    "docs/proposals/": ["title", "number", "status"],
    "docs/plans/": ["title", "number", "status", "originating_proposal"],
}
for f in FILES:
    for prefix, fields in REQUIRED.items():
        if f.startswith(prefix) and (prefix.startswith(".claude") or re.search(r"/\d{3}-", f)):
            fm = frontmatter(f)
            missing = fields if fm is None else [k for k in fields if k not in fm]
            if missing:
                problems.append(f"{f}: frontmatter lacks {', '.join(missing)}")

# No control characters in the site's Markdown. A TAB there is almost always
# a lost backslash: `\t` written through a string that was not raw turns
# `\theta` and `\top` into a TAB and "heta", and KaTeX renders the rest.
CONTROL = re.compile(r"[\x00-\x09\x0b-\x1f]")
for f in sorted(glob.glob("www/**/*.md", recursive=True)):
    if f.startswith(SKIP) or any(s in f for s in SKIP):
        continue
    for i, line in enumerate(open(f, encoding="utf-8"), 1):
        m = CONTROL.search(line)
        if m:
            problems.append(f"{f}:{i}: control character {m.group(0)!r} (a lost backslash?)")

for p in problems:
    print(f"  {p}")
print(f"  agent docs: {len(FILES)} files, {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
