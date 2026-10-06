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
