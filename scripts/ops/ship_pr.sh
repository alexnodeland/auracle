#!/usr/bin/env bash
# ship_pr.sh [--full-ci] [--priority] WORKTREE BRANCH TITLE BODY_FILE
#
# The operator's push of an agent's reviewed branch (docs/process.md § Pull
# requests; the ship-wave skill): check the title and the issue lines as
# `PR checks` will, with the checks from origin/main; push the branch; open
# the PR labelled `queue`; and queue it with `@mergifyio queue`. Prints the
# PR's number and link.
#
#   --full-ci   label it `full-ci` (the Slow suite runs on it) and do not
#               queue it yet: queue it once its Slow suite is green
#               (watch_queue.sh says "Slow suite green"), with the two
#               commands this prints.
#   --priority  label it `priority`: a fix to CI or to a flaky test goes into
#               the queue's next batch ahead of the rest.
#
# It refuses a worktree with uncommitted changes, a branch that is not the
# worktree's or is not claude/*, and a title or body the checks would fail.
# It never force-pushes: a branch already on GitHub with other commits is
# refused by git. The repository is the origin remote's (GH_REPO overrides).
#
# `gh pr create` goes through GitHub's GraphQL API, which has failed ("Something
# went wrong") while the REST API worked. Then the PR is opened through REST
# (or, when that answers nothing, found by its branch, in case the create went
# through) and labelled there; the `@mergifyio queue` comment, too, goes
# through REST when `gh pr comment` fails.
set -euo pipefail
# A hook or another tool may have set these for some other checkout.
for v in $(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done

full_ci=0
priority=0
while [ $# -gt 0 ]; do
  case "$1" in
    --full-ci) full_ci=1; shift ;;
    --priority) priority=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    --) shift; break ;;
    -*) echo "ship_pr.sh: unknown option $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
[ $# -eq 4 ] || { echo "usage: ship_pr.sh [--full-ci] [--priority] WORKTREE BRANCH TITLE BODY_FILE" >&2; exit 2; }
wt=$1 branch=$2 title=$3 body=$4

git() { command git -c core.fsmonitor=false "$@"; }
here="$(cd "$(dirname "$0")" && pwd)"
repo="${GH_REPO:-$(git -C "$here" remote get-url origin | sed -E 's#\.git$##; s#^.*github\.com[:/]##')}"
case "$repo" in */*) ;; *) echo "ship_pr.sh: can't tell the repository from origin ($repo); set GH_REPO=owner/name" >&2; exit 1 ;; esac

[ -f "$body" ] || { echo "ship_pr.sh: no body file $body" >&2; exit 1; }
# gh runs from a scratch directory below, so the body's path is made absolute.
body="$(cd "$(dirname "$body")" && pwd)/$(basename "$body")"
case "$branch" in claude/*) ;; *) echo "ship_pr.sh: $branch is not a claude/ branch; a contributor pushes their own" >&2; exit 1 ;; esac
[ "$(git -C "$wt" rev-parse --abbrev-ref HEAD)" = "$branch" ] || { echo "ship_pr.sh: $wt is not on $branch" >&2; exit 1; }
[ -z "$(git -C "$wt" status --porcelain --untracked-files=no)" ] || { echo "ship_pr.sh: $wt has uncommitted changes" >&2; exit 1; }

# The checks as CI runs them on a PR: main's script, the title and body from
# the environment. `links` reads each issue named on GitHub.
git -C "$wt" fetch -q origin
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
git -C "$wt" show origin/main:scripts/pr_checks.py > "$tmp/pr_checks.py"
if ! (cd "$tmp" && PR_TITLE="$title" PR_BODY="$(cat "$body")" PR_AUTHOR="" GITHUB_REPOSITORY="$repo" \
    python3 pr_checks.py title && PR_TITLE="$title" PR_BODY="$(cat "$body")" PR_AUTHOR="" GITHUB_REPOSITORY="$repo" \
    python3 pr_checks.py links); then
  echo "ship_pr.sh: PR checks would fail: fix the title or the body" >&2
  exit 1
fi

git -C "$wt" push -q -u origin "$branch"

labels=()
[ $full_ci = 1 ] && labels+=(full-ci) || labels+=(queue)
[ $priority = 1 ] && labels+=(priority)
create=() add=()
for l in "${labels[@]}"; do create+=(--label "$l"); add+=(-f "labels[]=$l"); done

# The queue's comment, through REST when gh's own command fails.
queue_it() {
  (cd "$tmp" && { gh -R "$repo" pr comment "$1" --body "@mergifyio queue" >/dev/null ||
    gh api --method POST "repos/$repo/issues/$1/comments" -f "body=@mergifyio queue" >/dev/null; })
}

if url=$(cd "$tmp" && gh -R "$repo" pr create --base main --head "$branch" --title "$title" --body-file "$body" "${create[@]}" | tail -1) &&
    [ -n "$url" ]; then
  n=${url##*/}
else
  echo "ship_pr.sh: gh pr create failed; opening the PR through the REST API" >&2
  python3 -c 'import json, sys; title, body, head = sys.argv[1:]; json.dump({"base": "main", "head": head, "title": title, "body": open(body, encoding="utf-8").read()}, sys.stdout)' \
    "$title" "$body" "$branch" > "$tmp/pr.json"
  n=$(cd "$tmp" && gh api --method POST "repos/$repo/pulls" --input "$tmp/pr.json" -q .number) || n=
  if [ -z "$n" ]; then
    # A create that went through with its answer lost: the PR is found by its branch.
    n=$(cd "$tmp" && gh api "repos/$repo/pulls?head=${repo%%/*}:$branch&state=open" -q '.[0].number') || n=
  fi
  case "$n" in
    ''|*[!0-9]*) echo "ship_pr.sh: no PR for $branch: gh pr create and the REST API both failed. The branch is pushed; open it by hand" >&2; exit 1 ;;
  esac
  (cd "$tmp" && gh api --method POST "repos/$repo/issues/$n/labels" "${add[@]}" >/dev/null)
  url="https://github.com/$repo/pull/$n"
fi
if [ $full_ci = 1 ]; then
  echo "$n $url"
  echo "opened with full-ci, not queued. Once its Slow suite is green (scripts/ops/watch_queue.sh $n), queue it:"
  echo "  gh -R $repo pr edit $n --add-label queue && gh -R $repo pr comment $n --body '@mergifyio queue'"
elif queue_it "$n"; then
  echo "$n $url"
else
  echo "$n $url"
  echo "ship_pr.sh: #$n is open and labelled, but the queue's comment failed: gh -R $repo pr comment $n --body '@mergifyio queue'" >&2
  exit 1
fi
