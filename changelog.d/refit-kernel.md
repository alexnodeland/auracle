### Changed: the model relearns your taste in about a quarter of the time

- **A refit now takes a fraction of the time it took, and learns exactly
  what it learned before.** Every sixth pick, the model fits your taste
  again from everything you've taught it, while the amber lamp is lit. It
  used to rebuild its whole description of your taste for each of the
  thirteen thousand small steps a fit takes, to change one number each
  time; it now changes that number in place. Measured outside the browser
  on the engine the app runs, a first refit went from about half a second
  to 33 ms, and one after a hundred picks from 3.9 s to under a second,
  with the same result to the last bit (#386).
