# A browser job waits forever

## How the queue works

`www/video/tools/one_browser.sh` writes a ticket to
`${BROWSER_QUEUE:-$TMPDIR/auracle-browser-queue}` named
`<arrival-ns>-<pid>`, holding its lane (`exclusive` or `shared`), and adds
`<ticket>.run` when it starts. A job starts only once everyone ahead has
started: an exclusive job when it is first and nothing runs, a shared one
(browser tests) when everyone ahead is a running shared job and fewer than
`BROWSER_SHARED` (2) run. Nothing starts while a `footage.mjs` runs outside
the queue. Tickets of dead processes are swept (ADR-010).

## What to do

1. `ls` the queue directory, and `ps -p <pid>` each ticket's PID to see what
   is ahead of you (`cat` a ticket for its lane; a `.run` beside it means it
   has started).
2. A long rehearsal ahead is expected; wait.
3. A waiter started before the queue existed (the old polling gate) has no
   ticket and can never run: stop it and start the job again.
4. A `footage.mjs` running outside the queue blocks everyone until it ends.
5. If the queue directory was cleared, running waiters lose their tickets:
   restart them.
