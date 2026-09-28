# `make wasm` cannot download wasm-opt

## Symptoms

- `make wasm` compiles, then stops with:

  ```text
  Caused by: failed to download from https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz
  To disable `wasm-opt`, add `wasm-opt = false` to your package metadata in your `Cargo.toml`.
  ```

- `curl` fetches the same URL without trouble.

## Why

`wasm-pack` downloads binaryen's `wasm-opt` on first use and caches it. Its
downloader does not read the proxy's CA settings that `curl` and cargo use, so
behind a TLS-terminating proxy (a cloud agent session, a corporate network) the
download fails. Nothing is wrong with the build.

## What to do

Do **not** set `wasm-opt = false`: the release binary would be larger and
slower, and the app would differ from what CI ships.

1. Fetch the same binaryen release with `curl`, which trusts the proxy:

   ```bash
   mkdir -p /tmp/binaryen
   curl -sSL https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz \
     | tar -xz -C /tmp/binaryen
   ```

2. Put its `bin/` first on `PATH` for the build. `wasm-pack` uses a
   `wasm-opt` it finds there instead of downloading one:

   ```bash
   PATH=/tmp/binaryen/binaryen-version_117/bin:$PATH make wasm
   ```

3. Keep the version at `version_117`, the one `wasm-pack` asks for, so the
   optimisation passes match CI's.
