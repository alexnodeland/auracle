### Fixed: EVOLVE says when there is no pair left to deal

- **When fewer than two sounds in the pool are left uncut, EVOLVE says
  there is nothing to pair.** Cutting a sound on the table when it and the
  other were the last two left uncut used to bring the buttons back live
  with no pair behind them and no reason given. Now the cards stay dimmed
  with **▶ PLAY**, **PICK A**, **PICK B**, **⇄ CIRCUIT**, **↓ PATCH** and
  **ANOTHER PAIR** off, and say *Nothing to pair. Fewer than two sounds are
  left to deal.* They deal again by themselves when you take a cut back or
  the pool changes. While a pair is being dealt, **▶ PLAY**, **⇄ CIRCUIT**
  and **↓ PATCH** are off too, as the picks and **ANOTHER PAIR** already
  were: with no pair on the table they had nothing to play, show or open
  (`evolve_truth.spec.js`, `deal.test.mjs`, #195).

### Fixed: a pick taken back keeps the pair dealt behind the next

- **Taking a pick back no longer throws away a pair already dealt.** ⌘Z
  puts the pair back, and the pair that went up in its place waits as the
  next. The pair behind that one is dealt once that one's sounds have
  arrived; when that was before ⌘Z, ⌘Z threw it away and a new pair came
  instead, so in a seeded session the pair two picks on depended on how
  fast the sounds rendered. Now it is kept, and offered as the next pair
  once the one before it goes up again (`evolve_ahead.spec.js`,
  `deal.test.mjs`, #211).
