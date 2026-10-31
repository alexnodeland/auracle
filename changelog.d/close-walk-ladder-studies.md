### Changed: the reference dates its figures on how long a refinement walk should be

- **The reference's page on refinement now says what its walk-length figures
  were measured on.** The table of steps against results, and the line that
  twenty steps is not enough for a chain to leave its seed, were measured
  before 2026-10-07, on the previous version of the library the walk is built
  on (fugue-ppl 0.2.2) and with oscillator octaves drawn evenly, but the page
  read as if they described the walk that ships. It now says so, lists what
  has changed since, and gives the two measurements made of the shipped 40
  steps (the share of ⚡ evolve from this walks whose child beats its parent:
  66.7% to 70.3% on the new library, 71.1% to 68.0% with octaves drawn by
  weight, neither worse beyond the noise). It also says what was never
  measured: the walk with both changes together, and the longest walks. Longer
  walks are not shipped, and the shipped length is unchanged.
