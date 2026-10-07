### Changed: a fresh bank sits where laptop speakers play

- **Far fewer of a fresh bank's sounds sit too low for a laptop's
  speakers.** Each oscillator's octave was drawn evenly from two below to
  two above, and a sound's register comes almost entirely from its lowest
  oscillator, so in five fresh banks 30.5% of the sounds put most of their
  energy below 200 Hz, and 17.5% were barely there on a laptop at any
  volume. Octave 0 is now the most common draw and two octaves down the
  rarest, and the same five banks hold 21.5% and 8.5%. The 16% that
  *every patch at one level* gives further down is the same measure, taken
  under the even draw. Bass is rarer, not
  gone: every octave is still drawn, and a preset or a saved sound at either
  end of the range is still bred. The same random seed now deals a
  different bank (`the_prior_puts_three_draws_in_four_at_octave_zero_or_above`,
  `pool_loudness`, #62).
