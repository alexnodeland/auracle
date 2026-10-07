# TASTE: what it learned about you — storyboard

A walkthrough over the real instrument, for musicians: one recorded shot per
beat (`shots.json` → `tools/footage.mjs`), framed by `stage/walk.js` with a
slow camera, callouts pinned to measured marks, a chapter label and captions.
Twelve beats, eight chapters. The title and the outro are cards drawn with the
kit over their shots (`film.js`), as `films/launch` draws its cards.

**TASTE is quiet by nature, so the film keeps it moving and audible.** Every
chapter either plays something (a dot clicked and played on the keys, a
style's example, a duel) or changes the view on camera (a tab, a rename, a
refit). Under the demos the bed is out (`bed_db: -60`) and the app is the
music; under the title, the chapter turns without app sound and the outro it
is at 0. Chords are in the bed's F Lydian and follow each other without a
shared key: Fmaj7 `f h k ;`, Em7 `d g j l`, Am7 `g h k ;`, Am `h k ;`, a
fifth `a g`.

## Making it

    python3 www/video/films/view-taste/gen_shots.py   # shots.json
    www/video/tools/voice.sh view-taste               # voice, ASR gate, timeline.json
    www/video/tools/rehearse.sh view-taste            # dry run + summary
    node www/video/tools/validate.mjs view-taste
    python3 www/video/tools/framing.py view-taste

`gen_shots.py` writes the shots; `session.py` holds the taught session and
the page scripts the set-ups run. `arrangement.json` is written by the
timeline step from each beat's `music` and `bed_db`.

## The two sessions

Both are seeded (`init`) and built off camera in each shot's set-up, so every
take is the same session. The listener that answers (`session.py`) holds one
taste for the whole session: dark, slow sounds (warm pads, washes, drones)
and bright, struck ones (glass plucks, bells), over anything noisy or gritty,
the example the TASTE page gives. It judges a pool patch by its name, which
the app reads off the measured sound (`<character> <role>`, naming.rs), and a
preset by a table, so it judges the same way every time.

- **FRESH** (open, title): the warm start skipped and five picks, so the
  meter reads *1 more pick and it redraws your taste map* and the map is its
  pre-fit self (*nothing predicted yet*, *1 more pick and it redraws your
  taste map*, and a **1 MORE PICK →** button). Then *skip ↻*
  (records nothing) re-deals until the pair is two kinds of sound, one the
  listener likes and neither one it dislikes, so the two auditions on camera
  are musical.
- **RICH** (every chapter): the warm start answered by the listener (its
  three favourite cards), two *skip ↻* once the pool is full, thirty duels,
  stars from the listener (★5 on the three bank rows it likes most, ★1 on the
  two it likes least), a first note to retire the keybed coach, then duels to
  the edge of a refit.

**Pairs dealt ahead.** EVOLVE deals the next pair while one is on the table
(once the table's two sounds are in), and a pick or *skip ↻* puts it up at
once. Two things follow for a seeded session (`session.py`):

- The first pair is dealt while the pool is still filling, and so, most
  likely, is the pair dealt ahead behind it: those are the two deals that can
  differ between takes. Both sessions skip **twice** once the pool is full
  (`REDEAL`), so the pair on the table was dealt from the full pool. One skip
  was enough when a pair was dealt only after the one before it was answered.
- A pick made while the next pair's deal is still on its way races it, and
  the next two pairs can come up in either order. So every scripted pick and
  skip first waits (`settle`) for the table's sounds and for the pair dealt
  ahead (the passive listener counts the worker's `duel` replies marked
  `ahead`), the way a person who plays both first does anyway.

**Nothing is chosen by name.** A new build of the engine deals a different
pool, so every target is chosen by what it is, from the engine's own taste
views: the firm yes is the surest of the brightest dots that the listener
likes, the maybe the least sure of them, the dim dot the dimmest, the
neighbours the tightest group whose names share a word. The rehearsal's
sidecars log what each set-up chose (`targets`, `pick`, `rows`, `trust`,
`pair`, `walk`).

**Finding things on the canvas.** MAP, STYLES, DIRECTIONS and TRUST are drawn
on one canvas. `init` also carries a passive listener on the engine worker
(as `www/capture-screens.mjs` does) that keeps the latest taste views and
calibration. A set-up script replays the app's own layout (`drawMapTab`,
`drawDirectionsTab`, `drawTrustFromEngine`, `drawStylesTab`) to find a dot,
a row or a bin, and drops an invisible 2-px marker on it (`#vt-*`). The
pointer ops and the marks use the markers.

**Selectors.** Taste tabs `.tab[data-tab='map'|'styles'|'dir'|'trust']`;
chips `#style-chips .style-chip` with `.sc-name`, `.sc-play`; the canvas
`#taste-crt`; legend `#map-legend`; the live label `#live-label`; the live
bank row `.bank-item.live` with `.star[data-s='1'…'5']`; EVOLVE `#play-a`,
`#play-b`, `#choose-a`, `#choose-b`, `#duel-pred`, `#teach-copy .teach-link`
(*see what changed ▸*: it appears when the refit lands, which waits out the
sixth pick's seven-second undo window, and stays until the next pick); ⋯ menu `#ovf-btn`, `#export-btn`,
the *Load taste profile* label, `#taste-reset-btn`, `#alarm`.

---

## 1. `open` — shot `vt-open` (no narration, 14 s; bed out)

- **Set-up:** FRESH · view taste · map.
- **Actions:** `1.6` view evolve; `2.0` ▶ A; `4.2` ▶ B (the pair's phrase
  plays on); `6.2` the listener's pick (`[data-vt='pick']`), then *see what
  changed ▸* (stamp `learned`), clicked at `@learned+0.5`; the fit lands
  (stamp `lit`); `@lit+0.5` a bright dot the listener likes (the brightest
  quarter's first) marked, hovered (its tooltip) and clicked; Fmaj7 as the
  bench has it, to the bar line; Em7 on that bar, to the end.
- **Clips:** `[7.9, "@lit-0.9"]`, a cut from the link to just before the fit
  lands (no cut when it is quick).
- **Camera:** wide on the pre-fit map; in on the pair; wide as the map
  lights; a slow, centred push. Centred because FRESH's first deal can
  differ between takes (the pair-lost-a-side re-deal during the fill), and
  with it which bright dot is played; the RICH session reproduces exactly.
- **Reads without sound:** dim, even dots and *nothing predicted yet*, then
  the whole map lit.

## 2. `title` — shot `vt-title` (title1–2; bed at 0)

- **Set-up:** FRESH, then the same sixth pick, the fit, the brightest dot on
  the bench: the frame the cold open ends on.
- **Card:** a scrim from the left, the mark, *Auracle · the four views*,
  **TASTE** in amber, *what it learned about you*, and the four views with
  TASTE lit.

## 3. `tabs` — shot `vt-tabs` (tabs1–4) — chapter `01 · four ways in`

- **Set-up:** RICH.
- **Actions:** each tab clicked on its word: map, styles, directions, trust.
- **Callouts:** under each tab as it opens: *where your sounds sit*, *the
  tastes it has found*, *what pulls you*, *whether to believe it*; then the
  chips, *your styles, in every tab*.

## 4. `map` — shot `vt-map` (map1–5) — chapter `02 · the map`

- **Set-up:** RICH; markers on the firm yes, the maybe and the four
  neighbours (`MAP_TARGETS`).
- **Actions:** `map2:Nearby` the pointer glides over the four neighbours
  (their tooltips name them); `map3:Glow` off the dots, to the legend;
  `map4:small` hovers the firm yes (*would like: N%*); `map5:big` hovers the
  maybe.
- **Camera:** in on the neighbours; wide for the legend and the bank; in on
  each dot.

## 5. `hear` — shot `vt-hear` (hear1–3; bed out)

- **Actions:** each dot clicked on its line, and played once the bench has it
  (the live label, stamped): the firm yes, Fmaj7 then Em7; the maybe, a fifth
  then Am; the dimmest dot, Fmaj7.
- **Camera:** 1.2, with the dot and the keybed both in frame.

## 6. `styles` — shot `vt-styles` (styles1–5; bed out) — chapter `03 · styles`

- **Actions:** `styles1:taste` STYLES; `styles4:plays` ▶ on the chip whose
  example the listener likes best, then ▶ on another style's; `styles5:Name`
  that first chip renamed *warm washes* (`RENAME` in gen_shots.py, which has
  to fit its example, here Warm Wash: the `pick` log says what it is), Enter. No refit follows the
  rename on camera.
- **Callouts:** the chips; each ▶; the renamed chip, *yours now*.

## 7. `directions` — shot `vt-dir` (dir1–5) — chapter `04 · directions`

- **Actions:** `dir1:Directions` DIRECTIONS; markers (from the app's own
  `taste-geom.js`) on the topmost row of each kind dir4 names (`heard`: a
  measurement of the sound, the first group of main.js `NICE_NAMES`;
  `built`: a count of one kind of module, `n_…`), the row every style pulls
  the same way, the longest bars each way, and the longest bar whose drawn
  whisker plainly crosses the centre line (a guess: drawn hollow, its label
  ending in *?*).
- **Callouts:** *toward*, *away*, *noise srcs: every style leans away*,
  *what you hear*, *what it's built from*, *hollow, with a ?: still a guess*.
- dir4 names no row ("Some rows name what you hear. Others name what the
  patch is built from."): which twelve rows DIRECTIONS shows moves with the
  session, and it named shimmer, brightness and supersaws, then reverbs,
  from one rehearsal to the next.
- The app draws a sure bar solid and a guess hollow, with the caption
  *Where each style leans. Solid = it's sure. Hollow = still a guess — the
  thin line is how far it could be off.* dir5 says the same: "A solid bar is
  sure. A hollow bar is still a guess, its whisker across the centre line,
  and here most are." (It said "Read the whisker, not the bar", from before
  the bars said it themselves.)
- **Check:** the `rows` log has every row with each style's bar (`x`: the
  interval crosses zero; `>`: a whisker cut at the edge). The rehearsal of
  28 September (after the Wave 0 fixes) shows twelve rows: brightness,
  chorus & sweeps, noise srcs, shimmer, snap, density, grit, slow attack,
  supersaws, stepped mods, treble reach, amp sustain. Every style leans away
  from *noise srcs* (−0.13, −0.12, −0.17), and 32 of the 36 bars are guesses
  (only snap, grit, slow attack and amp sustain have a sure bar); there is
  no reverbs row any more. dir3 and dir5 say exactly that. Deals ahead
  (above) change the session, so re-check dir3 (*noise srcs* is the row every
  style agrees on, `agree` in the log) and dir5 (most bars are guesses,
  `guesses` in the log) at the next rehearsal, and rewrite them if they no
  longer hold.

## 8. `trust` — shot `vt-trust` (trust1–5) — chapter `05 · trust`

- **Actions:** `trust1:believe` TRUST; markers on the diagonal, the axis,
  the largest bucket and the check-duel line.
- **Check:** trust4 says what the check line is ("its score on duels dealt
  at random: how much sharper than chance it is"), and the screen gives the
  number (*on N unbiased check duels: N% sharper than chance — this is the
  number to trust*). It used to say "Here, twenty-six percent", and one
  rehearsal of the same session read 26% and another 27%; the number moves
  with the session, so the words do not quote it. The `trust` log has the
  numbers.

## 9. `wrong` — shot `vt-wrong` (wrong1–6; bed out) — chapter `06 · when it's wrong`

- **Set-up:** RICH, then pairs re-dealt with skip (records nothing) until one
  side is a sound the model rates at 70% or more, the listener dislikes and
  nobody has starred, against a side it rates lower (`WRONG_PAIR`); its dot
  marked.
- **Actions:** `wrong2:thinks` hover it (*would like: N%*); `wrong2:one`
  click it, Fmaj7 once it is on the bench; `wrong3:one` ★1 on its row;
  `wrong4` EVOLVE, where that pair is on the table; `wrong4:other` choose the
  other side, against the model: *⚡ Surprise — it had this backwards*; the
  link clicked at `@learned+1.0`; the refit lands (stamp `fitted`); the same
  sound marked again (the axes turn a little at a refit) and hovered. On
  28 September it was Noisy Pluck 2, 81% before and 78% after: one pick moves
  it a little, and wrong6 says so. The callouts no longer quote the two
  numbers (the tooltips show them); check that *after* is below *before* in
  the `dot` and `after` logs.
- **Clips:** `["wrong6-0.3", "@fitted-0.7"]`. The pick is the sixth since
  the last fit, and its refit now waits out the pick's seven-second undo
  window: under wrong5 the meter reads *● learning from your last 6 picks…*,
  and *see what changed ▸* appears when the fit lands (stamp `learned`, about
  8 s after the pick; `fitted` follows at once). The cut skips that wait, so
  the link is on screen when the film resumes and is clicked 0.5 s later.

## 10. `profile` — shot `vt-profile` (profile1–4) — chapter `07 · your profile`

- **Actions:** ⋯; *Save taste profile* (a real download); ⋯ again, hover
  *Load taste profile*; a file handed to its input (the system's file picker
  cannot be filmed), so the app's question appears, and *keep mine*; *Reset
  taste profile…*, its question, *keep it*.
- **The questions** (rehearsal log): Load, *Replace your taste profile with
  auracle-profile.json? Your 58 picks, stars and cuts are replaced by the
  file's. Your current profile is downloaded first, so nothing is lost.*
  Reset, *Reset your taste profile? Your 58 picks, stars, cuts and 0
  generations are forgotten, with every patch you haven't saved. Your 3 saved
  patches stay. A copy of the profile downloads first.* profile4 says what
  the second one says ("Reset asks first. It keeps your saved patches, and
  downloads a copy before it forgets the rest."); it used to say "Reset
  forgets everything", from when Reset also deleted the saved patches.

## 11. `together` — shot `vt-together` (together1–3; bed out) — chapter `08 · the loop`

- **Actions:** `together2:walk` the map focused, the arrow keys step the
  dashed cursor to a bright dot the listener likes, Enter, Fmaj7 to the bar;
  `together3-1.4` on to a maybe nobody has starred, Enter, so it opens on
  "Try a maybe", Em7 then Am7; `together3:Star` ★5 on its row (once the
  bench has it); `together3:back` EVOLVE.

## 12. `outro` — shot `vt-outro` (outro1–3; bed at 0)

- **Actions:** `outro2:EVOLVE` the EVOLVE tab.
- **Card:** the four views in a row: TASTE lit on *TASTE*, PERFORM (green)
  on *play*, EVOLVE (amber) on *EVOLVE*; *go play, and keep picking in
  EVOLVE*; the guide pill, *the guide › the four views › TASTE*.

---

## ⚑ Found in rehearsal, reported

1. **`n_silence` had no words** (a chip read *n_silence + formant voices*).
   Fixed in the app (8340b64: *empty sockets*).
2. **The map mirrored on a refit** (x and y correlated −0.98 and −0.77 across
   one refit), against the guide's "the orientation is pinned". Fixed in the
   engine (11c4a15); the wrong beat re-checks it.
3. **Size barely varied** on the map, so "a small, bright dot" and "a big,
   bright dot" were hard to tell apart. Fixed: dots span 2.5–9 px over the
   map's own range of uncertainty (the firm yes here is 2.5 px, the maybe 9).
4. **A renamed style seemed to move at a refit.** It stays on the style (the
   exemplar can change); the guide now says so (21a339e).
5. **DIRECTIONS capped the drawn whisker**, so a wide interval could look as
   if it did not cross the centre line. Fixed (bars and whiskers on one
   scale, `taste-geom.js`); `dirRows()` in `session.py` uses that module.
6. **Renaming a style renamed the others** and moved every share (the rename
   was the first fresh views since the last fit). Fixed (06fee64).

## ⚑ To re-check at the next rehearsal (Wave 1 and RFC-001)

The app now deals the next pair ahead, and the engine breeds generations as
farm jobs, so the RICH and FRESH sessions are new: the pairs differ from the
28 September rehearsal. Read the sidecars (`out/view-taste/dry/*.json`) and
fix what no longer holds:

- **Camera aims** in `film.js` are typed as app coordinates from the old
  session: `map4` (the firm yes, 1278,600), `map5` (the maybe, 1090,300),
  `wrong2` and `wrong6` (the wrong dot, 1250,560 and 1330,540). Re-aim them
  from the `targets`, `dot` and `after` logs; `framing.py` shows any callout
  they push out of frame.
- **RENAME** (*warm washes*) must fit the first style's example (`pick` log).
- **dir3** (every style leans away from *noise srcs*: `agree` log), **dir5**
  (most bars are guesses: `guesses` log), **wrong6** (the dot's *would like*
  lower after the refit: `dot` and `after` logs).
- The refit's new menu-bar slot (*refitting your taste map…*, the E lit)
  runs inside the cold open's and the wrong beat's cuts, so it is not on
  screen; nothing in the film says otherwise.
