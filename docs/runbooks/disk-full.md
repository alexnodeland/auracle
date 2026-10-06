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
| `www/video/out/<film>/music`, `voice` | 100–200 MB | Yes; they regenerate, slowly |
| `.claude/worktrees/*` | 0.2–1.2 GB each | Only after confirming the work is merged, with `make worktree-rm TOPIC=<topic>` (a plain `rm -rf` leaves git's record of it until `git worktree prune`) |

## What to do

1. `du -xsh` the candidates above and delete the largest safe ones first.
   Deletes still succeed when writes fail.
2. If a render failed at the join, its parts are complete: write
   `picture.ffconcat` listing them and run only the encode step.
3. Record and render films one at a time.
