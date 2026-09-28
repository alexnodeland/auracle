# TASTE: what it learned about you — storyboard

A walkthrough over the real instrument, for musicians: one recorded shot per
beat (`shots.json` → `tools/footage.mjs`), framed by `stage/walk.js` with a
slow camera, callouts pinned to measured marks, a chapter label and captions.
Twelve beats, eight chapters. The title and the outro are cards drawn with the
kit over their shots (`film.js`), as `films/launch` draws its cards.

**TASTE is quiet by nature, so the film keeps it moving and audible.** Every
chapter either plays something (a dot clicked and played on the keys, a
style's exemplar, a duel) or changes the view on camera (a tab, a rename, a
refit). Under the demos the bed is out (`bed_db: -60`) and the app is the
music; under the title, the chapter turns without app sound and the outro it
is at 0. Chords are in the bed's F Lydian: Fmaj7 `f h k ;`, Em7 `d g j l`,
Am7 `g h k ;`, Am `h k ;`, a fifth `a g`.

## The two sessions

Both are seeded (`init`) and built off camera in each shot's set-up, so every
take is the same session. The listener that answers (`common.py` in the
generator) holds one taste for the whole session: dark, slow sounds (warm
pads, washes, drones) and bright, struck ones (glass plucks, bells), over
anything noisy or gritty. It judges a pool patch by its name, which the app
reads off the measured sound (`<character> <role>`, naming.rs), so it judges
the same way every time.

- **FRESH** (open, title): the warm start skipped, five picks, so the meter
  reads *1 more pick and it redraws your taste map* and the map is its
  pre-fit self (*nothing predicted yet · 5 of 6 picks*). Then *skip ↻*
  (records nothing) re-deals until both sides are sounds the listener likes,
  so the two auditions on camera are musical.
- **RICH** (every chapter): the warm start (the listener's three: Sea
  Change, Coin Toss, Pump Room), thirty duels, five stars (Warm Drone 2,
  Warm Drone and Coin Toss ★5; Noisy Pad 3 and Gritty Drone ★1), a first
  note to retire the keybed coach, then duels to the edge of a refit. The
  header reads about 56 picks, and TRUST has 32 forecasts.

**Finding things on the canvas.** MAP, STYLES, DIRECTIONS and TRUST are drawn
on one canvas. `init` also carries a passive listener on the engine worker
(as `www/capture-screens.mjs` does) that keeps the latest taste views and
calibration. A set-up script replays the app's own layout (`drawMapTab`,
`drawDirectionsTab`, `drawTrustFromEngine`, `drawStylesTab`) to find a dot,
a row or a bin, and drops an invisible 2-px marker on it (`#vt-*`). The
pointer ops and the marks use the markers.

**Selectors.** Taste tabs `.tab[data-tab='map'|'styles'|'dir'|'trust']`;
chips `#style-chips .style-chip:nth-child(n)` with `.sc-name`, `.sc-play`;
the canvas `#taste-crt`; legend `#map-legend`; the live label `#live-label`;
the live bank row `.bank-item.live` with `.star[data-s='1'…'5']`; EVOLVE
`#play-a`, `#play-b`, `#choose-a`, `#choose-b`, `#duel-pred`,
`#teach-copy .teach-link` (*see what changed ▸*, live for 3.2 s); ⋯ menu
`#ovf-btn`, `#export-btn`, the *Load taste profile* label, `#taste-reset-btn`,
`#alarm`.

---

## 1. `open` — shot `vt-open` (no narration, 14 s; bed out)

- **Set-up:** FRESH · view taste · map.
- **Actions:** `1.6` view evolve; `2.0` ▶ A; `4.2` ▶ B (the pair's phrase
  plays on); `6.2` the listener's pick (`[data-vt='pick']`), then *see what
  changed ▸* (stamp `learned`), clicked at `@learned+0.5`; the fit lands
  (stamp `lit`); `@lit+0.5` the brightest dot marked, hovered (its tooltip)
  and clicked; `@best+0.1` Fmaj7 held to the end.
- **Clips:** `[7.9, "@lit-0.9"]`, a cut from the link to just before the fit
  lands (no cut when it is quick).
- **Camera:** wide on the pre-fit map; 1.12 on the pair; wide as the map
  lights; a slow push.
- **Reads without sound:** dim, even dots and *nothing predicted yet*, then
  the whole map lit.

## 2. `title` — shot `vt-title` (title1–2; bed at 0)

- **Set-up:** FRESH, then the same sixth pick, the fit, the brightest dot on
  the bench: the frame the cold open ends on.
- **Card:** a scrim from the left, the mark, *Auracle · the four views*,
  **TASTE** in amber, *what it learned about you*, and the four views with
  TASTE lit.

## 3. `tabs` — shot `vt-tabs` (tabs1–3) — chapter `01 · four ways in`

- **Set-up:** RICH.
- **Actions:** each tab clicked on its word: map, styles, directions, trust.
- **Callouts:** under each tab as it opens: *where your sounds sit*, *the
  tastes it has found*, *what pulls you*, *whether to believe it*.

## 4. `map` — shot `vt-map` (map1–5) — chapter `02 · the map`

- **Set-up:** RICH; markers on Sea Change (small and bright), Warm Drone 2
  (big and bright) and four neighbours in the gritty, noisy corner.
- **Actions:** `map2:Nearby` the pointer glides over the four neighbours
  (their tooltips name them); `map3:Glow` off the dots (the legend); `map4:small`
  hovers Sea Change (*would like: 81%*); `map5:big` hovers Warm Drone 2
  (*would like: 93%*).
- **Camera:** 1.7 on the neighbours; 1.6 on the legend; 1.7 on each dot.

## 5. `hear` — shot `vt-hear` (hear1–3; bed out)

- **Actions:** each dot clicked on its line, and played once the bench has it
  (the live label, stamped): Sea Change, Fmaj7 then Em7; Warm Drone 2, a
  fifth then Am; Noisy Bell (dim), Fmaj7.
- **Camera:** 1.2 with the dot and the keybed both in frame.

## 6. `styles` — shot `vt-styles` (styles1–5) — chapter `03 · styles`

- **Actions:** `styles1:taste` STYLES; `styles4:plays` ▶ on the third chip
  (its exemplar is Warm Drone 2), then ▶ on the second (Coin Toss);
  `styles5:Name` the third chip renamed *dark drones* (Enter).
- **Callouts:** the chips; each ▶; the renamed chip, *yours now*.

## 7. `directions` — shot `vt-dir` (dir1–5) — chapter `04 · directions`

- **Actions:** `dir1:Directions` DIRECTIONS; markers on the rows the lines
  name (grit, body, space), the longest bars each way, and the longest bar
  whose whisker crosses the centre line.
- **Callouts:** *toward*, *away*, *grit: all three pull away*, *body*,
  *space*, *whisker over the line: a guess*.

## 8. `trust` — shot `vt-trust` (trust1–5) — chapter `05 · trust`

- **Actions:** `trust1:believe` TRUST; markers on the diagonal, the axis,
  the largest bucket and the check-duel line.
- **The numbers:** 32 forecasts · Brier 0.201 · 20% sharper than chance; on
  32 unbiased check duels the same (every dealt duel is a check under the
  default random pairing). trust4 says *twenty percent*, which is what the
  screen says.

## 9. `wrong` — shot `vt-wrong` (wrong1–6) — chapter `06 · when it's wrong`

- **Actions:** `wrong2:thinks` hover Noisy Wash (*would like: 80%*);
  `wrong2:one` click it, Fmaj7 once it is on the bench; `wrong3:one` ★1 on
  its row; `wrong4` EVOLVE, where the pair dealt is Noisy Bell against Noisy
  Wash; `wrong4:other` choose against the model (the side the bank rates
  lower): *⚡ Surprise — it had this backwards*; the link clicked at
  `@learned+1.0`; the refit lands (stamp `fitted`); Noisy Wash re-marked and
  hovered (*would like: 46%*).
- **Clips:** `["wrong6-0.3", "@fitted-0.7"]`.

## 10. `profile` — shot `vt-profile` (profile1–3) — chapter `07 · your profile`

- **Actions:** ⋯; *Save taste profile* (a real download, kept in
  `vt-profile.dl/`); ⋯ again, hover *Load taste profile* (not clicked: it
  opens the system's file picker); *Reset taste profile…*, whose question
  appears; *keep it*.

## 11. `together` — shot `vt-together` (together1–3) — chapter `08 · the loop`

- **Actions:** `together2:walk` focus the map, → (the leftmost dot, Warm
  Drone 2), Enter, Fmaj7 to the bar; `together3:maybe` → → (Warm Bell, big
  and bright), Enter, Em7; `together3:Star` ★5 on its row; `together3:pick`
  EVOLVE.

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
   engine (pkg rebuilt 23:06); the wrong beat re-checks it.
