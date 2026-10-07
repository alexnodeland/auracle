# The app runs old engine code

## Symptoms

- A Rust fix does not show in the browser, or a browser test fails in a way
  the Rust tests say cannot happen.
- The console reports a wasm method is not a function (the JS calls something
  the binary does not export).
- The session-start hook says `apps/web/pkg` is older than the Rust sources.

## What to do

1. `make wasm` (it also rewrites `apps/web/pkg/build.json`).
2. Reload the app; `serve.py` sends no-store, and the build stamp changes the
   worker and wasm URLs, so the browser fetches the new binary.
3. In a worktree, remember `pkg/` is per checkout: build it there too
   (`make pkg-reuse` takes another checkout's, the main one first, when it
   was built from the same Rust, and says why each was passed over when none
   was).
4. Re-run the browser test on its own port (`AURACLE_TEST_PORT`), so it is
   not served by another checkout.
