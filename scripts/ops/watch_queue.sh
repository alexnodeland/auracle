#!/usr/bin/env bash
# watch_queue.sh [--every SECONDS] [--for HOURS] PR [PR ...]
#
# Wait until one of the PRs merges, closes, leaves the merge queue, goes red
# on its own CI or PR checks, or (a PR opened with full-ci and not queued
# yet) has its Slow suite finish; print each that did, as `#N=<what>`, and
# exit 0. What counts is queue_state.py's rule: each check read by its latest
# run, and a `dequeued` label left on after a requeue not counted while
# Mergify's queue check is in progress.
#
# Run it as a background task (Claude Code's run_in_background), which tells
# you when it exits; a watcher detached with `&` tells no one. It polls every
# 30 s (--every, whole seconds), and gives up after 6 hours (--for, which may
# be a fraction: 0.5 is half an hour), exiting 2 with "still waiting": by
# then something is stuck, and a look is due. A PR gh cannot read on one poll
# (the network) is read again on the next. A full-ci PR's Slow suite verdict
# waits until its run, looked up by id, is complete.
# The repository is the origin remote's (GH_REPO overrides).
set -uo pipefail
for v in $(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done

every=30
hours=6
while [ $# -gt 0 ]; do
  case "$1" in
    --every) every=$2; shift 2 ;;
    --for) hours=$2; shift 2 ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    -*) echo "watch_queue.sh: unknown option $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || { echo "usage: watch_queue.sh [--every SECONDS] [--for HOURS] PR [PR ...]" >&2; exit 2; }
case "$every" in ''|*[!0-9]*|0) echo "watch_queue.sh: --every takes whole seconds, not $every" >&2; exit 2 ;; esac
case "$hours" in ''|.|*[!0-9.]*|*.*.*) echo "watch_queue.sh: --for takes hours, like 6 or 0.5, not $hours" >&2; exit 2 ;; esac

here="$(cd "$(dirname "$0")" && pwd)"
repo="${GH_REPO:-$(git -c core.fsmonitor=false -C "$here" remote get-url origin | sed -E 's#\.git$##; s#^.*github\.com[:/]##')}"
case "$repo" in */*) ;; *) echo "watch_queue.sh: can't tell the repository from origin ($repo); set GH_REPO=owner/name" >&2; exit 1 ;; esac

# Bash arithmetic is whole numbers only, and --for may be a fraction.
polls=$(awk -v h="$hours" -v e="$every" 'BEGIN { p = int(h * 3600 / e); print (p < 1 ? 1 : p) }')
i=0
while [ $i -lt "$polls" ]; do
  out=""
  for n in "$@"; do
    n=${n#\#}
    json=$(gh -R "$repo" pr view "$n" --json state,labels,statusCheckRollup 2>/dev/null) || continue
    # A full-ci PR not yet queued: its Slow suite run's own status, so the
    # verdict waits until every job of it has run (queue_state.py says why).
    run=$(printf '%s' "$json" | python3 "$here/queue_state.py" --slow-run)
    status=()
    if [ -n "$run" ]; then
      s=$(gh -R "$repo" run view "$run" --json status -q .status 2>/dev/null) || s=unknown
      status=(--run-status "${s:-unknown}")
    fi
    what=$(printf '%s' "$json" | python3 "$here/queue_state.py" ${status[@]+"${status[@]}"})
    [ -n "$what" ] && out="$out #$n=$what"
  done
  if [ -n "$out" ]; then
    echo "${out# }"
    exit 0
  fi
  i=$(( i + 1 ))
  sleep "$every"
done
echo "still waiting after ${hours} h: $*"
exit 2
