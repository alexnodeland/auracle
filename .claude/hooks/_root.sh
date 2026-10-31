# Sourced by the hooks: which checkout a path is in.
#
#   checkout_root /abs/dir   -> the nearest directory at or above it holding
#                               a .git (a directory in a clone, a file in a
#                               worktree); nothing when there is none
#
# A branch's worktree lives inside the main checkout, at
# .claude/worktrees/<topic>, and is a checkout of its own: a path in it is
# judged from its root, not from the main checkout's (docs/process.md
# § Building). Read from the path alone, without git: the directory may not
# exist yet (a Write makes it), and no GIT_DIR in the environment can move it.
checkout_root() {
  local d="$1"
  case "$d" in /*) ;; *) return 0 ;; esac
  while :; do
    if [ -e "$d/.git" ]; then printf '%s\n' "$d"; return 0; fi
    if [ "$d" = / ]; then return 0; fi
    d="$(dirname "$d")"
  done
}

# Where web-setup.sh keeps a checkout's logs and its background engine
# build's pid: one directory per checkout, since the build writes that
# checkout's apps/web/pkg and a session in another is not waiting on it.
#
#   web_setup_dir /abs/root  -> $TMPDIR/auracle-web-setup/<a hash of the root>
#   web_building  /abs/dir   -> succeeds while that directory's build runs
#   web_setting_up /abs/dir  -> succeeds while its detached setup runs
web_setup_dir() {
  printf '%s/auracle-web-setup/%s\n' "${TMPDIR:-/tmp}" "$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
}
# The build removes its pid file when it ends; a pid left by one that was
# killed (a container stopped) can name another process by now, so the pid
# counts only while it is still the build.
web_building() {
  local p
  p="$(cat "$1/wasm.pid" 2>/dev/null)" || return 1
  [ -n "$p" ] && ps -o args= -p "$p" 2>/dev/null | grep -q 'make wasm'
}
# The detached setup (web-setup.sh run again in the background) removes its
# pid file when it ends; the same caution about a stale pid holds.
web_setting_up() {
  local p
  p="$(cat "$1/setup.pid" 2>/dev/null)" || return 1
  [ -n "$p" ] && ps -o args= -p "$p" 2>/dev/null | grep -q 'web-setup.sh'
}
