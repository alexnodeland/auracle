# A tour of Auracle — storyboard

The map before the four views' deep dives: where everything is and roughly
what it does, for someone opening the instrument for the first time. About
2:20, over the real instrument: one recorded shot per
beat (`shots.json` → `tools/footage.mjs`), framed by `stage/walk.js` (camera,
callouts, chapter label, captions), with a title card and an end card drawn
with the kit (`cards.js`). Eight beats, six chapters, 31 lines at speed 0.9.

**Files.** `script.json` (the words) → `www/video/tools/voice.sh tour` (voice,
the ASR gate, `timeline.json` and `arrangement.json`) → `gen_shots.py` (writes
`shots.json` from the timeline) → `film.js` + `cards.js` (the picture).
`check_audio.py` measures what each rehearsed shot played; `preview_cards.mjs`
takes stills of the cards before any footage exists. `align_tails.py` sets
each beat's `tail` so it ends where the next one starts (a snapped start
would otherwise leave a blank, silent gap at a chapter turn), and re-times.

**Sound.** Every region is shown in use, so the app is the music under almost
all of it: the bed (`study`, 84 BPM) is out (`bed_db` −60) whenever the
instrument plays, and up under the orientation beats where nothing plays —
the title, *up top* and the outro (loop_b there).

**One session, the one a newcomer has.** Every shot is the same seeded
session with the three-pick warm start answered: the card on the films'
shortlist (Ceiling, in this deal), then the first bass and pad card on the
grid. The first-visit beat does exactly that on camera,
so the film's world is what someone sees after picking three: PICKS reads
18, My patches holds those three, TASTE has a first map.

**Keys.** `a` = C4. Chords: **C** `a d g` · **Am** `h k ;` · **F** `f h k` ·
**G** `g j l`.

**PERFORM on a preset.** A preset ships with its wiring: its controls work
the moment it opens, and PERFORM re-measures it in the background ("… ·
re-checking"). Every PERFORM shot waits for that re-check in set-up, so which
control swells (the first that turns up) is the same in every take.

**Camera.** Each chapter opens wide (1.0), then aims (1.3–1.8×) at the region
named, and holds still while a callout is up.

The view one-liners match the deep dives' titles: PERFORM, *playing the
sound*; PATCH, *inside the sound*; EVOLVE, *breeding sounds you like*; TASTE,
*what it learned about you*.

---

## 0. `open` — the cold open (no words; shot `to-open`)

*What does it sound like?* Five bars at 84, wide, on Slow Weather in PERFORM:
**C** with Bright swelling up; **Am** as Blend crosses into the offer waiting
in B; **F** on the offer; **G**, and **Take**; **C** on the sound just taken.
One chord a bar, on the score's bar lines. The offer is grown in set-up
(a fresh one is ~10 s of renders), so the Offer pad reads **NEXT** (*passes on
B*) until Take empties B.

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
- PERFORM (Slow Weather): C, then Am with the first control that turns up
  (Bright, when it can) ridden up.
- PATCH: F held while the filter's cutoff turns on the rack.
- EVOLVE: ▶ A, ▶ B, choose B; the next pair is up at once (dealt ahead
  while this one played; the pair on the table was rendered in set-up, so ▶
  sounds at once).
- TASTE: the map, over a C chord to the end of the beat.
- A callout under each tab as it is named, with its deep dive's title.

## 3. `bank` — 02 · the bank (shot `to-bank`, in PATCH)

*Where are my sounds, and how do I try one?*

> On the left is the bank, where your sounds live. Presets came with the
> instrument. Evolution is the pool it breeds from, each with a guess at how
> much you'll like it. My patches holds the ones you save. Press play to hear
> one. Click it, and it's yours to play.

- Am · F · C · G on Slow Weather under the first four lines, one per line.
- The three lists clicked in turn; callout *its guess* on a row's percentage.
- ▶ on the card on the shortlist among My patches (Ceiling; its standard phrase); space stops it as the
  row is clicked, which opens it in PATCH at once (no cut); Am, then F, on it
  the moment it lands; callout *open, and live* on the row.
- Camera: aim 1.7 at the rail; out to 1.15 on the rack when the row opens.

## 4. `dock` — 03 · the dock (shot `to-dock`, Ceiling at 84)

*How do I play it?*

> Along the bottom is the dock, the same in every view. Play the keys on
> screen, your computer keys, or a MIDI keyboard. Hold latches chords, and
> the arpeggiator plays them in time. On the right, glide slides each note into
> the next. Record saves what you play, next to MIDI and the volume.

- Under the first line, a bass figure on the keys on screen (C3 C3 G3 B♭3…).
- Three ways in: a screen key, a run on the computer keys, a MIDI figure
  through the `?film` port (the keys light).
- HOLD, Am latched, ARP (up·down, 84): the latched chord becomes the
  arpeggio, which runs to the end of the beat.
- Glide dragged up under the running arpeggio.
- ● rec pressed on camera, then pressed again: a real take and its toast.
- Camera: 1.3 on the keybed; 1.7 on the left (hold, arp); 1.7 on the right
  (glide, rec, MIDI, volume). One callout at a time.

## 5. `header` — 04 · up top (shot `to-header`, EVOLVE)

*What are the counters and buttons up there?*

> Up top, PICKS counts what you've taught it. The number beside it counts
> generations bred toward your taste. While a generation breeds, the slot
> beside them shows how far along it is. The question mark opens the keyboard
> map. The three dots hold your files, your taste profile, and these films.

- Nothing plays; the bed is up.
- A generation is breeding: EVOLVE POOL pressed in set-up (it takes minutes,
  on the render farm beside the player), filmed once its first child is in.
  The job slot reads "⚡ breeding 1/10 · about 3 min" (the count and estimate
  are the take's own; the narration quotes neither), and EVOLVE POOL is its
  amber progress bar with stop.
- Callouts on PICKS (18) and the generations count (0) at 1.8×, then
  *a generation, breeding* on the job slot. The narration names the thing,
  not the label's abbreviation. The counters are measured as they are named:
  they sit left of the slot, which widens as its text changes.
- ? opens the help card (wide), Escape closes it.
- ⋯ opens the menu; the pointer rests on *Export this patch*, *Save taste
  profile* and *Watch the films* as they are named.

## 6. `first` — 05 · your first visit (shot `to-first`, a fresh session)

*What happens the first time?*

> The first time you open it, it asks which three sounds you like. Play them,
> pick three, and press teach it. That's eighteen picks in one go, so it
> starts out pointed at you. Your three are saved, and PERFORM opens, ready to
> play.

- The nine cards; ▶ on the card on the shortlist as the narrator says "it asks" (the real
  first press), its phrase running up to
  the cut; it, then the first bass and pad card, picked; *teach it* (callout
  *3 picks × 6 passed = 18*).
- A cut from the press to the "Your three taught it 18 picks… Your three are
  saved, and Ceiling is under your fingers." toast (seconds of engine work; no cut if it is quick); PERFORM is
  open on the first pick, its controls live at once (its wiring came with it;
  PERFORM re-checks it in the background). The job slot says "refitting your
  taste map…" meanwhile.
- A soft pulse from the MIDI keyboard under the result, then the full 303
  figure on "ready to play", with the first control that turns up swelling
  under it. Callouts: *18 picks* (PICKS), *your three* (My patches).

## 7. `next` — 06 · where next (shot `to-next`), then the end card

> To go deeper, each view has a film of its own. PERFORM: playing the sound.
> PATCH: inside the sound. EVOLVE: breeding sounds you like. TASTE: what it
> learned about you. Now open it, and play.

- Aim 1.7 at the tabs; each tab clicked as its film is named, with the film's
  title under it.
- *Now open it, and play*: the end card — lockup, `auracle.alexnodeland.com`,
  *the instrument · the guide · a film for each view* — then black.
- Bed: loop_b.
