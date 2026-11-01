### Changed: each input gets its own clip

- **The model hears each of your inputs through a clip of that input.** It
  used to capture one clip, from the input the keys play, and hear every
  AUDIO IN through it, so a sound reading a microphone and a guitar was
  rated as if both played the microphone. Now each input is captured the
  first time you play into it while a sound you're playing or recording
  reads it, and a sound that reads two inputs is heard through each one's
  clip (#147).
- **NEW CLIP captures its own module's input,** even on a module that says
  *meter only*, and only the sounds on that input are rated again.
- **Each input's clip is saved with your session** and comes back with it.
  A session saved before this comes back with its one clip on every input,
  and each input is still captured as its own the first time you play into
  it, the input that clip came from too.
