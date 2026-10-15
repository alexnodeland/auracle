### Fixed: a returning visit reads every sound back, and an open answer waits for your turn to rest

- Coming back with no render workers to help, Auracle sometimes worked out one or two of your sounds again instead of reading them from what it had kept. The last sound measured on the visit before could be lost as those workers closed. They now finish keeping it first.
- With a control's answer open, turning that control on a slow machine asked for a new figure each time one came back, so the figure kept changing under your hand. It now asks once the control rests.
