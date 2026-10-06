# Auracle's voice

This guide covers every word Auracle says, in every medium:

- the app;
- the landing page and the launch film;
- the view films and the illustrated films;
- the guide, the reference, the README and the changelog.

It is the one set of language rules. The `AGENTS.md` files, the agents, the
skills, `VIEWS.md`, and `SCRIPTS.md` point here, and where any of them differs,
this guide wins. Two other rules sit beside it:

- **[ADR-004](../../docs/decisions/004-descriptions-stay-true.md):** every
  description stays true to the app.
- **[ADR-012](../../docs/decisions/012-motion-shows-what-the-engine-does.md):**
  motion shows only what the engine does.

The maintainer approves changes to it ([ADR-013](../../docs/decisions/013-one-voice.md)).

## The line

> **A synthesizer that grows toward you.**
>
> Pick the sound you'd reach for. It learns your ear, and every generation
> grows a little closer.

The first line is the **tagline**; the second is the **descriptor**. They
travel together:
- the landing page's hero;
- the brand lockup;
- the README;
- the guide's lede;
- the app's first screen;
- the end of the launch film;
- `og:title` and `og:description` (the tagline and the descriptor).

**Saying the name:** Auracle is said like "oracle". Say it that way in the
films and anywhere it is spoken. The films' lexicon (`www/video/films/lexicon.json`)
maps it for the voice.

The tagline has no period when it stands alone as a title or in a lockup. It
takes one inside running prose. Don't paraphrase either line, and don't write a
second tagline.

The image is a plant growing toward light. Each generation is bred toward what
you pick, and each sound's face grows out of the one before it. The film sound
(RFC-007, to be written) comes from the same place: soft, warm, nature-ambient.
Keep the image when you write about the instrument: things grow, lean, settle,
and come closer. Don't tell the reader about the image.

When a surface needs more than the descriptor (the README's first paragraph,
the guide's introduction, a meta description), use the **long line**:

> Auracle is a modular synthesizer you play in the browser. Pick between two
> sounds, and it learns what you like, breeds new sounds toward it, and shows
> you what it learned. Every sound is a patch you can open and change.

## Who Auracle sounds like

Picture the person who built the instrument, sitting beside you while you play
it. They know exactly how it works, they love how it sounds, and they want to
hear what you'll make with it. They don't sell it to you. They hand it to you,
tell you what each part does, and get out of your way.

| Auracle is | Not | Sounds like | Not like |
| --- | --- | --- | --- |
| **Precise** | Technical | "The filter opens, and more of the top comes through." | "The cutoff frequency raises the passband's upper bound." |
| **Warm** | Familiar | "Pick the one you'd reach for." | "Ooh, which one's your fave?" |
| **Curious** | Clever | "It guessed the other. It's still learning which way you lean." | "Plot twist!" |
| **Confident** | Loud | "Four new sounds, each grown from one it rates highly." | "Incredible new sounds, instantly!" |
| **Honest** | Apologetic | "It needs a few more picks before it can guess." | "Sorry, we couldn't generate a prediction." |
| **Calm** | Hurried | "Nothing changes until you pick." | "Quick! Choose before it's gone!" |
| **Musical** | Mechanical | "It leans brighter." | "Feature weight 3 increased by 0.4." |

## What Auracle believes

The beliefs come first, and the copy follows from them. When a line is hard to
write, ask which belief it serves.

1. **Your ear is the authority.** Auracle never tells you what you like. It
   says what you picked and what it guesses from that: "the one you'd reach
   for", never "the best one".
2. **Taste is yours to grow, not ours to set.** No sound is better or worse
   than another, only nearer to your taste or farther from it. Harsh can be
   someone's taste. Don't call a sound good, bad, right or wrong.
3. **A sound is something you play.** Every sound is a patch you can open,
   play, and change, not a file from a black box. Write it as an instrument,
   with verbs of playing.
4. **It shows its work.** It says how sure it is, what it learned from, and
   what it did. The figures show the mechanism, and the words name it. Nothing
   is magic.
5. **Searching is growing, not gambling.** New sounds grow from ones you chose,
   step by step, so write it as growth. Nothing spins, rolls or is endless.
6. **Quiet is a feature.** Restraint in the words, in the sound, and in the
   motion. The space around a sound is part of it.

## Five principles

1. **Say what it does.** Every claim is something the app does today, and
   every number is one the app shows or the code defines ([ADR-004](../../docs/decisions/004-descriptions-stay-true.md)).
   If a sentence would need "can", "may" or "helps you" to stay true, it is
   describing a hope.
2. **Exact, plain words.** Use the app's own names, from the word table below.
   Call a control by its name on the panel (BRIGHT, not "the tone knob"), and
   say "breeds", not "creates".
3. **Quiet confidence.** No superlatives, no exclamation marks, no adjectives
   that sell. The sound is the drama; the words get out of its way.
4. **Warm, not cute.** Second person, present tense, musical and natural images
   (grow, lean, reach, ear) over machine ones (engine, algorithm, AI). The
   warmth comes from precision and care, not from metaphor: use the growth
   image lightly, and never stack images. No jokes and no whimsy in copy; the
   play lives in the sound.
5. **One idea a sentence.** Short sentences, and structure (headings, steps,
   tables) for everything else. Motion and sound explain mechanisms; words name
   them.

## How Auracle talks about…

### Sound

- **Use the words musicians use for what they hear,** and give each one
  one meaning. Where a word names a PERFORM control, it means what that
  control does:

  | Word | Means |
  | --- | --- |
  | **bright / dark** | More or less energy up high |
  | **warm** | Weight in the low middle, a soft top |
  | **body** | Weight low down |
  | **air** | The very top, above the notes |
  | **snap** | A fast, sharp attack |
  | **round** | A soft attack, few harmonics |
  | **heft** | Dense, held weight: the opposite of a light pluck |
  | **motion** | Movement over time |
  | **throb** | Pulsing and tremolo: movement at 2 to 8 Hz |
  | **sway** | Slow sweeps and breathing: movement at 0.5 to 2 Hz |
  | **grit** | Roughness, distortion |
  | **space** | Room and distance: reverb, delay |
  | **wide / close** | Stereo spread; how near it sits |

- **Describe what changes, not what it is like:** "the top opens", "the attack
  softens", "it settles into the room".
- **No empty praise:** not nice, rich, lush, epic, huge, or insane. "Fat" only in a
  preset's name.
- **Tie a word to its mechanism once,** in the guide or a film, then trust it:
  "Brighter means more energy up high: the filter lets more of the top
  through."

### The model

- **Call it "it" or "the model."** Never AI, never a name, never "I", never
  "we".
- **It may learn, guess, rate, lean, fit, breed, and offer.** It may not know,
  understand, feel, want, love, or decide for you.
- **Give its evidence:** "from 12 picks", "a hunch", "fairly sure".
- **When it's wrong, say so plainly and without defense:** *it guessed the
  other*. Its mistakes are how it learns, and they are not failures to hide.

### You

- **You lead; it follows.** Imperatives are invitations to the instrument
  ("Hold a chord.", "Listen to the top."), never instructions about taste.
- **Assume a musician,** not an engineer and not a beginner. Explain what is
  Auracle's own, and don't explain music.
- **Never** "simply", "just", "easy", "obviously", or "of course". What is easy
  for one player isn't for the next, and the word only makes the second one
  feel slow.
- **Never praise or scold the player.** No "Great pick!", no "You haven't
  picked in a while". The sound is the reward, and their pace is theirs.

### How it works

- **Layered.** In the app and the guide, say what something does first, in one
  or two sentences. How it does it sits one step deeper, behind a "How it
  works" that opens in place. The math lives in the reference, one link
  further. Each layer is complete on its own; nobody needs the next one to act.
- **Show, then name, then explain:** what you hear or see first, the term
  second, the reason third.
- **One example before the rule.**
- **Analogies come from music and nature** (growth, a garden, an ear, a room),
  not from computing (pipelines, processing, algorithms).
- **Say what it doesn't do as plainly as what it does:** "There is no
  crossover: every child grows from one seed."

## Tone by moment

The character stays the same, and the tone moves with the moment.

| Moment | Tone | Example |
| --- | --- | --- |
| A first visit | Welcoming and brief: one sentence, then the instrument | "Pick the three you'd reach for." |
| Teaching | Patient and concrete | "Hold a chord, and ride BRIGHT up." |
| Waiting | Honest about progress | "Walk 3 of 10", "listening…" |
| Something worked | Understated: say what changed | "Generation 3: four new sounds in the pool." |
| The model was wrong | Curious, not defensive | *it guessed the other · 62%* |
| A refusal | Calm, specific, and why | "Nothing to play. No source reaches the output: plug one into the empty socket." |
| An error | Own it, and say what to do | "That sound didn't load. Try another, or reload the page." |
| A loss | The facts, and how to keep it next time | "Bell Jar was replaced. Save a sound to keep it." |
| Celebration | None. The sound is the reward | |

## Rhythm and word choice

- **Lead with the thing, and end on the point.** The last words of a sentence
  are the ones that land, so put the new idea there.
- **Verbs, not nouns:** "it breeds", not "the breeding process"; "you pick",
  not "your selection".
- **Active voice, with a concrete subject.** "The model reweights its draws",
  not "the draws are reweighted".
- **Twos and threes.** The descriptor is two beats. A list of three is the
  longest a reader holds without looking back.
- **Vary the length.** A short sentence after two longer ones lands.
- **Words Auracle reaches for:** grow, lean, settle, reach, open, close, play,
  hear, shape, warm, round, room, near.
- **Words it avoids,** though no check bans them: leverage, utilize, solution,
  experience (as a noun for the app), journey, unlock, empower, discover,
  endless, infinite, perfect, ultimate, easy, simply, just.

## Who each surface speaks to

| Surface | Reader | What they need | Register | Length |
| --- | --- | --- | --- | --- |
| Landing page | A musician deciding whether to try it | What it is, what it sounds like, what it does for them | Plain, at its most concise | The line, then one sentence per section |
| Launch film | The same, in 90 seconds | To hear it and see the loop once | Narration | Under 100 seconds |
| The app | A player with their hands on it | Names, what just happened, what they can do next | Silk, plain, the model's voice | The text budget |
| The guide (`www/docs`) | A player learning a view or a task | How to do it and what each part does | Plain, long form | A page per view or task |
| View films and illustrated films | A musician learning one view or one idea | To see it work and know when they'd reach for it | Narration | 2 to 6 minutes |
| The reference (`www/reference`) | The curious, and contributors | How it works and why, in enough detail to disagree with | Technical | As long as the argument needs |
| README | Someone arriving at the repo | What it is, how to run it, where to read more | Plain | One screen before "Run it" |
| CHANGELOG | A player reading what changed | What is true now, and what was wrong before | Plain | One or two sentences an entry |

Every surface starts with the musician's experience. Depth comes after it and
is opt-in: the guide goes further than the app, and the reference goes further
than the guide. A film made for the curious says so in its first line, and it
still opens with the sound.

## The registers

### Silk: the panel

Labels and the things you press. A noun or a verb, never a sentence.

- **One to three words.** EVOLVE POOL, ANOTHER PAIR, BRIGHT, TAUGHT.
- **Capitals with tracking**, set by CSS: the source is lowercase and the
  display is uppercase. In prose, write a silk label as it is displayed:
  "press EVOLVE POOL".
- **Verbs for actions, nouns for places and values.** A button says what it
  does (PLAY, KEEP AS NEW). A heading names a thing (POOL, SAVED).
- **No punctuation**, except the middle dot between a name and its key or count
  (`Evolve pool · E`, `Pool · 24`) and the ellipsis on an item that opens a
  dialog ("Open…").
- **No first person.** No "my", "me" or "Make me one".

### Plain: what the app and the docs say

Toasts, status lines, tooltips, empty states, the guide, the README, and the
changelog.

- **Sentence case, present tense, second person.** "You" is the player, and
  "it" is the model.
- **One idea a sentence**, and usually 20 words or fewer.
- **Name the sound,** never an id: "Saved Glass Pad. No generation will
  replace it."
- **Say what happened, then what you can do,** and stop.
- **A refusal says why:** "Nothing to play. No source reaches the output: plug
  one into the empty socket."
- **An error says what to do next,** or that nothing needs doing.
- **Uncertainty is a fact you state:** "It needs a few more picks before it
  can guess.", not "might be unable to".

In the app, plain is held to the text budget ([ADR-011](../../docs/decisions/011-one-design-system.md),
Plan-004):
- at rest, a view shows at most one sentence of guidance;
- no instruction appears on two surfaces;
- no block runs past 25 words outside the guide;
- a tooltip is a name and a key, at most eight words;
- a toast is at most two sentences.

### The model's voice

What the model believes, and why. Set in Newsreader italic, lowercase, and
declarative. **Only the model speaks in it.** Module descriptions, the landing
page's pitch, and the docs' ledes are plain.

- **Third person:** "it", never "I": *it guessed this · 62%*, *still guessing ·
  4 more picks and it fits*.
- **Its limits as facts:** *too few to price*, *no guess for this sound yet*.
- **How sure it is**, in words beside any percentage, from one scale: *a hunch
  · leaning · fairly sure*. A bare "93%" is never shown alone.
- **A guess looks like a guess:** dashed or hollow, never drawn more certain
  than it is.

### Narration

The films' spoken voice, with its own section below: [The spoken voice](#the-spoken-voice-the-films).

### Technical: the reference

For the curious and for contributors: how it works and why, in enough detail
to disagree with.

- **Third person and present tense.** "The model reweights its draws after each
  pick." Never "we".
- **Define a term at first use,** then use only that term.
- **Write math in notation with words around it:** say what a symbol means
  before the equation uses it.
- **Quote constants by name, with their value and where they live:**
  "`refine_seeds` (10, in `engine.rs`)". When a default changes, grep for its
  name.
- **State uncertainty and limits plainly**, and link the design decision that
  chose them.
- **Longer sentences and paragraphs are fine**, but never decoration: each
  paragraph makes one point.

### Marketing: the landing page and the launch film

The plain register at its most concise.

- **The hero is the line.** The tagline is the heading, the descriptor is its
  lede, and the call to action is a verb: "Play it in your browser".
- **Sound first.** Let a section play before it explains itself.
- **Each section is a pair: what you do, then what it does.** "Pick between two
  sounds. It learns which way your taste leans."
- **No feature lists of adjectives,** no comparisons with other products, no
  "AI", no "generate".
- **No claim the app can't show on the same page:** a film, a figure, a
  screenshot, or a sound.

## The spoken voice: the films

Everything above holds in the films. Speech adds its own rules, because the ear
can't go back and reread.

### The narrator

The narrator is a calm voice beside you at the instrument, talking to one
person. It is not a presenter addressing an audience, a teacher filling the
silence, or a friend selling the excitement. It says the least that lets you
hear the most.

- **Never** "Hey everyone", "In this video", "Let's dive in", "Without further
  ado", "Make sure to", "Don't forget to", "Thanks for watching".
- **No "we" and no "let's".** The narrator doesn't play along with you. It
  tells you what to try, and the instrument does the rest.
- **The voice** is Kokoro `af_heart` at speed 0.81: unhurried, warm, American.
  "Auracle" is said like "oracle". Every pronunciation the voice needs lives
  in `www/video/films/lexicon.json`. Check a new name there before it is
  spoken.

### Writing for the ear

- **Hear every line before it ships.** Render it and listen. The ASR gate checks
  that every line is recognized, but not that it sounds right.
- **One breath a sentence:** 16 words at most, and usually fewer.
- **Subject first, new idea last.** The voice lands at the end of a sentence,
  so that's where the point goes.
- **Nothing the ear can't see:** no parentheses, no asides, no semicolons, no
  nested clauses.
- **Contractions, as people speak:** you'll, it's, that's.
- **Three items at most in a list,** and say "two things" before a pair.
- **Spell everything for the voice:**
  - numbers and units: "forty-two", "minus six decibels";
  - keys: "Command K";
  - abbreviations as the lexicon says them.
- **Avoid lines that sound wrong:**
  - a homophone at the key moment;
  - a run of s sounds the de-esser will dull;
  - a word the voice stresses in the wrong place.

  Render and listen, and rewrite rather than fight the voice.
- **Point the ear with an imperative, not a question.** "Listen to the top."
  works better than "Can you hear the top?". Use at most one question a film,
  and only one the next sound answers.

### Silence and music

- **Silence is part of the script.** Write it in:
  - the pause before every demo, about 0.7 seconds;
  - the pause after it, about 0.8 seconds once its tail has rung out;
  - a breath after each new idea;
  - each chapter's few seconds without words.
- **Explain, pause, demo, continue:**
  - the voice says what you're about to hear and why;
  - the demo answers it, with the instrument over the bed and no voice;
  - then the voice names what you heard, or moves on.

  Voice and instrument never overlap.
- **A demo never cuts off.** Its last notes ring out into their own room.
  Then the bed carries a pause of about 0.8 seconds, and only then does the
  voice continue. The voice never starts over a sound's tail.
- **The bed sits under the voice,** soft and in F. Its melody lives between
  lines, never across them. The film sound's specification sets the levels
  (RFC-007, to be written).
- **The first words come after the cold open's sound** has had its moment.

### The shape of a film

1. **The cold open:** 10 to 15 seconds of the film's most musical moment, in
   the app's own sound, with no words.
2. **The entrance mark** with the title. The first line comes about two
   seconds after the mark ends, and says what you'll be able to do by the end,
   not "This is…".
3. **Each chapter:**
   - a figure;
   - the voice explains;
   - a pause, the demo, its tail, and a pause;
   - the voice continues;
   - a few seconds without words.
4. **The ending:** one thing to try, then the exit mark about two seconds after
   the last word, with the lockup. The motif plays only as the two marks, never
   in the bed, so it's heard where it's placed and nowhere else.

### Spoken, before and after

| Before | After | Why |
| --- | --- | --- |
| "This is EVOLVE, where new sounds grow from your taste." | After the cold open: "EVOLVE grows new sounds from the ones you pick." | Open on what it does, not "This is" |
| "It plays you two patches. You pick the one you like better." | "It plays you two sounds. Pick the one you'd reach for." | Sound, not patch; "reach for" is the line's own phrase |
| "Every duel is two sounds, A and B." | "Every pair is two sounds, A and B." | The word table |
| "Ride Bright up and the top opens", with the demo under the voice | "Ride BRIGHT up." Pause. The demo plays. "The top opened: more of it comes through." | Explain, pause, demo, continue |
| "Every synthesizer has a sound in it that's yours." | Keep it | Concrete, warm, and true |
| "Not samples. Real modular circuits, built and wired from scratch." | Keep it | It says what it does, in two beats |

## Words

### Sound, patch, preset

- **A sound** is what you hear, pick, save and breed. Every player-facing
  surface says sound: a bank row is a sound, and the header holds the sound
  you're playing.
- **A patch** is how a sound is built: its modules, knobs and cables. Say patch
  when you mean the build. That means the PATCH view, editing, the reference,
  and files ("open a patch file").
- **A preset** is a sound from the library, made by hand.

"Open the sound in PATCH to see its patch" is correct.

### The word table

This restates and extends RFC-003's table
([ADR-009](../../docs/decisions/009-one-instrument-contracts.md)). The
banned-words check in `make dev-check` reads the list after it.

| Say | Means | Not |
| --- | --- | --- |
| **pick** | Any choice between two sounds: an EVOLVE pair, PERFORM's TAKE or a pass, the warm start, and keep as new | vote, choose, preference, "keep the one" |
| **pair** | The two sounds you pick between | duel (outside the reference) |
| **fair-test picks** | Pairs dealt at random, the ones LEARNING's forecasts are graded on | check duels, check picks |
| **TAUGHT n** | The counter: everything it learned from (picks, stars, cuts) | PICKS for a count that includes stars |
| **save / saved** | Kept safe from replacement, on the Saved shelf | "saved" for a download |
| **download / open** | Files | save, export, load for files |
| **keep** | PERFORM's Keep, in the moved bar (↵), only | every other keep |
| **moved · KEEP · BACK** | PERFORM's head, shown exactly when the sound has left home (a control turned, a drift not kept, a glide) | changed, dirty, edited |
| **keep as new** | PATCH: the edit joins the pool as a new sound, and the original stays | commit |
| **pick the edit** | KEEP AS NEW's one-time shortcut: keep the edit as new without the comparison, telling the model you'd pick it | my edit is better |
| **bank** | The rail and its tabs: Pool, Saved, Presets | "IN BANK", "the node bank" |
| **pool** | The sounds the model weighs and breeds from | evolution (for the tab) |
| **generation** | One round of breeding: EVOLVE POOL, or ⚡ evolve from this, which the engine counts as a generation of its own; "gen 3" only in a tight label | round, cycle |
| **breed / bred** | What a generation does: grows new sounds from seeds | generate, create, crossover (there is none) |
| **seed** | The sound a child grew from. A random number generator's seed is always "random seed" | parent (outside the reference) |
| **child**, **New** | A bred sound; the bank's group of the latest generation's children | offspring |
| **replaced** | What happens to the pool's lowest-rated unsaved sounds when a generation ends | retired, evicted, made room, gone |
| **offer** | PERFORM's pad, and the variant it grows into B | suggestion |
| **ideas** | Wander's middle zone | "offer" as a zone name |
| **the sound you're playing** | In help and tooltips; toasts name it | bench, workbench, current patch, #ids |
| **another pair** | Deal a new pair without picking | skip, in a pair |
| **PASS** | PERFORM's pad: pass on the offer in B without growing another; heard, a pick for what you had, with UNDO | skip, reject, discard |
| **first steps** | Each level's first-visit steps, one at a time in a pill bottom left (PERFORM's: play, turn, offer, zoom out to TASTE, the model view; PATCH's: play it, a knob, a lock, ⚡); its × is *Stop showing these*, for that level's | guide (that is the site), tutorial, tips, coach (that is the keybed's) |
| *Press ⌥↑ to zoom out to TASTE, the sound among all sounds* / *Pinch to zoom out to TASTE, …* | PERFORM's fourth first step; the line is TASTE's own from `#where` | scroll out, go up, zoom to the map |
| *Hold ⌥ to see what the model believes* / *Hold MODEL to see …* | PERFORM's fifth first step, ticked as the view comes up | what the model thinks, lens |
| **▶ PLAY** | An EVOLVE card's button: its phrase | SAMPLE, audition |
| **↓ patch** | An EVOLVE card's corner: open its sound in PATCH without picking | open in patch, promote |
| **⇄ face** | An EVOLVE card's corner, flipped to its circuit: back to its face | wave |
| **Velocity plays**, **vel** | ARRANGE's row for which control a note's velocity drives, and the tick on that control | TOUCH, velo |
| **share** | PERFORM's button by the name: the sound's card as a picture | export, send |
| **what each generation did** | EVOLVE's disclosure under EVOLVE POOL, opening the lineage's spark and log | history, log (as a label) |
| **frozen** | Wander's state while a tap (or Enter) holds it still: its ring lit, this word under it and as its value | paused (that is hands on), held, stopped |
| **Nothing to keep: this sound is home.** / **Nothing to go back to: this sound is home.** | ↵ or ⇧⌫ pressed with the sound at home: the refusal, said at once | No changes, Already saved |
| **Nothing to pair. Fewer than two sounds are left to deal.** | EVOLVE's cards when the engine has no pair to deal, every other sound in the pool cut: the refusal, said at once on both cards, with their buttons off | |
| **Couldn’t deal a pair. ANOTHER PAIR tries again.** | EVOLVE's cards when the engine could not deal the pair the table waits on: said at once on both cards, with the pair's buttons off and ANOTHER PAIR (N) live, which deals again | |
| **B · ‹aim›** (B · GRITTIER) | B's label for an offer a control asked for: B and the aim word of the way it was turned | B (grittier), target |
| **offered · hold B to peek** / **hold Peek to hear it** (touch) | B's line under its face: it is an offer, and how to hear it | press and hold, preview |
| **depth** | ARRANGE's slider beside Velocity plays: how far velocity reaches | amount, intensity, sensitivity |
| **CONTROLS** | PERFORM's cap over the controls, with ARRANGE and HOW IT WORKS | knobs, macros, deck |
| **Share this sound as a picture** | The share button's accessible name | export image, save image |
| **or** | The word between EVOLVE's two cards, a silk label | vs, versus |
| **listening…** | PERFORM measuring a sound's controls | measuring… (that is a figure's) |
| **measuring…** | Renders on their way for an answer or the lesson: a figure, or the lesson's shape, while the engine renders and measures the sound in hand | listening… (that is PERFORM's), loading… |
| **rating…** | The model rating an edited sound again, on the guess above the rack | re-measuring…, listening… (that is PERFORM's) |
| **style** | One cluster of your taste, named for its pull ("like Warm Wash") | lens, "1st style" |
| **the model view** | What holding ⌥ or MODEL shows: what the model believes over the level you're at (the bank's guesses and order, TASTE's halos, EVOLVE's guess before a pick) | lens |
| **MODEL** | The menu bar's pill for the model view: held (or ⌥ held) it shows while held; a tap keeps the view up, across a reload; Esc ends it once nothing nearer is open. Its light is lit while the view is up | LENS, the model button |
| **Find a sound** | The bank's search field: it keeps the sounds whose name, family or description has what you type; Esc clears it | search, filter, Search sounds |
| **IN THE POOL**, **RANKED BY THE MODEL** | POOL's heading for the sounds below New: at rest in the order they joined it; under the model view, once it has fitted, in the order it rates them | the rest |
| *it guesses this · 62% · leaning* | Under the model view, EVOLVE's guess before you pick, on the card it favours; *it guessed this* is the line after |  |
| *still guessing · 4 more picks and it fits* | The model view's tag before the first fit; after it, *what it believes, from 18 picks* |  |
| **face** | A sound's drawn shape | vessel (outside design notes) |
| **card** | The picture of a sound you download to share: its face, its name and where it came from | poster, thumbnail, share image |
| **module** | One part of a patch (a VCO, a filter) | node, plate (outside the reference) |
| **AUDIO IN** | The module that brings your own signal into a patch | mic node, input node |
| **input** | A microphone or an interface the browser offers, numbered from 1 on AUDIO IN | device (except the browser’s own names) |
| **monitor**, MONITOR | Hearing your input through the sound, at the speakers | listen (that is PERFORM’s *listening…*) |
| **clip** | The seconds of your input the model hears a sound with AUDIO IN through | sample; *recording* or *take* for the clip (a take is CAPTURE’s) |
| **take**, RECORD | A CAPTURE’s recorded audio: RECORD makes a new take, and the module shows its length. PERFORM’s **TAKE** pad is the verb (take the offer), always its name in capitals | recording (for the take itself), sample, loop |
| **kept safe** | A sound whose take couldn’t be read, out of the pool until RECORD AGAIN makes a new take | held, HELD, quarantined |
| **the catalog**, ADD MODULE, ADD A MODULE | The list of modules PATCH opens over the left of its well, the ones you add from | the module rail, MODULES, the node bank, catalogue, palette (that is PERFORM's) |
| **N changes** | The edit bar's count: the undo steps since the sound was opened | N edits, unsaved changes |
| **undo to as opened** | ↺: every change since opening taken back at once | revert, reset, discard |
| **as opened** | A knob's or the sound's state when it was opened (the pale tick; the bar at zero) | original, before, previous |
| **HOW TO READ THIS** | The well's legend | help, legend, key |
| **the face at OUT** | The bench's face past the amp, measured; a click plays the sound | preview, thumbnail |
| **the well** | PATCH's canvas, the rounded frame the patch sits in | canvas, stage, board |
| **fit · − · + · map · layout ▾** | The camera corner's words | zoom to fit, overview |
| **by hand** | The layout you arrange yourself | freeform, manual, custom |
| **detail: automatic / full / compact** | How much of each module is drawn | LOD, zoom level |
| **TEACH ▸**, **TEACH · N PICKS ▸** | The folded quick picks at the well's foot, counting to the first refit | train, rate, vote |
| **SET ASIDE n** | The chip for modules unplugged or deleted, waiting to go back; it opens the shelf | tray, HELD, trash |
| **leans** | The lean edges: amber or red plate edges by family under the model view (⌥ / MODEL); stronger when surer; in PERFORM, a control's lean: an amber arc from 12 o'clock toward the end your taste leans to, its interval behind it, dashed while it is a guess | belief, belief tint |
| *it leans brighter* / *it leans brighter?* | Under the model view, the line under a PERFORM control in place of its caption, and its aria-description: it names the way your taste leans with the palette's comparative (*softer*, *more restless*), and a **?** while it is a guess | it leans bright (the control's end word) |
| **knob** | One setting of one module | parameter (outside the reference), dial |
| **control** | A named control on PERFORM (BRIGHT, MOTION), or the WANDER control | dial, macro |
| **figure**, **answer** | What ? on a control opens: its **answer** (BRIGHT · WHAT IT DOES), a **figure** of what the engine measured and a sentence; the guide's words, the app shows the title | tooltip, popover, explanation, help |
| **lesson** | A short walk through one idea on the sound in hand, opened from an answer: **LEARN: WHAT A FILTER DOES** | tutorial, course, guide (that is the site) |
| **cutoff** | Where a filter starts cutting, in the knob's own unit: *cutoff 3.7 kHz* | corner frequency, fc, passband edge |
| **lowpass** | A filter that keeps the lows and cuts the highs; one word | low-pass, LPF |
| **the palette** | The set of controls you place on PERFORM | "module palette" (say "the 45 modules") |
| **place**, **hide** | Put a control from the palette on PERFORM's panel; take it off (it stays in the palette) | add, remove, delete |
| **ROUND** | The palette's control from hard to round: a soft attack and few harmonics | Softness, soft (the low end is *hard*) |
| **THROB** | The palette's control from steady to throbbing: pulsing and tremolo | Wobble (a preset's name), Pulse (a wave shape) |
| **SWAY** | The palette's control from fixed to swaying: slow sweeps and breathing | Drift (WANDER's zone and walk), Breath (reads as AIR) |
| **HEFT** | The palette's control from slight to heavy: dense, held weight | weight (the family's name) |
| **stage mode** | ⇧F in PERFORM: the sound you're playing on the whole screen | fullscreen, performance mode |
| **set aside** | Modules unplugged or deleted, waiting to go back | HELD |
| **59% · leaning** | A prediction: a percentage and a word | MODEL'S GUESS 0.59 |
| **guess** (a module) | PATCH: the module the model guesses you'd add next, GUESS · FILTER, with its reason in the model's italic | suggestion, recommendation, TRY, NEXT |
| **What goes here?** | PATCH: a module's ⋯ row (and Q) asking the model's guess for that module's place: after it, on its modulation slot, or in it if the socket is empty | suggest here, recommend |
| **AFTER THE MIX** / **ON THE FILTER'S CUTOFF** / **IN THE EMPTY SOCKET** | Where a guess asked for a place goes, on the well's top line after GUESS · DELAY | |
| *hearing the modules that fit at the mix…* | The well's top line while a What goes here? is ranked | thinking, loading |
| **lower bound +0.03** | A runner-up guess's ranking figure under the model view: its gain's mean less one sd | at least, worst case |
| **Runner-up guess** | The name of a runner-up chip under the model view: the guess ranked after the one drawn | alternative, other suggestion |
| **Back to the output's guess · Esc** | The ✕ ending the line of a guess asked for a place (and its label for a screen reader): the guess goes back to the output | cancel, close |
| **Worth per kind** | The worth chip's name (its tooltip) | price, value |
| *no settled lean on anything in this patch yet* | The model view's note in PATCH when no family's lean is settled | no data, nothing to show |
| *it’d like this 62% · leaning · was 58% ▲* | Under the model view, PATCH's subtitle in place of its counts: the model's guess for the sound in hand, what it said before the last edit, and the arrow when the printed number moved | MODEL'S GUESS |
| **THE PATCH** | PATCH's readout under the model view with nothing selected, then what adds up to the belief line | |
| **filtering +0.12 · shared by 2** (the worth chip) | Under the model view, a chip per kind of module in PATCH: what one more of that kind is worth to the model, shared by the modules of that kind; *a guess* when its interval crosses zero | the worth of this module, a per-socket price |
| **from ‹Seed› · N changes** | PATCH's subtitle on a bred sound as it was bred; N counted as its bank row lists the changes | parent, mutations, diffs |
| *silent without it* / *without it, it fails the safety check* / **Dashed at OUT: without the selected module, measured** | PATCH: the readout's words when the patch without the selected module has no face to draw, and HOW TO READ THIS's row for the face it does draw | approximate, estimated |
| **BRIGHT and SPACE turn this cutoff** / **BRIGHT turns its cutoff and res; SPACE turns its decay** | PATCH's readout: which of PERFORM's controls turn a knob, or a module's knobs, as PERFORM measured them | mapped to, assigned to |
| **Hold ⌥: what the model believes (your lean on each kind, what one more is worth, its next guesses)** / **A tick on a module: the generation that bred this sound changed it** / **A pale tick on a knob: where it was when you opened the sound; on a bred sound as bred, where its seed had it** | HOW TO READ THIS's rows for the model view, what a generation changed, and the pale pointer | |
| **couldn’t measure this patch** / **couldn’t re-check this patch** | PERFORM's status line when the engine failed a measurement of the sound in hand, or wasn't ready to take one, and none is out now: *measure* when there is no wiring to play, *re-check* (after the count, *4 of 6 controls reach this patch · …*) when the controls still play on their last measurement | measurement failed, error, unavailable |
| **the engine crashed: reload to continue** | B's line, or a control's toast after *nothing changed.*, for something asked of PERFORM after the engine crashed; the alarm's own words | try again (it can't), engine unavailable |
| **your taste**, **the model** | What it has learned; the thing that learns it | posterior, belief, profile (outside the reference) |
| **LEARNING** | The level above TASTE, the model room | the model page |
| **the levels** | PERFORM, PATCH, EVOLVE, TASTE and LEARNING as one space around the sound you're playing: zoom out to TASTE and LEARNING, in to PATCH, beside it to EVOLVE; and the cross at the stage's right edge that shows where you are (its name to a screen reader: *Where you are*) | tabs, pages, "the rail" (that is the bank's), the depth rail |
| **the levels nod** | ⌥↑ at LEARNING, ⌥↓ at PATCH, a turn or a pinch past the end: the cross nods and no level moves | bounce, shake |
| **a light along the levels** | The light that travels the stops from the level you left to the one you reach while a move plays | puck, indicator, dot |
| **spread**, **pinch** | Two fingers on a touch screen moving apart, and together | pinch in / pinch out, pinch-zoom |
| **the face flies**, **fades** | A move between the levels, or a sound opened from the bank, carrying its face to where the next level draws it; where a level doesn't, it fades, and with no face to carry one level fades into the next | morph, transition, zoom animation, cross-fade |
| **KEYS ⋯** | The keys bar's settings: HOLD, UNI, ARP, SYNC, glide, the keybed's height and span, and silence | settings, options, the dock's drawer |
| **Find or do anything** | The menu bar's button, and the list's name: ⌘K opens one list of what the instrument can do and every sound it holds | search, command palette, quick actions, spotlight |
| **Find a sound, a level or what to do** | The list's field: type part of a sound's name, a level, or what you want done (*octave*, *download*) | Search, Search sounds, Type a command |
| **This level**, **Anywhere**, **Sounds** | ⌘K's three groups, in that order: what the level you're at does, what works at every level, then the sounds (the pool, then the presets), each with its face | Current view, Global, Results, Library |
| **choose**, **do it**, **close** | The list's foot, beside ↑ ↓, ↵ and esc | select, run, execute, dismiss |
| **Keys and gestures** | The ⌘K command that opens the guide's keyboard page, where the ? card's key map went | Keyboard map, shortcuts, hotkeys, help card |
| **What does BRIGHT do?** | ⌘K's way to explain's answer for a control, here BRIGHT; it prints no key, since ? asks only over the control and elsewhere opens the list | Explain BRIGHT, Help with BRIGHT |
| **What are the three banks?** | ⌘K's command for the bank's walkthrough, the one the bank's ? starts | Bank tour, Explain the banks |
| **Record again: ‹name›** | ⌘K's command for a kept-safe sound: RECORD AGAIN makes it a new take | Re-record, Retake, Redo take |
| **Undo an edit**, **Redo an edit** | PATCH's commands in ⌘K: the last edit taken back, and brought back; *Undo to as opened* takes back every edit at once | Undo, Step back, Revert one |
| **Take back your last pick or cut** | Anywhere's ⌘Z in ⌘K: the pick or cut taken back within its seven seconds; with **Play the sound in hand** (Space), **Save the sound you’re on** (M) and **Cut the sound you’re on** | Undo last action, Play/pause, Bookmark, Delete |
| **Press a key to hear it. ⌘K lists what you can do, with its keys.** | The toast after skipping the warm start: the keybed plays, and ⌘K is where the rest is found | Tip, Hint, Did you know |
| **One space** | The guide page that says how PERFORM, PATCH, EVOLVE, TASTE and LEARNING fit together, how to move between them, the model view and ⌘K | Navigation, Views overview, Modes |
| **Watch ‹LEVEL› in depth** | The film of the level you're at, opened in the guide, only once the film is published; the film chip's words as a ⌘K label | Tutorial, Learn ‹LEVEL›, Watch the tour |

### The view names

The view names are PERFORM, PATCH, EVOLVE, TASTE and LEARNING:
- always in capitals, in prose too;
- never PLAY.

A subtitle follows a colon in prose: "PERFORM: the sound, under your hands".
In the header the level's name stands in capitals and its line beside it in
small type (`#where`, from `apps/web/levels.js`), and moving between them is
moving between *the levels* (the word table).

### Never in player-facing copy

The check reads this list. Each line is a word or phrase, the surfaces it
applies to (`player` = the app, the landing page, the guide, and the films;
`all` adds the reference, the README, and the changelog), and what to say
instead.

```banned
AI | all | the model, or say what it does
artificial intelligence | all | the model
generate | player | breed, grow, offer
generative | player | (say what it does)
magic | all | (say what it does)
revolutionary | all | (say what it does)
seamless | all | (say what it does)
effortless | all | (say what it does)
powerful | all | (say what it does)
amazing | all | (say what it does)
stunning | all | (say what it does)
cutting-edge | all | (say what it does)
next-generation | all | (say what it does)
unleash | all | (say what it does)
game-changing | all | (say what it does)
vote | player | pick
preference | player | pick, your taste
commit | player | keep as new
evict | player | replace
retired | player | replaced
made room | player | replaced
bench | player | the sound you're playing
workbench | player | the sound you're playing
lens | player | style, the model view
HELD | player | set aside
MODEL'S GUESS | player | 59% · leaning
posterior | player | your taste, the model
duel | player | pair, pick
plate | player | module
```

## Mechanics

### Spelling

The spelling is **American**: color, center, toward, math, catalog, dialog,
analyze, normalize, gray, license, modeling, canceled. "Synthesizer" is spelled
with a z. Quoted names keep their own spelling.

The check counts the British spellings listed in `BRITISH` in `www/checkwords.py`.

### Punctuation

- **No em dashes, anywhere.** Use a colon to introduce or explain, a comma for
  a pause, a period for a new idea, or parentheses for an aside. Headings
  take a colon: "Fixed: a ▶ pressed mid-edit plays the edit".
- **En dashes** join ranges only, with no spaces: 150–170, C0–C8, 2026–2027.
- **The serial comma**, always: "picks, stars, and cuts".
- **Curly quotes and apostrophes** in prose and the UI ("it’s", “Glass Pad”).
  Use straight ones only in code.
- **The ellipsis** is one character (…). Use it only for something in progress
  ("listening…") and for a menu item that opens a dialog ("Open…"). Never use
  it for a sentence that trails off.
- **The middle dot ( · )** separates items in a label, a status line, or a
  tooltip, never in prose.
- **No exclamation marks.** No emoji in copy or headings, the README included.
- **A list item** ends with a period only if it is a sentence. Keep the items
  of one list parallel.

### Case

- **Headings, titles, toasts, tooltips and menu items** use sentence case.
- **Silk labels and view names** are in capitals.
- **The brand name** is "Auracle" in prose and AURACLE only in the logotype.
- **A sound's name** is as given, with no quotation marks: Glass Pad, Bell Jar.

### Numbers and units

- **The app** uses digits. **Prose** spells out one to nine, except with a unit,
  as a percentage, or beside larger numbers in the same sentence. **Narration**
  says every number as spoken words.
- **Units:**
  - a space before the unit: 440 Hz, 1.2 kHz, −6 dB, 2.5 s, 66 BPM;
  - no space before %: 59%.
- **Signs and separators:**
  - a true minus sign (−) in the UI and docs; a hyphen only in code;
  - a comma in thousands: 1,131.
- **A knob's value is shown in its own unit,** never as a fraction of its
  range: "cutoff 1.2 kHz → 3.4 kHz", not "0.41 → 0.62".
- **Prediction, uncertainty, and the numbers a surface may quote** follow
  ADR-004:

  | Surface | May quote |
  | --- | --- |
  | Films and the landing page | Only what a seed or an engine change cannot move, such as the number of modules, and only through a check that ties it to its source |
  | The guide | What the app shows |
  | The reference | Constants, by name, with where they live |

  A count that appears on several surfaces comes from one source, named in the
  reference.

### Keys and gestures

- **In text, write keys** as `<kbd>` with the Mac symbol: ⌘K, ⌥, ⇧F, Space,
  Enter. The guide gives the other platforms' keys once per page, at first use:
  "⌘K (Ctrl K)". The app shows the platform's own.
- **In narration, say them as words:** "Command K", "hold Option", "press Shift
  and F".
- **Name gestures plainly:** tap, hold, swipe up, pinch.
- **Nothing a player needs lives only in a tooltip.** Touch and keyboard can't
  reach one.

### Headings, links and code

- **Headings:**
  - sentence case;
  - no period;
  - a colon for a subtitle;
  - one H1 a page.
- **Links** name where they go: "the PATCH guide", never "click here".
- **Backticks are for code:**
  - code names, file paths, commands, and constants;
  - never for UI labels, which are in capitals.

## Surface by surface

### The app

- **The panel speaks silk.** Toasts, status lines and empty states speak plain,
  and the model speaks only for itself.
- **One teaching surface at a time.** No placeholder rows.
- **Explanation lives in figures, the ? key, and the guide.** The ? on a
  desktop, or a long press on a phone, opens a figure.
- **A toast:**
  - at most two sentences;
  - sentence case;
  - the sound's name;
  - what happened, then what you can do.

  A later toast about the same thing replaces the earlier one, unless the
  earlier one says what happened to your sounds: that one still has its
  turn. A refusal jumps the queue and says why.

### The landing page

- **The hero** is the line: the tagline as the heading, the descriptor as the
  lede, and one verb as the call to action.
- **Sections** each open with a sound, a film or a figure, then one or two
  sentences in the what-you-do, what-it-does pattern.
- **The fine print** states facts: free, no account, nothing to install, your
  sounds and your taste stay in your browser.

### The launch film

- **It opens on sound,** the film's most musical moment, before a word is
  spoken.
- **It shows the loop once:**
  - play;
  - pick;
  - it learns;
  - a generation grows closer.
- **It ends on the lockup** and the sound mark.
- **Length:** under 100 seconds.

[The spoken voice](#the-spoken-voice-the-films) holds the rest.

### View films and illustrated films

They are one form (RFC-004 part 7), with the shape set in [the shape of a
film](#the-shape-of-a-film). The bed, the demo's key and register, and the
levels follow the film sound's specification (RFC-007, to be written).
`VIEWS.md` holds each film's outline.

### The guide

- **Each part is layered:** what it does first, then "How it works" for the
  mechanism, then a link to the reference for the math.
- **Each page opens with what it is for,** in one or two sentences. Then come:
  - how to do it, as numbered steps in the imperative ("Press EVOLVE POOL.");
  - what you see, with each part named in capitals as the panel shows it;
  - what to try next.
- **Paragraphs:** four sentences at most, about 18 words a sentence.
- **A how-to is a task,** not a tour.
- **The guide links to the reference** for how and why. It doesn't repeat it.

### The reference

- **It opens with its promise:** "What Auracle computes, in enough detail to
  disagree with."
- **The technical register** throughout.
- **Every page states what is not done** where a reader might assume it is (for
  example, "there is no crossover").

### README

The order:
1. The lockup.
2. The long line.
3. How to run it, in three commands or fewer.
4. Where to read more (the guide, the reference, `docs/`).

It has no badges wall and no Title Case headings.

### CHANGELOG

The `[Unreleased]` section becomes the release notes verbatim, so write it for
a player.

- **Each entry** opens with a bold sentence saying what is true now, then one
  or two sentences on what was wrong before.
- **Tense:** present for the fix, past for the bug.
- **Section headings** take a colon: "### Fixed: PATCH".

## Before and after

Lines from the app and the site, rewritten to this guide.

| Before | After | Why |
| --- | --- | --- |
| Pick the sound you like better. (landing h1) | A synthesizer that grows toward you | The line, everywhere |
| Auracle — a synthesizer that learns what you like (`og:title`) | Auracle: a synthesizer that grows toward you | The line; no em dash |
| Play both. Keep the one you’d reach for. | Play both. Pick the one you'd reach for. | "keep" is PERFORM's pad |
| MODEL'S GUESS 0.59 | 59% · leaning | A prediction is a percentage and a word |
| Saved Glass Pad — it won't be replaced | Saved Glass Pad. No generation will replace it. | No em dash; say what replaces |
| edit rejected: … | Sentence case, the sound's name, and why | Toasts are sentences |
| That patch isn't in the bank any more | Glass Pad was replaced by generation 4. | Name the sound and what happened |
| Auracle plays you two patches, learns which one you preferred, and starts making more of it. | Pick the sound you'd reach for. It learns your ear, and every generation grows a little closer. | The descriptor; "sound", not "patch"; no "preferred" |
| every crossover (guide introduction) | (removed) | There is no crossover |
| the colour of the noise | the color of the noise | American spelling |

## How this is kept

- **The check:** `make dev-check` and CI run `www/checkwords.py` (Plan-003
  task 1). It reads the `banned` block above each time it runs, so this guide
  stays the one list. It counts three things: the banned words, em dashes,
  and British spellings. It reads each surface the block names, with the
  figures and the films' on-screen text, and the script lists the files. It
  reads only what a reader sees or hears. In a page or the docs, that is the
  text and the attributes shown; in a script or Rust source, it is the
  strings, never the comments or the code around them.
- **The engine's words:** some of the app's words are written in the Rust
  engine: preset names and descriptions, the rack's labels, PERFORM's
  controls, the bank's sound names, and the reasons an edit is refused. The
  check reads every string in the files they come from, as the app's own,
  except what builds only for tests.
- **Names:** in a script or Rust source, the comment `// voice: name` marks
  its line as names (or a code, or a key), not copy: the check skips each
  string that starts on that line. A string that runs over several lines
  can't carry the mark, because its first line ends inside it.
- **Quotes:** in Markdown, someone else's words (a standard's title, a label
  the app used to show) sit between `<!-- voice: quote -->` and
  `<!-- /voice -->`. They keep their own spelling, and the check skips them.
- **The ratchet:** the copy is older than this guide, so the check holds it
  to a floor, not a wall. `www/brand/voice-baseline.json` holds each file's
  count for each rule. The check fails when a count rises, or when a new file
  has any hit. It also fails when a count falls and the floor stays where it
  was: a sweep lowers the floor in the same change, with
  `python3 www/checkwords.py --update`. The floor only moves down. Raising a
  count takes `--allow-rise`.
- **The sweeps:** `python3 www/checkwords.py --summary` gives each surface's
  count, rule by rule, so a sweep can show its drop. `--where FILE` lists
  every hit in one file.
- **The pointers:** the `AGENTS.md` files, the docs-writer and film-producer
  agents, the changelog skill, `VIEWS.md`, and `SCRIPTS.md` point here and
  don't restate these rules.
- **Changes:** a new word gets a row in the table before it ships. A new
  surface gets a row in "Who each surface speaks to". The engine's words have
  none of their own: players read them in the app, so the app's row covers
  them.
- **Approval:** the maintainer approves changes to this guide.
