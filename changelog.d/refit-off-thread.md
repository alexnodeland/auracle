### Fixed: nothing you do waits for the model to relearn your taste

- **The next pair, ▶ and everything else answer while the model relearns.**
  Every sixth pick the model fits your taste again from everything you've
  taught it, a few seconds of work on a slower laptop. The engine did it
  itself, and everything you asked for meanwhile waited for it: the next
  pair's sounds, ▶, opening a sound, a save. A render worker beside the
  engine does it now, and the engine answers you throughout; picks you make
  while it runs are folded in when it lands, and it says *● it just
  learned* then, as before. If you're pointing at the bank, the map or
  LEARNING's bars when it lands, they settle when you move away, not under
  your hand. On a computer with no render workers the engine still does it
  itself, after the pair's sounds (#300).
- **Coming back to a session no longer relearns your taste first.** What the
  model learned is kept with your session now, so it comes back as it was
  and nothing is fitted while it loads: your first ▶ and the first sound you
  open from the bank no longer wait behind a refit. A session saved by an
  earlier version, or one whose last visit was too short to stand alone and
  was merged into the visit before it, is fitted once, after it loads, while
  you play (#300).
- **A taste file you open is fitted ahead of background work.** Its fit used
  to queue behind work you hadn't asked for, such as an offer grown ahead;
  until it lands, TASTE shows every sound as a guess (#300).
