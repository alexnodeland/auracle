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
[ $full_ci = 1 ] && labels+=(--label full-ci) || labels+=(--label queue)
[ $priority = 1 ] && labels+=(--label priority)
url=$(cd "$tmp" && gh -R "$repo" pr create --base main --head "$branch" --title "$title" --body-file "$body" "${labels[@]}" | tail -1)
n=${url##*/}
if [ $full_ci = 1 ]; then
  echo "$n $url"
  echo "opened with full-ci, not queued. Once its Slow suite is green (scripts/ops/watch_queue.sh $n), queue it:"
  echo "  gh -R $repo pr edit $n --add-label queue && gh -R $repo pr comment $n --body '@mergifyio queue'"
else
  (cd "$tmp" && gh -R "$repo" pr comment "$n" --body "@mergifyio queue" >/dev/null)
  echo "$n $url"
fi
