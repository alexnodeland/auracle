# A browser job waits forever

## How the queue works

`www/video/tools/one_browser.sh` writes a ticket to
`${BROWSER_QUEUE:-$TMPDIR/auracle-browser-queue}` named
`<arrival-ns>-<pid>` and runs its command when that ticket is the oldest and
no `footage.mjs` is running. Tickets of dead processes are swept.

## What to do

1. `ls` the queue directory, and `ps -p <pid>` each ticket's PID to see what
   is ahead of you.
2. A long rehearsal ahead is expected; wait.
3. A waiter started before the queue existed (the old polling gate) has no
   ticket and can never run: stop it and start the job again.
4. A `footage.mjs` running outside the queue blocks everyone until it ends.
5. If the queue directory was cleared, running waiters lose their tickets:
   restart them.
