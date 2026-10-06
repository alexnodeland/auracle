#!/usr/bin/env python3
"""What a saved workflow's run came back with (.claude/workflows/; the
ship-wave skill): a summary to read, and for each branch it built the PR
body to open it with.

    python3 scripts/ops/wf_result.py RUN [--out DIR] [--session URL]

RUN is any of:

- a finished run's output file (`<run id>.json`, which the Workflow tool's
  result names);
- a running (or finished) run's journal, `journal.jsonl`, or its directory;
- a run id (`wf_…`): the output file is looked for first, then the journal,
  under Claude Code's projects directory ($CLAUDE_CONFIG_DIR, else ~/.claude).

One tool for both, so an item that is done can ship while its run's slower
items are still going. A finished run gives what the workflow returned. A
journal gives each agent's result as it came back, read by its label
(`<stage> <key>[ …]`: `build #177`, `fix #177 r2`, `finalize patch_facts`):
for each key, the latest result shaped as a report (a head, a title and a
body), the latest review and the latest re-check. A key with agents still
running says so, and its report is only as far as it got.

For each branch it writes, into DIR (default: <tmp>/auracle-ops/<run id>):

- `pr-<key>.md`: the PR body, ending with the session link when one is
  known (--session, else the run's args) and the body doesn't already;
- `wf-<key>.json`: everything the run said about it;

and `summary.md`, the summary it prints: per branch, its status and head,
closes and refs, whether it wants `full-ci`, the review's counts and the
re-check, the problems the workflow found or this finds (the title's type,
the issue lines, the session line, in-area work left), the voice drafts with
their voice.md rows, the open items by kind, the decisions made, and the
`scripts/ops/ship_pr.sh` command that ships it. A triage prints its waves
and questions; a review-pr run its findings.

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shlex
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import pr_checks  # noqa: E402  (scripts/pr_checks.py: the title and link rules CI applies)

SESSION = re.compile(r"^https://claude\.ai/code/session_\w+$")


# ─── reading a run ───────────────────────────────────────────────────────────


def find(run: str, home: str | None = None) -> str:
    """The file to read for RUN: a path as given, or a run id's output file,
    else its journal."""
    if os.path.isdir(run):
        return os.path.join(run, "journal.jsonl")
    if os.path.exists(run):
        return run
    home = home or os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    for pattern in (f"projects/*/*/workflows/{run}.json", f"projects/*/*/subagents/workflows/{run}/journal.jsonl"):
        hits = sorted(glob.glob(os.path.join(home, pattern)), key=os.path.getmtime)
        if hits:
            return hits[-1]
    sys.exit(f"no run {run}: neither a file nor a run id under {home}/projects")


def read_output(path: str) -> tuple[object, dict, str]:
    """A finished run's result, its args and its id."""
    with open(path) as f:
        data = json.load(f)
    return data.get("result"), data.get("args") or {}, data.get("runId") or os.path.basename(path)[:-5]


def read_journal(path: str) -> list[dict]:
    """Each agent of a run, in the order they started: label, phase and
    result (None while it runs, or when it failed)."""
    agents: dict[str, dict] = {}
    with open(path) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            key = rec.get("key")
            if rec.get("type") == "started" and key:
                agents.setdefault(key, {"label": rec.get("label") or "", "phase": rec.get("phase"), "id": rec.get("agentId"), "done": False, "result": None})
            elif rec.get("type") == "result" and key in agents:
                agents[key]["done"] = True
                agents[key]["result"] = rec.get("result", rec.get("value"))
    return list(agents.values())


WORKTREE = re.compile(r"[Ww]orktree:? (/[^\s,()]+)")
BRANCH = re.compile(r"branch (claude/[^\s,()]+)")


def prompt_of(journal: str, agent_id: str | None) -> str:
    """The prompt an agent of the run was given: its transcript's first
    message, beside the journal."""
    path = os.path.join(os.path.dirname(journal), f"agent-{agent_id}.jsonl")
    try:
        with open(path) as f:
            content = json.loads(f.readline()).get("message", {}).get("content")
    except (OSError, ValueError):
        return ""
    if isinstance(content, list):
        content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return content if isinstance(content, str) else ""


def is_report(r: object) -> bool:
    return isinstance(r, dict) and all(k in r for k in ("head", "pr_title", "pr_body"))


def items_from_journal(agents: list[dict], journal: str = "") -> list[dict]:
    """A ship-shaped item per key, from the agents' labels and results; its
    branch and worktree from its first agent's prompt."""
    items: dict[str, dict] = {}
    for a in agents:
        words = a["label"].split()
        if len(words) < 2:
            continue
        it = items.get(words[1])
        if it is None:
            prompt = prompt_of(journal, a.get("id")) if journal else ""
            wt, br = WORKTREE.search(prompt), BRANCH.search(prompt)
            it = items[words[1]] = {"key": words[1], "running": [], "final": None, "review": None, "verify": None}
            if wt and br:
                it.update(worktree=wt.group(1), branch=br.group(1))
        r = a["result"]
        if not a["done"]:
            it["running"].append(a["label"])
        elif is_report(r):
            it["final"] = r
        elif isinstance(r, dict) and "blocking" in r:
            it["review"] = r
        elif isinstance(r, dict) and "all_resolved" in r:
            it["verify"] = r
    out = []
    for it in items.values():
        if not it["final"] and not it["running"]:
            continue  # a key with no report: not a branch (a triage's or a review's agents)
        it["status"] = f"running ({', '.join(it['running'])})" if it["running"] else "done, read from the journal"
        out.append(it)
    return out


def normalize(result: object) -> list[dict]:
    """The items of a ship-shaped result: ship-issues, fix-flake and
    mutants-burndown, and the list the first ship-issues returned."""
    raw = result.get("items") if isinstance(result, dict) else result if isinstance(result, list) else None
    if not isinstance(raw, list):
        return []
    out = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        key = r.get("key") or (f"#{r['issue']}" if r.get("issue") else r.get("branch", "?"))
        status = r.get("status") or ("failed" if r.get("failed") else "done")
        out.append({**r, "key": key, "status": status, "running": []})
    return out


# ─── judging a report ───────────────────────────────────────────────────────


def problems_of(final: dict | None, session: str | None) -> list[str]:
    """What this can check without the network: the title, the issue lines
    against closes and refs, the session line, in-area work left."""
    if not final:
        return ["no report came back"]
    out = [f"title: {p}" for p in pr_checks.check_title(final.get("pr_title") or "")]
    body = final.get("pr_body") or ""
    links = pr_checks.parse(body)
    out += [f"body: {p}" for p in links.problems]
    if not links.named() and links.no_issue is None:
        out.append("body: it names no issue and has no `No issue:` line")
    for n in final.get("closes") or []:
        if n not in links.closes:
            out.append(f"closes #{n}, but the body has no `Closes #{n}`")
    for n in links.closes:
        if n not in (final.get("closes") or []):
            out.append(f"the body closes #{n}, which closes does not list")
    for n in final.get("refs") or []:
        if n not in links.refs and n not in links.closes:
            out.append(f"refs #{n}, but the body has no `Refs #{n}`")
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if session and lines and SESSION.match(lines[-1]) and lines[-1] != session:
        out.append("the body ends with another session's link")
    for o in final.get("open_items") or []:
        if isinstance(o, dict) and o.get("kind") == "in_area":
            out.append(f"in-area work left: {o.get('text')}")
    return out


def body_of(final: dict, session: str | None) -> str:
    body = (final.get("pr_body") or "").rstrip()
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if session and (not lines or lines[-1] != session):
        body += f"\n\n{session}"
    return body + "\n"


def full_ci(item: dict, final: dict) -> bool:
    need = final.get("needs_full_ci")
    return bool((isinstance(need, dict) and need.get("value")) or "full-ci" in (item.get("labels") or []))


# ─── saying it ──────────────────────────────────────────────────────────────


def slug(key: str) -> str:
    return re.sub(r"[^\w.-]+", "-", key.lstrip("#")).strip("-") or "item"


def count(review: dict | None) -> str:
    if not review:
        return "none came back"
    parts = [f"{len(review.get(k) or [])} {w}" for k, w in (("blocking", "blocking"), ("should_fix", "should-fix"), ("maintainers_call", "for the maintainer"), ("nits", "nits"))]
    return ", ".join(parts)


def summarize_item(item: dict, session: str | None, out_dir: str) -> list[str]:
    final = item.get("final")
    key = item["key"]
    lines = [f"{key}  {item.get('branch', '')}  {item['status']}"]
    if not final:
        lines += [f"  problem: {p}" for p in item.get("problems") or ["no report came back"]]
        return lines
    problems = list(item.get("problems") or [])
    for p in problems_of(final, session):
        if not any(p in q or q in p for q in problems):
            problems.append(p)
    need = final.get("needs_full_ci") if isinstance(final.get("needs_full_ci"), dict) else {}
    lines.append(f"  head {str(final.get('head', ''))[:12]}" + (f"  on origin/main {str(final['base'])[:12]}" if final.get("base") else "  (not rebased by the run)"))
    lines.append(f"  closes {' '.join(f'#{n}' for n in final.get('closes') or []) or 'none'}; refs {' '.join(f'#{n}' for n in final.get('refs') or []) or 'none'}")
    lines.append(f"  full-ci: {'yes' if full_ci(item, final) else 'no'}{' (' + need['reason'] + ')' if need.get('reason') else ''}")
    verify = item.get("verify")
    lines.append(f"  review: {count(item.get('review'))}; re-check: {'none needed' if not verify else 'all resolved' if verify.get('all_resolved') else 'NOT resolved'}")
    if final.get("conflicts") and final["conflicts"].strip().lower() != "none":
        lines.append(f"  rebase: {final['conflicts']}")
    lines += [f"  PROBLEM: {p}" for p in problems]
    for v in final.get("voice_drafts") or []:
        if isinstance(v, dict):
            lines.append(f"  voice: \"{v.get('words')}\" at {v.get('where')}; row: {v.get('voice_md_row')}")
        else:
            lines.append(f"  voice: {v}")
    for o in final.get("open_items") or []:
        kind, text = (o.get("kind"), o.get("text")) if isinstance(o, dict) else ("open", o)
        lines.append(f"  {kind}: {text}")
    lines += [f"  decided: {d}" for d in final.get("decisions") or []]
    lines.append(f"  title: {final.get('pr_title')}")
    if item.get("worktree") and item.get("branch"):
        flags = (["--full-ci"] if full_ci(item, final) else []) + (["--priority"] if "priority" in (item.get("labels") or []) else [])
        body = os.path.join(out_dir, f"pr-{slug(key)}.md")
        cmd = ["scripts/ops/ship_pr.sh", *flags, item["worktree"], item["branch"], final.get("pr_title") or "", body]
        lines.append(f"  ship: {shlex.join(cmd)}")
    return lines


def summarize_other(result: object) -> list[str]:
    if isinstance(result, dict) and result.get("workflow") == "triage-backlog" and result.get("plan"):
        plan = result["plan"]
        lines = [f"triaged {len(result.get('triaged') or [])}; not read: {result.get('missing') or 'none'}"]
        for w in plan.get("waves") or []:
            lines.append(f"wave {w.get('name')}: {w.get('why')}")
            for it in w.get("items") or []:
                lines.append(f"  #{it.get('issue')} claude/{it.get('topic')} ({it.get('agentType')}; closes {it.get('closes')}, refs {it.get('refs')}{'; full-ci' if it.get('needs_full_ci') else ''})")
        lines += [f"chain: {' -> '.join(f'#{n}' for n in c.get('issues') or [])}: {c.get('why')}" for c in plan.get("chains") or []]
        lines += [f"question #{q.get('issue')}: {q.get('question')}" for q in plan.get("questions") or []]
        lines += [f"closable #{c.get('issue')}: {c.get('why')}" for c in plan.get("closable") or []]
        lines += [f"held #{h.get('issue')}: {h.get('why')}" for h in plan.get("held") or []]
        return lines
    if isinstance(result, dict) and result.get("workflow") == "review-pr":
        lines = [f"{result.get('target')}: {len(result.get('findings') or [])} finding(s) stand, {len(result.get('refuted') or [])} refuted"]
        if result.get("lenses_failed"):
            lines.append(f"lenses that did not return: {', '.join(result['lenses_failed'])}")
        for f in result.get("findings") or []:
            lines.append(f"  [{f.get('severity')}] {f.get('file')}{':' + str(f['line']) if f.get('line') else ''}: {f.get('summary')}")
            lines.append(f"      scenario: {f.get('scenario')}")
        return lines
    return [json.dumps(result, indent=1)[:4000]]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="wf_result.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("run", help="a run id, its output file, or its journal (or the journal's directory)")
    ap.add_argument("--out", help="where to write the bodies and the summary (default: <tmp>/auracle-ops/<run id>)")
    ap.add_argument("--session", help="the session link the PR bodies end with (default: the run's args.session)")
    a = ap.parse_args(argv)
    path = find(a.run)
    if path.endswith(".jsonl"):
        run_id = os.path.basename(os.path.dirname(path)) or "run"
        result, args = None, {}
        items = items_from_journal(read_journal(path), path)
    else:
        result, args, run_id = read_output(path)
        items = normalize(result)
    session = a.session or (args.get("session") if isinstance(args, dict) else None) or (result.get("session") if isinstance(result, dict) else None)
    out_dir = a.out or os.path.join(tempfile.gettempdir(), "auracle-ops", run_id)
    os.makedirs(out_dir, exist_ok=True)
    lines = [f"{run_id} ({path})"]
    if items:
        for it in items:
            lines += summarize_item(it, session, out_dir)
            if it.get("final"):
                with open(os.path.join(out_dir, f"pr-{slug(it['key'])}.md"), "w") as f:
                    f.write(body_of(it["final"], session))
            with open(os.path.join(out_dir, f"wf-{slug(it['key'])}.json"), "w") as f:
                json.dump(it, f, indent=1)
    elif result is not None:
        lines += summarize_other(result)
    else:
        lines.append("no branch has a report yet")
    text = "\n".join(lines) + "\n"
    with open(os.path.join(out_dir, "summary.md"), "w") as f:
        f.write(text)
    print(text, end="")
    print(f"(written to {out_dir})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
