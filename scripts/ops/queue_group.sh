#!/usr/bin/env bash
# queue_group.sh [--drop-red] [--every SECONDS] [--for HOURS] PR [PR ...]
#
# Queue a group of PRs together (docs/process.md § Waves; the ship-wave
# skill). The merge queue holds a batch for company only so long
# (`batch_max_wait_time`), and a PR enters it once its own checks are green,
# so PRs queued as each turns green land in batches of their own. A wave's
# PRs are opened held (`ship_pr.sh --hold`) and queued here instead: wait
# until each PR's `CI`, `PR checks` and `Mutants in the changed code` are
# green on its head (and, for a PR carrying `full-ci`, its Slow suite too),
# then label every one `queue` and comment `@mergifyio queue` on it, all at
# once, so the group enters the queue within seconds and shares a batch (up
# to three PRs). What counts is queue_state.py's rule (`--ready`): each check
# read by its latest run, a skipped or neutral one not a success.
#
# It stops, queues nothing, exits 1 and names the PR when one goes red (a
# check failed or timed out, a full-ci PR's Slow suite failed or was
# cancelled) or closes or merges, or when a full-ci PR's gates are green and
# its Slow suite never ran: no PR waits for the rest while the rest wait for
# it. A PR that is merely slow is waited for. So is a cancelled run of a
# gate, and a cancelled Slow suite until a second poll still shows it: a
# newer run may not have its check yet (opening a PR with `full-ci` starts
# two runs of the Slow suite, and the second cancels the first).
#
#   --drop-red   leave such a PR out, say so, and queue the rest. The exit
#                is 1 only when nothing is left, or a PR could not be queued.
#   --every      seconds between polls, 30 by default; a fraction is fine.
#   --for        give up after this many hours, 6 by default (a fraction is
#                fine: 0.5 is half an hour), exiting 2 with "still waiting"
#                and nothing queued: by then something is stuck.
#
# Run it as a background task (Claude Code's run_in_background), which tells
# you when it exits; one detached with `&` tells no one. It prints
# `queued: #N ...` on stdout, and a line on stderr whenever what it waits on
# changes. A PR gh cannot read on one poll (the network) is read again on the
# next; ten polls running in which some PR cannot be read stop it, exit 1,
# so a mistyped number is not waited on for hours. Each PR's label and
# comment go through gh and, when that fails (GitHub's GraphQL API can fail
# while its REST API works), through the REST API, as in ship_pr.sh. Exit 1
# also when one could not be queued, and the line says which.
# The repository is the origin remote's (GH_REPO overrides).
set -uo pipefail
for v in $(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done

usage="usage: queue_group.sh [--drop-red] [--every SECONDS] [--for HOURS] PR [PR ...]"
every=30
hours=6
drop_red=0
args=""   # the PRs, wherever the options stand among them
while [ $# -gt 0 ]; do
  case "$1" in
    --drop-red) drop_red=1; shift ;;
    --every) [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }; every=$2; shift 2 ;;
    --for) [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }; hours=$2; shift 2 ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    -*) echo "queue_group.sh: unknown option $1" >&2; exit 2 ;;
    *) args="$args $1"; shift ;;
  esac
done
[ -n "$args" ] || { echo "$usage" >&2; exit 2; }
# A positive number, whole or with a fraction (sleep takes one; arithmetic in bash does not).
positive() { case "$1" in ''|.|*[!0-9.]*|*.*.*) return 1 ;; esac; awk -v x="$1" 'BEGIN { exit !(x > 0) }'; }
positive "$every" || { echo "queue_group.sh: --every takes seconds, like 30 or 0.5, not $every" >&2; exit 2; }
positive "$hours" || { echo "queue_group.sh: --for takes hours, like 6 or 0.5, not $hours" >&2; exit 2; }

# The PRs, once each, in the order given. Numbers have no spaces, so a
# string is a list (an empty array is an unbound variable to bash 3.2).
prs=""
for n in $args; do
  n=${n#\#}
  case "$n" in ''|*[!0-9]*) echo "queue_group.sh: $n is not a PR number" >&2; exit 2 ;; esac
  case " $prs " in *" $n "*) ;; *) prs="$prs $n" ;; esac
done
prs=${prs# }

here="$(cd "$(dirname "$0")" && pwd)"
repo="${GH_REPO:-$(git -c core.fsmonitor=false -C "$here" remote get-url origin | sed -E 's#\.git$##; s#^.*github\.com[:/]##')}"
case "$repo" in */*) ;; *) echo "queue_group.sh: can't tell the repository from origin ($repo); set GH_REPO=owner/name" >&2; exit 1 ;; esac
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# One PR: the label (which queues it, through Mergify's auto-merge
# conditions) and the comment (which queues it too, and is what puts back a
# PR that left the queue). Returns 1 when the label failed both ways, 2 when
# only the comment did.
queue_one() {
  { gh -R "$repo" pr edit "$1" --add-label queue >/dev/null ||
    gh api --method POST "repos/$repo/issues/$1/labels" -f "labels[]=queue" >/dev/null; } || return 1
  { gh -R "$repo" pr comment "$1" --body "@mergifyio queue" >/dev/null ||
    gh api --method POST "repos/$repo/issues/$1/comments" -f "body=@mergifyio queue" >/dev/null; } || return 2
}

limit=$(awk -v h="$hours" 'BEGIN { l = int(h * 3600); print (l < 1 ? 1 : l) }')
live=$prs     # the PRs still in the group
left_out=""   # "#N <why>, ..." for those --drop-red dropped
shown=""      # the last progress line
cancelled=""  # the PRs whose Slow suite showed as cancelled on the last poll
unread=0      # polls running in which some PR could not be read
while :; do
  ready="" waiting="" stop_n="" stop_msg="" cant="" cancelled_now=""
  for n in $live; do
    if ! json=$(gh -R "$repo" pr view "$n" --json state,labels,statusCheckRollup 2>"$tmp/err"); then
      cant="$cant #$n"
      waiting="$waiting #$n"
      continue
    fi
    # A full-ci PR's Slow suite verdict waits until its run, looked up by
    # id, is complete (queue_state.py says why).
    run=$(printf '%s' "$json" | python3 "$here/queue_state.py" --ready-run)
    status=()
    if [ -n "$run" ]; then
      s=$(gh -R "$repo" run view "$run" --json status -q .status 2>/dev/null) || s=unknown
      status=(--run-status "${s:-unknown}")
    fi
    what=$(printf '%s' "$json" | python3 "$here/queue_state.py" --ready ${status[@]+"${status[@]}"})
    # A cancelled Slow suite stops the group only when the last poll showed
    # it too; the first time it is waited on.
    if [ "$what" = "Slow suite cancelled" ]; then
      cancelled_now="$cancelled_now $n"
      case " $cancelled " in *" $n "*) ;; *) what="" ;; esac
    fi
    case "$what" in
      "") waiting="$waiting #$n" ;;
      ready) ready="$ready #$n" ;;
      *) stop_n="$stop_n $n"; stop_msg="$stop_msg${stop_msg:+, }#$n $what" ;;
    esac
  done
  cancelled=$cancelled_now

  if [ -n "$stop_n" ]; then
    if [ $drop_red = 0 ]; then
      echo "queue_group.sh: nothing queued; stopped at $stop_msg" >&2
      exit 1
    fi
    left_out="$left_out${left_out:+, }$stop_msg"
    kept=""
    for n in $live; do
      case " $stop_n " in *" $n "*) ;; *) kept="$kept $n" ;; esac
    done
    live=${kept# }
    echo "queue_group.sh: leaving out $stop_msg" >&2
    if [ -z "$live" ]; then
      echo "queue_group.sh: nothing left to queue" >&2
      exit 1
    fi
  fi

  if [ -n "$cant" ]; then unread=$(( unread + 1 )); else unread=0; fi
  if [ $unread -ge 10 ]; then
    echo "queue_group.sh: nothing queued; can't read$cant on $unread polls running: $(tail -n 1 "$tmp/err" 2>/dev/null)" >&2
    exit 1
  fi

  # Every PR still in the group is ready on this poll: all of them, at once.
  if [ -z "$waiting" ]; then
    for n in $live; do
      ( queue_one "$n"; echo $? > "$tmp/queued-$n" ) &
    done
    wait
    queued="" failed=""
    for n in $live; do
      rc=$(cat "$tmp/queued-$n" 2>/dev/null) || rc=1
      case "$rc" in
        0) queued="$queued #$n" ;;
        2) queued="$queued #$n"; failed="$failed${failed:+; }#$n is labelled, but the queue's comment failed: gh -R $repo pr comment $n --body '@mergifyio queue'" ;;
        *) failed="$failed${failed:+; }#$n could not be labelled: gh -R $repo pr edit $n --add-label queue" ;;
      esac
    done
    [ -n "$queued" ] && echo "queued:$queued"
    [ -n "$left_out" ] && echo "left out: $left_out"
    if [ -n "$failed" ]; then
      echo "queue_group.sh: $failed" >&2
      exit 1
    fi
    exit 0
  fi

  now="ready:${ready:- none}; waiting on:$waiting"
  if [ "$now" != "$shown" ]; then
    echo "queue_group.sh: $now" >&2
    shown=$now
  fi
  if [ "$SECONDS" -ge "$limit" ]; then
    echo "still waiting after ${hours} h: $live" >&2
    exit 2
  fi
  sleep "$every"
done
