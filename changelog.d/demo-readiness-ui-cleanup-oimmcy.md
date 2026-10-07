### Removed: the bubble over the keys on a first visit

- **A first visit has one guide, not two.** A bubble used to sit over the
  keys until you played a note (*Press A–L, or tap a key: you’re already
  holding a synth*), saying what the guide at the bottom left already
  says. It showed at every level but PERFORM, and was already up behind
  the first-visit cards. The guide's first step asks for the
  first note at PERFORM and at PATCH, and it is now the only thing that
  does (`perform_truth.spec.js`).

### Changed: the loading line counts sounds, not renderers

- **While it loads, the app says how many sounds it has heard,** *heard 12
  of 40*, and no longer adds how many renderers are on it (*· 4
  renderers*). The count is still there for whoever wants it, as the
  line's tooltip.
