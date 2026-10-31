### Fixed: ⌘K keeps up as you type

- **⌘K's list opens, and narrows with each letter you type, without falling
  behind on a slower laptop.** Each letter rebuilt the whole list, fifty rows
  and more, and laid every row out before the screen could change, so on a
  laptop like a 2018 MacBook Air the list was slow to appear and lagged
  behind your typing. It now draws the rows you can see first and the rest a
  moment later, out of sight below them. The list looks, scrolls and reads to
  a screen reader as it did, and each letter waits on about half the work it
  did (`cmdk.spec.js`).
