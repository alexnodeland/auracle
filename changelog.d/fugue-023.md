### Fixed: a random seed repeats what it learns and breeds, not only its pool

- **A session dealt from `?seed=` now learns the same taste from the same
  picks, and breeds and offers the same sounds, in the browser as in
  Auracle's tests and tools, which run the engine outside the browser.**
  The pool already matched. What came after it did not: the library Auracle
  learns and breeds with drew each step's choice from its random numbers
  one way in the browser and another way outside it, so the random seed in
  a bug report dealt the same pool everywhere but not the taste fitted to
  your picks, the sounds a generation bred or the offers PERFORM grew
  (`boot_agrees.spec.js`, #143). For a given random seed and the same
  picks, what the browser learns differs from before.

### Changed: breeding and offers move a knob the same way wherever it sits

- **A generation and PERFORM's offers now step a knob the same distance
  wherever it is set, and fold the step back at either end of its range.**
  The step used to grow with the knob's setting, so a knob set near zero
  barely moved. Over twelve presets, an offer of eight steps on the knobs
  alone moved its farthest knob 0.04 to 0.60 of its range, and now moves it
  0.36 to 0.68. For a given random seed, what is bred and offered differs
  from before (#143).
