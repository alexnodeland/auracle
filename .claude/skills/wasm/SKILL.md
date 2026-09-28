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
```

- Always through `make`: it sets `WASM_STACK`. A plain `wasm-pack build` ships
  a 1 MB stack that overflows on large patches.
- It takes about a minute. Run it before queueing browser work, not while a
  recording is running.
- After a **JS-only** change, `make -s wasm-stamp` refreshes the build stamp
  so browsers refetch the changed scripts.

## Then

Reload the app (the stamp changes every URL), or run the browser specs
(`browser-test`). Mention the new build id (`apps/web/pkg/build.json`) when you
tell film agents or reviewers what they are running on.
