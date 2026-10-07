### Changed: every sound is measured in about a sixth less time

- **Rendering a sound to measure it now takes about a sixth less time, and
  measures the same, to the last bit.** Every sound is played through the
  audition phrase and measured before you hear it: when the bank fills, when
  EVOLVE breeds, when PERFORM measures a preset or makes an offer, when an
  edit lands. A patch's knobs used to be read once per sample, each as a
  module of its own, though nothing turns them during a measurement; that
  render now sets each knob's value once, in the port it turns, and plays
  about half as many modules per sample. On a set of eighteen sounds,
  rendering in the background took 15% less time in Chromium and 20% less
  in Firefox (#298). The instrument you play keeps every knob live.
