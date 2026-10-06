### Fixed: the same random seed deals the same pairs on any machine

- **A seeded session deals the same pairs however fast its pool fills.**
  EVOLVE hands you a pair once eight sounds have arrived and fills the rest
  of the pool while you pick. Each pair used to be dealt from however many
  sounds had arrived by then, so the same random seed (`?seed=`) dealt other
  pairs on a faster machine. Now the first pair is dealt from the first eight
  sounds, the next from the first 16, then 24 and 32, in the order the pool
  fills, and every pair after that from the whole pool. A pair whose sounds
  haven’t all arrived waits for them, so if you pick very fast in the first
  seconds, the next pair can take a moment (`evolve_seeded_deals.spec.js`,
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
