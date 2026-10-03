# A sound’s face

<p class="lede">Every sound has a face: a small green shape beside its name,
drawn from what the sound actually played. This page is about what a face
shows, how to read one, and where you’ll see it.</p>

## What a face shows

A face is the sound’s spectrum, stood upright and compared with the rest of
your bank.

- **Height is pitch.** The base is the lows (about 35 Hz), the top the highs
  (about 14 kHz).
- **Width is “more than the bank”.** At each height the face is wide where
  this sound has more there than the sounds in your bank have on average, and
  narrow where it has less. A sound exactly like the bank’s average is a
  straight column half as wide as its space.
- **The outline is the whole phrase**, the standard phrase every sound is
  played on (a held note, a high stab, a two-note chord, a low note and its
  tail).
- **The faint layers inside are the phrase over time**, cut into twelve
  slices, each as large and as bright as that slice is loud. A slice that is
  almost silent (a long tail’s end) draws no layer.

The face is drawn from the engine’s own render of the sound, the same render
the model measures, so it is a picture of what you’d hear, not a guess.

## Reading one

- **Wide at the top:** brighter than your bank; **narrow at the top:**
  darker.
- **Wide at the base:** more low end than your bank.
- **A thin stem below:** nothing under the sound’s lowest note. Most pitched
  sounds have one.
- **Wide all the way up:** more in every band than the bank’s sounds, which
  is what noise looks like.
- **Layers spread wider than the outline at one height:** that part of the
  phrase carries more there than the phrase does overall.

Two sounds with similar faces have similar spectra. That is not the same as
sounding alike: how a sound moves and how its pitch behaves are mostly not in
the face.

## Where faces appear

- **The menu bar**, beside the name of the sound you’re playing, at every
  level: the face of what the keys play.
- **[The bank](./bank.md)**, on every row, in a column left of the row’s two
  lines. Preset rows draw theirs as you scroll to them, since a preset you
  haven’t heard may need a render first.
- **[EVOLVE](./views/evolve.md)**, beside each card’s name.
- **[PATCH](./views/play.md)**, beside the sound’s name in the header, on
  **A** and **B** in the teach strip under the rack, and beside the model’s
  guess for the next module: the patch as it is, and the patch with that
  module, from the render the guess made of it.
- **[PERFORM](./views/perform.md)**, beside the sound in your hands, and
  beside **B** once an offer has grown. B grows out of the face, and goes
  back into it. In stage mode (<kbd>⇧F</kbd>) the face fills the screen,
  and what you play is drawn over it.
- **AUDIO IN**, in the square on the module in the rack: the face of your
  input as it plays, drawn from the last few hundredths of a second, before
  the patch. It is there only while the input carries a signal. See
  [playing through Auracle](./playing-through.md#the-module).
- **[The warm start](./getting-started/first-session.md#2-pick-the-three-youd-reach-for)**,
  on each of the nine cards.
- **[TASTE](./views/taste.md)**: each sound on the map is its face, sized by
  how unsure the model is about it.

A face sits in space its place always keeps, so a name never moves when the
face arrives. Where a name could be cut short (the bank, PATCH’s header, A
and B under the rack), the column is wider by the face; EVOLVE’s and
PERFORM’s names wrap rather than cut.

An empty space means one of three things:

- **The face is on its way.** A sound from an earlier session, or a preset
  you haven’t heard, is rendered for it once the bank has finished arriving,
  after anything else the engine has to do. A preset row scrolled past before
  its face came asks again when you scroll back.
- **The sound doesn’t play.** An edit the instrument refuses to play has no
  render, so it has no face.
- **There is nothing to compare with yet.** A face is drawn against your bank,
  and needs at least four sounds there with faces.

## When a face changes

A face changes only when something real does:

- **its render changes.** The header’s face is the sound as it stands, so an
  edit shows in it once the edit’s render lands. Turning a PERFORM control
  doesn’t change it: nothing is rendered until you keep or take.
- **your bank changes.** A face is drawn against the bank, so when sounds are
  added, replaced or cut, every face is drawn against the bank as it is now.
  A change too small to move a face by a pixel’s worth isn’t redrawn.

Faces are redrawn in place. Nothing in a face moves on its own.

## Share a sound as a card

1. Open the sound.
2. Choose **Download as a picture…** from the **⋯** menu.
3. Set the first box to **the sound’s card**.
4. Press **DOWNLOAD**.

The card is the sound’s face, its name, and the line its bank row has: the
seed it grew from and what changed, or where it came from (*a hand-made
preset*). At **2×** it is 1200 × 630, the size a link preview wants. Like
every picture Auracle downloads, **the card carries the patch**: drop it on
Auracle and the sound opens. While the sound’s face is on its way the dialog
says so and waits. A sound with no face to draw downloads as a card without
one, and the dialog says why: *this edit doesn't play, so it has no face*, or
*a face needs at least four sounds to compare with*.

The [reference](../reference/features/faces.html) has the measurement in
full: the bands, the slices, and how a face is compared with the bank.
