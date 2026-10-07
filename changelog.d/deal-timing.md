### Fixed: the same random seed deals the same pairs on any machine

- **A random seed in the address deals the same pairs however fast its pool
  fills.** EVOLVE hands you a pair once eight sounds have arrived and fills
  the rest of the pool while you pick. Each pair is dealt at once from the
  sounds that have arrived, so a pick never waits for more, but that
  meant the same random seed (`?seed=`) dealt other pairs on a faster
  machine. Now a session opened with `?seed=` deals by a fixed schedule
  while its pool fills: the first deal is from the first eight sounds, the
  next from the first 16, then 24 and 32, even if the pool has filled by
  then, and every deal after that is from the whole pool. A deal whose
  sounds haven’t all arrived waits for them, so in such a session, if you
  pick very fast in the first seconds, the next pair can take a moment. A
  session with no seed in the address deals at once, as before. A saved
  session that comes back with its whole pool deals from all of it from the
  first pair, as before (`evolve_seeded_deals.spec.js`,
  `tests/worker/deal.test.mjs`, #211).
- **A cut changes no pair but one holding the sound you cut.** Cutting a
  sound used to change every pair dealt after it, even pairs of other
  sounds. Now only a pair holding the cut sound is dealt again, and it comes
  out the same whether you cut before the pair was dealt or after.
- **ANOTHER PAIR after ⌘Z shows the same pairs however fast the sounds
  arrived.** After you took a pick back and pressed ANOTHER PAIR, the pair
  you had picked could come back right after the next one, or not,
  depending on how soon that one’s sounds had rendered. Now it never does,
  as when you pick again (`deal.test.mjs`).

### Fixed: EVOLVE says when it couldn’t deal a pair

- **When the engine can’t deal a pair, EVOLVE says so and waits for ANOTHER
  PAIR.** It used to turn **▶ PLAY**, **PICK A**, **PICK B** and the cards’
  corners back on with no pair behind them. Now they stay off, the cards say
  *Couldn’t deal a pair. ANOTHER PAIR tries again.*, and **ANOTHER PAIR** (or
  N) deals again (`evolve_seeded_deals.spec.js`, `deal.test.mjs`).
