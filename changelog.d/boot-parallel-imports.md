### Changed: a first visit starts the engine sooner

- **Auracle starts measuring your first sounds sooner on a first visit.**
  Its code is 22 files, and the page asked for them one after another, so
  each waited on the one before it, and the engine did not start until the
  last had arrived. They are now asked for together, and the engine starts
  when the slowest comes in. Over a slow connection the wait is the slowest
  file, not the sum of all of them. A return visit, with the files already
  kept by your browser, changes little.

### Fixed: two copies of the face code after an update

- **After an update, the faces can no longer be drawn by an older copy of
  their code.** Two of the files that draw a sound's face asked for a third
  by a name that carried no version, so your browser could keep the old one
  for minutes after the rest had updated, and held a second copy beside the
  new one. They now ask for the version the page asked for, in browsers that
  support it (the current Chrome, Edge, Firefox and Safari).
