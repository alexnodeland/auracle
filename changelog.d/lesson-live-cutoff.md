### Changed: the filter lesson is heard as you drag its cutoff

- **The cutoff sounds as it moves.** In *Learn: what a filter does*, the
  sound used to change only after each new cutoff had been rendered, which
  on a slower laptop was about once a second while dragging. It now plays
  through a lowpass in your browser that follows the cutoff at once, its
  curve drawn dashed amber as a guess. Where you leave the cutoff, the
  render with the instrument's own filter fades in over it, and its
  measured curve takes the guess's place (#314).
