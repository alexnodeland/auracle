# No space left on device

## Symptoms

"No space left on device" from cargo, ffmpeg or git. `df` may show a large
disk with little used; the writable allowance is what ran out.

## Where the space goes

| Path | Typical size | Safe to delete |
| --- | --- | --- |
| `www/video/out/<film>/part-*.mkv`, `picture.mkv` | 2–4 GB per film | Yes, once the film's `.mp4` and `.webm` exist (they re-render) |
| `target/debug`, `target/ci*` | several GB | Yes; cargo rebuilds them |
| `target/release`, `target/test-fast` | 1–2 GB | Only if you accept a long rebuild |
| `target/test-fast/incremental` | about 0.9 GB | Yes; the next test build after an edit is then a full one |
| cargo-mutants' copies of the tree (`make mutants`, in the system's temp directory) | about 1.3 GB of `target/test-fast` each, two at a time (`MUTANTS_JOBS`) | Yes, once the run has ended; cargo-mutants removes them itself unless it was stopped |
| `~/Library/Caches/Mozilla.sccache` (`~/.cache/sccache` on Linux; `make` compiles through sccache whenever it is installed) | about 0.3 GB for the dependencies, 0.05 GB more for each worktree's own crates; when `make` starts the server it caps the cache at 2 GB (`SCCACHE_CACHE_SIZE`), evicting the least recently used | Yes; a new worktree's first build then compiles its dependencies again |
| `www/video/out/<film>/music`, `voice` | 100–200 MB | Yes; they regenerate, slowly |
| `.claude/worktrees/*` | 0.2–3 GB each, most of it the worktree's own `target/` | Only after confirming the work is merged, with `make worktree-rm TOPIC=<topic>` (a plain `rm -rf` leaves git's record of it until `git worktree prune`) |

## What to do

1. `du -xsh` the candidates above and delete the largest safe ones first.
   Deletes still succeed when writes fail.
2. If a render failed at the join, its parts are complete: write
   `picture.ffconcat` listing them and run only the encode step.
3. Record and render films one at a time.
