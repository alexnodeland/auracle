### Fixed: a toast about your sounds isn't taken away by the toasts after it

- **A toast that says what happened to your sounds now has its turn,
  whatever is said after it.** Toasts show one at a time, and three rules of
  that queue could still take one of these away before you read it, so you
  weren't told which sound was replaced. Keep a sound as new, then keep
  another before the first toast showed, and the second keep's toast took
  the place of *Kept Noisy Pluck as new. It replaced the lowest-rated sound
  it could: Woodblock.* When ⚡ couldn't start because a generation was
  breeding, the toast saying so took down the one about the sound ⚡ had
  just bred, with its **OPEN IT**. And *Opened the preset as …*, waiting
  behind another toast, was cut when you cut three sounds straight after.
  Now a later toast about the same thing waits behind it, a refusal shows
  first and, unless its time was up, the toast comes back after it with its
  button, and however many of these toasts wait, none is cut
  (`toasts.test.mjs`, #183).
