---
name: wasm
description: >
  Rebuild Auracle's web engine (apps/web/pkg) from the Rust crates, and know
  when it is needed. Use after changing Rust the web app calls, when the
  session-start hook reports a stale pkg, or when the app behaves like old
  engine code.
---

# Rebuild the web engine

`apps/web/pkg` is generated from `crates/auracle-wasm` and is not in git.
Every browser test, film rehearsal and manual check of a Rust change needs it
current.

## When

- Any change under `crates/` that the app reaches (almost all of
  `auracle-session` and `auracle-wasm`; grammar and features changes reach it
  through them).
- The session-start hook says `pkg` is older than the Rust sources.
- The app misbehaves in a way the Rust tests say is impossible
  (`docs/runbooks/stale-wasm.md`).

## How

```bash
make wasm          # wasm-pack --release with the 8 MB stack, then the build stamp
make pkg-reuse     # in a worktree that changed no Rust: another checkout's build, in a second
make wasm-dev      # a quick build for trying an engine edit by hand; the specs refuse it
```

If it stops with "failed to download … binaryen", the proxy is in the way of
wasm-pack's own downloader: `docs/runbooks/wasm-opt-download.md` (fetch the
same release with curl and put it on `PATH`; never disable wasm-opt in the
release build).

- Always through `make`: it sets `WASM_STACK`. A plain `wasm-pack build` ships
  a 1 MB stack that overflows on large patches, and leaves no stamp.
- It takes about a minute (more with every crate to compile). Run it before
  queueing browser work, not while a recording is running.
- **`make pkg-reuse`** copies a release build into a checkout and stamps it
  with that checkout's own app scripts: the first of this repository's
  checkouts and worktrees (`git worktree list`: the main checkout, then the
  most recently built) whose `pkg/build.json` says it was built from the
  same Rust and build command (its `source`, a hash of `crates/`, the Cargo
  files and the toolchain as the working tree has them, uncommitted edits
  included), and whose engine is still the one that stamp was written for
  (its `engine`: a plain `wasm-pack build` rewrites the engine and leaves the
  stamp alone). The files are copied, never linked, so a build elsewhere
  later can't change this one, and written anew, so the session-start hook
  doesn't call them older than the sources. `make worktree` runs it. When no checkout has one it
  says why each was passed over, and `make wasm` is owed.
  `PKG_FROM=<dir>` takes that checkout's only.
- **`make wasm-dev`** builds with test-fast's codegen (no LTO, 256 codegen
  units for the workspace's crates), incremental, and no wasm-opt: an engine edit reaches `make serve`
  in seconds rather than a minute. Its stamp says `"profile": "dev"`, and the
  `make browser-*` targets, the Playwright config, rehearsals and recordings
  refuse it, naming `make wasm`; the session-start hook reports it.
- **A build that fails or is stopped** leaves its stamp saying
  `"profile": "unfinished"` (each build writes that before it starts:
  wasm-pack writes the engine before wasm-opt runs), which everything that
  refuses a dev build refuses too, and `make pkg-reuse` won't take. If the
  Rust changed while it built, the stamp leaves out its `source`, so no
  other checkout takes it either.
- After a **JS-only** change, `make -s wasm-stamp` refreshes the build stamp
  so browsers refetch the changed scripts. It keeps the stamp's profile and
  source: the engine is the same.

## Then

Reload the app (the stamp changes every URL), or run the browser specs
(`browser-test`). Mention the new build id (`apps/web/pkg/build.json`) when you
tell film agents or reviewers what they are running on.
