# Changelog

All notable changes to Auracle are documented here, grouped by development
pass. The format is based on [Keep a Changelog](https://keepachangelog.com/);
the project is pre-1.0. Entries below 0.1.0 were written when the project was
called Ricercar (and, earlier, EvoSynth) and name it as it was then: a
changelog that edits its own past is not a record.

## [Unreleased]

### Changed: PATCH is a canvas that reads in signal order

- **A head above the patch.** PATCH · BASS (the family, for a sound opened
  from the library), the sound's name, large, and what it is made of: *4
  modules · 1 modulator, in signal order*. On the right: ⚡ EVOLVE FROM THIS,
  whose ▾ holds LOCK KNOBS, LOCK WIRING and CLEAR LOCKS (and STOP while it
  runs), ADD MODULE, NEW PATCH, and HOW TO READ THIS, which says what every
  mark on the canvas is. The two rows of buttons that were there are gone;
  everything they did is in the head, the edit bar or the well's corner.
- **An edit bar once you have edited.** *2 changes · KEEP AS NEW · PICK THE
  EDIT · UNDO TO AS OPENED.* The count is how many steps ⌘Z would take back.
  UNDO TO AS OPENED takes them all back in one go, and its toast's undo (or
  ⇧⌘Z) brings them back; pressed while another sound is still on its way, it
  says so and waits for nothing (⌘Z waits for it too now). A knob you have
  turned shows a pale tick where it was when you opened the sound.
- **The patch sits in a rounded well,** its modules drawn flat at the size
  you can read them: each one's name, the setting that says which kind it is
  (*vco · saw*, *filter · svf lp*) on the right of its head, and under every
  knob its value, then its name. Settings like the octave print their value
  in the knob's place; the amp draws its envelope from its knobs. Sound flows
  left to right along curved cables into OUT and the sound's face, and a
  two-input module names its inputs by the cables. The face is the patch as it
  stands, measured on its latest render, and a click on it plays the sound, as
  ▶ did. Modulation cables say how far and how fast they move their knob
  (*depth 25% · 0.51 Hz*). When the patch is wider than the view, its edges
  count the modules past them. The model's rating of the sound sits on the
  well's top line when it has one, and the scope is put away until you ask
  for it (⋯ › Scope & analyzer…).
- **Select a module** by pressing on it: it shows its ⋯ (replace, insert,
  duplicate, set aside, bypass, modulate, probe, swap, delete) and its lock,
  and the line at the well's foot names it and says what it does. Press L to
  lock it; a locked module's edge is solid amber.
- **The catalog opens when you ask.** ADD MODULE or / opens every module over
  the left of the well, with its search, what is set aside and what is in the
  patch; Esc or ✕ closes it. A module in hand is named along the well's top,
  with its price and a ▶ to hear it at a socket. Which way your taste leans on
  each module, in the catalog and its descriptions, now shows only while you
  hold ⌥ (LEANS, which tints the modules, is still a switch in the layout's
  ▾). The module rail and the strip that described modules under the rack are
  gone.
- **The camera is in the corner:** fit, −, +, map, and a menu for the layout
  (chain, compact, by hand; snap; reset; detail; leans). Zoomed out, the
  values and labels too small to read are left off and each module's name
  and setting print larger; further out, a module keeps three knobs to read. ⇧Home fits the whole
  patch now; Home and End go to the first module and the last, from the
  canvas (VOL, menus, the catalog and dialogs keep their own).
- **The keys follow the signal.** ←/→ walk the modules in signal order, ↑/↓
  go into a module's modulators, Enter goes into its knobs, F2 opens its
  menu, Esc steps back out one thing a press: a menu, the knob, the module,
  the catalog, then a new patch.
- **SET ASIDE and TEACH are chips** at the well's foot that open their shelf
  and their strip over it; TEACH counts the picks to the first refit, which
  the head no longer repeats. PATCH's first steps (play it, turn a knob, lock
  what you love, ⚡) move into the pill, and its × stops PATCH's steps only.
  On a touch screen every module shows its ⋯, and a module's sheet has AUDIO
  IN's and CAPTURE's buttons and the sound's face.

### Changed: PERFORM shows the sound large, and its pads have keys

- **PERFORM is a well and a panel.** On the left, the sound: its family (for
  a sound opened from the library), its name, large, with a share button that
  opens the picture of its card, its description, and a well holding its face
  with a glow and a reflection, as stage mode draws it. Click the face to hear
  the phrase. On the right, what you turn: CONTROLS with ARRANGE and HOW IT
  WORKS, your controls three to a row, the knobs they move, and the pads.
- **An offer stands beside your sound.** B's face grows in amber next to
  yours, with what changed and *hold B to peek* under it, and BLEND is a
  slider under the two while B holds one.
- **The pads are WANDER, OFFER, PEEK, TAKE and PASS.** PASS passes on B
  without growing another, and counts as a pick for what you had once you
  have heard B, with UNDO, as NEXT's pass does. Tap WANDER to freeze it (the
  FREEZE pad is gone); its ring lights and it says *frozen*.
- **Keep and Back appear when they mean something.** Once the sound has moved
  from where you last kept it, *moved · KEEP · BACK* shows by its name.
- **Keys for the pads.** N offers (and passes on B for the next), hold B to
  peek, ⇧↵ takes, ↵ keeps when nothing is focused, ⇧⌫ goes back. In EVOLVE, N
  deals another pair. None of them fire while you type or a dialog is open.
- **XY and How it works open in the well,** from XY in its corner and HOW IT
  WORKS in CONTROLS, so the controls stay in reach beside them. What your
  velocity plays is a row of ARRANGE, and its control wears a small *vel*.
- **First steps move into a pill** at the bottom left: one step at a
  time with a pip for each, ticked off as you do it, and × to stop it. Steps
  you had already done carry over.
- **EVOLVE asks one question.** *Pick the one you'd reach for.* heads it with
  its pips, a small TASTE map shows the pair among every sound, and each card
  shows its sound's face large in place of the waveform, with ⇄ circuit and
  ↓ patch in its corner. The buttons read PLAY · 1, PICK A · ←, ANOTHER PAIR ·
  N; EVOLVE POOL is dashed until your picks have taught the model, and what
  each generation did opens from under it.
- **Stage mode** shows the wordmark and the model's lamp, and the sound's
  family where it has one.

### Changed: the bank is quieter, and holding ⌥ shows what the model thinks

- **The bank has tabs and a search.** POOL, SAVED and PRESETS are tabs with
  their counts (the arrow keys move between them), and **Find a sound** under
  them keeps only the sounds whose name, family or description has what you
  type. Esc clears it, and typing there plays no notes. The line that said
  what each bank holds is now each tab's tooltip; the save count is SAVED's
  tooltip, and its count turns amber when every save is used. **+12** on POOL
  says sounds are still arriving. The **?** that walks you through the banks
  sits at the end of the search.
- **A row is a face and a name.** Its actions show when you point at it or
  put the keyboard cursor on it: compare (for a bred sound), ▶, ★, save, and
  cut. On a touch screen every row shows them, and every preset its ▶, on a
  line under the name. ★ opens the five stars; 1–5 still rate the row under the cursor. A
  child's second line still says which seed it grew from and what changed.
  Ids and signatures show only with Show measurements. Presets are grouped
  by family with a count, and a preset's description is its name's tooltip.
  Double-clicking the name of a sound you aren't playing renames it now: its
  second click used to open the sound again, and that redraw swallowed the
  rename.
- **Hold ⌥ (Alt) for the model view.** Every row shows the model's guess, a
  percentage and a bar, and once it has fitted the pool glides into the order
  it rates the sounds, and back when you let go. At rest the pool stands in
  the order its sounds joined it, and the guesses are hidden. TASTE switches
  to its TASTE side while you hold, and in EVOLVE the card the model favours
  says its guess before you pick (*it guesses this · 62% · leaning*), as does
  each card's style. A tag under the top bar says what it believes and from
  how many picks. **MODEL** in the top bar does the same when held, and a tap
  keeps it up until you tap again or press Esc. ⌥ and an arrow still move
  between levels without flashing it.

### Changed: the views are levels of one space, and the frame around them is new

- **PERFORM, PATCH, EVOLVE, TASTE and LEARNING are levels now, not tabs.**
  They sit around the sound you're playing: TASTE is zoomed out (the sound
  among all sounds), PATCH zoomed in (what it's made of), LEARNING past
  TASTE, and EVOLVE beside PERFORM. A cross of stops at the right edge of
  the stage shows where you are, with each one's name on hover; click a stop
  to go there. The tabs at the top are gone.
- **New keys for moving between them:** <kbd>⌥↑</kbd> zooms out and
  <kbd>⌥↓</kbd> in, <kbd>⌥←</kbd> goes to EVOLVE and <kbd>⌥→</kbd> back,
  and <kbd>⌥1</kbd>–<kbd>⌥5</kbd> go straight to PERFORM, PATCH, EVOLVE,
  TASTE or LEARNING (Alt on Windows and Linux). They work with a knob or a
  list focused, but not while you type in a field (where on a Mac ⌥ and an
  arrow still move by word) or while a dialog such as stage mode is up. With the stops focused, the plain arrows walk them.
- **It opens at PERFORM,** or at the level you were at last time, or at the
  one a link names (`…/play/#taste`). It used to open on PATCH.
- **The top bar is new.** The wordmark has a round amber lamp after it, lit
  while the model works, where the final E used to light. Beside it, the
  level's name and what it is. The sound you're playing moved up from the
  keyboard to the bar, with its face and a ▶ that does what Space does.
  **GENERATIONS** moved to the top of EVOLVE. The forecast skill line moved
  out of the bar: LEARNING's forecasts show it, as they did. **?** and **⋯**
  are where they were, at the right.
- **The keyboard bar is quieter.** On the left, KEYS and the octave (**Z**
  and **X** are buttons too). On the right, **VOL**, **MIDI**, **● REC**
  and **KEYS ⋯**, which holds HOLD, UNI, ARP and its settings, SYNC, GLIDE,
  ⇕ TALL, the keybed's span and ◼ SILENCE. KEYS ⋯ lights while HOLD, UNI,
  ARP or SYNC is on, and its tooltip says which; while ARP or SYNC runs, a
  chip beside VOL says what it's set to. The bar is shorter, so the levels
  above it are taller.
- On a window under 1180 px, PERFORM's controls sit in two rows of four and
  PATCH's next-step line has a row of its own, so neither cuts its words
  beside the stops.
- Opening at PERFORM means PERFORM starts measuring the sound it opens with
  straight away. Go to PATCH or open another sound before it is done, and it
  finishes in the background, for when you come back. It no longer holds up
  anything else waiting there: PATCH's cables light, the model's guess comes
  and the faces in the bank and on the stage appear as they did before,
  instead of after that measurement (up to a minute on a slow machine).

### Fixed: PERFORM says when the engine couldn't measure a sound

- **When the engine has crashed, or cannot run a measurement PERFORM asks
  for, PERFORM's status line says so** (*couldn’t measure this patch*, or
  *couldn’t re-check this patch* when the controls still play on their last
  measurement), next to the engine's own error. A measurement asked for
  after the engine had crashed, or still waiting its turn when it did, used
  to leave the line on *listening to this sound…* or *re-checking* for the
  rest of the session, with the controls it was measuring reading
  *listening…*.
- **After a crash PERFORM asks the engine nothing more.** An offer it would
  have to grow says *the engine crashed: reload to continue*, as the alarm
  does, where B used to say *growing an offer…* for good (one grown ahead
  before the crash still comes into B). So does an offer whose own walk
  crashed the engine, which said *the walk failed on this sound: try
  again*.
- **A control that asks for a module the engine fails to add says so.**
  Turning BRIGHT, BODY or SPACE past its notch on a sound that can't reach
  it gives the sound a module to turn; when the engine failed to add one,
  PERFORM said *nothing to add here, so it’s growing an offer instead* and
  grew one. It now says *the engine couldn’t add the tone EQ, so nothing
  changed* (the longer release, for SPACE), and grows nothing.

### Fixed: a taken offer is measured first when you come back to PERFORM

- **Take an offer, look at PATCH, come back, and the taken sound's
  measurement carries on first.** Going to another level hands PERFORM's
  measurements to the engine's background work, and coming back hands back
  the ones you are waiting on. A Take's measurement was left there: it waited
  behind anything else in the background (a cable probe, the model's guess),
  and the controls the taken sound had lost said *listening…*, with
  *re-checking* on the status line, for longer than they needed to. The same
  happened to a control you had just placed on the panel, which says
  *listening…* until it is measured. Now both are yours again the moment
  PERFORM shows, as a sound's first measurement already was.

### Fixed: a sound you keep as new is safe until it has been in a pick

- **A sound you make in PATCH and keep as new is no longer replaced before
  the model has heard a single answer about it.** The pool has a fixed size,
  so anything that joins it (a preset you open, a generation's children, a ⚡
  child) replaces the sound the model rates lowest. A sound you had just kept
  as new was often that sound: open a preset straight after, and the toast
  said your new sound had been replaced. Now it waits for its first pick,
  with it on either side, whatever you picked: a pair in EVOLVE (or PATCH's
  quick-pick strip); an offer in PERFORM you heard and took or passed while
  playing it, if you had kept the sound before you answered (a TAKE counts
  when its window closes, and a sound kept in that window isn't judged by
  it); keeping an edit of it as new with an answer (the WHICH WOULD YOU REACH
  FOR? card, or PICK THE EDIT); or a cut. The question KEEP AS NEW asks about
  the sound it keeps doesn't count, since that one is about the sound you
  edited from, and nor do stars or SKIP COMPARING. After its first pick it's
  an ordinary pool sound; save it to keep it for good. A patch file you open
  joins the pool the same way and waits too.
- It isn't a save: no mark, no charge to your saves, and EVOLVE POOL never
  marks it *may be replaced* while it waits. Up to a quarter of the pool (10
  of 40) can wait at once, not counting any you have also saved; keep one
  more as new and the oldest goes back to being an ordinary pool sound. It
  survives a reload, and sessions saved before this load as they did.
- **What a replacement says is true now.** The toast used to say *The sound
  it rated lowest was replaced*, which was not so when a saved sound (or now
  one waiting for its first pick) rated lower. It says *It replaced the
  lowest-rated sound it could: Bell Jar.*, and the app's help, tooltips and
  guide say the same: a generation or a preset replaces the lowest-rated
  sounds it can, never a saved one, nor one kept as new before its first pick.

### Added: ask a control what it does, and a lesson on filters

- **Every control on PERFORM answers with a figure of what it does to the
  sound you're playing.** Point at a control and press **?** (or the small
  **?** beside it, or hold it on a touch screen). The instrument renders your
  sound twice, the control at its center and turned, measures both the way
  the model hears them, and draws the measurement that control listens to:
  BRIGHT and the tone controls the sound's face and how each band moved,
  SNAP the attack, SPACE the tail,
  MOTION the held note moving at its own pace, GRIT the harmonics. A sentence
  gives the numbers (*Turned to bright, its center moves from 359 Hz to
  2.5 kHz. Here it turns filter cutoff.*). Every placed control is a tap
  away, and the answer follows the control as you turn it. Before, the only
  way to learn a control was to hear its sweep, or to read which knobs it
  turns.
- **BRIGHT's answer has a one-minute lesson: what a filter does, on your own
  sound.** A lowpass filter from the instrument's own modules goes on the
  sound you're playing; drag its cutoff, see the filter's curve and the
  sound's shape change, and hear it, rendered at each position. The sound
  itself is left as it was. A sound with no room for one more module gets
  the filter after it instead, and the lesson says so; a render that fails
  is said, and nothing is played in its place.
- On a touch screen, a long press on a control now opens its answer, whose
  **HEAR IT** plays the sweep the long press used to.

### Added: TRACK and CAPTURE, to play and record with your input

- **TRACK plays a chain from your voice or your instrument.** Sing or play
  into an AUDIO IN and the chain in TRACK’s first socket follows your notes.
  One voice tracks, and keys played over it stop when you let them go, where
  they used to pile up while you sang.
- **CAPTURE records what is patched into it,** up to four seconds, and plays
  the take from the keys. Press RECORD on the module, play, and press
  STOP; the new take goes into the sound as an edit, one undo step, kept
  with KEEP AS NEW like any other.
- **A sound whose take couldn’t be read is kept safe** at the foot of the
  pool, under KEPT SAFE. RECORD AGAIN records it and brings it back.

### Added: play through Auracle with AUDIO IN

- **AUDIO IN brings your own signal into a patch**: a microphone, or a
  guitar or a line out through an interface. It is under SOURCES in the
  module rail; put a filter or a delay after it, or let a follower in the next
  module's mod slot move with your playing. The browser asks
  for an input only when you add one, and what it hears stays in the browser.
  Refuse, and the module stays in the patch, silent, with ASK AGAIN.
- **MONITOR plays your input through the sound with no key down.** It starts
  off every time Auracle opens, so a microphone never reaches the speakers
  until you ask; the module’s square shows your input’s level and its face,
  as you play, either way. Use headphones.
- **Pick the input on the module.** Each microphone or interface gets an
  input number that stays with it, an input is opened once however many
  modules read it, and one that is unplugged goes silent and says so, then
  plays again when it is back.
- **The model hears a sound with AUDIO IN through a clip of your playing**:
  six seconds captured the first time your input carries a signal, saved with
  your session. NEW CLIP captures another. Until there is one, it hears a
  built-in plucked phrase.
- **A sound with AUDIO IN breeds like any other.** ⚡ evolve from this and a
  generation walk it through the clip and keep its input where you set it. No
  generation adds an input to a sound by itself.

### Fixed: an offer growing in the background no longer holds up your pick

- **A pick, a Keep or a ▶ no longer waits for an offer that was growing
  behind it.** PERFORM grows a spare offer while you play, ahead of the
  Offer pad, and growing one is twenty-odd renders of the sound that the
  engine could not stop partway. Whatever you did next (answering an offer
  with a pick, Keep, play) waited for all of it: about a minute on a slow
  machine. The engine now grows an offer, or Wander's drift, one render at a
  time and answers you between renders, so you wait for at most the render
  in progress. An offer you press for still takes the time its renders take,
  and B counts the seconds as before.
- **Leaving a sound stops the offer growing for it.** Switching to another
  sound, or turning a different control while an aimed offer grows, used to
  let the old walk finish for nothing. It stops at its next step.
- **For a given seed, the offers themselves differ from before.** Each
  offer and each drift now walks on a stream of its own, seeded when it begins, so how far
  one offer had got when another began no longer changes what either finds.
  They are the same kind of walk on the same target as before.

### Added: PATCH builds from nothing, guesses the next module, and lights each cable by its level

- **NEW PATCH** empties the sound you're playing down to its amp envelope, so
  you can build one module at a time. It is named *New patch*, its caption
  counts its modules and says *nothing to hear yet* until it makes a sound,
  **CLEAR** empties it again, and **BACK TO** *the sound's name* (or Esc)
  returns to where you started. A new patch with modules in it waits for you
  under NEW PATCH. Deleting a source now leaves its socket empty, set aside
  with an undo, where it used to be refused, so a patch can be taken back to
  nothing one module at a time.
- **The model guesses the next module.** Once it has fitted your taste,
  PATCH shows *GUESS · REVERB* over the rack with its reason in the model's
  italic (*it moves toward still, as your picks lean · 67% · leaning*), and
  draws the module dashed amber where it would go. Click it to add it; its ×
  skips it, and that kind stays away from that place for this patch. Undoing
  a guess you added counts as a skip. When it isn't sure the module helps,
  the line ends *it may not help*. Before the warm start it shows nothing. It
  renders the candidates on a render crew where the machine has cores to
  spare, and the likeliest eight on the engine's own thread where it hasn't.
- **Each green cable carries light by its level.** Once an edit settles, the
  engine renders the phrase once more and measures every audio cable; a
  cable's brightness is that level, and a mark on its middle lights one bar
  per third of the meter's range, with the number on hover. Before, a cable's
  brightness at rest was an estimate from the mixers above it. Modulation
  cables are not measured, and carry no mark.
- **On a touch screen, a tapped module opens a sheet with every setting**:
  each knob as a wide slider with − and + steps, each named setting as its
  choices, and REMOVE MODULE at its foot.

### Changed: TASTE draws each pick, and LEARNING is the model room

- **A pick draws as an arrow on TASTE's map, and every glow moves with
  it.** The map changed only when the model fitted again, every sixth pick,
  so a pick left no mark there. Now each pick draws an arrow from the sound
  you passed to the sound you picked, and every sound's glow moves to the
  model's new rating at once, because a pick moves its view of every sound.
  Picks made in EVOLVE are drawn in turn when you open TASTE. A refit
  settles every glow and every place together.
- **TASTE is the map, with a card for each sound.** Each sound glows amber
  by how much the model guesses you’d like it, dashed while it has no
  guess, and is larger where it is less sure. Point at one for its name,
  the guess (*would like: 59% · leaning*), **▶ PLAY** and **OPEN**; the
  arrow keys walk the map. The MAP, STYLES, DIRECTIONS and TRUST tabs are
  gone: their contents are in LEARNING.
- **LEARNING, a new view, shows what the model weighs and how it has
  guessed.** Each style's 44 weights, a guess drawn hollow with a **?** in
  the margin; which way liking rises across the map; every forecast it made
  before a pick, scored (*14 / 22*, *expected 64% · was 58%*) with the skill
  the menu bar shows; **COPY AS JSON**; and **THE MATH**, whose numbers (18
  audio and 26 structural features, 500 draws, a style for every 20 things
  it learns from, up to five) come from the model itself. Name a style on
  its chip here. TRUST's reliability chart is not drawn any more; its
  numbers are in the copied JSON.
- **TASTE's map has a track of your taste over time.** Drag it, or press ▶,
  to see the glows and places as the model had them after any pick this
  session has kept, with that pick's arrow. It is saved with your session
  and starts when this version first ran.
- **SOUND / TASTE** at the map's top left: SOUND shows the sounds as they
  are, TASTE dims each by how little the model likes it.
- **LEARNING's weights move with every pick, and REPLAY (R) steps them
  through your picks.** Pointing at a weight shades the small map by how
  much of that quality each sound has.

### Added: PERFORM's palette, its offers in motion, and stage mode

- **You choose PERFORM's controls.** **ARRANGE** opens the palette: the
  eighteen controls the instrument can measure, in six families (tone,
  weight, dynamics, movement, space, and character). Place up to eight on
  the panel, hide any, and put them in your order; the panel is kept with
  your session. The twelve new ones are WARMTH, AIR, THUMP, HEFT, PUNCH,
  ROUND, THROB, SWAY, DISTANCE, HAZE, BITE, and LO-FI. Until now the panel
  was always the six.
- **A control you place is measured on the sound you're playing, and says
  so.** It reads *listening…* in amber while it is measured, the status line
  names it (*listening to Bite…*), and the controls beside it keep playing.
  Nothing off the panel is measured, and a set measured on a sound before is
  kept.
- **HOW IT WORKS covers every control on the panel.** It opens on the one you
  last touched, with the rest a tap away: what you hear it do, what it
  listens to, and what it turns on this sound. It used to describe three of
  the six in one paragraph.
- **An offer shows where it came from.** B grows out of the sound's face,
  because it is grown from the sound you're playing. Taken, it fills with
  green and goes into the face; passed, it folds back into it. With reduced
  motion on, nothing moves.
- **Stage mode.** In PERFORM, <kbd>⇧F</kbd> puts the sound you're playing on the whole
  screen, for a gig or a stream: its face, large, and what you hear drawn
  over it, fading like phosphor. The keys and
  Space play as everywhere, and <kbd>⇧F</kbd> or <kbd>Esc</kbd> leaves.
- **The mod wheel and pressure follow MOTION and BRIGHT** wherever you put
  them on the panel, and a MIDI controller's first eight knobs take the
  deck's first eight controls.

### Added: every sound has a face

- **A face beside every sound's name**: on the bank's rows, EVOLVE's cards,
  PATCH's header and its teach strip (and, beside the model's guess, the
  patch as it is and with the guessed module, from the guess's own render), PERFORM's sound in hand and its offer,
  and the warm start's cards. A face is the sound's spectrum from its own
  render, stood upright (the lows at the base) and compared with the rest of
  your bank: wide where this sound has more than your bank's sounds, narrow
  where it has less, with faint layers for the phrase over time. It changes
  when the sound's render does (an edit lands, an offer grows) or when the
  bank changes enough to move it, and is redrawn in place. Measuring it
  costs about 1% of each render, and the engine works on faces after
  everything else, the sound you asked to hear included; a face's own
  render, when one is needed, takes about half a second.
- **A face never moves or shortens a name.** Every row and card keeps the
  face's space whether or not it has arrived. Where a name could be cut
  short, its column is wider by the face: the bank (280 px, 228 px under
  1080 px wide), PATCH's header and the A and B under the rack. EVOLVE's and
  PERFORM's names wrap rather than cut.
- **Share a sound as a card.** *Download as a picture…* has a new choice,
  *the sound's card*: its face, its name and where it came from, 1200 × 630
  at 2×, with the patch inside like every picture Auracle downloads, so
  dropping it on Auracle opens the sound.

### Changed: the bank shows what a generation does

- **Pointing at EVOLVE POOL marks its seeds as well as what it may
  replace.** The ten sounds the next generation would breed from get a solid
  amber rail and *seed*; the ones it may replace still have their dashed rail
  and *may be replaced*. Both are the model's own lists and move with your
  picks. Before, only *may be replaced* was marked, by a rule the bank worked
  out for itself, and the seeds were not shown at all. While a generation
  runs, the marks are that generation's: its seeds, and *will be replaced* on
  what its end will replace, one more with each child it takes in (more can
  follow). Save one and the mark moves to the sound that will go instead.
  While ⚡ evolve from this walks, its seed and the one sound its
  child would replace are marked; only the seed was.
- **EVOLVE POOL says what each walk came back as**: *walk 3 of 10 · joined
  the pool*, *rated below the pool*, *already in the pool*, *came back
  unchanged*, or *couldn't start*. It used to count the walks and say
  nothing about them.
- **A bred sound's row says which seed it grew from and what changed**
  (*from Soft Pad · +delay, cutoff 1.2 kHz → 3.4 kHz*), counting the modules
  it gained and lost, so a module that only moved isn't a change. Click that
  line, or press <kbd>c</kbd> on the row, to compare the two: the seed's
  phrase as an outline with the child's grown out of it, every change, what
  the model rated each when it bred them, and both to play while both are in
  the pool.
- **A child you haven't heard has a green dot** left of its name until its
  own phrase plays or you play a note on it, across a reload. Playing an edit
  of it doesn't count.
- **Children grow out of their seeds.** As each lands, where its seed's row
  is in view, it buds out of it and moves up into the New group, now headed
  *New · generation 3* with its count. A child the pool won't take buds
  beside its seed with the reason and fades. Nothing moves with your system
  set to reduce motion, and the same facts are on the rows and the button.
  When children land in a burst, each bud lands as the next child arrives,
  so none flies from or to a row that has moved.
- **Replaced lists what the latest generation replaced, by name only**, at
  the foot of the pool: the sounds themselves are dropped, so there is
  nothing to play or bring back.
- **A mark never moves a name.** NEW now takes the place of the ⚡ glyph, in a
  column every row keeps left of its name, and the dot sits beside it. NEW
  used to push the name to the right, and *may be replaced* followed the name
  and could cut it short. Every name in the bank starts a little further
  right to make that room.
- **GENERATIONS counts a generation as soon as its first child lands**, as
  the guide says. If you hadn't picked since pressing EVOLVE POOL, it went on
  showing the count from before (0, with three children already in New) until
  the generation ended.

### Fixed: Space and the settings on the rack

- **Space plays the sound you’re playing as it stands on the rack, in
  every view.** In PERFORM and EVOLVE, Space played the preset as it was
  saved: change a wave in PATCH, switch to PERFORM, press Space, and you
  heard the old wave. It now plays your edits there too, and in PERFORM what
  you kept or took, without a control turned since or Wander’s drift. It
  waits for an edit still on its way, as ▶ does in PATCH, and *▶ waiting
  for the edit…* stands in for the sound’s name at the right of the keybed
  until then.
- **Space plays after a click on a setting or a control.** A click on a
  wave or filter-mode chip left it focused, and Space then changed the
  setting again; after a drag on a PERFORM control or a click on the XY
  pad, Space did nothing. A click now leaves no focus on a setting, and one
  reached with the keyboard cycles on Space or Enter, as a button does (⇧
  goes back).
- **A knob turned into a runaway is muted, as the alarm says.** The alarm
  read *Muted* while held notes went on playing what the knob had made; a
  module placed or removed was already muted when its check failed. A
  setting that fails its check is never played, and the alarm now says
  *Not applied* for it, where it said *Muted* over the sound from before.
- **A screen reader hears what a setting on the rack is set to.** Its name
  carries its value (*VCO wave, sin*), and each change is read out; it was
  the name alone, so cycling it said nothing.
- **An undo, a redo, or a Take plays at the sound's own level from the
  start.** The keys take the sound back before the engine has rendered it
  again, and they took it at the level of the sound being left: undoing a
  filter-mode change on Falling Sign played a held note 11.8 dB too loud
  until the render, and up to 27 dB on other presets. They now take it at
  the level it was measured at.
- **A preset opened while an edit is still rendering plays at its own
  level.** A remembered preset plays from the click, and the reply to an
  undo or a module change made just before set that edit's level on it, up
  to 40 dB too loud, until the preset's own reply landed.

### Changed: one type scale, one set of spaces and speeds

- **No text in the app's panels is smaller than 11 px, and none drawn on a
  canvas is smaller than 12 px.** Labels, chips, and captions that were
  10 px are 11 px, and values and readouts are 12. The minimap's bookmark
  numbers, which were 7 px, are 11 on a larger pip. The scopes' and TASTE's
  canvas text, which was 9 to 11 px, is 12. The rack keeps its own sizes, which grow
  and shrink with its zoom, and a glyph on a button is sized to its button.
- **Some text grew and some shrank.** Prose is 14 px where it was 13, a
  sound's name and a card's title are 21 where they were 17, and the model's
  italic is 17 where it was 15. The rest of the old 15 px text is 14,
  including EVOLVE's teaching line (15 px, or 17 on a wide window). The
  wordmark is 21 px where it was 22, and 14 on a phone where it was 17; the
  booth's line under it is 14 where it was 17.
- **Spacing, corners, and motion come from one short list.** Paddings and
  gaps sit on a 4 px grid (4, 8, 12, 16, 24, 32, and 48 px), corners come
  from three radii (4, 8, and 14 px; a hairline's rounding stays under 4),
  and a press, a change of state, and a move take 90, 180, and 320 ms. The
  rack's relayout and camera, and PERFORM's re-center and Blend home, take
  the same three. With your system set to reduce motion, all three are
  instant, and nothing pulses, including a bank row's *opening…*.
- **PERFORM's control captions are whole at every window width.** They wrap
  to as many as three lines instead of ending in an ellipsis (*turns
  toward…*), and under 1280 px the knobs give their gaps to them. To fit
  three lines, a control that moves two knobs with long names names one and
  how many more (*wavefolder mod depth +2*), and Wander says *nothing better
  nearby* where it said *staying: nothing better nearby*. On a phone, behind
  *look around anyway*, the warm start's cards fit the screen in two columns.
- **The module search and the line under the rack still fit.** The search's
  example reads *search: grit, vowel*, and the line under the rack is
  shorter: *Point at a module, here or in the module rail: this strip says
  what it does, where it can go, and how your taste leans.*

### Changed: quiver 0.4.0

- **Plucked strings and delays sound slightly different.** Auracle now runs
  on quiver 0.4.0, whose plucked string was rebuilt to stay stable at every
  pitch, and whose delay no longer lags its input by one sample. Sounds with
  neither render exactly as before: of the 62 presets, the 12 with a Pluck or
  a Delay changed, and the other 50 are the same bit for bit.
- **Your sounds are measured again, once.** The first boot after the update
  is slower, because every sound in your bank is measured again instead of
  read from the browser's saved measurements. The first time you open a sound
  in PERFORM, it plays from its last measurement and measures again in the
  background (*re-checking*): a measurement from the old version is never
  kept as current.

### Changed: the films' sound

- **The films are mixed the way their sound was chosen, with no sound
  effects.**
  - The narration is lightly equalized and softened on its "s" sounds, at a
    steady level.
  - The music sits a little under the voice. While the voice speaks, it
    dips a little, and a little more in the range where speech is clearest.
  - Each demo plays after its line, never under it, as loud as the voice,
    with the music well under it.
  - Two short themes open and close a film, just under two seconds from its
    first and last words.
  - The music under a film is written to fit its timing: a held low note,
    chords that move one voice at a time, and short falling phrases only
    where the narration pauses.

  Before, the music sat lower under an untreated voice and dropped sharply
  whenever it spoke. The app's own sound came in at whatever level it was
  recorded, and whooshes, clicks and a logo sting played on top. Each film
  changes when it is re-voiced and mixed again; until then it sounds as it
  did, without the effects (ADR-014, `docs/notes/sound-2026-09/SPEC.md`).

### Fixed: a cut sound is never dealt

- **A sound you cut no longer comes back in EVOLVE, even when the table was
  slow to deal.** When the cards are dimmed waiting for a pair, a pair that
  can't go up is dealt again, and after three tries the next one goes up
  anyway, so a small pool can't leave the table waiting for good. A sound
  you cut while that last deal was on its way could come back in it. Now a
  pair holding a cut sound is always dealt again, as the cut's message
  promises (`evolve_truth.spec.js`).

### Fixed: a reload keeps what PERFORM just measured

- **A patch PERFORM measured just before a reload plays at once after it.**
  PERFORM keeps its measurements in the browser, so a patch you have played
  before has working controls the moment it comes back, even after a reload.
  It wrote each one 1.5 s after it landed, and a reload, a closed tab or a
  booth's visitor reset in those 1.5 s lost it: the patch said *listening…*
  for a whole measurement again (7 to 10 s). A preset opened in those 1.5 s
  was forgotten the same way, and after the reload it waited for the engine
  instead of playing from the click. Both are now also written the moment the
  page is hidden or left, as your session is.

### Fixed: the films' music

- **The music under a long film plays to its end.** Each film's music is
  stretched to fit the film, and the stretch kept each phrase's written
  number of repeats, so about 46 s into a long section the music stopped,
  or thinned to its bass line. In the published films, `math` and `dsp`
  fall silent under the narration for 36–44 s and `engine` for 7.5 s, and
  in those three and `taste` the music is only its bass line for 24–39 s at
  the end.
  Each phrase now repeats to the end of its section, and the films change
  when they are next rendered (`test_fit_score.py`).

### Fixed: what a generation and ⚡ say

- **A generation that adds nothing to the pool says why, walk by walk.**
  *Generation 4: 3 were bred, but none rated above the sounds they would
  replace.*, or *every walk came back unchanged*, or a count of each; a
  stopped one counts only the walks that came back before the stop. It used
  to say *no move was accepted* whatever happened, even when children were
  bred and refused, or landed on sounds the pool already held.
- **A refused ⚡ child is held to the bar the engine uses: the sound it would
  replace, the lowest unsaved one.** The toast said the child had to beat its
  parent, which was never the rule.
- **A ⚡ child joins the bank’s New group, tagged NEW, as a generation’s
  children do.** It used to land among the ranked rows with nothing to mark
  it.

### Changed: words

- **The app says what it means in one set of words: a bank row is a sound,
  files are downloaded and opened, and the menu bar counts everything you
  TAUGHT.** The counter said PICKS while it counted stars and cuts too; its
  tooltip now splits it (*52 picks · 4 stars · 2 cuts*), and EVOLVE’s meter
  still counts picks. The bank’s tabs read POOL, SAVED, and PRESETS; PATCH’s
  COMMIT is KEEP AS NEW and its HELD tray is SET ASIDE; a pair’s ⌖ BENCH and
  SKIP ↻ are OPEN IN PATCH and ANOTHER PAIR. While Freeze stops Wander, the
  line under it reads *frozen*, where it read *held*.
- **A guess is a percentage and a word, never a bare number.** The line
  above the rack reads *59% · leaning* where it read MODEL’S GUESS 0.59, and
  a pair’s forecast reads *it guessed this · 72% · fairly sure*. The words
  come from one scale: a hunch, leaning, and fairly sure.
- **Toasts are sentences that name the sound.** They start with a capital,
  carry no em dashes or ids, and are spelled the American way: *Saved Glass
  Pad. No generation will replace it.* They used to start lowercase, run on
  with dashes, and name some sounds by number.
- **The words the engine writes follow the same rules: the preset
  descriptions, and the reason a refused edit gives.** Six of them ran on
  with an em dash, two lists lacked the serial comma, and First Bass was *the
  plain correct one*. A refused edit could name a module by its address (*no
  node at node/0/1*) or say *no patch on the bench*; it now says *that module
  is not in the patch* or *there is no sound open to edit*.
- **Only the model speaks in italics.** Module and preset descriptions, empty
  states, and the teaching line are set plain, so the italic face means the
  model is saying what it believes.
- **A MIDI knob that takes a control is announced in a sentence.** A knob
  that claims a free control says *CC 74 now moves Bright, the first free
  control.* One bound with LEARN says *CC 21 now moves Snap.* They read
  *mapped: CC 74 → Bright*.
- **Three more lines read as sentences.** A sound that kept you waiting to
  open is announced as *Opened Glass Pad.*, with its period. A module’s spec
  card says a lean the model is sure of in its own sentence: *In 12 of 40
  sounds. In analog sustain (60% of your pool), you lean toward it.* It ran
  on in lowercase after the count. Wander’s tooltip and HOW THIS WORKS say a
  tap freezes it, as the FREEZE pad does; they said a tap held it.
- **Keys are printed in each platform’s own words.** Off Apple platforms the
  ? card reads Ctrl Z and Ctrl Shift Z, the booth menu Shift Esc, and the
  minimap’s tooltip Shift 1–9. They printed ⌘ and ⇧ everywhere, though Ctrl
  has always worked.

### Changed: the guide

- **The guide speaks the app’s words, and each page opens with what it is
  for.** Steps are numbered, each part is named as the panel shows it (KEEP AS
  NEW, SET ASIDE, ANOTHER PAIR), and how a thing works sits behind a “How it
  works” that opens in place. It used to describe duels, lenses, COMMIT, and
  HELD, and quoted toasts the app no longer shows.
- **The guide says only what the app does.** Its introduction said breeding
  crosses patches over, and its TASTE page said TRUST shows a hit rate. There
  is no crossover: every child grows from one seed. TRUST grades the model by
  its Brier skill.

### Fixed: ▶ plays the edit

- **▶ or Space in PATCH, pressed right after an edit, plays the edited patch.**
  The sample ▶ plays is rendered by the engine after each edit, and until that
  render landed ▶ played the one from before: click a VCO's wave from square
  to sine and press ▶ at once, and you heard the square. The press now waits
  for the edit to land (a fraction of a second, longer while the engine is
  busy) and plays the new sound. While it waits the ▶ wears a dotted amber
  ring. Pressing it again or pressing Space takes the wait back, and so do
  any other ▶ and switching views. Changes you hear on held notes, and ▶
  pressed once the edit has landed, were already right; a browser test now
  measures both at the output (`patch_audible.spec.js`).
- **Space in PATCH no longer plays the patch from before your edits when ▶ is
  off.** With nothing reaching the output (an unplugged source) or a setting
  muted by the safety check, Space played the bank's saved sample of the
  patch as it was before any edit. It now says why there is nothing to play,
  as ▶ would.

### Changed: one source for color

- **The app, the website and the films take every color from one file,
  `www/brand/tokens.json`, and the repo's checks fail on a color written
  anywhere else.** The palette used to be copied by hand into six places, and
  the copies had drifted: the films drew their darker amber as `#6e4d22` where
  everything else used `#7a5526`, and the brand page lit the E of AURACLE
  green where the app lights it amber, the color that means the model is
  working. Both now match, and nothing else looks different. The published
  films were made with the old amber and change when they are next rendered
  (`test_tokens.py`).

### Fixed: a patch keeps its name

- **A patch keeps its name when the bank changes around it.** Names are read
  off the patch next to the rest of the bank, and they were read again every
  time the bank changed, so a generation that replaced nine patches renamed
  patches that had not changed: the child you had just opened could turn from
  *Soft Drone* into *Soft Lead* as the generation landed, and a numeral could
  come and go (*Warm Key* became *Warm Key 2*). A name is now given once, when
  the patch joins the bank, and kept, across reloads too
  (`a_patch_keeps_its_name_when_the_bank_moves`,
  `names_are_kept_across_a_reload`).

### Changed: the hands first

- **A preset's controls work the moment it lands.** Every one of the 62
  presets now ships with PERFORM's measurement of it, so the named controls
  of a preset opened from the bank, a warm-start pick or a booth demo turn at
  once. They used to read *listening…* for 11–16 s on every patch not visited
  before, which is where the warm start leaves a newcomer: 8.8 s after
  *teach it* the controls were still dead. The shipped measurement was taken
  against a standard pool, not yours, so PERFORM re-measures in the
  background (*re-checking*) and the controls keep working meanwhile. While
  the warm start is open, its nine cards are measured against your session
  too, once the pool has filled. A first measurement waits at most three
  seconds for the file, so a stalled download cannot leave a preset on
  *listening…*. `make perform-wirings` regenerates the file,
  and `make test` fails when it is stale: a preset changed, or what the
  measurement is made of (the phrase, φ, loudness, the DSP, the standard
  pool, PERFORM itself), re-measured on a sample of the file
  (`shipped_preset_wirings_are_current`,
  `shipped_preset_wirings_measure_the_same_today`, `budgets.spec.js`).
- **A preset you have opened before plays the moment you click it, even
  right after a reload.** The page remembers each preset's patch and level,
  so the keys and PERFORM's controls have it at once while the engine catches
  up; PATCH shows the new rack when the engine has rendered it. Any other
  patch reaches the keys as soon as the engine turns to it, before that
  render. Opening used to wait behind whatever the engine was already
  rendering, and just after a reload that is always something (the first
  patch, the sounds of the pair on the table and of the next one): PERFORM
  showed a reloaded preset's controls working 9.3 s after its tab was opened
  on a CI runner and 4.7 s on one core. The sounds of a dealt pair now wait
  behind what you ask for (an open, a ▶, the start of an Offer or of a
  measurement) instead of the other way round. Until PATCH has the new rack,
  PERFORM's Keep, Take and Back say they wait for it rather than land on the
  rack being replaced. Two presets clicked in quick succession open the one
  clicked last; the first used to open when it loaded, and the second was
  then refused (`perform_instant.spec.js`, `perform_open_early.spec.js`).
- **A preset clicked in the bank opens with one render instead of two.** Its
  insert used to throw its audio away and the bench then rendered the same
  phrase again; the insert now keeps it, as the warm start's ▶ already did,
  and so does the warm start's first pick (`budgets.spec.js`).
- **The second offer comes as fast as the first, and NEXT says it passes on
  B.** PERFORM now grows the next offer in the background while B still holds
  one, so offer, hear it, pass, offer is instant every time; the second offer
  used to be grown on demand and took 10.9 s where the first took 0.01 s.
  While B holds an offer the Offer pad reads **NEXT** with *passes on B*
  under it: pressing it was a verdict on B that the pad never mentioned. A
  pass now carries **undo** for seven seconds (B comes back and nothing is
  recorded), as a Take carries *don't count it*, and a B you pass on without
  hearing it says *<!-- voice: quote -->B skipped — not counted, you hadn't heard it<!-- /voice -->* instead of
  vanishing without a word (`perform_next.spec.js`).
- **Wander answers at once, and says what it is doing on itself.** Let go of
  Wander in a new region and its first move (an offer, or a drift) is asked
  for a second and a half later; the region's pace sets the moves after that.
  Turning it into *drift* used to leave 21 s of nothing, because the first
  move waited out a whole period, and turning Wander counted as a hand on the
  sound, so the status line said *<!-- voice: quote -->paused — your hands are on it<!-- /voice -->* while it was
  being turned up. Wander's own drag no longer pauses it. Three ticks on its
  ring mark where *ideas*, *drift* and *roam* begin, and the middle region is
  called **ideas** (it was *offer*, the Offer pad's word and Blend's). The
  line under Wander carries its state (*drift · next in 9 s*, *paused 3 s*,
  *held*, *<!-- voice: quote -->staying — nothing better nearby<!-- /voice -->*) with a thin arc filling toward
  the next move, and PERFORM's status line keeps to the patch
  (`perform_wander.spec.js`).
- **PERFORM's controls stay under your hands.** When the controls re-center
  (after a Keep, a Take, a fresh measurement or a Wander glide, where the
  sound does not move), the pointer glides home over a quarter of a second
  and a faint tick marks where it was, instead of jumping to 12 o'clock in
  one frame. A re-check in the background no longer re-centers anything
  unless it wired a control to different knobs: it used to take a turn away
  seconds after the hand had let go. A MIDI pot on a re-centered control keeps
  working from where it is, scaled so each end of the pot still reaches the
  control's end; it used to go dead until swept back through the middle,
  every few seconds in *roam*. Blend is the exception: when it comes home
  after a pass or a Take, a pot on it is let go until brought back down to
  home, so a pot left near the top cannot pour the next offer in with one
  nudge (`perform_recentre.spec.js`, `midi.test.mjs`).
- **The next pair is already waiting in EVOLVE.** While a pair is on the
  table the engine deals the next one and renders both its sounds, so a pick
  or a skip puts it up at once and its ▶ plays at once; the pair after is
  dealt behind it. A pick used to put the table away and wait for the deal,
  and during a generation that wait was a whole seed's walk, up to about
  20 s of dimmed cards, with the new pair's sounds rendered after it. Taking
  a pick back puts its pair back and keeps the other as the next, and a
  patch cut meanwhile is never dealt: its pair is dropped and dealt again.
  Pairs go up in the order they were dealt: a pick made while the next deal
  is still out (a generation holds it) waits for that deal instead of asking
  for a second, so a seeded session shows the same pairs in the same order
  however long each deal took (`evolve_ahead.spec.js`, `budgets.spec.js`). A
  pair dropped unseen does not count as asked: under an information-seeking
  pairing rule the unbiased probes TRUST scores on are one in ten of the
  pairs you were shown, and a probe dealt ahead and dropped used to take its
  turn and leave the sample smaller
  (`discarded_deals_do_not_advance_the_check_cadence`).
- **What the instrument promises about time is measured.** The app marks
  its own moments (boot start, the veil lifting, the first sound, a full
  pool, PERFORM's controls wired, a patch opened, a pair dealt), every film
  rehearsal records them beside its stamps, and new budget specs hold them:
  a preset's controls live within a second of its click, a warm-start
  pick's within a second of *teach it*, the next pair within 0.3 s of a
  pick, a duel ▶ sounding within 0.15 s, and a patch revisited in PERFORM
  wired within 0.5 s (1.5 s after a reload), where the spec used to allow
  5 s and 8 s (`budgets.spec.js`, `perform_instant.spec.js`).
- **A generation breeds beside you.** EVOLVE POOL's ten walks run in
  parallel on the render farm, and the engine only folds their children in,
  in the order the walks were dealt, so a seeded session breeds the same
  children at any number of workers. It used to walk them one after another
  in the engine itself: for two to three minutes a pick's next pair waited up
  to twenty seconds for the walk in progress, and a patch opened in PERFORM, a
  pressed Offer and every refit waited for all of it. Now a pick deals its
  next pair in a few hundredths of a second, a ▶ plays, PERFORM measures and
  an Offer starts while it breeds; only a refit still waits, so the generation
  is bred under the model it started with. A pick made meanwhile moves the
  next pair at once but not which children are kept, which is judged under
  that same model however the picks and the walks interleave
  (`picks_during_a_generation_do_not_change_which_children_are_kept`), and
  GENERATIONS and the next-step chip count the generation once its first
  child lands, not the moment a pick's reply arrives. On a busy four-core machine a
  generation still takes two to three and a half minutes (157–173 s with four
  workers, 208–230 s walked one at a time), because it lasts as long as its
  slowest walk (`evolve_breeds_beside_you.spec.js`,
  `evolve_generation_timing.spec.js`,
  `farm_walks_breed_the_serial_generation`).
- **Children land as they are bred, at the top of the bank.** Each child
  appears the moment it is bred in a **new · gen N** group leading the
  evolution bank, in the order they were bred, playable at once; the ranked
  rows below it do not move. Nothing leaves the bank until the generation
  ends, so a patch you save while it breeds is safe, and hovering EVOLVE POOL
  marks the rows it may replace. A session saved while a generation bred
  comes back with that generation unfinished; the next EVOLVE POOL ends it
  first and names what it replaced. The ten children used to arrive at once at
  the end, scattered through the ranked list, and patches were replaced as the
  walks went (`evolve_breeds_beside_you.spec.js`).
- **EVOLVE POOL is its own progress bar, and a generation can be stopped.**
  While it breeds the button fills in amber and reads *breeding 3/10*, with
  **stop** beside it; stop ends the generation with the children bred so far
  and replaces only as many patches as they need (as at any generation's end,
  the lowest-ranked go, which can include a child bred early). It used to be a dimmed "BREEDING 1/10…" that
  could not be stopped (`evolve_breeds_beside_you.spec.js`).
- **⚡ evolve from this walks on the render farm.** Its walk (about twenty
  seconds, longer with many locks) no longer stops the engine: a deal, a ▶, a
  bank open and an edit are answered while it runs, and **stop** drops it. It
  used to be one call during which nothing but the knobs answered, with a
  toast as its only sign. ⚡ and EVOLVE POOL take turns: while a generation
  breeds ⚡ is disabled and says why when you hover it, while ⚡ walks
  EVOLVE POOL waits, and a refit waits for either, so a seeded session breeds
  the same children whichever finishes first. The patch ⚡ walks from stays in
  the bank until its walk lands or is stopped
  (`evolve_breeds_beside_you.spec.js`,
  `a_seed_evolving_is_never_evicted_until_its_walk_lands`).
- **Long work has one home: the job slot in the menu bar.** Beside
  GENERATIONS it shows *⚡ breeding 3/10 · about 40 s*, *⚡ evolving Glass
  Pad* or *refitting your taste map…* while one runs, with **stop** where the
  job can be stopped, in every view; the estimate comes from this session's
  own walk times. The wordmark's E is lit exactly while the slot shows. The E
  used to be the only sign, and it meant three different things
  (`evolve_breeds_beside_you.spec.js`).
- **The render farm comes back when it is needed, and leaves again.** Boot's
  workers are reaped when boot ends, as before; a generation or ⚡ raises a
  crew from the engine binary already compiled, and it is reaped after a
  minute with nothing to do, so its memory is not kept behind the instrument.
- **A bank ▶ says it heard you.** A ▶ whose sample has to be rendered first
  shows a dotted amber ring until it plays.
- **The next-step chip breeds where you are.** *It's learned something. Breed
  a generation ▸* starts the generation without leaving the view you are in,
  and afterwards the chip points at the new children at the top of the bank
  instead of opening TASTE.
- **Turning a search control grows an offer that goes the way you turned it,
  and B says how far it went.** Turn Grit up past its notch on a patch with
  nothing rough in it and the toast says *growing a grittier offer instead*;
  B counts the seconds while it grows, then reads *grittier by 1.8σ* (in
  amber: it is the model's measurement, σ being the spread of the patches in
  your session), or *<!-- voice: quote -->not grittier: this walk found no way there — turn it
  again to try another<!-- /voice -->*. The offer used to be the Offer pad's walk with the
  direction only as a label, so it was grittier by accident: over sixteen
  presets, one Grit offer in seven or fewer moved that way. Now the walk
  counts a variant for more the further it goes the way you asked, and keeps
  walking from where it stopped (up to three walks) until it has, so Grit
  turned up comes out grittier in about two offers of three before any picks
  and about half once a taste that dislikes noise has been learned. That can
  take longer than an Offer does. The Offer pad and Wander are not aimed
  (`perform_aimed.spec.js`, `an_aimed_offer_moves_the_way_it_was_turned`,
  `make offer-census`).

### Fixed: true today

- **A guess looks like a guess in TASTE, and in PATCH's node bank.** A pull
  the model is sure of (its interval clears zero) is a solid bar with its
  whisker; one it is still guessing at is a faint hollow bar with the whisker
  drawn at full strength, and its label ends in **?**. DIRECTIONS used to draw
  every coefficient as the same glowing bar under "Longer bar = stronger
  pull", when at 58 picks 35 of its 36 intervals crossed zero; STYLES drew
  them with no interval at all; the node bank called the same numbers "no
  lean either way" and capped their whiskers at 16 px. DIRECTIONS' caption
  now reads "<!-- voice: quote -->Where each style leans. Solid = it's sure. Hollow = still a guess
  — the thin line is how far it could be off.<!-- /voice -->" (`taste_marks.spec.js`,
  `taste-geom.test.mjs`)
- **TASTE's early states count from where you are.** MAP offers "1 more pick
  →" at five picks, not "Start 6 quick picks →"; STYLES says "Your first style
  appears at pick 6; more split off as you teach it."; TRUST counts its own
  twenty guesses ("14 to go →") instead of borrowing the six-pick button. The
  map's footer is in words ("<!-- voice: quote -->A flat view of 40 patches — close dots usually
  sound alike (it shows 29% of how they differ)<!-- /voice -->"), and its caption says what a
  click does: it opens the patch (`taste_marks.spec.js`).
- **Reset taste profile keeps your saved patches, and downloads a copy
  first.** It used to delete the whole saved session: every saved patch, the
  modules set aside and the dock's settings went with the picks, although the
  question named none of them and the guide said saved patches survive. It
  now asks with the counts ("Your 2 picks, stars, cuts and 0 generations are
  forgotten, with every patch you haven't saved. Your 1 saved patch stays."),
  saves `auracle-profile-before-reset.json`, and keeps the saved patches with
  their pins and layout. **Save taste profile** now says what it wrote
  ("<!-- voice: quote -->Downloaded auracle-profile.json — 58 picks.<!-- /voice -->"), and a loaded profile
  redraws the taste map at once instead of waiting for six more picks
  (`taste_profile.spec.js`).
- **COMMIT's comparison is blind, and Esc cancels it.** The two sides are A
  and B until you pick, and the receipt says which was yours ("B was your
  edit"); they used to be titled "your edit" and "the original". Esc, or
  **cancel**, closes the card and commits nothing (it used to commit);
  **commit without comparing** is its own button. **my edit is better** skips
  the comparison for one commit and unticks itself: it used to stay ticked
  and silently turn every later commit into an unheard claim
  (`patch_editing.spec.js`).
- **A commit's receipt is said next, not behind the edits it committed.** The
  lane still showed a placement's "TAKE IT OUT" 1.3 s after COMMIT, offering
  to undo into a patch already saved; a landed commit now takes the edits'
  receipts down (`patch_editing.spec.js`).
- **A tablet in portrait gets the narrow-window notice.** The notice needed a
  mouse and the phone gate a small screen, so a 768 × 1024 tablet got neither
  and a layout with PERFORM's pads under the keybar. It now shows at 999 px or
  less with any pointer: "Turn your tablet sideways, or widen the window."
  (`narrow_gate.spec.js`)
- **The EVOLVE guide gives true timing.** It said a generation takes "a
  minute or two" and that a pick is answered between seeds as if at once;
  what a generation costs now is under *Changed: the hands first*. The node
  bank's "nothing called that" no longer says Auracle has no sequencer: steps
  and euclid are sequencers that play the sound, not the notes.
- **⌘Z outside PATCH never undoes a PATCH edit.** It takes back your newest
  pick or cut still inside its seven seconds, in any view; with none left it
  says *<!-- voice: quote -->nothing to undo here — PATCH edits undo in PATCH<!-- /voice -->* and changes nothing.
  In EVOLVE it used to fall through to the edit undo and silently revert a
  knob turned minutes earlier on a patch you could not see. In PATCH, a pick
  from the pick strip is now taken back before any edit (`evolve_truth.spec.js`).
- **The sixth pick can be taken back like the other five.** Its refit waits
  for the pick's seven seconds (or goes out when you pick again), and the
  meter says *● learning from your last 6 picks…* meanwhile. The sixth pick
  used to go into the log the moment the next pair landed, and its toast
  showed a dead **IN THE LOG** button; a closed undo window now simply removes
  the button (`evolve_truth.spec.js`).
- **"● it just learned" appears when the model has learned.** It used to be
  shown when the refit was *sent* and taken down 3.2 s later, so during a
  generation it announced a map that would not be redrawn for minutes. It now
  appears when the refit lands and stays until your next pick; during a
  generation the meter says *● it will learn from these 6 when breeding
  finishes*. *see what changed* always opens TASTE's map, and the wordmark's
  **E** stays lit until every job it stands for is done, rather than going
  dark when the first of them replies (`evolve_truth.spec.js`,
  `evolve_feedback.spec.js`).
- **skip ↻ puts the pair away like a pick does.** The cards dim and their
  buttons stop until the next pair is dealt, and a deal slower than 300 ms says
  why on the cards, for example *<!-- voice: quote -->dealing — the engine is breeding (seed
  4/10)<!-- /voice -->*. A skip used to leave the old pair up with buttons that looked live
  and did nothing, which during a generation could last twenty seconds
  (`evolve_truth.spec.js`).
- **A cut patch is never dealt again.** A cut hid the row, but the patch stayed
  in the pool and could come back minutes later as a duel side. The toast now
  reads *<!-- voice: quote -->Cut Soft Wash — it won't be dealt again<!-- /voice -->*, without the id, and ⌘Z
  takes a cut back too (`a_cut_patch_is_never_dealt_again`,
  `evolve_truth.spec.js`).
- **What a generation or a loaded preset replaced is named.** The toast used
  to count ("the 10 patches it liked least were retired to make room"); it now
  names them: *The 10 it liked least were replaced: Soft Wash, Noisy Pad, Glass
  Rain +7 more.*
- **The EVOLUTION strip speaks names.** A step reads *Soft Pad → Warm Drone 2 ·
  … · liked +0.06* where it read *#51 → #52 · … · Δtaste +0.06*; with nothing
  bred yet it says *no move was accepted*, as the generation's toast does. The
  guide now says what the sparkline plots: each step's child as the model
  scored it then, not the pool's utility over generations.
- **Opening a patch is not announced unless it kept you waiting.** Every open
  used to toast "X on the bench", and a click on the TASTE map toasted "<!-- voice: quote -->…
  selected — it's on the workbench and under your fingers<!-- /voice -->" before the patch
  had arrived, then the bench toast after it. Now the dot shows a dotted ring
  while it opens, and only an open slower than a second says *Opened Acid
  Line* when it lands (`evolve_truth.spec.js`).
- **Clicking a view's tab puts the keyboard in that view,** so EVOLVE's ←/→
  pick on arrival and Tab continues inside it; keyboard users on the tabs still
  move between them with the arrows (`evolve_truth.spec.js`).
- **Keys a list or the rack uses are not also notes.** *p* in the presets list
  plays the preset without also playing a D♯, *L* in the rack locks without
  playing a D, and *1* / *2* during PATCH's keep-as-new comparison play a side
  without also rating the bank's row (`keys_are_not_notes.spec.js`).
- **A PERFORM control that turns only one way draws its ring on that side.**
  The half you can turn toward is solid, the other is a dotted hairline, and a
  stop sits at the top; a drag into the stop gives the pointer a small bump
  (none with reduced motion). The ring used to be drawn on the closed side,
  in a gray that barely showed, so the one cue for which way to turn pointed
  the wrong way (`perform_truth.spec.js`).
- **The line under a one-way control says what you can do: *turns toward far
  only*.** It used to say *at the close end*, a guess about where the sound
  sits that the amber dot on the same control often contradicted. The amber
  dot now explains itself on hover: where this sound measures, compared with
  the patches in your session. The PERFORM film's line changes to match.
- **A control PERFORM has not measured yet reads *listening…*, looks quiet, and
  does nothing.** After a Take, a control whose knobs the taken sound no longer
  had turned amber and said *turn to ask for it*, and turning it grafted a
  module or grew an offer, seconds before the measurement put it back. The XY
  pad struck both axes through in amber while a patch was being measured, the
  look of "this patch can't", and swapped an axis under your hand after a
  Take. Now "not measured yet" has its own look, a turn of it springs back,
  and the status line says *listening to this patch…* where it said
  *measuring how this patch moves…* (`perform_truth.spec.js`).
- **First steps name a control that turns on the patch you're playing.** Step 2
  said "Turn a lit control: BRIGHT is a good start" on every patch, while the
  only colored names on screen were the amber controls that can't turn, and
  Bright is one of them on some patches. It now says *Turn BRIGHT: drag up or
  down* (or whichever control turns), and the keybed's first-run hint waits
  while the steps show, instead of saying step 1 again in a second voice.
- **Choosing an XY axis gives the keys back.** The axis drop-downs kept focus
  after a choice, so the note keys went silent until you clicked elsewhere,
  and pressing `s` jumped the axis to Snap or Space (`perform_truth.spec.js`).
- **An amber search control always springs back when you let go, and says
  what letting go will do.** Turned less than three tenths of the way it used
  to stay off-center, doing nothing, with nothing said. Now a notch marks
  where asking starts, and the line reads *turn further to ask*, then *let go
  to ask for rough* (or *let go to add a tone EQ*).
- **After a pass, Blend comes home.** Pressing Offer again with an offer in B
  left Blend at, say, 67% over an empty B, and the next offer arrived at that
  level over what you were playing. It now glides home, as it does after a
  Take (`perform_truth.spec.js`).
- **Re-checks after a Keep or a Wander glide wait behind what you ask for.**
  They ran in the engine's foreground lane for 10–16 s, so an Offer pressed
  after a Keep or during roam waited behind a measurement nobody had asked
  for. Keep no longer re-measures at all unless the knobs have traveled far
  from where they were measured; either way the controls keep working and the
  status says *re-checking* (`perform_truth.spec.js`).
- **PERFORM's toasts follow the lane's rules, and a Take's *don't count it*
  always works while you can see it.** A later word about the offer replaces
  the earlier one instead of queueing behind it; refusals such as *Nothing
  offered yet* jump the queue. The Take's window used to start at the press,
  so a toast held back in the lane could show the button after the pick had
  been sent, and it did nothing; the window now starts when the toast
  appears, and a late press says *Already counted*. Keep says *<!-- voice: quote -->Kept — this is
  home now. Back returns here.<!-- /voice -->*
- **PERFORM's words match the app.** The guide's opening line counts six named
  controls, Blend and Wander (it said eight named ones); help says Freeze
  stops Wander where it is (it said it holds everything still); a control's
  caption names at most two knobs and then *+N* instead of cutting a third
  off mid-word; and a control at its center reads *<!-- voice: quote -->centre<!-- /voice -->* to a screen
  reader, not *far 0%*.

### Added: the films

Five films, each on the page it explains, with the launch film as the landing
page's hero:

- **Auracle** (1:38), the launch film. On the landing page its opening loops
  silently in the instrument's bezel and the whole screen plays it with sound;
  it opens the guide's introduction too.
- **How Auracle learns what you like** (1:49), in *What the model learns from*.
- **Under the hood** (2:17), in the reference's introduction.
- **The math** (2:46), in *Reading what it learned* and *Utility as a max of
  experts*.
- **The sound engine** (2:49), in *The standard phrase* and *The web runtime*.

Captions are on by default, and the guide's Films page lists every film with
its chapters and full transcript. The README carries the launch film's poster,
each crate's API docs link the films about it, and the app's ⋯ menu gains
**Watch the films**. Everything you hear is Auracle: the scores are played by
its own engine. The narration is synthetic (Kokoro-82M, offline).

### Fixed: what the films found

Rehearsing a film of each view meant doing everything the guide says, on
camera, in a seeded session. Wherever the app fell short of the guide, the app
was fixed, not the words.

- **PERFORM's "under the hood" rows name each knob by its module again.**
  A patch opened from the bank while PERFORM was showing reached PERFORM
  before PATCH's rack had named its modules, so the rows read raw knob names
  ("thresh 15%", "dec 25 ms") under captions that said "threshold" and "mod
  env decay", and stayed that way. The rows are rebuilt once the rack lands.
- **The TASTE map stays the way round you left it.** A refit could mirror it:
  in a taught session one refit sent "Warm Drone 2" from the far left to the
  far right, though the guide says the orientation is pinned. The rule that set
  each axis's sign (its largest loading positive) changes its answer as the
  axis turns, and with φ's near-equal brightness loadings that was routine.
  Each map now faces the way the last one was drawn, and the session saves it,
  so a reload does not mirror it either (`a_redraw_never_mirrors_the_map`,
  `taste_map_keeps_its_orientation_across_redraws_and_reloads`).
- **A seeded session is the same session every time.** Fills, duels, fits,
  evolution and PERFORM's offers drew from one random stream, so a spare offer
  that finished early or late moved every duel and fit after it: the same patch
  read 0.39 in one session and 0.43 in its twin. Each now has its own stream,
  and a fit is seeded from the evidence it is fitted on
  (`a_consumer_draws_only_from_its_own_stream`).
- **Keys work after a click.** A focused button swallowed every key that
  doesn't play a note, so one click on HOLD or ▶ turned off `[`/`]`, `m`, 1–5
  and EVOLVE's ←/→ until you clicked elsewhere. A button now keeps only Space
  and Enter.
- **A half-closed PERFORM control stops at the center** on the side it can't
  reach, with the mouse, the arrow keys, a MIDI pot or a long-press, as the
  guide says; the dial used to turn on past it while the sound stayed put. An
  XY axis the patch can't move now strikes its end words through
  (`perform_controls.spec.js`).
- **Knobs read in their units.** A slew's rise and fall read "52.84 s" for a
  53 ms glide, and a granular grain "10.00 s" for 10 ms.
- **The wavefolder's knob is called threshold.** It is the fold threshold, so
  turning "fold" up folded less, and PERFORM's hood showed "fold" falling as
  Bright folded harder.
- **A bank row's cut appears on approach again.** Its reveal rules were less
  specific than the rule that hides it, so cut could never be seen or pressed
  (`bank_row.spec.js`).
- **The spec strip no longer says "heard as as".** Its label is "heard", which
  every module's line was written to follow.
- **A node-bank preview ends at silence.** Its fade stopped one step short of
  zero and left a sliver of a loud patch's last sample.
- **Renaming a style renames that style and nothing else.** A rename showed
  every change the votes and stars had made since the last redraw, so naming
  one style "dark drones" renamed the other two and moved every share. The
  name now changes alone, at once, and sticks through refits.
- **The bank scrolls to the patch you opened**, not the one you left. Opening
  a patch from the TASTE map scrolled the list to the previous patch, so the
  one just opened, and its stars, stayed out of sight.
- **PICKS counts a pick the moment you make it.** It showed the engine's log,
  which hears of a pick only after its seven-second undo window, so it lagged
  every pick and read 22 after 23 quick picks. Now picks, cuts and stars count
  at once, and ⌘Z uncounts a pick everywhere it was counted.
- **The latest word replaces the last.** Each pick's toast takes the place of
  the one before instead of queueing behind it (the lane used to name the
  first pick six seconds after the third). The warm start's result replaces
  "Loading those in…" and names the patch under your fingers; ● rec's "saved"
  replaces "recording"; a MIDI mapping's confirmation replaces the last.
- **EVOLVE says how its pairs are dealt, truly and steadily.** A line beside
  skip ↻ reads "<!-- voice: quote -->◇ random pair — a fair test<!-- /voice -->": the model doesn't choose what you
  hear, so every pick is a fair test of its forecast, which TRUST scores. The
  old "unbiased probe" mark claimed only one duel in ten was random, and
  vanished after five.
- **The sixth pick always redraws your taste map**, and "● it just learned"
  says so. After picks the model agreed with, the promised redraw used to
  quietly not happen (`evolve_feedback.spec.js`).
- **The first generation's result arrives at once**, with "what happened?" on
  it. A separate one-time explanation used to hold "Gen 1: 10 new patches in
  the bank" back for seven seconds. ⚡ evolve from this now announces its child
  when it is actually on the bench.
- **The newest generation says "new" in the bank**, and a bank row's ▶ (and
  EVOLVE's ▶ SAMPLE) lights while it plays and stops on a second press.
- **TASTE draws uncertainty so you can read it.** Map dots now range from 2.5
  to 9 px over the map's own spread of uncertainty (they were 5.6–7.5 px), and
  DIRECTIONS draws each whisker on its bar's scale: a capped whisker made
  grit's −0.12 ± 0.13 look settled. An interval that includes zero now crosses
  the center line.
- **The menu bar says "generations"** and fits every window the app opens in;
  at 1000 px it used to push ⋯ off the edge.
- **Wander says it is paused while your hands are on it.** It waits a few
  seconds after any touch, but only said so when a touch interrupted a glide.
- **PERFORM says "re-checking" when the controls keep working.** After Wander
  moved the sound a long way, the status read "measuring how this patch
  moves…", the words for a patch whose controls are waiting, while the dials
  worked on.
- **Back after a drift glides home.** After Wander's drift, Back used to jump
  seconds late and clear the offer in B, because the drifted patch was written
  out with its fields in a different order and read as a new patch. Keep after
  a drift, and PERFORM's memory of measured patches, had the same fault
  (`perform_replies_write_trees_in_their_own_key_order`).
- **An empty socket is silent.** Unplugging a source, extracting a module or
  moving a cable left a dashed EMPTY plate, but under it the app had put a saw
  oscillator that went on playing: the film's scope showed a clean saw under a
  held chord, and the model scored and learned from a sound you never built.
  The socket now holds the grammar's own silent source, so nothing plays
  there; one side of a mix unplugged mutes only that side. When the socket was
  the patch's only source the whole patch is silent, and it says so in those
  words ("<!-- voice: quote -->silent — nothing reaches the output<!-- /voice -->", and "no guess" from the model)
  instead of the runaway-feedback warning. A patch saved with an empty socket
  before this change still has the saw behind its EMPTY plate until you fill
  it (`patch_truth.spec.js`,
  `an_unplugged_socket_is_silent_and_filling_it_sounds`).
- **A knob you turn in PATCH shows the value you turned it to.** Once PERFORM
  had measured a patch, PATCH redrew a knob you had just turned at its old
  value, in amber, with a pointer claiming PERFORM was playing it: CUTOFF set
  to 7.83 kHz read 1.78 kHz. PERFORM's own copy of the knob never heard the
  turn, so the next PERFORM control you moved also put the old value back into
  the sound. PERFORM now plays from what you set, and PATCH draws an amber
  pointer only where a PERFORM control, Wander or Back is actually moving the
  knob (`patch_truth.spec.js`).

### Fixed: the player first

The engine does long work (measuring a patch for PERFORM, growing offers,
refitting), and every request used to wait its turn behind all of it. Films of
the app caught a warm-start ▶ silent for 18 s and every PERFORM control
reading "measuring…" for 14 s after a Take.

- **Your gestures are answered first.** The engine serves the player's own
  requests (plays, edits, picks, opens) ahead of work nobody is waiting on, and
  long jobs pause between pieces to answer them (`responsive.spec.js`).
- **Take keeps the controls under your hands**, names the offer you took
  ("Acid Line (taken offer)") and brings Blend home. The controls used to go
  dead while the new patch was measured.
- **A warm-start ▶ says it is waiting and never plays late**, and "teach it"
  opens PERFORM straight onto the pick.
- **Out of sight, PERFORM waits.** Its measurements step back while PERFORM is
  hidden, so editing in PATCH is not slowed by a view you are not using.

### Fixed: editing a patch

- **Every edit lands, in order.** Two knobs turned close together could lose
  the first one, and a second drag could start from a stale value. Every edit
  to the patch on the bench now goes through one ordered lane, and a drag
  starts from the value you last set (`patch_editing.spec.js`).
- **A knob survives the redraw that follows an edit**, and a knob you are
  holding is never rebuilt. For a moment after an edit a knob could vanish
  from under the pointer.
- **Coming back to PATCH, the rack is where you left it, knobs and all.**
  While another view was up, PATCH fitted the patch to its own hidden frame,
  which measures nothing, so on the way back the rack zoomed in from far away
  and showed bare plates for a moment before the knobs returned. A knob
  reached for straight away was not there yet (`patch_truth.spec.js`).
- **Undo retires the toast of what it undid**, and the newest edit's toast
  replaces the last one's instead of queueing behind it.
- **⚡ evolve from this never overwrites edits** you made while it bred: the
  child waits in the bank ("open it").
- **With SYNC on, a sequencer's RATE reads the division it plays**; HOLD, the
  dock and notes leave the arp drawer open; ▶ on a placement preview plays the
  socket being previewed.

### Fixed: every patch at one level, and none that blasts

A fresh bank auditioned at levels 10 LU apart and played at the keys at levels
35 LU apart: loudness normalization is fitted for φ, and two of its bounds were
reaching the speakers. Measured over 200 patches from five fresh loads
(`crates/auracle-wasm/examples/pool_loudness.rs`):

- **▶ plays at the target.** The stored audition (the buffer φ is measured on,
  unchanged) is played through a copy raised back to −18 LUFS and held under
  0 dBTP by a look-ahead true-peak limiter. Auditions 10 LU or more under the
  target: 11 → 0; the spread of the bank (5th to 95th percentile) 10.2 → 1.5 LU;
  true peaks over 0 dBTP 28 → 0. Peaky plucks come back as far as their
  transients allow; a patch at the target plays bit-for-bit as before.
- **The keys play at the target too.** The live makeup is the gain loudness
  asked for, no longer the audition's gain clamped to ±12 dB (which 43 % of the
  bank was outside). Notes 10 LU or more under: 53 → 12; the spread 35.4 →
  13.5 LU.
- **A held note cannot run away.** A slow swell keeps rising after the
  phrase's 1.8 s note, so a makeup fitted on the phrase carried held pads to
  −2.6 LUFS before any of this. A leveler in front of the brickwall now holds
  sustained loudness at 8 LU over the target, where the loudest audition
  moments already are: the loudest held note settles at −9.5 LUFS. The score
  renderer keeps its hand-set mix (`set_leveler(false)`).

Still quiet, on purpose: slow swells on a short tap, and plucks whose C4 is far
under their own phrase. Still inaudible on a laptop at any level: the 16 % of
the bank with under a fifth of its energy between 200 Hz and 5 kHz. That is
the prior's register (it draws octaves −2…+2 uniformly, and a third of the bank
sits mostly below 200 Hz at C4), not loudness.

### Fixed: held notes, MIDI, and the TRUST count

- **Held notes stay held.** A trill played over a held chord took the chord's
  voices one by one: stealing went by age, and the held notes were the oldest.
  A new note now takes, in order, the voice already on that note, a silent
  voice, the release tail that began first, and only then the oldest held
  note. A trill cycles through tails and the chord under it holds
  (`held_notes_survive_a_trill_over_them` in `live.rs`).
- **MIDI says why it is unavailable.** The MIDI panel said "<!-- voice: quote -->no device — plug
  one in<!-- /voice -->" whether the browser had no Web MIDI (Safari), was still waiting on a
  permission prompt (Firefox asks to add a site permission), had been refused
  it, or failed to open MIDI. The dock now reads `midi ?` for all of those, and
  the panel says which, with a **connect midi** button that asks again from a
  click. The guide no longer says Web MIDI is Chromium-only: Firefox has it
  too, and Troubleshooting has a section for a controller that does not play.
- **MIDI plays one tab.** The browser sends a controller to every tab that
  asks for it, while the computer keyboard reaches only the tab in front. With
  Auracle open twice, an older tab played every MIDI note too, with its own
  patch: changing preset, or turning a PERFORM control or the XY pad, in the
  tab you were using seemed not to apply to MIDI notes at all. Now the tab you
  used last plays MIDI and any other stands aside (`midi ○` in its dock; a
  click takes MIDI back), releasing whatever it held.
- **TRUST counts every check.** A calibration check answered after the next
  duel had been dealt was recorded as an ordinary duel, so the check count
  could sit at 0 of 20 after thirty random duels. The engine now remembers the
  last 32 checks it dealt
  (`a_check_answered_after_the_next_deal_still_counts`).

### Changed: the keys reach C0 to C8

<kbd>z</kbd> / <kbd>x</kbd> shift the computer keymap from `a = C0` to
`a = C7`, and the on-screen keybed follows, so every note of an 88-key piano
is in reach.

### Changed: one name in the tab, one address

Every tab reads **Auracle**, or **Auracle | Play**, **Auracle | Guide**,
**Auracle | Reference**, with nothing after it. The site moves to
**auracle.alexnodeland.com**, and the github.io address redirects there. The
landing page and the in-app help point at it, and the screenshots are
re-captured from a taught session by `www/capture-screens.mjs`.

### Added: booth mode

For a kiosk (⋯ menu, or `?booth` on the URL; `?booth=30` for a 30 s idle):

- **Attract.** After a minute with nobody at the keys, the instrument plays
  itself in PERFORM through a curated set of eight patches. It holds a chord
  progression, moves two named controls under an invisible hand (the XY pad
  follows), lets Wander turn the knobs, then grows an offer and blends it in.
- **Hand over.** Any key, click, touch, wheel or MIDI note hands it to the
  visitor on the spot.
- **Next visitor.** Shift+Esc forgets the taste profile and keeps booth mode
  and the measured controls.

Attract is *quiet*: nothing it does is logged, and its offers are never
answered, so it cannot teach the model. An offer it leaves in B starts unheard
for the visitor. `tests/web/booth.spec.js` walks it: attract starts, a control
moves, one key hands over, no pick recorded.

### Added: first steps for a visitor, measurements for an engineer

- **First steps.** A strip under PERFORM's header lays out the whole loop in
  three moves: play a key, turn a lit control, press Offer. Each ticks off
  when it happens, not when it is read, and the strip retires with *"That is
  the loop. Every offer you take or pass teaches it what you like."* It is per
  visitor: the booth's New visitor brings it back, and attract never ticks it.
- **Show measurements** (⋯ menu). The controls' tooltips speak in knobs and
  sounds. For whoever wants the evidence, this puts purity, reach in σ, the
  verified halves, the position and the knob gains back underneath.

### Added: the circuit shows what PERFORM is playing

PATCH drew the kept patch, while PERFORM plays it with controls, glides and
Wander on top. Opening the circuit mid-phrase showed knobs standing still
while the sound moved. Now every knob PERFORM is playing away from its kept
value carries an **amber pointer** at the sounding value, and its readout says
that value. Hovering it names the control turning it (or Wander). Keep folds
the two pointers into one. `tests/web/perform_circuit.spec.js`: turn Bright on
First Bass, open PATCH, and the ladder's cutoff is drawn performed.

### Changed: Offer answers at once

Offer used to start ~10 s of renders on the press: the one gesture no other
instrument has, made to wait. Once a patch has been steady for six seconds and
nothing else is asking the engine for anything, PERFORM grows one offer in the
background and keeps it. Offer hands it over at once, and a press while it is
still growing claims it. A spare belongs to the sound it grew from: a new
patch discards it, and so does moving the knobs outside the region it grew
in. Measured: 0.15 s from press to B, against ~10 s grown on demand.

A press while any offer is growing (Wander's, or attract's just before a
visitor took over) claims that offer, and asks once more if it comes back
empty. It used to be dropped silently, which could leave a press with nothing
at all. Found recording the booth demo.

Asking for another offer passes on the one in B, and that offer now leaves B
(it fades out) instead of staying there, playable and takeable, while the next
one grows. A player could Take the very sound they had just passed on, and a
Take landing just after the next offer arrived was counted as an unheard
answer to that one. CI caught the second case in `perform_teaches`.

### Changed: PERFORM is playable at once on a patch it has measured before

Measuring a patch takes seconds (about one render per knob, plus
verification), and a booth flicks between the same demo patches all day.
Every measurement is now kept, keyed by the patch, and persisted across
reloads. A patch measured before is playable immediately from that
measurement, and re-measured in the background when the model has refit since
(the status line says *re-checking*). The directions a control turns its
knobs survive a refit, since the standardizer only rescales each coordinate,
so the old wiring is right about what moves and the fresh one sharpens how
far. It never re-centers the controls under a moving hand; it waits for a
pause. Measured in headless Chromium: first visits 10–16 s, a revisit 0.12 s,
the same patch after a reload under 1 s (`tests/web/perform_instant.spec.js`).

### Added: playing teaches: an offer heard and answered is a pick

PERFORM used the taste model but never fed it: Keep, Take and every turn were
logged and ignored (and Keep's tooltip claimed otherwise). An offer is the
model's proposal played against the sound in your hands, which is the question
an EVOLVE duel asks, asked without stopping the music. Now, once B has been
**heard** (Peek held, or Blend past half, for a second while notes sound):

* **Take** records *offer over what you had*, after an 8 s window whose toast
  says **don't count it**;
* asking for **another offer** records *what you had over the offer*.

Both directions count. A log of takes alone would be the model hearing its own
proposals agreed with. An offer answered unheard counts for nothing. The
answers are ordinary duels (`Engine::record_tree_duel`; nothing enters the
pool), forecast before they are observed and tagged with a new provenance,
`perform_offer`. TRUST scores them as their own stream, *offers you took or
passed*, which is how anyone will find out whether answers given
mid-performance are as reliable as dealt ones. `tests/web/perform_teaches.spec.js`
walks it on the real engine: a heard pass +1, a heard take +1, an unheard take
+0.

### Added: an XY pad in PERFORM

Two named controls under one finger, beside the under-the-hood strip, in the
space the booth critique found empty. It starts as Bright × Motion, and either
axis can be any of the six. Only a reachable axis moves; an amber one is
struck through on the pad. Double-click returns it to the center, and the arrow
keys move it.

### Changed: named controls turn the knob that does the work, and grow one when there is none

A booth critique found PERFORM's controls mostly dead: 1–4 of 6 reached a
patch, and Bright, where it did reach, was "mostly resonance".

* **Ranked by effect, not coefficient.** A knob that barely moves the sound
  needs a large coefficient to contribute anything, so it headed the wiring
  and set the travel scale, and the knob doing the work got a sliver of a
  turn. On Iron Bass, Bright moved the drive by half its range and the cutoff
  (+4σ of centroid per unit) by almost nothing: 0.03σ of reach. Now the
  largest-effect knob gets the whole `MAX_TRAVEL` and the rest clamp there.
* **The control's own knobs first.** Bright tries cutoff, tone and the like,
  and Motion tries mod depth and rate, before the solve may use anything else.
  On Acid Line, Bright was the amp's attack and release; it is now the cutoff
  (purity 0.87, reach 2.85σ).
* **A half-travel retry** in `verify` for a control that would otherwise close.
* Measured on the same 24 fresh-pool patches and the same build: Bright
  reaches 50% (was 29%), Snap 79% (67%), Body 29% (21%), Space 46% (38%), and
  the mean reachable controls per patch went from 2.21 to 2.54. Median
  verified reach is 3–4× larger. **Motion fell**, 62% → 46%, and that is
  written down in the reference rather than tuned away.
* **Grafts.** Turning a search control now first tries to give it something
  to turn (`perform::graft_for`). Bright and Body get a flat EQ, placed below
  any stereo module that ends the chain; it is transparent (median |Δz|
  0.000). Space, turned up, gets a ≈250 ms release, because every effect sits
  before the amp envelope and a reverb's tail is cut at note-off. The graft is
  one undo step; the patch is measured again and the control is set where the
  hand left it. Over the presets, the EQ opens Bright on 7 of 10 and Body on
  15 of 48, and the release opens Space on 41 of 46. Grit has no graft: its
  axis hears noise, not saturation (a new open question).
* Tooltips say "raises filter cutoff as you turn it toward bright", not
  `node#cut +0.50 · purity 0.92 · 2.72σ`.

### Fixed: the first minute at a booth

A walkthrough of the first-run flow, played the way a visitor would, found:

* **The warm start lost most of what it was told.** A visitor who listened to
  the nine presets before choosing (≈25 s) had 9 of 18 preferences recorded
  and a column of "that patch is gone" toasts: the nine inserts went into a
  full pool one message at a time and the unpicked six evicted each other
  before their duels were logged. It is now one worker turn (`warm_start`):
  picks go in first and pinned, and each unpicked preset's three duels are
  recorded the moment it lands. `tests/web/first_run.spec.js` walks the slow
  path and requires 18; the old code gives 9.
* **The warm-start ▶ could not be clicked.** A global rule lifts anything
  with `aria-pressed` above the toast lane, and a warm card holds its pick in
  `aria-pressed`, so the card painted over its own ▶ and "hear this" cast a
  pick. The same rule put PERFORM's pad over the MIDI popover.
* **PERFORM named the previous patch.** The tree reaches PERFORM before its
  name does, and PERFORM read the name on the tree's arrival, so a sweep of
  twelve presets was off by one every time.
* **Measuring a patch took seconds, every time.** PERFORM now keeps the last
  24 measurements, keyed by the tree and by how many votes the model had seen,
  so flicking back to a patch is instant.
* **The help dialog** was taller than a 900 px window with no scroll; its
  title and GOT IT were unreachable.
* **Toasts** covered B's title in EVOLVE, rack plates in PATCH and the TASTE
  header. They now stack upward from just above the keybar.
* **After the warm start, PERFORM** (not PATCH, the densest view), and a
  returning player comes back to PERFORM if that is where they left.
* **Bred children below their parent** are labeled *exploring*: the walk
  samples the posterior rather than only climbing it, and a column of bare
  negative Δtaste read as "it bred worse patches". The guide no longer says
  every walk goes uphill.
* **The arp's settings float above the dock** instead of widening it; turning
  ARP on moved every key ~120 px under the player's hand.
* **Unrated stars** on the selected bank row read as five lit stars; they are
  muted until hovered.
* **Copy**: the warm start's "about twenty votes" is eighteen; help's "PLAY" is
  PATCH; the landing says four views, and its miniature uses the app's control
  names; "model's guess: needs a few picks" after eighteen picks now says it is
  fitting.
* **B says what it changed**: the offer strip leads with the diff ("attack
  0.03→0.09, +follower") instead of only "an offer is waiting".
* **The rack draws legibly.** The scope's reserved corner was chosen by pixels,
  not by what it cost the patch, and a two-row patch lost a third of its
  height to it (First Bass at 0.63×, labels ≈6 px). It now takes the side that
  leaves the larger fit, or none when that would shrink the patch by more than
  a fifth (the scope already ducks out of any plate's way).
* The warm start is a real dialog (role, `aria-modal`, focus on the first ▶);
  the menubar's forecast count no longer runs one behind TRUST; style names
  are no longer clipped.
* **A narrow window** (999 px or less, any pointer but a phone's) says to
  widen it, instead of overprinting the controls into "BRIGSNAPTIOBODY". CSS
  only: it disappears as the window widens, and nothing underneath is reset.
* **PERFORM's pads.** The Hold pad is **Freeze** (the dock's **hold** latches
  notes: two buttons named the same doing different jobs); Take and Peek are
  disabled until there is an offer; Offer reads as the primary.

### Fixed: the preset bank, measured instead of written by feel

`examples/preset_audit.rs` (auracle-features) measures what audition actually
plays for every preset: makeup gain lost to the peak ceiling, and energy by
band (sub, low, mid, presence, air, and the 200 Hz–5 kHz share a laptop or
booth monitor reproduces). Its first run found two problems.

* **Pink noise was 22 % infrasound.** quiver's 16-row Voss generator runs its
  1/f slope down to ~1 Hz, with a DC-to-RMS ratio of 0.13. Loudness
  normalization is K-weighted and ignores it, so it only spent headroom:
  behind a lowpass, `Noise Wash` measured 77 % of its energy under 40 Hz and a
  77 Hz centroid. The compiler now puts pink through the voice DC blocker's
  20 Hz highpass at the source: 1 % below 20 Hz, no DC; `Noise Wash` is now
  centered at 318 Hz. Every patch with a pink source renders differently, so
  `RENDER_EPOCH` is 3.
* **The leads could not cut.** `Filter.cutoff` is the pole frequency; at zero
  resonance the ladder is −12 dB there and −3 dB an octave below (measured:
  0.7 → 1.19 kHz, not the map's 2.5 kHz). Presets written as if it were the
  −3 dB point left six of nine leads with under 1 % of their energy above
  2 kHz at C4. Re-voiced: Wobble Board, Falling Sign, Loudhailer and Fifth
  Wheel now carry 1.7–2.4 %; Tine's high partial is audible again (its
  highpass sat at 5 kHz, above almost all of a C6 triangle); Coin Toss, Iron
  Bass, Held Under, Anvil, Ember and Rotor open up. Acid Line's sweep is
  longer (τ 16 → 63 ms) and it and Anvil sustain higher, so neither auditions
  6–9 dB under its neighbours because of one attack spike. The table at the
  top of `presets.rs` now gives the measured −3 dB point beside the map.

### Added: PERFORM

A performer reaches for *brighter*, not for `node/0#cut`, and until now the
only way to change a sound while playing it was by address, one knob at a time,
in a rack built for editing. **PERFORM** is a new first tab for playing the
sound instead: six named controls (**Bright, Snap, Motion, Body, Grit, Space**),
**Blend**, **Wander**, and six pads (**Keep · Back · Offer · Take · Peek ·
Hold**). Nothing in it opens a dialog, because a player mid-phrase cannot answer
one. The tab formerly labeled PLAY is now **PATCH**.

A named control is a fixed direction in standardized audio-φ, the same on every
patch. What it turns is measured per patch: one finite-difference render per
knob gives the Jacobian ∂z/∂knob, and a ridge solve wires each control onto at
most four knobs, no knob traveling more than half its range at a full turn. A
table of what each kind of knob "usually does" was measured first and rejected:
over the 61 presets, wiring from each patch's own Jacobian reaches a median
purity (cosine between the movement produced and the one asked for) of 0.61,
0.77 and 0.75 for Bright, Snap and Motion, and the best leave-one-out per-site
table reaches 0.23, 0.16 and 0.09. The same knob does different things in
different patches.

**A control the knobs cannot honestly produce is not faked.** Below a purity of
0.35 or a reach of 0.15σ it is drawn as an amber *search* control, and turning
it asks for a structural offer instead of moving knobs that do not do what the
label says. Grit and Space are search controls on most presets, because most
patches have no drive or reverb to turn. And because the Jacobian is a local,
linear claim that fails at boundaries, every half of every reachable control is
rendered at ±½ and ±1 before it is offered, and closed if the sound did not move
the asked way both times. On First Bass the linear prediction said Motion could
go down; rendered, turning it down made the sound slightly more restless. That
half is now closed and the control says *already as still as it gets*. The gate
test checks every open half again at ±¾, a point verification never rendered,
with a stated tolerance of 0.05σ: no finite set of samples proves a response
monotone.

**Wander** is one dial from *still* through *offer* and *drift* to *roam*. Drift
is the locked Metropolis–Hastings walk refinement already uses, with every
structural and categorical site locked, so structure never changes under the
player's hands and the walk is still exact conditioning on the patch's shape.
It inserts nothing into the pool. It pauses for 3.5 s after any touch, and a
touch mid-glide stops the glide where it is. Offers may change structure, and
are heard through a **B slot**: a second voice set that follows the same hands,
crossfaded at equal power and matched loudness (Blend, Peek, Take).

Before any taste has been fitted, drift and offers used to return nothing. The
posterior before evidence is the prior, so they now walk the grammar prior
restricted to patches that vet (`VetOnlyFitness`), and say so on screen.

Two limits, stated where the player can see them. A search control's offer is
not yet aimed at the direction turned. And Keep, Take, Back and every turn are
logged as implicit events and not fitted: implicit evidence has to earn its
place in the likelihood, and nothing here has yet.

The `perform_wiring` example prints the wiring for any preset.

### Added: MIDI that does more than notes

A controller with knobs did nothing but play notes, so the instrument's new
named controls could only be turned with a mouse. MIDI now maps itself: the
first eight distinct CCs you move claim PERFORM's eight controls in the order
you move them, each claim announced, and **learn** / **clear** in a new MIDI
panel (click *midi* in the dock) remap any of them. The map, the auto-mapping
switch and the bend range are remembered per device.

Relative encoders are recognized with nothing to set. An absolute pot only
sends when its value changes, so it rarely repeats; an encoder repeats its tick.
That tell, rather than the range of values, is what separates a pot swept to
its bottom stop from an encoder. Absolute pots get **soft takeover**: a pot does
nothing until it passes the control's current position. That matters more here
than on most instruments, because Wander moves the controls under a pot that
has not moved, and without pickup the first nudge would snap the sound.

Channel pressure rides Bright and the mod wheel drives Motion by default. Bend
range is selectable (±2, 7, 12, 24 or 48 semitones). MIDI clock sets the tempo
by a least-squares fit over the last two beats of ticks, so one late tick moves
the estimate by a fraction of its lateness. The protocol's pure parts are unit
tested with `node --test` (`make web-check`, and a new Web job in CI).

### Fixed: the sustain pedal

The sustain pedal was wired to the HOLD latch, and lifting it called panic(),
which also killed every note still under the player's fingers. It now does
what a sustain pedal does: notes released while it is down ring until it
lifts, and lifting it releases exactly those. A note struck again under the
pedal belongs to the finger again.

### Fixed: turning on the arp stripped the rack's knobs

Found recording a demo: on Loom, the tallest stock preset, opening the
ARP/SYNC drawer shortens the rack band by 46 px, which moved its zoom from
0.488 to 0.4265 against an automatic-detail threshold that moved to 0.4268,
so every knob and step bar vanished from the patch you were about to play
with. Both numbers ride the frame height, so a patch near the line flipped on
any small layout change. The automatic detail level now has hysteresis: once
knobs are drawn they stay until the zoom is 8% below the line.

### Fixed: one patch, two names

Auto-names are relative to the pool, so a patch can be renamed as the pool
fills. Several worker messages replaced the bank's rows and re-rendered only
the bank, so a fresh session showed #1 as "Gritty Wash" in the bank and
"Bright Wash" in the PATCH header, the dock and PERFORM. Every label naming a
live or bench patch now refreshes from the same rows whenever the bank does.

### Added: tempo sync for the step sequencers

Steps free-ran at its evolved rate while the arpeggiator and MIDI clock kept a
tempo, so the two drifted apart. **SYNC** in the dock snaps each sequencer's
rate to the nearest musical division of the tempo in octaves (straight,
triplet or dotted) and drives every voice's clock from one transport through a
new `sync` port on `StepsCv`: whenever the position changes, the module
re-seats on step ⌊pos⌋ mod length at phase frac(pos), and between changes it
integrates as before, so blocks stay sample-accurate and a voice that wakes
later lands on the grid. The transport restarts on the first key down (the
same block the arp fires its first step) or on MIDI start, and counts steps,
not bars, so polymeter survives. A rate knob turned with sync on moves between
divisions. Auditions are untouched: the genome's clock stays free-running.
Tests: two sequencers with different histories agree sample-for-sample once
synced; every voice reads one transport; snapping picks the nearest division.

A review of the first version found the grid was not yet shared, and fixed:
- the transport is an integrated beat count, so a tempo change alters speed,
  never position (positions had been elapsed samples × the current rate, and
  a 1 BPM nudge two minutes in threw every sequencer four 16ths forward);
  a division change keeps the current step and re-grids its phase;
- the arpeggiator carries each step's overshoot past the block boundary (it
  had run 2.2% slow at 16ths and fallen a step behind the sequencers in under
  six seconds), and MIDI Start restarts it with the transport;
- a freshly loaded B joins A's transport instead of starting its own at zero;
- MIDI clock pulls the transport onto the room's beat every 24 ticks after a
  Start, rather than free-running on an estimated tempo;
- a rate smoother left over from before sync no longer overwrites the snap,
  and the under-the-hood strip shows the rate a synced sequencer plays.

### Added: under the hood, in PERFORM

The named controls are a view onto a patch's own knobs, and PERFORM now shows
which ones: every knob a reachable control moves, and any knob Wander has
carried away from home, as a bar with its value in its own units and a tick
where it sat when the sound became home. Turn Motion and the envelope's decay
and the filter's mod depth visibly move; click one to open its module in
PATCH, pulsing. The hierarchy runs PERFORM → the knobs → the rack, each a click
deeper. The landing page gains a PERFORM screenshot, first among the views.

### Changed: Wander drifts, instead of jumping and gliding

Measured over 12 presets, an 8-step "drift" moved some knob by 0.3–0.85 of
its range: the walk was refinement's, fugue's adaptive single-site kernel,
which starts every fresh chain with a wide proposal. Drift is now its own
local Metropolis walk on the live knobs (a reflected Gaussian step, symmetric,
accepted on the same target), with the step set by the Wander dial: gentle
drift moves the farthest knob about 0.06–0.14, roam 0.25–0.6. And the named
controls are no longer re-measured after every glide (~46 renders), only once
a knob has left the 0.12 neighbourhood their linear model was measured in.

### Changed: named-control purity measures cross-talk, not correlates

A census of the patches a new player actually meets (the first 24 of a fresh
session pool, `reach_census`) found **Bright** reaching only a quarter of them,
at a median purity of 0.26. Purity was the cosine with Bright's axis across the
whole of φ, so the zero-crossing rate and high band that rise with any real
brightening counted as impurity. It is now measured where cross-talk is heard:
against the other named controls' axes. Two controls whose predicted moves are
nearly collinear are now one gesture, and the later becomes a search control.
Verified on real renders: Bright reaches 29% of patches (from 25%), Snap 71%
(58%), Motion 62% (58%), Body 21% (17%); patches reaching nothing, 2 of 24
(from 4). Bright's real limit is reach (many pool patches have no filter),
which is what search controls are for.

An earlier version of this entry claimed a jump to "purity 0.53" by aiming the
wiring at each control's population *pattern*. That number measured purity
against the pattern itself, and a review caught it: against the axis, the
pattern wiring reached fewer patches than the bare axis. It was removed, and
the reference records it as tried and not shipped.

### Fixed: PERFORM reloaded the patch under the player's hands

PERFORM wired, pushed and drifted every continuous site of the patch, and not
every one has a live handle in the voices: a modulation depth with nothing to
modulate compiles to nothing, and some values are baked into constants. The
first push after a wiring wrote all of them, the misses came back, and the app
answers a miss by reloading the patch, so turning a named control could
restart the sound mid-phrase, re-measure the controls and drop the offer in B.
Found on camera, in the Loom playthrough. PERFORM now uses only the knobs the
compiler gave a handle (`perform::live_knobs`); the drift walk moves
only those. On Loom that is 22 of 27 continuous sites.
A test checks every preset.

### Fixed: 256 KiB of stack per level of the patch tree

The compiler recurses once per level of the audio tree, and quiver's
`Wavetable` (128 KiB inline) and `PitchShifter` (38 KiB) were constructed by
value inside that recursive function, so every level reserved their space
whether or not it built one: over 256 KiB a level, measured from the binary's
stack probe. Eight levels overflowed a 2 MiB thread (found when the audit's
over-the-ceiling test met the merged tree). Both are now built in a
non-inlined helper outside the recursion, and a level costs about 2.5 KiB. A
test compiles a wavetable under sixteen filters on a 512 KiB thread, and
overflows without the fix.

Two merge interactions fixed alongside: PERFORM's walks now return the audit's
`RefineOutcome`, so an offer on a patch outside the prior's support says so
instead of "no offer beat this patch", and the build stamp hashes every app
script (`perform.js` and `midi.js` were missing, and would have been served
stale from cache after a change).

### Fixed: a red-team pass over PERFORM, MIDI and the motion bands

A review of the new surfaces before merge, every finding fixed:

- **Render cache.** `RENDER_EPOCH` is 2: an epoch-1 row lacks the motion bands
  and does not deserialize. The bank's cache-hit path now falls back to a
  fresh render when a cached row is refused, rather than dropping the patch.
- **Answers about a patch that is gone.** Every PERFORM request carries the
  patch generation it was asked about, and a reply for an older patch is
  consumed, not applied. Before, a slow wiring could land on the next patch
  and wire its controls to knobs of the last one.
- **Glides started from a moving point.** The glide wrote into the same map it
  read its start from, so every glide was an exponential approach instead of
  the smoothstep it claimed to be.
- **Hands win.** A drift proposal computed while the player touched a control
  is dropped. A wiring that lands after the controls moved folds in where the
  sound *is*, not where it was when measuring began, so nothing jumps.
- **Keep keeps.** It no longer discards the offer waiting in B or resets the
  controls: the sound does not change, so nothing playing it does either.
  PERFORM's commits also stopped taking two undo steps each.
- **B hands over without a gap.** Take keeps B sounding until A has rebuilt as
  the offer, then fades it; any B that leaves fades first and is freed only
  when silent. B follows the arpeggiator when it loads, is silent while PERFORM
  is out of sight, and its errors are said on screen. Its render view is
  cached like A's instead of being allocated every quantum.
- **The worker always answers.** A PERFORM call that throws still replies,
  with the error, so a failed walk cannot leave an offer "in flight" forever.
- **Expression is expression.** Channel pressure and an unmapped mod wheel
  are offsets on top of the player's own turn: at rest they add nothing, and
  they never count as a touch (which held Wander for as long as a key was
  down). Bank select, data entry, (N)RPN, sostenuto, soft and every
  channel-mode controller are reserved, so a keyboard setting its bend range
  cannot claim a control on the first auto-map. A pot's gesture ends when it
  goes quiet: it is logged and can ask a search control for an offer, as a
  mouse release does. Moving a MIDI control measures the patch even if PERFORM
  was never opened.
- **Stuck notes.** Panic and a device change reset the sustain latch.
- **Accessibility.** Pads answer assistive-technology clicks; a run of arrow
  presses on a control is one logged gesture; the MIDI button reports
  `aria-expanded`, the panel takes focus when opened and Escape returns it.
- **Motion bands measure the held note, not its arrival.** The track starts
  when the level reaches 97% of its peak if that is later than 250 ms, and a
  dip reads at most 60 dB deep. A 0.9 s swell into a steady tone used to read
  4.3 octaves over the floor in the slow band; it now reads still, as does a
  tone that starts late. The modulation FFTs are planned once per thread.
- **Search health ran out of time every night.** The scheduled workflow was
  one 90-minute job that the 16-seed climb alone outlasts. It is now three
  parallel jobs with their own limits.

### Added: φ hears how fast a sound moves, not only how much

A texture is mostly its motion, and φ could not tell a slow sweep from a fast
flutter. Measured on one saw-into-ladder patch under a ladder of cutoff
modulations (`motion_probe` example), `held_centroid_std` scored a 0.55 Hz
sweep and a 13 Hz flutter at 0.098 and 0.094, and stepped random motion like a
6 Hz LFO. A linear taste model on those coordinates cannot represent "slow
breathing, not fast wobble", the first thing anyone says about a pad.

Three coordinates split the held note's motion by **modulation rate**:
`motion_slow` (0.5–2 Hz), `motion_mid` (2–8 Hz) and `motion_fast` (8–30 Hz),
each the log standard deviation of the detrended brightness and level
trajectories in that band. Hearing groups fluctuation this way (Dau et al.
1997), and band-wise modulation power is much of what makes a texture
recognizable (McDermott & Simoncelli 2011). On the probe ladder the band that
reads highest follows the rate (0.55 Hz lands in slow, 2.7 Hz in mid, 13 Hz in
fast), and a static tone reads the floor in all three, exactly.

**It is learnable, not just representable.** A synthetic listener whose whole
taste is *slow yes, fast no* (+1.5 on `motion_slow`, −1.5 on `motion_fast`,
zero elsewhere) is recovered by the ordinary closed loop (real prior draws,
real renders, 60 duels, the shipped fit) at r = 0.63 / 0.59 / 0.43 between
posterior and true utility over three seeds, with the model's top five
+0.6 to +1.0σ above the pool mean. Every bit of that had to come through the
two band coordinates. Gated as `closed_loop_learns_motion_rate` (13 s).

No new render: the tracks come from the held note the phrase already plays,
at a finer hop than the spectral features use (their 43 frames/s would fold the
fast band). Old votes read the new columns as "no evidence" through the
existing projection by name, so no tag bump and no migration.

**Regularity was tried and is not shipped.** Telling a periodic sweep from a
random walk needs several cycles in the window; in the held span's 1.55 s the
two candidate measures separate them cleanly at 2.7 Hz and above and not at
all below 1.5 Hz, which is exactly where evolving textures live. It waits for a
longer stimulus rather than teaching the model a guess.

Three measurement examples come with it, all rerunnable: `motion_probe` (the
ladder), `leverage_probe` (how concentrated a patch's audible leverage is
across its knobs: median 68% in the top four, 94% in the top eight, over the
61 presets) and `jacobian_probe` (∂φ/∂knob per preset, the raw material for
named performance controls).
### Added: a fourth design register, for the questions nobody has raised

The reference could say what was chosen (decisions), what closed (milestones)
and what is unsettled (open questions). It could not say what was never
considered, so *rejected* and *never considered* looked identical from the
outside. **Unraised directions** is that register: sixteen possibilities the
architecture already supports and nobody has argued about either way, each
naming the machinery that already exists, what stands in the way, and what
would settle it. Entries graduate onto the open-questions page as soon as
someone can state that measurement, and an entry that can be stated as neither
is speculation and gets deleted.

The one worth reading first is the register's own foundation problem: two open
questions are now gated on evidence from real sessions, and the architecture
(IndexedDB, no account, nothing transmitted) has no path for that evidence to
arrive. The `Profile` export is already the portable, self-contained unit; what
is missing is a destination, not a format. Also on the page: the Boltzmann
target consumes utility as a black box, so a reference-sound distance
substitutes straight in and turns the search into a matcher; *declared* context
dissolves the circularity that blocks per-style audition phrases, because a
declared context is a statement rather than an inference from the stimulus it
would change; and recency denominated in log positions quietly changes meaning
if a lean-back mode ever changes the observation rate.

Six of the sixteen turned out to be one observation wearing six hats, and the
page names it: **Auracle is a better instrument than it is a consumer of its
own instruments.** `style_shares`, the provenance calibration split, the
quarantine reasons, the persistent render cache and the lineage events are all
labeled data the project pays to generate and then reads exactly once,
literally. The sharpest instance: `search/proposals.md` says a production →
brightness map is "a model nobody has fitted", and every `(term, spec) → φ` the
system has ever computed (which is precisely what the render cache stores)
is a row of that model's training set.

One of the sixteen is half a correction. `structural.rs` claims in the present
tense that a struct-only surrogate "prunes candidates before the expensive
render path", and two reference pages repeat it as part of the justification
for φ being two-part. Nothing in `auracle-session` prunes anything;
`SurrogateFitness::evaluate` renders every candidate it is handed. The entry
says so, and says which of the two fixes it wants.

### Added: what the audition cannot hear

A fifth design register, and the uncomfortable one. The other four are about
decisions; this is about the **premise** underneath them (that preference
measured under a fixed gesture is the same thing as musical taste), and the
eight places that premise costs something.

The argument is not new to the book. It is the one the v2 phrase was built on:
*the grammar could express patches the audition could never reveal … no amount
of model improvement fixes that; it is a measurement problem.* That reasoning
closed four holes and stopped. The page is the rest of it.

The sharpest three. **`NoteSpan` has no velocity field** (every audition note
is struck identically, while the live instrument responds to MIDI velocity), so
a patch is a function from performance to sound and φ samples it at one point,
which makes every model downstream a faithful model of preference over *point
samples of instruments*. **Modulation rate is nowhere in φ**: `mod_density` and
`mod_depth_mean` say how much and how deep, `centroid_std` says how much it
moved, and a 0.3 Hz sweep and a 7 Hz tremolo at equal depth are the same patch
to all of them, so the tilt can learn *more* modulation and can never learn
*slower*, on the instrument whose distinguishing claim is that modulation is a
whole chain. And **the raw level is already measured**: `VetReport` takes `peak`
and `rms` on the pre-normalization render and discards both, so an axis of
entirely ordinary preference (*hits hard*, *sits back*) is thrown away for
free by a normalization that only needed to protect *playback*.

Also on it: everything is judged in a silent room, with no notion of how a patch
sits against other material; there is no tempo, and the preset source is working
around it in comments (`rate: 0.55, // ≈83 bpm`); the loop is selection where
sound design is pursuit; comparability constrains the measurement and not the
listener, so duelling in the player's own hands costs φ nothing; and the rack
exposes every trace address with no macros over them, when a fitted style lens
is already a personal macro axis.

Cross-linked both ways with **Unraised directions**, which now records that two
of its entries have their strongest arguments on this page rather than on its
own, and from the standard-phrase page, which is where the argument started.

### Fixed: φ is ℝ⁴¹, and the books said ℝ⁴⁰

`n_silence` joined `StructFeatures::NAMES` as its own column when Silence
shipped, which made φ_struct twenty-six coordinates and φ forty-one. The
reference had not followed: the pipeline in the introduction, the notation
table, the decisions log, the φ_struct page and the guide's two plain-English
descriptions all still said forty. The site-count arithmetic was wrong with it:
at $d = 41$ the model has $41K + S + 5$ sites, so **46 + S** at K=1 and
**210 + S** at K=5, not 45 and 205, and a fixed 10 000-step budget is ~47
sweeps per site at the cap rather than ~48. Corrected everywhere, including the
two `205 + S` figures on the posterior page and the open question that quotes
them.

Two stale counts went with it. `StructFeatures` collapses **forty-two
productions into nineteen family counts** plus seven term-level numbers;
`structural.rs` and the page it is quoted on both said forty-one kinds into
fourteen, which has not been true for some time and does not sum to the
twenty-six names either of them lists.

This is the failure mode `CONTRIBUTING.md` names (*"if you changed a doc
comment that the reference quotes a number from, the number in the reference is
now wrong"*), and it is worth recording rather than fixing silently, because a
book whose first commitment is that every number is sourced is one where a
stale number costs more than it would anywhere else.

### Added: `steps`, a step sequencer that lives inside the timbre

Every rhythmic modulator the instrument had was a *gate*: the euclid opens and
closes, and the logic ops combine openings. Nothing could make a timbre walk a
pattern of **values** (a cutoff that goes dark, bright, middling, brightest on
a clock), which is the gesture behind most evolving textures. `steps` is that
modulator: up to eight steps of bipolar CV at 0.5–16 steps a second, with a
glide that is a fraction of each step (0 is hard steps, 1 slides the whole
way), free-running on its own clock like the euclid's. Tempo sync is left for
when the instrument has a transport to lock to.

**Each step value is its own genome site** (the Mutable Instruments *Marbles*
design): an evolution proposal that moves one step moves that step and nothing
else, and a lock on one bar holds that step while the rest of the pattern
evolves. **`length` hides steps rather than deleting them**: all eight stay in
the patch, so shortening a pattern and lengthening it again brings back what
was there.

It is Auracle's own module rather than quiver's `StepSequencer`, whose values
are internal state with no ports: every one of the eleven sites here is a live
knob, so dragging a bar is an atomic write into the running voices, not a patch
recompile per pointer move. A test pins that the live handle and a recompile of
the edited patch produce the same samples, bit for bit.

Measured on a saw through a lowpass at full mod depth, with two steps
alternating dark/bright at 2 steps a second: the bright steps render at
**~190×** the RMS of the dark ones, the level flips exactly once per step
boundary, and turning glide from 0 to 1 cuts the largest 10 ms level jump from
2.65 to 0.43. The same module is sample-rate independent (the glide is a
function of the step's phase, not of a sample count), NaN-safe at every port,
allocation-free per sample, and resets to bit-identical output.

In the rack it is three dials and a row of eight bars: press a bar and drag to
set a step, or use the keyboard like any other knob; bars past `length` gray
out, live, as the length dial turns. It is in the node bank under *sequence*,
*pattern*, *rhythm* and *steps*, and a new texture preset, **Loom**, walks a
ladder filter's cutoff through a slewed five-step pattern.

For the model and the search:

- **Prior weight 3%**, the euclid's: a leaf, so its mass buys variety rather
  than chain length. The table is renormalized rather than rescaled, so every
  older modulation kind keeps its exact proportion to every other.
- **Wire format:** it is `#mod` index **8**, after `Pair`. The order is
  append-only, so no saved patch or trace moves. That exposed an assumption in
  the prior: "is a leaf" was an index range (`kind < 6`), which at the depth
  bound would have switched the new leaf off along with the branches. It is now
  a predicate, and a test forces a max-depth term to bottom out in `steps`.
  Old traces and old JSON saves are pinned to decode to the same trees.
- **φ:** counted in the `n_rand` column, which is now the *stepped CV* family
  (S&H and step sequence: to the ear, a value that jumps on a clock). No new
  column: at 3% of slots it would be a near-indicator. The column keeps its
  stored name, since every observation on disk predates the step sequencer and
  its `n_rand` already is its stepped count; the panel now labels it
  "stepped mods". Cached feature rows from before this change still load.
- The catalog is now **forty-two modules** (sixteen modulators).

The September 2026 audit ([`AUDIT-2026-09.md`](./AUDIT-2026-09.md)) read the
whole stack against the pinned sources. The entries below are its auracle
findings being closed, in the audit's priority order.

### Fixed: a knob dragged to its stop made the patch un-evolvable

Every continuous site is a draw from `Uniform(0, 1)`, and fugue's `Uniform` is
half-open: `log_prob` is `−∞` at `x >= 1.0`. Auracle's own domain contract was
closed: `PARAM_DOMAIN = 0.0..=1.0`, `in_domain` accepted `1.0`, `set_param`
and `clamp_domains` clamped *to* `1.0`, and the panel's knob stops at `1`. So a
knob dragged to the end of its travel produced a legal term with zero prior
mass. `EvolutionChain::init_from` returns `None` for such a seed, `refine_one`
returned `None` in turn, and ⚡ evolve did nothing and said nothing. Two of the
61 shipped presets ("Sea Change" `mix`, "Ask The Dice" `mod_depth`) and the
default Vibrato insert shipped in that state; any tree repaired by
`clamp_domains` from a value above one landed there too.

The domain is now half-open where it is enforced: `PARAM_DOMAIN` is `0.0..1.0`,
the top of a knob is `PARAM_MAX = 1.0 − f64::EPSILON`, and one `clamp_param`
serves `set_param`, `clamp_domains`, the live handles' `clamp_input` and the
import routes, so "legal" cannot mean two things on two paths. `PARAM_MAX` is
one epsilon below rather than the next float down so a JSON round trip cannot
put it back on the boundary; no mapping in the compiler can hear the
difference. The three literal `1.0`s are `PARAM_MAX`. A saved session whose
knobs rest on `1.0` is mended on load by the same `clamp_domains` pass that
already runs on every import path.

**The gate that was missing:** `everything_a_hand_can_reach_has_finite_prior`
scores every preset, every `default_node`, every knob at either end of its
range, and every result of every structural op over a sweep of prior draws
under `PatchGrammarPrior::default().model()`, and requires a finite log-prior.
Nothing had scored what the panel produces; now something does.

### Fixed: the hand-edit ceilings were above the prior's support

`MAX_DEPTH` was 9 and `MAX_MOD_DEPTH` 4, against a prior whose `max_depth` is 5
and `max_mod_depth` 2. The prior forces `#leaf` at `max_depth` and zeroes
`Op`/`Pair` at `max_mod_depth`, so the deepest terms it can score have depth 6
and 3; a hand edit past that had `log p = −∞` and hit exactly the silent
`init_from → None` path above. The ceilings' comment said they were there to
protect the realtime voice rather than to shape the search, without noting that
the prior gave such trees zero mass.

Both ceilings are now **derived**: `MAX_DEPTH = PRIOR_MAX_DEPTH + 1` and
`MAX_MOD_DEPTH = PRIOR_MAX_MOD_DEPTH + 1`, read from `prior.rs`, so they cannot
drift again. This was chosen over raising the prior's bounds because the latter
changes every prior draw, widens the trees the wasm stack has to compile, and
would owe a revalidation for a bug that is entirely in the ceiling. The budget
readout is `n/24 modules · n/6 depth · n/3 mod depth`.

A session saved under the old ceilings may hold a deeper tree. It **still loads
and plays** (no load path re-checks the ceilings, because corruption must not
be load-bearing). Evolution now reports it as outside the prior's support (below)
instead of pretending to walk, and a structural edit that leaves it over the
ceiling is refused until one brings it under.
`ceilings_end_exactly_where_the_prior_support_does` pins the boundary from both
sides.

### Fixed: evolve says why it did nothing

`refine_seed`/`refine_from` returned `None` for four different reasons (no
taste yet, the walk did not move, it landed on a duplicate, the child was not
admitted) and, after the two findings above, for a fifth that is not like the
others: the seed has zero prior mass and the walk **never started**. The engine
now records a `RefineOutcome` after every refinement (`Engine::last_refine`),
and the wasm layer exposes it as `last_refine_reason()`; `outside_support` is
the one the UI should say out loud, because no budget or lock-loosening will
change it.

Two small things in the same code: `refine_from` no longer advances the
generation counter when nothing landed (a run of "no move" presses read as
empty generations in the lineage), and `absorb_bank_entry` no longer wraps the
id allocator on a hostile `u64::MAX` in a shared file.

### Fixed: `import_patch` skipped the ceilings, and the compiler had no guard of its own

Every write route into the pool ran `validate_tree` except the one that takes
untrusted input: `import_patch` repaired knob domains and then called
`commit_edit`, which always lands a hand edit. A shared file with a depth-40
tree entered the pool, evicted a member, and put its out-of-range φ into the
log on the next vote. `import_patch` now refuses what every other route refuses
(returns `0`).

Behind it, `compile` refuses a term nested deeper than `COMPILE_MAX_NESTING`
(32 levels, audio depth plus the deepest modulation chain) with an ordinary
`PatchError`. This is a stack guard, not a grammar ceiling: the compiler
recurses by value with frames large enough that ~60 nested nodes overflow the
wasm build's 8 MB stack, and a wasm trap is not an error the caller sees. It
poisons the engine for the rest of the session. Every caller of `compile`
already handles its error; none could handle the overflow.

### Added: the wasm boundary tells the app what it could not do

Three places where the engine's answer folded a failure into a no-op, now with
the distinction on the wire. Nothing existing changed shape; the web app is
expected to move to these.

- `import_session_checked(json)` and `import_session_deferred_v2(json)` return
  `{"status":"ok"|"empty"|"unparseable", …}` beside the old `usize` / `"[]"`.
  A save the current build cannot parse used to be indistinguishable from a
  save with nothing in it, and the app treated both as "nothing to restore",
  then autosaved a fresh session over the record it could not read.
  `unparseable` is the answer that must stop that write.
- `record_duel`/`record_keep`/`record_stars` return `bool`, `false` when an id
  is no longer in the pool (a duel side evicted inside the undo window). The
  vote was always dropped in that case; the app counted it and toasted "rated".
- `edit_param` refuses a non-finite value, as do `LivePoly::set_param`,
  `set_bend` and `set_makeup`: `f64::clamp` passes NaN, and a NaN knob rode the
  smoother into the atomic the voice reads every sample.
- `budget_ceilings()` reports `{"size","depth","mod"}` from the grammar, so the
  app stops restating numbers that just moved.

### Fixed: a save this build could not read was overwritten by a fresh one

The web app kept one IndexedDB record with no version on it and no backup, and
the engine's restore answered `0` both for "nothing in this save" and for "I
cannot parse this save". The app treated both as a first run: it booted from
the prior, the first vote scheduled an autosave, and ~2.5 s later the record it
had never understood (every patch and every pick in it) was gone under a
fresh session. An older build served from the browser cache opening a newer
save was enough to trigger it; so was one corrupt bank tree, because
`SessionState` deserialises all-or-nothing outside the observation rows.

The worker now restores through the verdicted forms
(`import_session_deferred_v2`, `import_session_checked`) and posts
`restore_failed` when the answer is `unparseable`. Main then, before anything
else can write, copies the record to `state-quarantine-<timestamp>`, pins a
`role="alert"` that says what happened and where the copy is, and turns
autosave off until the player chooses **start fresh**, or reloads under a
build that can read it, in which case the record is still exactly where it was.

Around that, the persistence layer gained the shape it should have had:

- The record is versioned, `{v: 2, session, ui}`; a v1 record reads as before.
- `state-prev` holds the record the page **booted from**, written once per
  session before the first overwrite. Every restore migrates and repairs the
  session (schema-1 rows converted, out-of-range cells clamped, unreadable
  votes dropped) and the first autosave used to make that the only copy, so a
  conversion later found wrong had nothing to be undone from. Once per session
  rather than rotated on every save, because a slot rotated every 2.5 s would
  hold the already-migrated record within one vote of booting.
- `idbPut` resolves on transaction completion and has `onerror`/`onabort`. A
  full quota (`QuotaExceededError`) used to fail in silence with the app still
  telling itself it had saved; it is an alert now, with a retry. One IndexedDB
  connection is kept for the life of the page instead of one per save.

### Fixed: an engine that crashed left an instrument that never found out

`main.js` set `worker.onmessage` and nothing else, and `worker.js` caught
errors around `init` and `render` only. Every other request that threw
(including a wasm trap, which under `panic = "abort"` unwinds out of a `&mut
self` call and leaves every later call failing with "recursive use of an
object") became an unhandled rejection inside the worker, which never reaches
`worker.onerror`. The flag that request was holding stayed set for the rest of
the session: the wordmark on "thinking" (`fitting` is cleared only by
`fitted`), the evolve button on "breeding 2/3…" (only by `refined`), every knob
edit queued behind one that would never return (`editInFlight`, only by `bench`
or `edit_rejected`). The README promised a pinned alert for a crashed engine;
it existed only for the worklet and for a failed boot.

The worker now runs every request through one `dispatch` under a `try/catch`
that answers `engine_error` with the request's type and id, and main releases
exactly what that request was holding: `fitting`, `editInFlight`, `dealing`,
`pendingEvolve`, `engineBusy`, the evolve buttons, a preview slot. A fatal
error (a `WebAssembly.RuntimeError`, or the borrow-flag message that follows
one) latches the worker as poisoned, so later requests are answered with the
same error instead of a cascade of misleading ones; on the main thread it,
`worker.onerror` and `messageerror` all reach one `engineCrashed`: everything
released, autosave stopped (the record on disk is the last good session), and
the `role="alert"` strip says to reload. Unhandled rejections in the worker are
reported the same way.

### Fixed: a vote on a patch that had just been evicted was counted as taken

Every vote waits out a 7 s undo window before it reaches the engine, and a
generation, a preset load or an import can evict one of its patches inside that
window. The engine dropped such a vote silently; the worker posted `status`
regardless; the app incremented its Brier tally, lit the star, toasted "rated
★" and saved. The engine's `record_*` calls now answer `false` for that case
(see the wasm entry above), the worker forwards it as `recorded` with the vote
it describes, and the app rolls back (the star returns to what it was, the
refit counter and the forecast score are left untouched) and says that the
patch is gone and the vote was not recorded.

The same round trip now carries **why** evolution did nothing. ⚡ evolve used
to say "<!-- voice: quote -->no accepted move — try again, or loosen some locks<!-- /voice -->" for five different
reasons, one of which (the seed has zero mass under the prior, a knob on its
stop or a tree deeper than the model scores) no amount of trying or
loosening can change. `last_refine_reason` rides back with `evolved_from` and
(per seed) with `refined`, and `outside_support` gets its own sentence: nudge
a knob off its stop, or take a module out.

### Fixed: the budget readout restated ceilings the grammar had moved

`main.js` carried `BUDGET = {size: 24, depth: 9, mod: 4}` as literals, so
when the two depth ceilings were derived from the prior's support (6 and 3,
above) the rack went on reading `n/9 depth · n/4 mod depth`, three and one
steps past where the engine actually refuses, with the "tight" warning firing
on trees the engine would no longer take. The worker now reads
`budget_ceilings()` from the grammar at boot and posts it with `ready`; the
literals remain only as the fallback for a binary too old to say, and match
the grammar as of this writing.

### Fixed: importing a profile replaced yours without asking or keeping a copy

Picking a file in TASTE sent `import` on the spot; `import_profile` replaces
the whole observation log and adopts the file's standardizer, and the autosave
2.5 s later made it permanent. Now, when there is anything to lose, the app
asks ("replace it" or "keep mine"), and on "replace it" the current profile
is downloaded first as `auracle-profile-before-import.json`, through the same
export path the ⤓ button uses. The worker is serial, so that file is the
profile as it stood before the import ran. Merging two logs would be the better
answer; the engine has no merge today, so the question is replace-or-keep
rather than replace-or-merge.

### Fixed: three small things the web app was leaking or forgetting

- **The last 2.5 s were lost with the tab.** Autosave is debounced, and the
  only unload handler committed a pending vote. Hiding or leaving the page now
  commits the vote *and* saves at once, in that order, so the save the worker
  writes contains it. Not before the boot veil has lifted: a session exported
  mid-restore is a bank with half its patches missing.
- **Every reload re-downloaded the engine.** The worker and wasm URLs were
  stamped with `Date.now()`, which is a cache-buster for the ~2 MB binary on
  every visit. `make wasm` now writes `pkg/build.json`, a content hash over the
  engine and the app scripts; the same bytes get the same URL and a new build
  gets a new one. Served from the repo with no build, the clock is the
  fallback.
- **Nothing was ever freed.** `renders` held one ~0.6 MB `AudioBuffer` per id
  ever auditioned, and the stars and cuts of patches long since evicted rode
  into every autosave. `applyViews` already computed what left the pool; it
  now drops those ids' buffers, failure notes, stars and cuts, and the timer
  of a cut whose undo window was still open, since there is nothing left to
  record against.

### Fixed: a pinned alert did not survive the first patch on the bench

The alert strip is one slot, and its rule (written over `alarm()`) is that
a handler clears only the condition it tagged. The `bench` reply handler did
not follow it: on every clean vet it called `alarm(null)`, which was there to
lift its own "<!-- voice: quote -->Muted — this setting can run away<!-- /voice -->" notice and which lifted
whatever else was in the strip. At boot the first patch lands on the bench a
moment after `restore_failed`, so the quarantine alert above was shown and
then wiped before anyone could have read it. Autosave stayed off, as it
should, but the page no longer said why, and **start fresh** was gone with the
text. Any later bench reply did the same to a crash alert or a refused save.
The handler now tags its notice `vet` and clears only that.

Found by the first browser test to provoke an unparseable save (below); the
Rust gates could not see it, because the whole fault is in which DOM node one
reply writes to.

### Changed: the quality bar and the gates that enforce it say the same thing

CONTRIBUTING promised `cargo test --workspace --release`; the Makefile and CI
ran `--profile test-fast`. CONTRIBUTING said `node --check apps/web/live-audio.js`
"catches [the backtick failure] and nothing else does"; nothing ran it. `make
check` skipped the wasm32 check CI ran, so green locally and green in CI were
two claims. Two of three workflows installed wasm-pack with an unpinned
`curl | sh`; the third used a pinned action. `release.yml`'s header still said
the Pages workflow fired on tags, a year after that was turned off. No browser
ever opened the app in CI.

- `make check` is now `fmt-check lint js-check wasm-check test`: `node --check`
  on all four app scripts and `cargo check` for `wasm32-unknown-unknown` join
  the gate, and CONTRIBUTING's list matches it, `test-fast` included.
- CI gained a `web` job (`node --check`, seconds, gated on the app or the site
  changing, not on Rust, because a JS-only PR is the one this check exists
  for) and, inside the `site` job where the wasm is already built, **browser
  tests**: `tests/web/smoke.spec.js` boots the instrument in Playwright's
  Chromium and requires no console errors, a registered worklet and an engine
  that reaches `playable`; `tests/web/failure_flows.spec.js` then provokes the
  four failure flows this pass fixed and had not watched: an unparseable save
  seeded into IndexedDB before the page runs (quarantined, `state` untouched
  past the debounce, **start fresh** writes a fresh v2 record and keeps the
  boot record as `state-prev`), an engine error (a real one from a malformed
  request, released and toasted; a fatal one, injected as the worker would
  post it after a trap, pinning the strip, freeing the evolve button and
  blocking `saved`), a vote the engine refused (a real refusal for an id not
  in the pool, rolled back; a star rollback from an injected reply) and the
  profile-import prompt (keep leaves the log; replace downloads
  `auracle-profile-before-import.json` first). Where a step is injected rather
  than provoked the test's name says so. The numeric audio assertions are
  still run by hand. Locally it is `make smoke` (`make smoke-tools` once).
- `pages.yml` and `release.yml` install wasm-pack through
  `taiki-e/install-action`, as `ci.yml` already did; `release.yml`'s header
  says what actually deploys the site.

### Changed: the live voice allocates nothing per quantum outside a swap, and says what a swap costs

CONTRIBUTING asks that `LivePoly` stay allocation-free per quantum, and three
paths were not: the arpeggiator cloned the held chord and built the pattern
into a fresh `Vec` at every step boundary; a knob write allocated a `String`
for its address on first touch, from the worklet's `onmessage` on the render
thread; and every smoother did a `HashMap<String>` lookup per voice per
quantum. The arp now reuses two buffers sized for a full keyboard, and the live
parameter handles are interned into one table at each (re)build: a knob write
is a scan of that table and an atomic store, a smoother tick is one store per
voice. The three `held.clone()`s around swaps and arp toggles are index loops.

Not changed, and now written down where it lives: **a patch swap compiles on
the render thread.** `set_patch` parses the tree in `onmessage` and the rebuild
runs a full `compile()` per voice per quantum with this node's gain at zero.
That silence is inaudible from *this* node; the duel auditions, master gain,
analyzers and recorder share the thread, and a compile that overruns the
quantum glitches them. Compiling in the engine worker and transferring a ready
voice is the fix, and it is out of scope for this pass; `live.rs`'s header and
`apps/web/README.md` say so, so the next click heard on a structural edit has
a known cause.

### Fixed: a φ coordinate declared unit-bounded was not, and the load-time repair rewrote it

`mod_depth_mean` is the mean nesting depth of the filled modulation slots: 1
for a bare modulator, 2 for one wrapped in a processor, 3 for two. It was
listed in `StructFeatures::UNIT_NAMES` (the coordinates the saved-log repair
clamps into `[0, 1]` on every load), so every stored vote on a patch with a
shaped modulator was rewritten to 1.0, "unshaped", the next time the session
opened, while freshly featurised pool rows kept their 2.0. The standardizer was
fit on a mixture of the two, for exactly the coordinate that exists to say
"this person likes modulation that has been shaped". A debug build panicked on
about 4 % of prior draws at the assertion that UNIT_NAMES hold.

It is out of `UNIT_NAMES`. Its definition is unchanged (it is a count-like
mean and is treated as one, like the module counts beside it), so no
`RENDER_EPOCH` bump is owed and no stored render is orphaned. What cannot be
undone is the evidence already rewritten: a vote clamped by an earlier load
says 1.0 where the patch had 2.0, and stays that way. Tested with an
`Op`-wrapped modulator on both sides of the seam: the featurizer reads 2.0 and
`repair_log` leaves it alone.

### Fixed: the RNG sampler could never draw a hole

`PatchGrammarPrior::sample_with_rng` mirrors the fugue program for callers
without a trace (`EvolutionaryGenome::generate`, several tests). Its source
match ended in `_ => Formant`, written before `Silence` joined the palette, so
index 6 (the hole) became a formant oscillator: over 20 000 draws the RNG
path produced 0 `silence` terms where the program produced 141. The two
samplers are documented as agreeing, and now
`the_two_samplers_agree_on_kind_frequencies` holds every module kind's
frequency to it.

### Fixed: the stars likelihood attenuated the wrong quantity

An imputed coordinate attenuates the comparison it enters (#55). For keep/kill
the code attenuated `u − τ`, correctly; for stars it attenuated `u` alone and
then compared it to the cutpoints, which applies no correction at all at
`u = 0` and moves the probability *away* from the marginalized truth elsewhere
(0.205 against 0.133 at `u = 1.5`, one cutpoint, by Monte Carlo). Both bounds
now use `σ(a·(c_k − u))`, and the imputation test gained a stars case that
checks the attenuated probabilities against the marginal computed by
quadrature. In the same expression the category probability is now computed in
log space, so a rating far from `u` scores its real log-probability rather than
the `ln(1e-12) = −27.6` floor two near-equal sigmoids used to cancel down to.
Only reachable for `Stars` rows with imputed coordinates, i.e. after a
stimulus-tag bump, which is when it matters.

### Fixed: the render seeded quiver's RNG after compiling the main voice

quiver's randomness is one thread-local stream and some of its module
constructors draw from it. `render_phrase` compiled the main voice, *then*
seeded. Deterministic today only because no module the grammar compiles draws
in its constructor; the seed now precedes `compile`, so the `(term, spec) →
bit-identical samples` contract is by construction rather than by luck.

### Fixed: the render cache's namespace did not know which DSP it was rendering with

`RENDER_EPOCH` names every function this workspace owns that can change a
stored φ (formula, vet gate, compiler mapping) and not the DSP library all of
them call into. A `quiver-dsp` bump can change a sample with no line here
changing, and the cache would have served the old φ as the new. The namespace
is now `e<epoch>:q<quiver version>:<spec hash>`; `QUIVER_DSP_VERSION` is
hand-maintained and a test reads `Cargo.lock` to fail the suite the moment it
is stale. Every stored row moves namespace once, on this build: the same cost
as an epoch bump, paid deliberately.

The `AUR_DCB_ALWAYS` environment override, which inserted a DC blocker into
every voice tail and so made a process with it set write different φ into the
same namespace, is removed from the render path. The blocker is decided by the
term alone (`makes_dc`), as it was for every process without the variable.

### Fixed: grafted subtrees are normalized like set modulation terms

`SetModTree` always folded its fragment through `ModNode::normalized`;
`ReplaceTree` and `InsertTree` grafted whole audio subtrees with their
modulation slots verbatim. An `Op` over nothing in one of them encodes
`#mod = 0` where the prior's weight is zero (`log p = −∞`, the un-evolvable
state again), and a one-parameter `Op` carrying a stray `p1` would not survive
its own trace round trip, which is the equality refinement uses to decide
whether it moved. `finish()` now normalizes every slot of every result,
keeping identities wherever nothing changed.

### Fixed: a follower on a source now has the knobs the rack advertises

`Follow` reads the owning module's input, and a source has none, so under an
oscillator it compiled to nothing: no attenuverter, no `mdepth` handle, no
`sens`/`rel` handles, while the faceplate showed all three. A drag on any of
them fell back to a full patch swap. The follower is now built with its input
unpatched (it reads 0 V and emits 0 V), so the term above it compiles like any
other and every knob gets its handle. The cable it drives carries `+0.0`, and
`a_follower_on_a_source_changes_no_sample` pins the render bit-identical to the
empty slot, which is why no `RENDER_EPOCH` bump accompanies this. The
live-handle gate now covers every `mdepth` and every modulation-module knob,
not just `table` and `oct`. The alternative (zeroing `Follow` in a source's
slot weights) was rejected because saved sessions containing one would have
become un-evolvable.

### Fixed: three small grammar edges

- The diff view's `src`/`op`/`mod` label tables had gone stale for exactly the
  newest productions (`silence`; `shift`, `comp`, `duck`, `gate`, `vocoder`;
  `euclid`, `op`, `pair`), for the second time. They are now read from one set
  of tables in `prior.rs` whose lengths are the arity constants, so a
  production cannot be added without a label.
- A v1 trace decoded a module's missing `mod_depth` as 0.3 while v1 JSON
  decoded it as 0.0; the same save was two different terms depending on route.
  Both say 0.0: the v1 behavior, and the value that matters is only that
  they agree.
- `from_trace` refuses a categorical index outside its arity instead of
  wrapping it (`oct = 9` used to become an octave; `fkind = 4` used to become
  `svf lp`). Unreachable from MH or a knob; a hand-made trace is told.

### Fixed: a refit no longer shuffles which lens is which

`TastePosterior::aligned()` resolved label switching *within* one posterior
(against its own last draw), and `fit_posterior` replaced the previous posterior
with no reference to it. MCMC has no reason to return the lenses in the same
order twice, so with probability about `1 − 1/K!` two consecutive fits ordered
them differently, and everything keyed by lens index (the names the player
gave their styles, the recorded style shares, the panel's lens colors)
silently attached to a different taste after every refit.

`aligned_to(reference)` aligns a fresh posterior to the previous fit's lens
means; `fit_posterior` uses it whenever a previous posterior of the same
dimension exists. A lens added because the log grew takes an index the old fit
did not claim, so no name has to move. Tested at both layers: the taste crate
pins that a label-switched draw set aligns to whichever reference order it is
given (and that a one-lens reference pins lens 0 and leaves lens 1 free), and
the session crate refits the same log from a different RNG state and finds the
dominant lens at the index it had.

### Fixed: the engine's history is bounded

Three things grew for the life of a session and rode along in every autosave.
The implicit-event stream stored two raw-φ vectors per edit, revert and play
flush, forever; it now keeps at most `EVENTS_CAP` (4096) rows and the raw φ on
only the newest `EVENT_PHI_KEEP` (256) rows that carry it: the stream exists to
be fitted on later, and its shape (kind, id, value, detail) outlives any one
row's vectors. The duel-exposure tallies (`shown_pairs`, `shown_candidates`)
kept rows for ids that had been evicted and could never be dealt again; they
are pruned at eviction and cleared at import. Forecasts and the lineage are
left as they are: one small `Copy` record per vote and one per accepted child,
growing at the rate of the observation log, which is the source of truth and
grows the same way.

### Fixed: every reload opened a new τ session

All three import paths call `begin_session`, and it opened a new session
unconditionally. The taste program has one τ (keep/kill threshold) site per
session, so `sites = d·K + n_sessions + 5` grew by one on every visit: a
once-per-visit voter accumulated a nuisance site per visit forever, each
stealing single-site MH budget from θ.

Two changes. `begin_session` opens a new session only when the latest one holds
at least `MIN_SESSION_OBS` (5) observations, and resumes it otherwise. And at
import, `merge_short_sessions` folds sessions that never reached the floor into
their predecessor: the walk runs from the newest session down and stops folding
once a group has earned a τ, so a legacy log of one-vote reload sessions
regroups into sessions of at least five rather than collapsing into one or
staying as dozens. A migration like the others: applied on load, and the log
written back is the merged one.

### Changed: the refinement gate prints its worst case instead of asserting it

`refinement_improves_pool` asserted that no seed's *best* pool member got worse
across a generation. That is not guaranteed by construction: `insert_candidate`
evicts the *model*-worst member, the model is a surrogate, and a misranking can
evict the true best while the search works exactly as designed. It held on the
sixteen fixed seeds, which is the class of flake the test's own header warns
about. The number is printed; the gates that remain (median gain, seeds
improved, anything injected) are the claims.

### Fixed: small robustness edges in the taste crate

- `reweighted_with(feedback, session, absent)` takes the same imputation mask a
  full fit does, so the between-fits update and the fit weigh an imputed row
  alike; `reweighted` passes none, which is exact for any row written under the
  current names.
- `FitSet::build` checks the standardizer's dimension against φ and names the
  mismatch, instead of indexing past a shorter standardizer three lines later.
  `dot` carries a debug assertion for the same disagreement.
- `Standardizer::fit` falls back to `(0, 1)` for a column whose moments
  overflow, instead of writing `inf`, which `serde_json` serializes as `null`
  and the profile then cannot load.
- The site counts quoted in `model.rs` said `d = 40` and "the documented 206";
  φ has been 41 coordinates for some time. They say 211 (216 with the
  brightness group), and the test that hard-coded 40 now reads the live
  feature set and will fail the day φ moves again.

### Changed: the reference says what the taste tilt actually does

`biased_prior` reweights the grammar's kind weights by the fitted structural θ
and installs the result as the **prior** of the `EvolutionModel`. fugue-evo's
target is `prior.model() + factor(β·f)`, and fugue's categorical proposal is a
resample from that same prior, so the Hastings terms cancel and the chain is a
correct MH sampler for `π' ∝ p_tilted(x)·exp(β·u(x))`, a different target from
`π_β`. The proposals page said the opposite ("tilting the proposal changes the
kernel, not the target … the stationary distribution is unchanged"). It, the
two-loops page, the notation table and the doc comments now say it is a prior
tilt, why a true proposal tilt is not available (fugue 0.2.2 offers only
`PriorResample` for `usize` sites), and why it does not matter much in practice
(refinement hill-climbs rather than samples). `SessionConfig::proposal_tilt`
keeps its name; the app and the harness both set it.

### Changed: three feature-extraction confounds are written down where they live

- `rms_mean`/`rms_std` are measured after the peak cap, so the ~15 % of patches
  the ceiling pulls down read as "quiet" for a reason that is peakiness, which
  `crest` already carries. Documented on the fields rather than moved: moving
  the measurement point is a `RENDER_EPOCH` bump for a confound the
  standardized model largely absorbs.
- `tail_ratio` measures the amp envelope's release first and mostly: the amp
  ADSR → VCA is the last stage after every effect, so a reverb tail is
  multiplied by the release rather than heard past it. The field doc no longer
  claims it captures effect tails.
- Frame silence is recognized only at (near-)exactly zero power, which works
  because quiver's `Adsr` snaps exactly to 0; a tail that outlasts a rest never
  gets a chain break. The relative threshold that would fix it moves φ for every
  patch with a tail and owes a measurement that has not been made. Documented
  at the line and in the open questions, not changed blind.

### Changed: quiver-dsp 0.3.3, and a declared MSRV

The workspace pinned `quiver-dsp 0.2.0` while the repo was at 0.3.3, and two
reference pages still said the `voct_to_hz` clamp was "open upstream"; it
shipped in 0.3.0. The pin is 0.3.3. Every module and port name the compiler
uses exists unchanged in both versions, and renders inside ±32 octaves are
bit-identical, so **no `RENDER_EPOCH` bump** accompanies this. Stored render
rows still move, once, because the cache namespace now carries the quiver
version as its own coordinate (above), and that is the right outcome rather
than a cost, because for pathological CV the two versions render *differently*
(0.2.0 recovered an infinite phase increment by reset; 0.3.x aliases at a
finite ~THz pitch), and an MH search can reach such values through chained
`Offset`s. Both are garbage the vet gate quarantines; they are not the same
garbage, and a cache that could not tell them apart would be wrong about
exactly those rows.

`rust-version = "1.87"` is declared in `[workspace.package]` and inherited by
every crate. fugue-ppl requires 1.87, so this states a floor that already
existed; CI runs on `stable` with clippy as errors, and a declared MSRV is what
makes a new stable lint a deliberate bump rather than a surprise.

### Changed: the acquisition question was measured, and the tie does not break

BALD ties uniform random pairing at session horizon, and the open question named
two regimes where that should stop being true: a much larger pool, or a much
longer session. Neither had been asked, and only one of them *could* be: pool
size was a flag, session length was a constant. `learn_synthetic` now takes
`--rounds` beside `--pool`.

Both regimes run, 20 CRN-paired seeds, `bald − random`:

| regime | cos θ* | rank r | excess nats |
|---|---|---|---|
| baseline (pool 48, 6 rounds) | +0.059 ± 0.046 *(static)* | +0.045 ± 0.068 | −0.013 ± 0.012 *(static)* |
| **pool 192** | −0.002 ± 0.044 | +0.015 ± 0.061 | −0.001 ± 0.012 |
| **24 rounds** (288 duels) | +0.031 ± 0.042 | +0.013 ± 0.013 | −0.003 ± 0.006 |

At the baseline BALD has two marginal wins in the static regime. **Widening the
pool fourfold removes them** rather than growing them, and lengthening the
session fourfold leaves everything inside noise with several signs flipped. The
reasoning (that a bigger pair space gives an information-seeking rule more
redundancy to prune) does not survive being tried.

What is stable across all three regimes is BALD beating dueling Thompson
(t = 2.9 to 6.9), which was already known. Uniform pairing stands as the default
on the grounds it always had: it ties everywhere anyone has looked, has no
tuning constants, and makes every duel an unbiased calibration sample.

### Changed: what actually blocks per-style audition phrases

The register implied the blocker was the migration mechanism. It is not: the
`:p2` stimulus tag already solves the history problem, and the imputation it
leans on is now honest rather than a silent measurement. Comparability is fine
too: the phrase is a property of the *session*, not of a candidate, so a pool
is auditioned under one stimulus and duels stay apples-to-apples.

What blocks it is circular. A style is *discovered*: an inference from φ. φ is
measured under a phrase. If the phrase is chosen by the style, the stimulus
depends on an inference that depends on the stimulus. That loop can be broken,
but every way of breaking it is a decision about how much the instrument may
change what it is measuring while it measures it. Deferred until that has an
answer worth defending, rather than until someone has time.

### Fixed: an imputed coordinate no longer arrives as a measurement

`FitSet::build` imputes an absent coordinate at the standardizer's mean, which
standardizes to exactly 0, the honest imputation for "this observation says
nothing about that axis". For a **duel** that is the end of it: both candidates
carry the same absence, the term cancels in `u_a − u_b`, and the observation is
correctly silent about that axis.

For **keep/kill** and **stars** there is no second candidate to cancel against.
`u(x)` is compared to a threshold, and a coordinate imputed at zero contributes
exactly zero to that sum, so the model read a patch that might be extreme on
the missing axis as though it were average on it, and then took the resulting
verdict at full confidence. The information was missing; the certainty was not.

The likelihood now marginalizes the missing contribution instead of assuming it
away: an imputed coordinate's `θ_i · x_i` has variance `θ_i²` under the
standardizer's own unit-normal prior, and the comparison is attenuated by
`1/√(1 + πσ²/8)`, the logistic analogue of integrating a probit link. The model
still learns from the observation; it stops claiming certainty about the part
that was guesswork. An imputed axis the listener does not care about is free,
because its `θ` is zero.

Low severity while duels dominate, and it spikes exactly when it matters most:
immediately after a stimulus-tag bump, when every audio coordinate of the old
log is imputed at once, which is when the migration machinery is supposed to be
protecting the profile.

**No revalidation is owed and the reason is worth stating.** `FitSet::as_is`
imputes nothing, and `FitSet::build` marks a coordinate absent only when a log's
recorded feature names do not cover it, which cannot happen for a log written
under the current names. Every synthetic measurement in the harness therefore
runs with an empty absent set, and the change is provably inert for them. It
activates on migrated real logs, which is what it is for.

### Added: the brightness cluster's fused prior, implemented and switched off

`rolloff_mean`, `zcr_mean` and `centroid_mean` are three genuine measurements of
one perceptual thing, and `rolloff_mean` is the worst-conditioned coordinate in
φ. The open question asked for a shared or fused prior over the cluster rather
than dropping a column. It is now built (a latent mean per style, members drawn
about it), and it ships at `ρ = 0`, which is off.

**Two gates were run and they disagreed. That is the finding.**

Against the always-on closed-loop gate, which scores θ *recovery*, fusing helps:

| ρ | mean posterior/truth r |
|---|---|
| 0.00 | 0.657 (the flat prior, reproduced exactly) |
| **0.25** | **0.702** |
| 0.50 | 0.644 |
| 0.75 | fails the per-seed floor |

Against the **climb** at ρ = 0.25 (48 paired seeds, the gate that asks what the
pool is actually worth to the listener), it hurts, and not marginally:

| statistic | value |
|---|---|
| 10% trimmed | **−0.579 ± 0.188 (−3.09 se)** |
| median | −0.726 |
| sign test | 16 better / 32 worse, **p = 0.029** |
| climbed | 41/48 → 38/48 |

Both are true because they measure different things. Pooling an ill-conditioned
ridge is a real regularizer for *estimating* θ. It is a *bias* for the search
that consumes θ: the synthetic listener puts 2.0 on `centroid_mean` and exactly
0 on the other two, so shrinking them together drags the one coefficient that
matters toward two that do not, and the search aims worse.

**The general warning is worth more than the feature.** A VIF says the three
coordinates move together *across patches*: a fact about φ. Fusing their
coefficients asserts that a listener's *preferences* about them move together:
a fact about people, which does not follow from the first and had not been
measured. The issue's framing invited that conflation, and the climb caught it.

Kept re-checkable rather than deleted, as `RefineKeep::Best` and
`Acquisition::Thompson` are. At `ρ = 0` it emits no latent sites at all, so the
program is the flat one node for node and the fit stays at 206 sites.

Also: the premise had already moved. The VIFs motivating this were 18.4/10.4/5.9;
after the ZCR DC removal they measure **16.9/9.7/5.9** and `zcr_mean` is no
longer flagged at all. A third of the original argument was a coordinate bug.

### Added: `Silence`, so an empty socket is empty in the term too

An "empty" socket made sound. The rack drew a dashed EMPTY plate and the
substitute node underneath it was a `Vco`, so the plate was honest and the patch
was not: the model was taught on a tree containing a source the player believed
was silent, and every φ coordinate measured a render with it in.

**Its prior weight is small but not zero, and that is the whole design.** At zero
the grammar gives `p = 0` to any tree containing a hole, `log p` is −∞, and MH
rejects every proposal that touches one, so unplugging a socket would quietly
make a patch un-evolvable. At 0.5% a `Silence`-only tree renders silent, the vet
gate quarantines it, and evolution learns to avoid holes rather than being
forbidden from representing one. Both halves are tests.

It is appended at source index 6 rather than inserted, because a source kind's
*index* is the persisted wire format; the round-trip test asserts the literal 6,
since a test that asked the encoder what it wrote would agree with any
renumbering. It compiles to a `Vca` with an unpatched audio input: `Offset`'s
ports are `CvBipolar`, and feeding one to an audio consumer would raise a
signal-kind warning on every patch holding a hole.

**`n_silence` joins the source/binary identity as its own φ column, and the VIF
sweep confirms it.** The worry was that a 0.5% column is a near-indicator
variable, the objection that kept `n_ringmod` out. Measured over 1200 draws it
comes back at **VIF 1.1**, the best-conditioned coordinate in φ, with no exact
dependency introduced and the worst VIF in the whole vector *falling* 16.9 →
16.1. A hole's prevalence is set by the player's edits rather than by the prior,
which is what makes it unlike the other rare kinds.

For the same reason it is deliberately **not tilted by taste** in `biased_prior`:
the tilt moves proposals toward source kinds a listener is enjoying, and a hole
is not a timbre anyone can enjoy.

Paired 48-seed climb against `main`: mean **+0.041 ± 0.377**, median −0.108, 10%
trimmed **−0.083 ± 0.207**, sign test 22 better / 26 worse (p = 0.665). No
detectable effect on search health, which is what an expressiveness change that
the synthetic listener has no opinion about should show. Seeds that climbed went
41/48 → 45/48 and the worst seed went −10.30 → −2.48, but McNemar puts that at
p = 0.344: suggestive, not established.

### Changed: the RefineKeep A/B was run, and it tied

A refinement walk renders ~40 candidates and injects one. Which one was never
measured: the shipped rule is "the state the walk ended on", and
`RefineKeep::Best` (the highest-`log π_β` state the walk occupied, seed
included) has been implemented, free and switched off, waiting for the
instrument that would settle it.

Sixteen paired seeds, same list both arms:

| | `Last` | `Best` |
|---|---|---|
| mean gain | +1.927 ± 0.452 | +1.774 ± 0.302 |
| median gain | +2.058 | +1.819 |
| 10% trimmed | +1.840 ± 0.383 | **+1.925 ± 0.190** |
| climbed on | 14/16 | 15/16 |

Paired difference: mean **−0.153 ± 0.384**, median −0.185, trimmed
−0.113 ± 0.318, sign test **8 better / 8 worse (p = 1.000)**. As exact a tie as
sixteen seeds can produce. Nothing clears zero at 2 se, so **the default stays
`Last`** and the result is written into the `RefineKeep` doc comment: a rule
rejected on evidence stays re-checkable, the way `Acquisition::Thompson` is kept
after losing.

Neither the feared failure nor the hoped-for win appeared. The worry was that
argmax over a surrogate would find the surrogate's errors and deepen the
catastrophic tail; across the pair the tails are a wash. What did show is that
**`Best` is the lower-variance rule rather than the better one**: half the
trimmed standard error. Injecting the walk's argmax is more *consistent* than
injecting where it stopped; it simply does not aim anywhere better on average.
That is the argument to re-run this on if the surrogate ever gets sharper.

### Fixed: two φ coordinates that were measuring the wrong thing

**ZCR counted crossings of zero, not of the signal's own center.** A constant
offset suppresses them, so a patch riding +0.3 with a ±0.2 oscillation crosses
zero *never* and read as maximally dark: the floor of the axis, for a tone that
is plainly not dark. The vet gate admits `|mean|/rms` up to 0.6, so that is a
reachable render rather than a hypothetical, and `zcr_mean` feeds a linear model
as if it were a brightness measurement. Subtracting the mean is the whole fix;
for a render with no offset the count is unchanged.

**Spectral flux stepped across a silent gap** as though the frames either side
were adjacent, because `prev_mag` only tracked frames that passed the power
floor. Flux is the change between *adjacent* frames, so carrying it across a
rest reports a difference that did not happen in one hop. The standard phrase
has four rests, so every re-entry scored a spurious burst of movement: the
opposite of what a rest is.

Both are pinned by fixtures that fail without them: an offset tone that must
read as bright as the centered tone it is a copy of, and a burst-rest-burst
phrase whose flux must not notice that the second burst is ten times quieter.

**What the revalidation said, and what it said about itself.** Renders are
untouched (`norm-peak` is identical), and collinearity *improved*: over 1200
draws `rolloff_mean` fell 17.7 → 16.9 and `zcr_mean` 10.3 → **9.7**, dropping
off the collinear list it had been on. That matters beyond this change: the
open question about the brightness cluster is a VIF argument, and one of its
three numbers just moved for a reason unrelated to modeling.

The climb is where this got interesting. At 16 seeds the paired difference read
−0.530 ± 0.391; at 48 seeds it read **+0.749 ± 0.857**: the opposite sign, both
inside the noise. Neither is a fact about the search. Three seeds of 48 carry
**95% of the variance**: pool utility collapses catastrophically on a small
fraction of seeds, worth tens of utility against a typical gain of two, so the
mean is not a statistic about search health but about whether a seed list
happened to contain a collapse.

Read robustly, the answer is clean and tight:

| | 16 seeds | 48 seeds |
|---|---|---|
| paired mean | −0.530 ± 0.391 | +0.749 ± 0.857 |
| median | | **−0.095** |
| 10% trimmed mean | | **−0.099 ± 0.191** |
| sign test | | 20 better / 28 worse, p = 0.31 |

A correctness fix to two coordinates the synthetic user has **zero weight on**
should not move the search, and measured properly it does not: −0.10 ± 0.19,
four times tighter than the raw mean and indistinguishable from zero.

`make climb` now prints the median and the 10% trimmed mean beside the mean, so
the next φ change is read on a statistic that can resolve it. The mean stays:
the collapses are real, and hiding them would be worse than reporting a number
that a collapse can swing.

### Changed: the rack's flow animation measures the level it draws

The cables' motion was scaled by an estimate: *reach*, meaning how much of what
is on this cable arrives at the amp, computed from the patch with every source
assumed to be at unity. Two comments explained why it could not be a
measurement ("<!-- voice: quote -->the analyser hangs off the master and there is no per-node port
to attach to<!-- /voice -->"), and both were out of date. quiver's `StateObserver` takes
`Level`, `Scope` and `Spectrum` subscriptions on any node port, and has for
some time; it is in the `quiver-dsp` release the lockfile already pins.

The reach half was right and stays. It is what makes a whole limb go still
together when a mixer branch is crossfaded away, instead of leaving four cables
running at full speed into a stopped one. What it could not see was the other
half (a filter choking its input, an envelope closed, an oscillator that is
simply quiet) because it had no way to ask. Now it asks: the compiler records
where each term node's audio leaves it (`CompiledVoice::taps`), `LivePoly`
holds a `Level` subscription on each, and while notes sound the measured RMS is
multiplied into the reach factor.

Two questions the register said were open have answers:

- **Which voice to meter.** The most recently pressed sounding one, re-chosen
  every quantum. A sum across the bank averages different notes at different
  envelope phases, which is not the level on any wire.
- **Whether `sync_output_keepalive` is needed.** It is not. That call pins
  ports nothing consumes, and it dirties the patch: a recompile that would
  have had to be staged around the audio thread the way patch swaps are. The
  genome is a typed tree, so every module's output already feeds exactly one
  parent and quiver is already computing every value metered here.

Metering is off until a surface asks and allocation-free while off, which is
the state every player is in. The port trace stays an offline render, now by
choice rather than by constraint: a `Scope` subscription reads whatever is
being held, which while someone is reading a teaching surface is usually
nothing, and "what does a wavefolder do to a saw" wants the same phrase every
time so that two looks at it are comparable.

### Changed: CI stops making every PR pay for the parts it cannot affect

A PR took ~11m30s, and 11m12s of that was the one `Test` job. Measured rather
than guessed, and then measured again in CI afterwards:

| | before | after |
|---|---|---|
| test compile, warm cache | 2m21s | **1m12s** |
| a Rust PR, end to end | 11m30s | **~8m** |
| a site or brand PR | 11m30s | **~2m** (only `Site` runs) |
| a README or changelog PR | 11m30s | **16s** (nothing to build) |
| three pushes to one PR | three full runs | the first two canceled |

The honest headline is the docs PR and the cancellation, not the Rust PR. After
the compile is halved and the suite is unblocked, **~365s of the remaining ~8m is
one test**, `refinement_improves_pool`, and that floor is not movable from here
(see the note at the end).

**A test profile that is not the release profile.** `[profile.release]` sets
`lto = "fat"` and `codegen-units = 1` to shave the render loop of the artifact
users wait on. Applied to five test binaries it instead funnels every link
through one core. Timing the three heaviest tests under both profiles, runtime
differed by under a tenth of a second: the LTO was buying the suite *nothing*
and costing it a serialized link. `[profile.test-fast]` keeps release's
`opt-level` (the DSP genuinely needs it; debug is ~20× slower) and drops the
shipping flags. `make test` uses it too, so the contributor loop gets it as well.

**The slowest test gets a runner to itself.** `refinement_improves_pool` walks 16
seeds on one thread each; on a 4-core runner those queue four deep. It is ~550s
of CPU against ~270s for the other 170 tests *combined*, so in one job it did not
merely take its own time: every other test waited behind it for the cores. Two
nextest shards on exact complementary filters now split it off, so the job takes
as long as the floor takes rather than the floor plus the suite. The filters
being complements is what keeps it honest: no test can land in both shards or in
neither, and `--no-tests=fail` makes a rename that empties a shard go red instead
of silently dropping a gate.

**Jobs gated on what the change reaches.** Most PRs here are documentation, brand
and site copy (the same observation `search-health.yml` already makes about
where a PR budget goes). The Rust jobs now require Rust to have changed, and the
Makefile and workflows count as touching everything. Narrowing applies to
`pull_request` only: `main` is what the site deploys from and what releases are
cut from, so it is never partially verified.

Also: `concurrency` with `cancel-in-progress`, so a new push stops the run its
own commit obsoleted instead of paying for two answers; `fmt` folded into `lint`,
having spent more on scheduling than on work; `rust-cache` saves restricted to
`main`, so PR branches stop evicting the warm cache every other job restores
from; `wasm-pack` from the tool cache rather than curl-piping an installer; and
job timeouts, because the 6-hour default is a lot of rope for a hung run.

One new check, `CI`, reports the aggregate. It is the one to require in a branch
ruleset: the jobs above are conditional, and requiring a job that legitimately
skips would wedge every documentation PR.

**What is left, and why it stays.** `refinement_improves_pool` is now ~81% of a
Rust PR's wall clock: 365s of the ~8m. Its 16 seeds are independent and it is the
obvious thing to split across runners, and it must not be. The gate is the
**median** of the 16 per-seed gains, chosen over the mean because two seeds in
that spread are catastrophic outliers; the test's own doc comment records that a
four-seed gate "would have been a coin flip that failed for reasons having
nothing to do with the change under review." A median cannot be assembled from
independent shards, and a per-shard gate is exactly the coin flip that reasoning
rejected. The seeds stay together.

That leaves core count as the only remaining lever, and it is a billing decision
rather than a code one. The test's doc comment records ~70s wall for the 16 seeds:
that is a 16-core machine, where they run one-per-core; a 4-core runner queues
them four deep and takes 365s. A larger runner would put a Rust PR near ~2m30s at
roughly neutral cost, since four times the rate over a quarter of the minutes is
a wash. It is not enabled here: larger runners are billed even for public repos,
so it is the repo owner's call rather than a default.

### Added: a cross-island measurement, which closed an open question by refuting it

The reference listed as an open question: *"local refinement from island A will
not find island B. A tempering schedule would cross the valley; today the user
reaches the second island by hand or by the prior."* It had never been measured,
which is why it was written down: the taste model is a max of K linear experts
precisely so one user can hold several islands, and the search is a local walk,
so the tension looked real.

`make islands` teaches a genuinely bimodal synthetic user (two islands opposed
on every coordinate they share), runs real generations, and asks how often a
child lands on the island its parent was not on:

| | |
|---|---|
| refinement events that cross islands | **99 / 473 (20.9%)** |
| of those, *decisive* (both ends > 1.0 onto their island) | 64 (**13.5%** of all events) |
| seeds whose pool ended on one island only | **0 / 8** |

The decisive column is the one that carries the claim. A patch on the decision
boundary flips island under an arbitrarily small change, and counting that as
crossing a valley measures nothing; filtering it out leaves the answer standing.
Pool share is reported beside it as a control, since both islands being occupied
would say only that the prior scattered candidates over both.

**The reasoning was wrong about the geometry.** It treated refinement as a local
walk in *feature* space. It is a reversible-jump walk over a **tree grammar**,
where one accepted structural move swaps a subtree: a large jump in φ. The
search never has to travel through the space between the islands, so there is no
valley for a tempering schedule to cross. Tempered SMC may still earn its place
on the distributional claim; it no longer earns it on this one.

Also adds **`--keep-best`**, which re-runs the whole harness under
`RefineKeep::Best` so the two arms can be paired seed-for-seed. That A/B is
tracked in #42 rather than run here.

### Fixed: the small batch from the gap sweep

Four items that cost nothing to verify, kept apart from two that do.

- **`FftPlanner` was rebuilt on every render.** Planning is where rustfft
  computes the twiddle factors for the frame size, and a fresh planner per call
  redid it for every candidate the search featurizes: thousands per generation,
  for a table that depends only on a compile-time constant. Now `thread_local!`.
  Bit-identical by construction, and **verified**: the feature table over 40
  prior draws is byte-identical to `main`.
- **`TastePosterior::aligned` used an unweighted reference mean** in its second
  pass, while every other summary on the type respects the importance weights.
  Draws stop being equally probable the moment `reweighted` folds a vote in, so
  the label alignment was leaning on draws the evidence had already discounted,
  hardest exactly when the weights have concentrated, which is when the
  per-style summaries are most worth reading.
- **The locked-refinement step compensation had a silent ceiling.** It is
  `LOCK_SCALE_CAP` now, and the fact that a very heavily locked walk explores
  less than the config nominally buys is written down rather than left to be
  discovered. It is a cost bound, not a correction: `⚡ evolve from this` is a
  button press with a person waiting behind it.
- **A module doc claimed φ_audio was 12 dimensions.** It is 15. It now names
  `AudioFeatures::NAMES` rather than repeating a count, so it cannot go stale
  again.

**Two related items are deliberately not here.** ZCR has no DC removal (the vet
gate admits `|mean|/rms` up to 0.6, so a DC-offset patch reads as very dark) and
spectral flux steps across a silent gap as though the frames were adjacent. Both
are a few lines, and both move φ, so they owe a paired revalidation and will
ride the next wave that is already paying for one, alongside `Silence`.

### Fixed: the taste map could mirror itself between recomputes

A PCA axis is defined only up to sign, and nothing fixed it. Power iteration
returns whichever orientation has a positive inner product with its start
vector, so the orientation was a fact about the *solver* rather than about the
data, and the start is the highest-variance coordinate, which moves as the pool
does. The map is sold as *where you have traveled*; territory that mirrors
left-for-right between one refit and the next is a different claim about the
same place, and it flipped rarely enough to read as bad data rather than as a
property of the projection.

Axes now carry the standard `svd_flip` convention: largest-magnitude component
positive. The regression test builds data where the unfixed solver returns the
second axis at `-0.90` and asserts the sign is pinned.

**The second axis is where this bites**, which is worth recording because the
first one hides it: axis 1 starts from the highest-variance coordinate, which is
usually also where the leading eigenvector puts its mass, so its natural
orientation satisfies the convention by accident. The deflated axis starts from
that same vector with axis 1 projected *out*, and what remains has no such
relationship to the second eigenvector.

Separately, the iteration **stops when it has converged and reports when it has
not**, rather than running exactly 60 passes and returning whatever it held.
Power iteration converges as `(λ₂/λ₁)^k`, and near-ties in the top eigenvalues
are a designed-in property of this feature set (the brightness cluster is three
genuine measurements of one perceptual thing), so a fixed count was an assertion
about a ratio nobody had measured. `TasteMap::converged` carries the answer.

### Fixed: the audition clipped, and preference data was collected on it

Matching integrated loudness says nothing about the peak, and crest factor spans
tens of dB across this grammar. `normalize_to` capped *boost* and nothing else,
so normalizing a percussive patch to −18 LUFS sent it well over full scale.
Measured over 150 vetted prior draws (`make norm-peak`): **15% of renders peaked
above 1.0 and 8% above 1.25** (which is where the app's `master.gain = 0.8`
clips), with a worst case of **4.06**, 12 dB over. After: **nothing over the
ceiling**, p50 unmoved at 0.623, and the 22 patches that gave up gain are
exactly the 22 that had been over full scale (mean 3.0 dB, worst 12.2 dB). The
unmoved median is the check that this is a fault stop and not a re-levelling of
the whole pool.

The live voice was never exposed to this; `live.rs`'s master limiter has always
held a 0.98 ceiling. The offline path took the volt divisor and not the limiter,
and it is the offline path the duels are dealt from, so a clipped audition
collected a vote about *clipping* rather than about the patch, which is exactly
the confound loudness normalization exists to remove, one stage later and
silent.

The fix is **a smaller gain, not a limiter**. `normalize_to` now gives up
whatever makeup it must for the peak to clear `PEAK_CEILING`, and reports how
much as `Features::peak_reduction_db` so a surface can say a patch was pulled
down 3 dB rather than presenting it as merely quiet. A scalar keeps
`render_playback` bit-identical *by construction* (the property its
bit-identity test exists to protect) and cannot change timbre at all, where a
limiter would reshape the waveform and need a second copy of itself in the
replay path forever. What it costs is stated rather than hidden: the ~15% that
hit the ceiling audition below target, so loudness matching degrades exactly
where crest is highest. Quieter is a smaller bias on a preference judgment than
clipped.

**This moves φ, so it carries the revalidation.** `rms_mean` and `rms_std` are
the only audio coordinates that are not scale-invariant; everything else is a
ratio or a spectral shape and cannot see a gain change. Paired 16-seed
`make climb`, same seeds both sides:

| | mean gain | climbed | gen-6 Δ | max u |
|---|---|---|---|---|
| before | +1.877 ± 0.362 | 15/16 | **−0.073** | 6.730 |
| after | +2.457 ± 0.298 | **16/16** | +0.113 | 8.093 |

Paired difference **+0.579 ± 0.350 (1 se), t = 1.65, 95% CI [−0.121, +1.280]**,
improving on 11 of 16 seeds. **That crosses zero: the headline gain is not
significant** and is not claimed as one. What the run does establish is the
thing the standing rule exists to check (the change does not cost the search
anything), and three secondary readings point the same way: every seed now
climbs (the one that previously went backwards, `1209` at −1.036, now returns
+0.908), the frontier is higher, and the generation curve **stopped turning
over** (mean utility used to peak at generation 5 and *fall* at 6; it is still
rising at 6).

The grading function itself did not move, which is what makes this comparison
unusually clean: the synthetic user weights only scale-invariant coordinates,
so generation 0 is bit-identical across the two runs (mean −0.000, max 5.454).
Whatever moved, moved through the *model*. And the plausible mechanism, stated
as a hypothesis rather than a finding, is that `rms_mean` was near-degenerate
at a fixed loudness target (every patch normalized to the same level), so
standardizing divided by a tiny σ and handed the model an amplified-noise
coordinate. Peak-capping gives it real spread. That is the dead-coordinate
failure from the `1e30` sentinel, in the opposite direction, and it is
checkable with `make phi-stats` on both sides.

### Added: the search-health harness is a command, not a memory

`make check` gates correctness and says nothing about whether the search still
searches. That has always been a standing rule enforced by discipline; it is now
`make revalidate` (φ statistics, normalized peaks, pool climb, the full
battery), plus `make climb`, `search-check`, `budget-ab`, `phi-stats`,
`norm-peak`, `fit-bench` and `closed-loop` individually. A `Search health`
workflow runs the same targets nightly and on `workflow_dispatch`, writing every
table to the job summary and uploading the logs so two runs can be diffed
directly. Deliberately **not** on `pull_request`: it is tens of minutes of real
audio rendering, and most PRs here are documentation.

### Fixed: the refinement gate did not gate refinement

`refinement_improves_pool` made three assertions and none could fail for the
right reason. `best_after >= best_before` is true **by construction**: eviction
only removes the pool's worst member, so the top of the ranking cannot fall. It
graded children with `ranked()`, the *surrogate refinement is optimizing*, so a
search that had learned to fool its own fitness would have scored perfectly. And
`n_refined` was printed, never asserted, so a build that injected nothing passed
silently.

It now grades on the synthetic user's **true** utility, before and after real
generations, a small always-on version of `search_health --climb`, over
sixteen concurrent seeds (~70 s).

**The gate statistic is the median, and that was measured rather than assumed.**
The mean was the obvious choice and the data rejected it: the per-seed gains are
thirteen clear improvements plus two catastrophic seeds (−12.04, −5.55), which
drag the mean to +0.215 while the median sits at +1.481. Over *any four* of
those seeds the mean ranges −4.51 to +2.49 and is **negative 40% of the time**,
so the four-seed mean gate this test was first written with would have been a
coin flip failing for reasons unrelated to the change under review. Gates:
median > 0.5, at least 10 of 16 seeds improving, and no seed's best member
degrading.

The two bad seeds are worth naming rather than smoothing away: they are the
surrogate optimized against itself. `insert_candidate` admits and evicts by the
*model*, so a posterior fitted on 40 duels at the suite's trimmed MCMC budget
can swap out nine candidates the synthetic user liked for nine it does not. That
is not a defect in the machinery, and it is why `RefineKeep::Best` ships
switched off, since taking the argmax of that same surrogate is the move most
likely to make it worse.

Widening the horizon to three generations also exposed a **false assertion the
old test had been carrying**: it required every lineage child to still be
findable in the pool, which only holds while nothing has had a chance to be
evicted. Across generations a child injected in generation 1 is an ordinary
eviction candidate in generation 2, so that assertion fails on a *correct*
engine. The invariant that survives is the other direction: the permanent
lineage explains every refined member the fixed-size pool still holds, and that
is what is asserted now.

### Fixed: an identity test conflated "the property held" with "it was tested"

`refinement_carries_node_identity` asserted `carried > 0` (that every accepted
refinement shares at least one module with its seed) under the message *"a
refinement step that changed everything is not a refinement"*. That is a claim
about the **search**, not about identity, and it is not a true one: forty MH
steps over a small term can replace the root's kind, after which no key/kind
pair matches and there is nothing to carry. No uid is lost in that case, because
none is comparable.

The φ shift above moved one seed's trajectory into exactly that case and the
test went red with nothing wrong. A round that preserves no structure now
**skips** rather than fails, the strict identity assertion on matched modules is
untouched, and the final check still requires that at least one round actually
exercised the property. Same class of error as the lineage assertion above,
found the same way: by widening what the tests look at.

### Added: refinement can keep the walk's best state instead of its last

A refinement walk renders ~40 candidates and injects **one**, and which one was
never measured. `SessionConfig::refine_keep` makes it selectable:
`RefineKeep::Last` (the shipped behavior, still the default) or
`RefineKeep::Best`, the highest-`log π_β` state the walk occupied (seed
included), so a walk that found nothing better than where it started now injects
nothing rather than whatever it was standing on at step 40.

The archive is **free**: every trace the kernel returns already carries its own
`log π_β`, so this is one `f64` compare per step and no extra render. Scored on
the target rather than on fitness alone: taking the argmax of `E[u]` would
discard the parsimony half of the distribution the walk is sampling, and would
do it with a bias toward the largest tree the walk touched. The default does not
move until the A/B says it should.

### Added: a persistent render cache

φ is a pure function of `(term, spec)`, and nothing was exploiting that across
reloads: every boot re-rendered the whole bank from nothing. The farm workers
now consult an IndexedDB store first and write back on a miss, so a returning
player pays for renders once.

`RENDER_EPOCH` is the coordinate the content key could not supply: the key
hashes the *inputs*, and a change to the normalizer or a descriptor's formula is
a change to the *function*. `cache_namespace` combines the two, and a namespace
mismatch orphans every row at once, which is the only correct granularity: a
cache whose invalidation is anything less than total will one day serve a number
from a featurizer that no longer exists. (This release bumps it to 1, because
the peak-capped normalization above moves `gain_db`.) The engine also re-derives
each row's key from the tree it holds before folding it in, so a hit is checked
rather than trusted.

Cached rows carry φ without samples, so jobs that asked for audio still render.
Otherwise the saving would land on the first patches the player actually
auditions, which is where `wantAudio` exists to avoid it.

### Changed: the taste fit no longer holds the whole chain in memory

`adaptive_mcmc_chain` materialized every step and `step_by(stride)` kept every
20th one line later: ~10 000 `Trace` clones of 206 `BTreeMap` entries live at
once to retain 500. Measured at the shipped budget, **303.1 MB peak RSS**,
scaling with `mcmc_samples`: a plausible mobile-Safari OOM rather than mere
waste.

It could not be fixed here (the retention is inside fugue's chain driver, whose
internals are private), so it was fixed upstream and adopted:
`adaptive_mcmc_chain_thinned` takes the stride and pushes only every `thin`-th
draw. **18.2 MB peak RSS for bit-identical draws** (16.7×), with `fit_bench`'s
per-fit checksum unchanged at `07d204764b58c88b`. `thin` gates the push and
nothing else, so every transition still runs and the RNG is consumed identically.
The peak no longer scales with the budget at all, which frees `mcmc_samples` to
be chosen on the recovery tables rather than against a memory ceiling.

Workspace dependency moves to fugue-ppl 0.2.2, which is where that API landed
(alexnodeland/fugue#47).

### Fixed: the site-count formula had not moved with φ

`27·K + n_sessions + 5` (33 at K=1, 141 at K=5) appeared in three places. φ is
40 coordinates now, not 27, so it is `d·K + n_sessions + 5`: **46 and 206**,
which `fit_bench` prints. The figure it feeds moved with it: 10 000 steps at
K = 5 is ~49 sweeps per site, not ~71.

### Changed: the brand page states the system, not how it was arrived at

A specification that narrates its own drafting dates the moment the drafting is
over. The page said the logotype was "already correct" and the lockup "the open
question", introduced the icon set as "the marks that lost the vote", and
recorded which candidate each icon had been before it was an icon. None of that
tells anyone what to draw. Those passages are rules now (*the wordmark's final
E must not be a second lamp*, *every icon is a shape and never a letterform*,
*an icon with no chapter behind it does not belong in the set*), and the
progress notes ("not yet wired into anything", "today that is only…") are gone
with them.

The **stacked lockup's descriptor is centered**, on every line. It was centered as
a box but left-aligned inside it, so at any width where it wraps it went
ragged-right under a centered wordmark. Both members of the stack also carry a
one-letter-space start margin: `letter-spacing` applies after the final letter
too, so tracked type centers half a letter-space to the left of true center
unless it is corrected.

The same correction reaches the **README banner**, which is a raster and had the
same lean baked into it: measured against the 720px axis of the 1440px artboard,
the lockup's ink sat 2.5px left of center and the tagline 3.5px left. It is
re-rendered from `render.html`. The compensation goes on the lockup rather than
on the wordmark, or it would open the specified 0.62em gap between the mark and
the word. `og.png` is unchanged; its type is set flush left, where the trailing
space costs nothing.

### Changed: "Make me one" builds something you can see

The hero's payoff button played a patch and left the screen showing the two
candidates it was not. The sound arrived, nothing appeared, and the most
available reading was that the button had done nothing.

The built patch now **replaces the duel** and takes the screen: an amber card
(green is sound, amber is the model, as everywhere else on the page) with the
generated name, its own waveform trace, and the coordinates it chose spelled out
(`from your 5 picks · brightness +0.42 · movement −0.33 · grit +0.05 · weight
+0.01`), so "built for you" is a claim the reader can check against the bars
directly below it rather than one they have to take. `hear it again` and `back
to training` (or <kbd>esc</kbd>) sit under it; returning restores the same duel
with the model untouched, and the button relabels to *Make me another*.

The screen holds the height it had with two cards on it while the built patch is
up. One card is shorter than two, and letting the panel collapse would have
pulled the button just pressed (and everything around it) a few hundred pixels
up the page, which is a good way to make a new patch arrive off-screen.

### Fixed: figure labels were being painted black on a black panel

Every label inside a figure on the landing page rendered black. `viz.css` styles
readable values with `fill: var(--fg)`, and the landing page defines the whole
phosphor palette but never defined `--fg`: an unresolvable `var()` in a `fill`
is invalid at computed-value time, which falls back to the inherited value and
then to the initial one, and the initial value of `fill` is black. The same rule
outranks the `fill` presentation attribute a figure sets on its own elements, so
the two-loops diagram's box titles, which encode *which loop this is* by color,
were painted black too and the figure lost the thing it was drawing.

`--fg` and `--mono-font` are aliased on the landing page, every `var(--fg)` in
the figure runtime carries `var(--silk)` as its fallback, and the diagram's
titles are set as inline style so the figure's own color wins.

Separately, `.v-axis` (axis names, units, and the small print inside a box)
was painting 9px glyphs in `--silk-mute`, which law 1 of the design system
reserves for rules and strokes and forbids for text. It is `--silk-dim` now, the
text tier, which lifts the same labels in both books in both themes.

### Changed: one rule for every figure in the books

Figures had grown three tiers and a bug in each. Detail crops were stretched to
the reading column by `.content figure img { width: 100% }`: the 252px bank
rail was published at 862px, a 3.4× upscale of 10px type. Full frames broke out
of the column to a width derived from `100vw` minus whatever the rule believed
was in the way, which was wrong with the sidebar collapsed: the frame ran 123px
off the right edge at every window width from 1200 to 1512. And roughly half the
figures had no caption at all.

One rule now, both books, no width classes: **every figure sits inside the
reading column, a little narrower than the prose, with a caption and alt text.**
Widths are capped, never set, so nothing is ever published larger than it was
captured, and the breakout tier is gone rather than repaired: no rule that
guesses at the available width can be right in a state nobody checked.

The trade is deliberate and is now written down where it can be checked: a
1440×900 frame lands at about 0.54×, where the app's own UI type is texture
rather than text. A frame is there to show the *shape* of a view and its caption
carries what the labels would have said; anything whose detail is the point is
published as a **crop**, at the size it was cropped to. `SCREENSHOTS.md` and
`encode-screens.sh` used to assert the opposite rule and now say this one.

Figures that were wrong, missing, or hand-drawn rather than merely mis-sized:

- **The warm start now shows the warm start.** "Pick 3 of 9" illustrated itself
  with a screenshot of the bank rail. There is a real capture of the three-pick
  card there now, and `SCREENSHOTS.md` records how to reach it.
- **The node bank got its frame** on *Wiring and the node bank*, and the
  **teaching meter** got its crop on *EVOLVE*. Both assets were being built and
  shipped by `encode-screens.sh` and referenced by nothing.
- **The landing page's coefficient figure is the coefficient plot.** It had
  been a whole 1440px app frame rendered at 665px beside a column of prose: a
  0.46× reduction in which the plot the caption describes was a smear and half
  the image was bank and keyboard.
- **A bank row is a bank row.** *Reading a row* drew one in ASCII inside a
  full-width code block, which read as a large empty box. It is a crop of the
  real row.

### Changed: one contributor document, and the design lives in the reference

`DEVELOPMENT.md` and `.github/CONTRIBUTING.md` were one document split across
two files that each pointed at the other; they are now a single root
[`CONTRIBUTING.md`](./CONTRIBUTING.md), which is also where GitHub looks first.
`CONTINUATION.md` (a session-handoff log superseded by this changelog) is
gone, with its still-true sharp edges carried into `CONTRIBUTING.md` rather
than dropped.

`DESIGN.md` is gone too, folded into the reference book under a new **Design**
part: [Lineage](https://alexnodeland.github.io/auracle/reference/design/lineage.html),
the [decisions log](https://alexnodeland.github.io/auracle/reference/design/decisions.html),
[milestones](https://alexnodeland.github.io/auracle/reference/design/milestones.html)
and [open questions](https://alexnodeland.github.io/auracle/reference/design/open-questions.html).
Its §1–§3 were already in that book in more depth, which is the problem: a
choice and the math that justifies it were two documents that could disagree.
Every decision row now links to the page that works it out, and the `DESIGN.md
§N` citations scattered through the crates' doc comments name reference pages
instead of section numbers in a file that no longer exists.

### Changed: the README badge row, and a credit

The badges had five colors between them for no reason. One rule now: green
belongs to GitHub (the two workflow badges are GitHub's own and still go red
when a check fails), and everything the README asserts about itself is amber on
the rack's panel color.

A `© 2026 Alex Nodeland` credit, linked to alexnodeland.com, is on the landing
page, both books, the brand page, the instrument's help card and the README.

The README's **Project Status** section is gone: a release badge reading
`v0.2.0` already says the project is pre-1.0, and a section restating it in
prose was one more place to forget to update. The one thing the version number
does not carry (that the save format may still move, and that an export is the
only backup) moved to Quick Start, where someone is about to make patches they
might want to keep. The landing footer lost the same phrase for the same
reason.

### Documentation site

The published site stops being "the instrument at a URL" and becomes a site with
the instrument in it. Four sections under one origin, all built by `make site`:

- **`/`: a landing page.** Hand-authored, in the instrument's own two-phosphor
  design system rather than a new one. Its hero is a **working duel**: two
  synthesized patches with real waveform traces rendered offline from the same
  graph builder that plays them, an online Bradley–Terry update, and a posterior
  whose credible intervals narrow as you pick. It is a four-coordinate miniature
  of a forty-coordinate model and the page says so under the panel.
- **`/play/`: the instrument.** Unchanged, and moved off the root. Every asset
  path in `apps/web` was already relative, so this cost nothing.
- **`/docs/`: a user guide.** Fifteen chapters on playing it: the three views,
  the bank, the rack, wiring, performance, what the model learns from and what it
  provably cannot, how to read its uncertainty, your data, the full key map,
  accessibility (including its four known gaps), troubleshooting, glossary.
- **`/reference/`: a technical reference.** Twenty-five chapters with the math
  set in KaTeX: the typed PCFG, trace addresses, compilation, the audition phrase,
  BS.1770 loudness, the vetting gate, both halves of φ, standardization, the
  max-of-experts utility, the three likelihoods, the posterior and its
  degeneracy diagnostics, calibration, the Boltzmann target, the taste tilt, locks
  as conditional refinement, acquisition, safety, persistence, the web runtime.
  Every constant is quoted from the code by name, every measured claim names the
  harness that produced it, and where the design and the implementation differ
  (refinement is local hill-climbing, not the designed tempered SMC), the page
  says so in its first paragraph.
- **`/reference/api/`**: rustdoc for all five crates.

Both books share one mdBook theme carrying the app's phosphor palette and its
three color laws, with two themes (rack and paper) rather than mdBook's six.
KaTeX renders at **build time** and its stylesheet and faces are vendored, so the
whole site makes no external requests, a property `make site-check` now enforces,
along with every link, asset, cross-section anchor and the absence of any
root-absolute path (which would work locally and 404 under the project subpath).

CI builds and checks the site on every PR, because none of its failure modes are
visible to `make check`: an undefined KaTeX macro is a build *warning*, and a
cross-section link does not exist until four sections are assembled.

The screenshots throughout are the real app in a taught session, published at
their captured size: `www/SCREENSHOTS.md` records how to remake them and why
scaling a frame of this app is not an option.

### Changed: a plainer voice across the docs and the site

An editing pass over every prose document: the landing page, both books, the
README, `DESIGN.md` and the contributor docs. Nothing about the product changed,
only how it is described.

- **Headings name the thing rather than its presentation.** "<!-- voice: quote -->Catalogued in
  signal-flow order, not alphabetically<!-- /voice -->" is now "Forty-one modules, from source
  to output". The same went for "What to expect, honestly", "The memo is not an
  optimization detail", "Why this page matters more than it looks" and a dozen
  others. Two anchors moved with their headings, and every inbound link moved
  with them.
- **Implementation boasts came out.** A progress bar that is "honest rather than
  decorative", a guarantee that "provably" holds, a patch that is "byte-for-byte"
  the one that was evolved, a comment that is "the longest and most useful in the
  workspace", a build whose foundations arrive in "one clone". Where the fact
  underneath was load-bearing it stayed; where it was there to impress, it went.
- **Retrospectives left the user-facing pages.** The guide no longer explains
  which bugs the app used to have, how small a jack's hit area once was, or which
  trap it "has already fallen into once". The reference keeps the ones that are
  reference material: the sentinel incident, the two upstream quiver bugs, the
  acquisition retraction.
- **Fewer em dashes, and fewer "not X, but Y" constructions.** 731 em dashes down
  to 172, with the parenthetical ones turned into parentheses and the rhetorical
  ones into full stops.
- **`DESIGN.md` kept its decisions and lost its swagger.** The rejected designs,
  the layered-safety argument and the design-versus-implementation note all stay;
  "this version does it properly", "a confident model mostly serves bangers" and
  "non-negotiable" do not. The locks decision row was reworded, and the reference
  page that quotes it verbatim was updated in the same commit so the quotation
  stays true.

### Changed: `DESIGN.md` is an evergreen document now

It had drifted into a historical record: a "v1 module palette (~10)" against a
shipped palette of 41, `K = 3` against a shipped default of 5, `quiver-dsp`
0.1.x against 0.2.0, and sibling path dependencies that have come from crates.io
since 0.1.0. Every claim in it was re-checked against the code and the document
now describes the system as it stands, with the design-versus-implementation
gaps stated in place rather than left to be discovered.

New or corrected: the full 41-production palette and the append-only categorical
orders; φ's actual 15 + 25 split and why the axes are shaped as they are; the
`s_K` prior correction that keeps `Var(u_a − u_b)` invariant to K; the shipped
taste tilt (it was written as a "long-term" possibility); the measured 40 × 10
refinement split; the acquisition measurement and why the default is uniform
pairing; a new §1.6 on prequential calibration; the DC blocker in the mandatory
output chain; `QUARANTINE_FITNESS = −50.0` rather than "−∞/large-negative"; and
a posterior over `(θ, τ, cutpoints)` rather than the `(θ, z, τ, cutpoints)` left
over from a rejected design.

Section 6 was rewritten: the answered questions (phrase spec, acquisition,
persistence format, vet thresholds) are gone, and the genuinely open ones took
their place (tempered SMC, cross-island discovery, a feedback production, fit
cost at the K cap, and the fugue-side `thin` parameter).

### Changed: the docs menu bar, and the landing footer

**The menu bar stopped becoming two rows.** mdBook ships it as `flex-wrap:
wrap`, so once the cross-site nav, the book title and the three right-hand icons
stopped fitting, the bar silently doubled in height instead of overflowing. At
768px the print/repository/edit icons dropped onto a second row and the section
links ran off the right edge. It is one row at every width now, and what does
not fit is dropped deliberately: the desk affordances first, then the section
labels.

**The section labels moved into the drawer rather than shrinking.** The old
fallback collapsed them to their initials under 700px, and "A G R" is not a
navigation. Below 1000px they appear at the top of the sidebar instead, marked
with the section you are in, and the instrument keeps its button in the bar as
the one destination worth permanent space.

**The landing footer lost two horizontal rules and a third of its height.** It
was three full-width bands fenced by two rules, which on a 1568px frame is three
short lines of text spread down 300px with the right half empty. Identity and
tagline sit on the left now, destinations on the right, credits under both with
a single rule above them. One column under 960px.

### Fixed: the Pages workflow no longer fails on every release

Pushing a `v*` tag fired the Pages workflow, which built the site for nearly two
minutes and was then rejected at the deploy step: *"Tag v0.2.0 is not allowed to
deploy to github-pages due to environment protection rules."* The `github-pages`
environment permits deployments from the `main` branch only, so that deploy could
never have succeeded: one guaranteed red run per release, for a deploy that had
already happened.

The tag trigger is gone. It was settling a question that does not arise: a tag is
cut from a green `main`, so by the time the tag exists that commit has already
deployed from the branch. And the two claims in the docs could not both be true:
a site that "always tracks `main`" is not a site pinned to the last tag. The site
tracks `main`, the zip is pinned to the tag, and the documented release process is
what makes them the same build. `DEVELOPMENT.md` says so now.

### Added: a release badge, and the release status said out loud

The README carries a `github/v/release` badge linking to the latest release. It
currently reads **v0.1.0**, which is the point: the workspace, the changelog and
the docs have all said 0.2.0 since 2026-08-04, but the `v0.2.0` tag was never
pushed, so no 0.2.0 release and no 0.2.0 bundle exist. The badge is the one
place that cannot drift from the truth.

Two documents were asserting the release that was never cut:

- The guide told readers to `unzip auracle-v0.2.0-web.zip`, a file that has
  never existed on any release. The commands now use the same `vX.Y.Z`
  placeholder the prose above them already used.
- `DESIGN.md` said "Released at 0.2.0". It now says the workspace is at 0.2.0,
  that the tag has not been pushed, and that the newest published release is
  still `v0.1.0`, cut before the rename, and named Ricercar.

### Changed: the README's architecture diagram is a mermaid figure

The ASCII box drawing became a `flowchart TD`, which GitHub renders natively and
which stays legible in both the light and dark themes. It carries the same two
loops, with the pool → duel → log → posterior → refine cycle drawn rather than
implied.

Checked by rendering rather than by eye: the diagram was parsed and rendered
against mermaid 11 under both of GitHub's themes at README column width. Two
things that pass a syntax check and still look wrong were caught that way: the
`<br/>` in node labels gets stripped rather than honoured, so multi-line labels
ran their words together, and a left-to-right layout came out four times wider
than tall and unreadably small in a README column.

The lead paragraph also lost "keep/kill triage" from the list of what the app
collects, for the reason above.

### Fixed: three counts and one screen that does not exist

- **The preset library is 62 patches across seven families, not 29.** The guide
  and the reference had both been quoting the count from an earlier wave; a
  screenshot in the guide had been showing `presets 61` next to prose saying
  twenty-nine. The warm start's nine cards are also described correctly now:
  one per family first, then filled out to nine, rather than "one per family".
- **Keep/kill has no triage screen.** The guide's table of teaching signals sent
  readers to a "Triage" screen that has never been built. The likelihood, the
  per-session threshold and `Engine::record_keep` are all real; in `apps/web`
  only the bank's **cut** calls it, recording a kill once its undo window
  closes, and nothing records a keep. The guide, the reference and `DESIGN.md`
  now say so.
- The README's architecture diagram named Thompson sampling as the duel
  acquisition rule. It is selectable, it is not the default, and it measurably
  loses; the default is uniform pairing. The diagram now says so.

## [0.2.0] - 2026-08-04

The first release under the name **Auracle**, and the first one that is a
*patcher* rather than a patchbay with a splice tool behind it. Since 0.1.0 the
instrument gained wiring as a gesture, node identity that survives evolution,
a navigable canvas, destructive verbs you can see and undo, a model that says
what it believes and how sure it is, and an exported picture that is itself a
patch. The prebuilt web bundle is attached below: unzip, `python3 serve.py`,
play.

### Renamed: Ricercar → Auracle

The project is now **Auracle** (aural + oracle): it listens, it learns, and it
tells you what you are going to like. "Ricercar" was a musician's in-joke that
most people could neither pronounce nor spell.

- Crates `ricercar-*` → `auracle-*`, wasm artifacts `auracle_wasm*`, worklet
  processor `auracle-voice`, the workspace and every intra-workspace path dep.
- The wordmark is `AURACLE` with the final **E** as the "model is listening"
  light: the same one mark, two jobs the final R used to do.
- **Nothing a player saved is lost, and nothing of theirs is deleted.** The
  IndexedDB autosave is now `auracle`, with an adopt-on-boot chain that reads
  `ricercar` then `evosynth`; every `ricercar-*` / `evosynth-*` localStorage
  preference is copied to `auracle-*` at import time, before any of it is read,
  and never overwrites an answer this build already has.
- Exported patches are `.auracle.json`, PNG `tEXt` keyword `auracle`, SVG
  `metadata#auracle-patch`. **Files exported by any older build still open**:
  the JSON path never read the marker (a patch is recognized by its shape), and
  the PNG and SVG readers try the old names after the new one.

### Fixed: a hole that stays a hole, a view that cannot be stranded, and a patcher that fits on a laptop

The rest of the closing gate: the dissenting panelist's two named blockers (M2,
M3), the one-line durability bug the chair pulled in on impact (m1), the two
polish items ruled to ship alongside M2 (p4, p5), and the demo gate (M4).

- **An empty socket is named by the node standing in it, not by where that node
  sits.** `placeholderKeys` was a set of trace addresses, so it survived exactly
  as long as the addresses did: the client-side rewrite path carried holes
  across by object identity and **every** `StructOp` (insert, delete, replace,
  set_mod, swap_mix, at any key in the patch) forgot them. Unplug, then insert
  anything anywhere, and the dashed EMPTY plate silently became a full vco with
  knobs on it. A hole is now keyed by `uid`, the same identity locks are keyed
  by and for the same reason, so it rides through any edit inside the node that
  moved. Verified in the browser: an insert that does not touch the hole and an
  insert that moves it from `node/0/1` to `node/0/0/1` both leave it a hole,
  and dropping a source *into* it clears the mark on the frame the module lands.
- **A hole survives a reload,** in `holeStore`/`ui.holes`, the same shape and
  the same argument as `lockStore`/`ui.locks`: persisting it is only honest
  because it names a node. It also survives ⌘Z/⇧⌘Z, because `benchStep` carries
  it: pruning gets undo right for free and could never have got redo right.
- **`case "committed"` files the child's locks (and its holes) under the
  child.** One line and its twin (m1). The commit reply carries no `m.subject`
  so it never reaches `case "bench"`, and IDB ended with an entry for the parent
  and none for the patch the player had actually authored: pins evaporating on
  reload for the one patch that mattered most, with the next ⚡ then breeding
  away the routing they meant to hold. Verified end to end through a commit, a
  full page reload, and re-benching the child.
- **Canvas, bank and accessibility tree agree about absence** (p4). The IN THIS
  PATCH list printed "vco" and the plate's `aria-label` said "vco module" about
  a socket the canvas was drawing as empty. All three route through one
  predicate now; the chip is dashed, reads "empty", and carries no θ, because a
  belief about vcos is not a belief about a hole.
- **The EMPTY plate stops shouting** (p5). It was inheriting the plate of
  whatever it replaced (up to 240×164 with a recessed control well), giving the
  most visual weight on the panel to the thing that is not there. It renders at
  the narrow 96-unit width, one row tall, title and hint only, no well.
- **Freeform can no longer strand the view, and now says so if it has.**
  `contentBox()` returns the modules' bounding box instead of the layout
  canvas's extent, so a fit is a fit of what is drawn: a persisted layout that
  put every plate at y ≈ 3400 had Home dutifully framing 3744 units of which
  3400 were empty. The minimap reads the same box. `applyGrid` re-seeds from the
  **chain** when what is drawn is degenerate, instead of pinning the stranding:
  the one command that looked like a rescue was the one that made the damage
  permanent. A stored layout that places under two thirds of the rack's nodes is
  dropped wholesale rather than applied, and the inheritance test rose from
  "*some* uid in common" (1 in 18) to the same floor. A **reset** verb sits in
  the freeform controls, and below 0.30× with a measurably worse-than-chain
  arrangement the frame itself offers it. Measured on a reproduced stranding:
  0.049× → 0.249× at 1280×900, 0.080× → 0.403× at 1700×1000.
- **The patcher fits on a laptop** (M4). The docked spec card collapses to a
  single line when it has nothing to describe (and stays one line while armed,
  so a placement in progress never resizes the canvas underneath itself); the
  short-laptop media query's breakpoint moves from 860px to 940px, which is
  where it was always meant to apply (1280×900 is the plan's own second test
  size); a **draggable divider** above the strip gives the player the final say,
  the node bank's rail pattern on the other axis, persisted and keyboard-
  operable; and the auto-LOD threshold scales with the frame's height, because
  what makes a knob small in a 364px band is the band, not the patch. Result at
  1280×900: rack frame **295 → 364px**, and **5 of 5** stock presets open in
  full detail with knobs (First Bass 0.67, Sub & Sparkle 0.61, Acid Line 0.67,
  Reese 0.44, Anvil 0.67 against a 0.40 threshold) where 5 of 5 opened as
  knob-less block diagrams. At 1700×1000 the frame is 489px, the threshold 0.54,
  and all five are in full detail.
- **The freeform verbs hold their slots** (m6, taken because M3 would otherwise
  have made it worse). `apply grid` used to be `display: none` outside freeform,
  so entering the mode slid the layout toggle ~100px under the pointer that had
  just pressed it and a second press fired *apply grid*, a command that
  rewrites every position. Both verbs are now reserved and disabled, and both
  are one word (`snap`, `reset`), because two long labels wrapped the group onto
  a second row at 1280 and cost 35px of the very budget M4 is fighting for.

### Fixed: the sentinel (a knob outside its range, and everything downstream that believed it)

The closing panel's one non-negotiable item, found independently by three
reviewers from three unrelated surfaces: a faceplate reading "SUSTAIN 1200.0
dB", a HELD fragment printing `1e+30` for every parameter, and six cells of
exactly `1e30` inside the raw φ of the persisted observation log.

- **Every continuous site in the grammar has a declared range, and it is now
  written down**: `PARAM_DOMAIN`, one constant, next to the `u01()` the prior
  actually samples from. `PatchTree::domain_violations` reports the sites that
  leave it and `PatchTree::clamp_domains` pulls them back, both by walking the
  **trace** rather than matching 26 productions: the trace enumerates exactly
  the continuous sites, by construction, so there is no second table of "which
  fields are knobs" for the next module to be left out of.
- **`validate_tree` (the WS-1 rider) now speaks about values.** It has always
  gated size, depth and modulation depth; it had nothing to say about a knob,
  which is why a value could walk through it into `edit_set_tree`, into
  `finish()`, into φ, into the exported PNG's `tEXt` chunk and into the log.
- **Domains are repaired, ceilings are refused,** and the asymmetry is the
  point: a 40-node patch cannot be clamped without deciding what to delete, and
  a knob can be fixed exactly. Refusing would have meant a saved session that
  already contains one becomes an app the player cannot edit their way out of.
  `finish()` (so every `ReplaceTree`/`InsertTree`/`SetModTree` fragment the
  panel hands in), `edit_set_tree_apply`, `import_patch` and the refinement
  boundary all repair; identities survive, so locks and hand-placed positions
  ride through the repair.
- **The featurizer's quarantine caught only audio pathology.** `sustain = 1e30`
  *renders fine* (the limiter bounds the voice), so it passed the vet and its φ
  became evidence. `featurize` now refuses an out-of-domain term before the
  render, and refuses a non-finite coordinate after it.
- **`Standardizer::fit` gained a runaway-column detector, and it is a detector,
  not a trim, because the trim was measured and thrown out.** One escaped row
  gave `amp_sustain` a mean of ~1.2e29 and a σ of ~5.5e29, which standardizes
  every real patch to the same place: a dead coordinate the model can never
  learn from while the belief line still prints a contribution for it. The first
  fix was routine winsorization at 2% per tail; the 16-seed paired run took it
  straight back out (`+1.877 ± 0.362` → `+0.204 ± 1.347` mean gain, 15/16 → 11/16
  seeds climbing, one seed at −18.2). Trimming a real tail is not free. So the
  shipped rule uses the plain moments **unless** a column's plain σ exceeds its
  winsorized σ by more than `RUNAWAY_RATIO`, which makes it a bit-identical no-op
  on clean data by construction rather than by luck. The threshold was measured
  too: a new `winsor_ratio` example fits 150 clean 48-patch pools and reports
  the largest ratio any column reaches (14.6, `rms_std`), against ~2×10²⁹ for a
  single `1e30`; `1e6` sits five orders above the first and twenty-three below
  the second. Non-finite cells are dropped from their column instead of turning
  it into NaN.
- **Saved state is migrated, not deleted.** On load, every bank term is
  clamped, the observation log's unit coordinates are clamped **by name**
  (never positionally), the implicit-event stream's stored φ pairs are clamped
  positionally *only* at the live φ width, votes carrying a non-finite cell are
  dropped, and (if anything at all was repaired) the persisted standardizer is
  discarded and refit, because a scale fitted over a poisoned column is itself
  poisoned. The frontend says what was mended and how much of it, with counts.
  HELD fragments are UI state and are repaired on their own path in the client.
- **The panel's formatters now fail loudly.** Every knob unit was a *map*, not a
  check: handed `1e30` they answered "1200.0 dB", "Infinity kHz" and
  "1e+32%", three plausible-looking readings of the same corruption. One guard
  in `knobUnit` renders anything outside 0–1 as `⚠ out of range`.
- **Where it came from.** `1e30` appears as a literal in no workspace source and
  in none of the vendored dependencies (`fugue-evo` 0.3.1, `fugue-ppl` 0.1.0 /
  0.2.0 / 0.2.1, `quiver-dsp` 0.1.x / 0.2.0), and the MH kernel *cannot* seat
  one: every continuous site is `Uniform(0,1)`, whose `log_prob` is −∞ outside
  the unit interval, so an escaped proposal scores `log α = −∞` and is
  rejected. That is measured, not argued: a new `mh_escape` example runs 8
  chains × 20 000 single-site transitions through the shipped kernel and
  observes zero escapes, and a full closed-loop seed (40-patch pool, 60 duels,
  6 refine generations) produces none either. In the shipped session the fault
  is traceable to one event: bank entry #23 (`origin: prior`) is clean, its
  hand-edited child #41 has the same amp envelope with `sustain`, `cut`, `res`
  and `mdepth` all at exactly `1e30` and a freshly-minted `uid` on the root
  filter, and #43/#55/#56 inherit from it. So it entered at the **hand-edit /
  whole-tree-replace boundary** (the one route into a term that went through
  neither `set_param`'s clamp nor the kernel's support check) in a session
  carried across builds, and that boundary is exactly what now has a gate.
- **The φ revalidation, since this touches φ.** 16 seeds, paired, same list both
  arms: pool climb `+1.877 ± 0.362`, climbing on 15/16, **bit-identical on
  every seed**, which is the intended result and is a property of the design
  rather than a lucky null: the domain gate cannot fire on a synthetic loop that
  never had a bad value, and the standardizer is the plain moments unless a
  column is runaway. VIF over 300 draws is likewise identical to the digit (no φ
  column moved; `amp_sustain` 1.4, `rolloff_mean:p2` 19.6). What *did* move is
  the coordinate the fault was killing: in the shipped profile `amp_sustain`
  comes back with mean 0.647 and σ 0.284, so two patches at opposite ends of the
  knob are 3.5 σ apart, against ~4×10⁻³⁰ σ before the repair. It is a live
  coordinate again, and that is the only number in this section that is supposed
  to be different.
- New regression tests: the prior's own claim (400 draws, every site in
  domain), the sentinel repaired with identities intact, NaN landing mid-range
  rather than pinned to an end, an explicit fragment that cannot seat a bad
  value, the quarantine refusing the exact `1e30` term, clean columns fitting
  bit-identically over four differently-shaped distributions, one escaped row
  that can no longer kill a column, and the log repair being idempotent.

### Added: φ_struct sees how a patch is *arranged*

- **Two arrangement coordinates in φ_struct**, so the taste model can hold an
  opinion about routing and not only about contents: `chain_balance` (mean
  source-to-root path over the longest one, an asymmetric branch, whichever
  side the chain is on) and `frac_sidechained` (binary nodes whose `/1`, a
  ducker's key, a vocoder's modulator, is a chain rather than a bare
  oscillator). `filter(mix(a, b))` and `mix(filter(a), b)` were *the same
  point* in φ before this: same counts, different instrument.
- Both are ratios of shape sums, never linear in any count, which is what keeps
  them clear of the two exact identities that put `size`, `depth` and `n_mix`
  out of φ in the first place. VIF over 300 draws: 2.7 and 2.4, against
  `mod_density` 5.6 and the standing `rolloff_mean` 19.6.
- **Four columns were written and two were cut, both by measurement**, and that
  is the more useful half of the change:
  - `branch_width_max` came back at VIF 10.4 and took `n_vco` from 3.1 to 9.1.
    WS-8 §4 asked for a parallelism coordinate on the reading that serial and
    parallel patches "differ only in `n_mix`". They do not: the leaf count is
    `1 + Σ binaries` exactly, so a patch cannot gain a mixer without gaining a
    source, and the source counts have been in φ since v1. A synthetic listener
    who "likes wide patches" was already learned to Spearman 0.709 by the *old*
    feature set, which says the same thing independently.
  - `mod_at_source` measured *well* (VIF 3.0, full spread) and is out on a
    tie the harness could not break. An 8-seed search-health run made three
    columns look like an unambiguous regression (climb +1.714 → +1.320, best
    patch 8.154 → 6.503, 7/8 seeds climbing → 5/8). At 16 seeds the harness's
    standard error on that quantity turned out to be ±0.64, and the paired
    differences are +0.35 ± 0.73 for two columns and −0.33 ± 0.74 for three:
    neither a regression nor an improvement anything here can see. So the tie
    goes to cost (every column is a dimension of posterior variance the cold
    start pays down) and to scope: two columns answer the question this wave
    was asked, and the third answers a different one. It stays as a display
    field, for a wave with evidence to spend and its own measurement.
- **The routing-lock copy now claims learning.** WS-8 §4 sequenced that
  deliberately: until these columns landed, "lock wiring" could only promise
  that evolution would leave the routing alone.
- **The pre/post evolution measurement, in one line each** (before → after,
  same seeds): pool climb +1.714 → +1.723 · MH acceptance 46.5% → 49.6% ·
  locked refine beat its parent 66% → 69% · fitted-vs-true ranking 0.318 →
  0.389 · true best survived the generation 98% → 100% · closed-loop
  calibration r 0.693 → 0.688 (se ±0.018). And for a synthetic listener whose
  taste *is* a routing preference: fit-vs-truth 0.662 → 0.705, true utility
  gain +2.016 → +2.669, and a pool that ends up 82% sidechained rather than
  71.6%. The full table is on `search_health`'s module doc.
- `search_health` gained three modes. `--routing` is a synthetic listener whose
  taste *is* a routing preference; it walks the term rather than reading
  `StructFeatures`, so the same measurement compiles and runs on both sides of
  a feature-set change. `--climb` runs the pool-climb gate alone at any seed
  count and prints the per-seed numbers, because ±0.4 in the mean gain is
  inside the seed-to-seed spread and the aggregate cannot tell a regression
  from a lottery. `--tail` runs the expensive back half alone, so an
  interrupted comparison run does not have to start over.

### Changed

- Two open questions about the search loop are now **answered in the code**
  rather than in a commit message, because both would otherwise be re-asked
  from scratch:
  - The refinement budget split (`2·N_OPS` steps from `N_OPS/2` seeds) is a
    measured optimum, not an argument: moving off it in *either* direction
    scores worse, and depth from few seeds is actively harmful. The table is
    on `SessionConfig::refine_steps`.
  - The pool-decline scare from the palette expansion: the fitted ranking
    genuinely does churn between refits (Spearman 0.556), and it genuinely
    does not matter, because the true best survives 98% of generations and
    eviction only reads the bottom of the order. Recorded on
    `search_health`'s `retention`, along with why the upper-confidence-bound
    eviction rule it motivated was designed and not shipped.

### Added: wave 2C (modulation becomes a sort)

- `ModNode` was a flat enum of leaves: one modulator, one destination, and
  nowhere to put anything in between. It is now **recursive with a depth
  bound**, so `s&h rand → quantize to a minor scale → slew` is a term the
  grammar can write, the taste model can learn and the rack can draw.
- Eleven new modulators: `euclid` (a clocked pattern, the rhythm behind most
  drum machines), the CV shapers `quantize`, `slew`, `rectify` and `hold`, and
  the combiners `min`, `max`, `and`, `or`, `xor` and `switch`.
- **Shapers wrap rather than replace.** Dropping a quantizer on a cable that
  already carries an LFO takes the LFO as its input: chaining is the whole
  point of the recursive sort, and it should not first cost you the modulator
  that made the cable worth quantizing. The socket says which of the three
  things will happen before you click.
- Palette: **30 → 41 modules**, and 43 of quiver's 65 are now reachable.

### Added: wave 2B (the binary-node family)

- **Five more modules.** `pitch shift` (a harmoniser: one note becomes an
  interval), and four **binary** nodes whose second child is a *control* rather
  than something you hear: `compressor`, `ducker`, `gate` and `vocoder`.
- Wave one cut all five on the grounds that they "need a second free audio input
  the typed tree cannot name". `ring mod` shipped in that same wave *as a
  two-child node*, so the premise was already false, and the pitch shifter
  turned out to be unary all along; the port map that condemned it belonged to
  the vocoder.
- A `dynamics` group joins the catalog, and binary sockets now carry real
  names (`in`/`key`, `carrier`/`voice`) instead of `a`/`b`.
- Palette: **25 → 30 modules**.

### Added: wave 2A (motion, voice, and pitch that can bend)

- **Six more modules**, none of which needed an architectural change. They were
  cut in wave one on product grounds that did not survive re-reading:
  `formant` (a glottal pulse through five resonators, with a *continuous* vowel
  slide rather than a five-way switch), `flanger`, `tremolo`, `vibrato`,
  `eq` (three bands, ±12 dB, arriving flat) and `granular`.
- **Pitch modulation.** `vco` and `supersaw` gained a modulation slot landing on
  the pitch offset. Until this existed nothing in the instrument could bend a
  pitch (no vibrato, no pitch envelope, no siren), which made "vibrato is just
  an LFO on pitch, pre-baked" an argument for a capability that was not there.
- Palette: **19 → 25 modules**, and modulation slots **10 → 18**.
- A `motion` group joins the catalog, between `space` and `combine`.

### Added: the palette, and the catalog that holds it

- **Six new modules, appended to the grammar**: `wavetable` (eight bandlimited
  shapes with a modulatable morph, the first source whose timbre moves),
  `pluck` (Karplus–Strong, gate-triggered), `distortion` (soft / hard / tube),
  `bitcrush`, `phaser`, and `ringmod`, the grammar's **second binary node**,
  which is what makes COMBINE a real sort rather than a sidebar heading.
  Plus `follower`, an envelope follower that taps the module's own input so a
  patch responds to itself, and a `glide` knob on `s&h rand`. Nineteen modules,
  from twelve.
- **Modulation almost everywhere.** Delay, chorus, reverb, wavetable, pluck,
  distortion, bitcrush and phaser gained a modulation slot, each with a fixed,
  **named destination** the rack prints on the jack (`→ time`, `→ size`,
  `→ drive`). It was filter and wavefolder only, in an instrument whose DSP had
  supported the rest all along.
- **The node bank became a catalog.** Six signal-flow groups, a transfer-
  function glyph per module, a port signature in both phosphors at rest, search
  by sound as well as by name (`grit`, `metal`, `wander`), a spec card with one
  sentence of plain English per module, and (where the evidence supports it)
  the model's own θ with a ±σ whisker.
- **Arm-and-place**, with a full keyboard equivalent. Click a module and every
  legal socket lights up and says what will happen to it: green **inserts**,
  amber **replaces**. Wiring previously had no keyboard path at all.
- **IN THIS PATCH** in the rail, a resizable and persisted width, a collapsed
  rail that keeps its name and its held count, and six new presets that
  exercise the new modules.

### Changed

- `φ_struct` carries **families**, not one column per module: `n_drive` covers
  fold + distortion + bitcrush, `n_mod_fx` covers chorus + phaser. Ten sparse
  per-kind columns would have arrived as near-indicator variables and cost the
  cold start ten dimensions of posterior variance before the model said
  anything.
- The taste→grammar proposal tilt is **shrunk by θ's own uncertainty** rather
  than reading `theta_mean` raw, and the refinement budget scales with the op
  alphabet.
- The rack's ⋯ menu stopped reprinting the module list: **replace with…** and
  **insert after…** hand off to the rail with the socket pre-chosen. One
  inventory, one place.
- The tray is now **held**, and states its terms where it stands.

### Fixed

- The belief the sidebar shows is gated on **evidence, not prevalence**: a
  coefficient whose |mean| sits inside its own σ draws a dot on zero and says
  "the model has looked and has no lean either way", rather than a short bar
  and a direction the posterior does not have.
- Tube-mode distortion is now included in the voice's DC-blocker test: its
  asymmetric shaping emits real DC, which the amp envelope would otherwise
  multiply into a per-note thump and carry into every feature vector.

## [0.1.0] - 2026-07-30

The first tagged release: a playable, taste-learning instrument. The
attached `ricercar-v0.1.0-web.zip` is the prebuilt web app: unzip,
`python3 serve.py`, play.

### Changed
- Dependencies come from crates.io (`quiver-dsp 0.1.1`, `fugue-ppl 0.2.1`,
  `fugue-evo 0.3.1`): a single clone builds. The quiver wasm32
  `SystemTime` panic was fixed upstream and released as `quiver-dsp 0.1.1`.
- Repository adopted the fugue-ecosystem / quiver OSS standards: MIT
  license, Makefile (`make check` = the CI gate), DEVELOPMENT.md,
  contributing + issue/PR templates, CI with separate
  fmt/clippy/test/wasm jobs under `-D warnings`, and this changelog.

### Renamed
- **EvoSynth → Ricercar** (`efceab6`): crates `ricercar-*`, wasm artifacts,
  worklet processor, storage keys (with one-time migration of old saves),
  export filenames, UI wordmark. Old `.evopatch` files still import.

### Added: pass 6, "four tiers" (`4e94345`, `d12a23b`, `ca82994`)
- **Trust**: IndexedDB session autosave/restore; undo/redo over knob and
  structural edits; Web MIDI in (velocity, pitch bend, sustain); per-patch
  LUFS makeup gain for loudness-fair live audition; in-worklet WAV recording;
  shareable single-patch files.
- **Musicality**: sample-accurate arpeggiator (up/down/up-down/random, BPM ×
  division), glide, unison with detune + stereo spread, velocity→level
  curve; palette grew **reverb** (Freeverb) and a **sample-and-hold random**
  modulation source, end to end (grammar → features → UI).
- **Taste loop**: refinement proposals tilted by the structural taste
  posterior (`exp(η·θ)` on grammar kind weights); recency-weighted
  likelihood (half-life 150 observations); implicit signals logged (play
  counts, promotes); nameable, color-coded styles with auto-labels and
  exemplar audition; pre-vote duel forecasts with running calibration.
- **Surface**: modulation wires pulse at the modulator's rate; duel-deal
  staging; quick-duel strip on PLAY; `?` help overlay with first-run onboarding;
  coarse-pointer touch targets.

### Added: pass 5, bulletproofing (`a0e5628`)
- Zero-allocation render path, one-pole parameter smoothing, click-free
  patch swaps (fade → silent amortized rebuild → re-press held notes →
  fade-in), swap coalescing, compile-failure fallback, chaos gate tests.

### Added: passes 1–4 (`ad00e32`, `05bfbe4`, `76962fc`, `5819ef9`)
- Interactive workbench (every knob a live trace address), locks with exact
  conditional refinement, max-of-experts taste model, taste map / styles /
  directions views, lineage strip.
- The instrument: AudioWorklet 4-voice polyphony, app frame
  (PLAY/EVOLVE/TASTE), patch bank, docked keyboard.
- Feature-complete push: typed structural editing, presets, patch naming,
  dynamic style count, duel-card circuit flip.
- The live surface: zero-recompile knobs (`ExternalInput` atomics), typed
  jack-drag rewiring with a parts tray, labeled jacks, colored wires.

### Added: milestones M0–M5
- Workspace scaffold; grammar + trace codec + compiler; feature pipeline
  (vet gate, LUFS, φ); taste model with three likelihoods; two-loop session
  engine with dueling-Thompson acquisition (closed-loop gate: r > 0.6 in 60
  duels against a synthetic user); wasm bindings and the first web frontend.
