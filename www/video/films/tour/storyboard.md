# A tour of Auracle — storyboard

The map before the four views' deep dives: where everything is and roughly
what it does, for someone opening the instrument for the first time. About
two and a quarter minutes, over the real instrument: one recorded shot per
beat (`shots.json` → `tools/footage.mjs`), framed by `stage/walk.js` (camera,
callouts, chapter label, captions), with a title card and an end card drawn
with the kit (`cards.js`). Eight beats, six chapters, 283 words at speed 0.9.

**Sound.** Every region is shown in use, so the app is the music under almost
all of it: the bed (`study`, 84 BPM) is out (`bed_db` −60) whenever the
instrument plays, and up under the orientation beats where nothing plays —
the title, *up top* and the outro (loop_b there).

**One session, the one a newcomer has.** Every shot is the same seeded
session with the three-pick warm start answered: the first bass, pad and
texture card on the grid. The first-visit beat does exactly that on camera,
so the film's world is what someone sees after picking three: PICKS reads
18, My patches holds those three, TASTE has a first map.

**Keys.** `a` = C4. Chords: **C** `a d g` · **Am** `h k ;` · **F** `f h k` ·
**G** `g j l`.

**Camera.** Each chapter opens wide (1.0), then aims (1.3–1.8×) at the region
named, and holds still while a callout is up.

The view one-liners match the deep dives' titles: PERFORM, *playing the
sound*; PATCH, *inside the sound*; EVOLVE, *breeding sounds you like*; TASTE,
*what it learned about you*.

---

## 0. `open` — the cold open (no words; shot `to-open`)

*What does it sound like?* Five bars at 84, wide, on Glass Pad in PERFORM:
**C** with Bright swelling up; **Am** as Blend crosses into the offer waiting
in B; **F** on the offer; **G**, and **Take**; **C** on the sound just taken.
One chord a bar, on the score's bar lines. The offer is grown in set-up
(turning Bright first would leave a spare offer behind).

- Camera: 1.0, a slow push to 1.05 toward the deck.
- Bed: out.

## 1. `title` — the title card, then the map (shot `to-map`)

> This is Auracle, a synthesizer that learns what you like. Here's a quick
> map: where everything is, and what it's for.

- The lockup draws itself over the instrument (kit: mark, wordmark, *a tour of
  the instrument*), on the bed's first bar (loop_a).
- On *map* it lifts away, and four callouts land on the real screen:
  *four views* (the tabs), *the bank*, *the dock*, *up top*.

## 2. `views` — 01 · the four views (shot `to-views`)

*Where do I play it, look inside it, teach it, and see what it learned?*

> Across the top are four views. PERFORM is where you play the sound. PATCH
> takes you inside it, to every module, cable and knob. EVOLVE plays you two
> sounds. Pick the one you like, and it breeds more like it. TASTE shows what
> it learned about you.

- *views1*: aim 1.7 at the tabs, callout *four views*; back to wide.
- PERFORM (Glass Pad): C, then Am with Bright ridden up.
- PATCH: F held while the filter's cutoff turns on the rack.
- EVOLVE: ▶ A, ▶ B, choose B; the next pair slides in (the pair was
  rendered in set-up, so ▶ sounds at once).
- TASTE: the map.
- A callout under each tab as it is named, with its deep dive's title.

## 3. `bank` — 02 · the bank (shot `to-bank`, in PATCH)

*Where are my sounds, and how do I try one?*

> On the left is the bank, where your sounds live. Presets came with the
> instrument. Evolution is the pool it breeds from, each with a guess at how
> much you'll like it. My patches holds the ones you save. Press play to hear
> one. Click it, and it's yours to play.

- Am · F · C · G on Glass Pad under the first four lines, one per line.
- The three lists clicked in turn; callout *its guess* on a row's percentage.
- ▶ on the first of My patches (the standard phrase); space stops it as the
  row is clicked, which opens it in PATCH; a short line on it.
- Camera: aim 1.7 at the rail; out to 1.15 on the rack when the row opens.

## 4. `dock` — 03 · the dock (shot `to-dock`, Acid Line at 84)

*How do I play it?*

> Along the bottom is the dock, the same in every view. Play the keys on
> screen, your computer keys, or a MIDI keyboard. Hold latches a chord, and
> the arpeggiator plays it in time. On the right, glide slides each note into
> the next. Record saves what you play, next to MIDI and the volume.

- Three ways in: two screen keys, a run on the computer keys, a MIDI figure
  through the `?film` port (the keys light).
- HOLD, Am latched, ARP (up·down, 84): the latched chord becomes the
  arpeggio, which runs to the end of the beat.
- Glide dragged up under the running arpeggio.
- ● rec pressed on camera, then pressed again: a real take and its toast.
- Camera: 1.3 on the keybed; 1.7 on the left (hold, arp); 1.7 on the right
  (glide, rec, MIDI, volume). One callout at a time.

## 5. `header` — 04 · up top (shot `to-header`, EVOLVE)

*What are the counters and buttons up there?*

> Up top, PICKS counts what you've taught it. GEN counts the generations it
> has bred. The question mark opens the keyboard map. The three dots hold
> your files, your taste profile, and these films.

- Nothing plays; the bed is up.
- Callouts on PICKS (18) and GEN (0) at 1.8×.
- ? opens the help card (wide), Escape closes it.
- ⋯ opens the menu; the pointer rests on *Export this patch*, *Save taste
  profile* and *Watch the films* as they are named.

## 6. `first` — 05 · your first visit (shot `to-first`, a fresh session)

*What happens the first time?*

> The first time you open it, it asks which three sounds you like. Play them,
> pick three, and press teach it. That's eighteen picks in one go, so it
> starts out pointed at you. Your three are saved, and PERFORM opens, ready to
> play.

- The nine cards; ▶ on the bass card; the first bass, pad and texture picked;
  *teach it* (callout *3 picks × 6 passed = 18*).
- A cut from the press to just before PERFORM opens (seconds of engine work).
- Callouts: *18 picks* (PICKS), *the E lights while it learns* (the lamp,
  amber), *your three* (My patches). A short bass figure on the first pick.

## 7. `next` — 06 · where next (shot `to-next`), then the end card

> To go deeper, each view has a film of its own. PERFORM: playing the sound.
> PATCH: inside the sound. EVOLVE: breeding sounds you like. TASTE: what it
> learned about you. Now open it, and play.

- Aim 1.7 at the tabs; each tab clicked as its film is named, with the film's
  title under it.
- *Now open it, and play*: the end card — lockup, `auracle.alexnodeland.com`,
  *the instrument · the guide · a film for each view* — then black.
- Bed: loop_b.
