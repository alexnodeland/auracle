#!/bin/bash
# The harness every figure in README.md came from: one measurement, appended
# as a line to $OUT/results.tsv.
#
#   OUT=/some/dir [SCC=1] measure.sh TAG DIR COMMAND...
#
# Runs COMMAND in DIR at `nice -n 10` under /usr/bin/time -l (macOS's; the
# `-o` file form), and records: tag, load average (1 minute) before and after,
# wall seconds, CPU seconds (user + system), user, system, peak resident MB,
# exit code. With SCC=1 it runs the command through sccache with a server of
# its own (its own port and cache directory, under `time` too), so the CPU of
# the compiles the server runs, which cargo never sees, is added in.
#
# A cold build is `rm -rf target` first; a second worktree is a copy of the
# tree at another path (git archive), since sccache keys a compile by its
# path. Variants were interleaved (A B A B) and the least CPU taken.
set -u
export PATH="$HOME/.cargo/bin:$PATH"   # rustup's proxies first: the pinned compiler
: "${OUT:?name a directory for the results: OUT=...}"
mkdir -p "$OUT/logs"
tag=$1; dir=$2; shift 2
l0=$(sysctl -n vm.loadavg | awk '{print $2}')
cd "$dir" || exit 9
T=$OUT/time.$$
if [ "${SCC:-0}" = 1 ]; then
  export SCCACHE_DIR=${SCCACHE_DIR:-$OUT/sccache}
  export SCCACHE_SERVER_PORT=${SCCACHE_SERVER_PORT:-4727}
  export SCCACHE_CACHE_SIZE=${SCCACHE_CACHE_SIZE:-10G}
  export RUSTC_WRAPPER=$HOME/.cargo/bin/sccache
  sccache --stop-server >/dev/null 2>&1
  SCCACHE_START_SERVER=1 SCCACHE_NO_DAEMON=1 nice -n 10 /usr/bin/time -l -o "$T.srv" "$HOME/.cargo/bin/sccache" > "$OUT/logs/$tag.server.log" 2>&1 &
  srv=$!
  sleep 2
fi
nice -n 10 /usr/bin/time -l -o "$T" "$@" > "$OUT/logs/$tag.log" 2>&1
rc=$?
if [ "${SCC:-0}" = 1 ]; then
  sccache --show-stats >> "$OUT/logs/$tag.log" 2>&1
  sccache --stop-server >/dev/null 2>&1
  wait $srv 2>/dev/null
fi
l1=$(sysctl -n vm.loadavg | awk '{print $2}')
parse() { awk '/ real /{r=$1; u=$3; s=$5} /maximum resident/{m=$1/1048576} END{printf "%s %s %s %.0f", r, u, s, m}' "$1"; }
read -r r u s m <<<"$(parse "$T")"
if [ -f "$T.srv" ]; then
  read -r _ u2 s2 _ <<<"$(parse "$T.srv")"
  u=$(echo "$u + $u2" | bc -l); s=$(echo "$s + $s2" | bc -l)
fi
cpu=$(echo "$u + $s" | bc -l)
printf '%s\t%s\t%s\t%s\t%.0f\t%.0f\t%.0f\t%s\t%s\n' "$tag" "$l0" "$l1" "$r" "$cpu" "$u" "$s" "$m" "$rc" >> "$OUT/results.tsv"
tail -1 "$OUT/results.tsv"
rm -f "$T" "$T.srv"
exit $rc
