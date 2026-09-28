# TASTE: interaction design review (ID prefix TA)

Scope: the four tabs (MAP, STYLES, DIRECTIONS, TRUST), the style chips, the map
(glow, size, keyboard, opening a dot, refits), DIRECTIONS, TRUST, the early and
empty states, and save/load/reset profile. Evidence comes from the
`www/video/out/view-taste/dry/` stills and sidecars, `films/view-taste/`, the
guide (`views/taste.md`, `reading-the-model.md`) and the code (`apps/web/main.js`,
`taste-geom.js`, `index.html`, `style.css`). The finished film was not on disk yet.

**Evidence caveat.** Several stills in `dry/` are left over from older rehearsals
(timestamps 27-23:5x and 28-01/02:xx), and they show a different session: *picks 57*,
other patch names, other chips. Those include `vt-wrong-04-link`, `-05-wrong2`,
`-06-end`, `vt-dir-01-grit/snap`, `-02-body`, `-03-grit/space`, `-04-centre/space`,
`-05-agree`, `-06-right`, `-07-left`, `-08-firm/guess`, `-09-end`, `vt-open-01-link`,
`-02-best`, `-03-end`, and all of `vt-x-rename-*`. This review cites only the
current run (28-03:48 to 04:06), which matches `rehearse-summary.txt`.

---

## 1. Summary

1. **The styles do not hold still.** One pick after 58 turned 3 styles into 4, and
   every auto-name changed. The names are built from coefficients that are 35/36
   guesses, so the chips, the words that span all four tabs, churn at every refit.
2. **Uncertainty is shown as certainty in three places.** DIRECTIONS captions
   "Longer bar = stronger pull" and draws guesses as bold bars. STYLES draws no
   intervals at all. Map size is relative to the map, so six picks look as sure as
   sixty, and the tooltip's "would like: 93%" sits on the *least* sure patch.
3. **The view reports but does not invite.** "Firm yes", "maybe", "try a maybe"
   and "read the whisker" exist only in the film's narration. The app has no
   maybe-finder, no ear on DIRECTIONS, no diff behind "see what changed ▸", and
   TRUST has no next step.
4. **Colour and vocabulary drift.** Five near-identical ambers try to tell styles
   apart. One concept has four names ("check picks", "check duels", "random pair —
   a fair test", "duels dealt at random"), and "lens"/"style" and "bench"/"workbench"
   are both in use.
5. **Strengths to keep:** TRUST's honesty machinery (out-of-sample forecasts,
   check-duel line, Wilson whiskers, hollow small bins), HTML empty states with a
   real CTA, a pinned map orientation, instant tabs (about 45 ms), dots that open
   in about 0.3 s, and Load that downloads your profile before replacing it.

---

## 2. Flows walked

### F1. First visit, before and just after the first fit (FRESH session)
1. **TASTE at 5 picks** (`vt-open-00-start.jpg`). Real dots, evenly dim, under a
   translucent card: *NOTHING PREDICTED YET … 5 of 6 picks … START 6 QUICK PICKS →*.
   Good: the dots are real and the card teaches. Friction: the CTA says **6** when 1
   is left, and EVOLVE's meter says "1 more pick and it redraws your taste map"
   (`vt-open-03-mid.jpg`), so the two views count differently (TA10).
2. **The 6th pick in EVOLVE**, then *● it just learned — see what changed ▸*
   (`vt-open-04-link.jpg`). Clicking it goes to TASTE. The map lights about 0.6 s
   later (stamps learned 6.30 → lit 6.91).
3. **The first lit map** (`vt-open-05-best.jpg`) has one chip, *sustained reverb
   100%*. Dot sizes already span the full 2.5–9 px, so after 6 picks some patches
   look "sure" (TA3). The toast *Picked Warm Drone over Warm Bell* sits just above
   the legend. Nothing says what changed (TA5).

### F2. Reading MAP and opening a dot (mouse, RICH, 58 picks)
1. Caption (`vt-map-00-start.jpg`): "Glow is how much the model thinks you'd like
   it, size is how sure it is — islands are styles." No islands are visible. Two
   of the three style hues are the same amber, and the third (cream) reads as
   "dim" (TA6).
2. Hovering Bright Bell gives the tooltip *would like: 93% · click to open on the
   bench* (`vt-map-01-end.jpg`). Its std is 1.41 (r 9), the least sure patch on the
   map, but the tooltip gives no hint of that. The bank beside it also leads with
   "Bright Bell 93%" (TA3).
3. Clicking opens the patch in 0.3–1.1 s. The first toast fires at once and
   says the patch is already "on the workbench". Then a second one, "… on the
   bench", arrives. Two opens in a row leave a stale toast: *Warm Drone 2 on the
   bench +2* while Bright Bell is live (`vt-together-02-star5.jpg`) (TA11).
4. To hear the patch you play the keys. The dot click does not audition, but the
   chip ▶ does (TA13).

### F3. Walking the map with the keyboard
1. Focus the canvas (green focus ring). Every arrow key steps through the dots
   in x-order, so Up behaves like Left and Down like Right. In the film, reaching
   a target took 6 and then 11 presses (`vt-together.json` walk: steps t1 6, t2 11).
2. The cursor is a dashed ring with no name, no percentage and no live
   announcement. You learn what you landed on only after Enter (TA12).

### F4. STYLES: naming and auditioning
1. `vt-styles-01-lens0.jpg`: three blocks of five bars. There are no whiskers,
   no centre line and no toward/away labels, and each block is about 265 px tall
   with about 90 px of content. The block order (35/34/30%) is not the chip order
   (35/30/34%) (TA7, TA16).
2. Pressing ▶ on a chip (`vt-styles-06-play-first.jpg`) plays a sound, but nothing
   on screen changes. The exemplar (Warm Wash) is never named, and the live label
   still reads *Sea Change* (TA7).
3. Renaming: the chip text is a bare `<input>` with no edit affordance. After a
   rename, *warm washes* is bright while the auto-named chips stay in dim
   placeholder grey, so they look disabled (`vt-styles-08-named.jpg`) (TA7).

### F5. DIRECTIONS
1. `vt-dir-00-start.jpg` / `vt-dir-07-guess.jpg`: twelve rows, three bars each, in
   two near-identical ambers and one cream. The whiskers are 1 px at 55% alpha.
   Nothing says which bar belongs to which style, or which side means "toward".
2. The caption reads "Longer bar = stronger pull". Per the `rows` log, 35 of the
   36 intervals cross zero, so almost everything drawn is a guess (TA2).
3. You cannot hover, click or listen to a row (TA13).

### F6. TRUST
1. `vt-trust-01-honest.jpg`: a square plot in the left 40% of a wide canvas, with
   no tick labels. The axes read "it said A would win this often" and "A actually
   won this often". Four bins, two of them sitting on the bottom edge (observed 0).
2. Three 10 px lines follow: *35 forecasts · Brier 0.182 · 27% sharper than chance*,
   then *on 35 unbiased check duels: 27% sharper than chance — this is the number to
   trust*, then a footnote at the canvas's bottom edge. When every forecast is a
   check, the first two lines say the same number twice (TA8).
3. There is no next step: no "firm it up", and no link back to EVOLVE.

### F7. The teaching loop: "when it's wrong"
1. Hover Noisy Pluck 2 (*would like 81%*), open it, give it ★1 (`vt-wrong-01-row`,
   `-02-star1`). The map does not mark your rating, so the model's 81% and your ★1
   never appear together (TA4).
2. In EVOLVE, pick the other side: *⚡ Surprise — it had this backwards. 42%*, then
   *see what changed ▸* at +1.0 s. The TASTE map still shows the old fit for about
   1.2 s, then jumps: the dot moves (1248,512)→(1362,497), the whole cloud shifts,
   and **the chips go from 3 to 4 with every name changed** (`vt-wrong-03-against`
   chips vs `vt-wrong-09-wrong2`, `-10-end`). The dot now reads 78%. Nothing
   explains that ★1 plus a surprise moved it only 3 points (TA1, TA5).

### F8. Profile: save, load, reset
1. ⋯ › *Save taste profile* downloads `auracle-profile.json` in 0.07 s
   (`vt-profile.json` downloads t 5.66, click 5.59), but no in-app word confirms it
   (`vt-profile-02-save.jpg`).
2. *Load*: a clear question, and the current profile is downloaded first
   (`vt-profile-05-alarm-load.jpg`). A model to follow.
3. *Reset…*: "Every pick, star and generation is forgotten." It offers no backup
   and does not mention saved patches, although the whole session record is
   deleted (`vt-profile-06-alarm.jpg`, `main.js:17577`) (TA14).

---

## 3. Findings (ranked)

### TA1. Styles and their auto-names churn at every refit. **P1**, consistency and understandability
- **Evidence.**
  - Before (`vt-wrong.json` `before`, `vt-wrong-03-against.jpg` duel badges,
    `vt-map-00-start.jpg`): 3 styles. *swirling supersaws* 35% (exemplar Warm
    Wash), *stepped, gated modulation* 30% (Coin Toss), *slow-blooming shimmer* 34%
    (Pump Room).
  - After one pick (`after-map`, `vt-wrong-10-end.jpg`): 4 styles, all renamed.
    *sustained, stepped modulation* 23% (k0, still Warm Wash), *analog shimmer* 26%
    (k1, still Coin Toss), *sustained flutter* 26%, *soft-edged wavetables* 25%.
  - `styleName()` (`main.js:16780-16793`) names a style from its two largest
    positive means and ignores σ. The `vt-dir.json` rows show 35/36 intervals
    crossing zero, so the names are built from guesses.
- **What the player experiences.** They learn "stepped, gated modulation = the
  Coin Toss family". One pick later the Coin Toss family is called "analog
  shimmer", and "stepped" belongs to a different chip. EVOLVE's duel badges and
  PATCH's belief tooltips use the same names, so the churn spreads. Only a style
  the player has renamed keeps its name.
- **Principle.** Stable identity: one thing, one name. Don't relabel on noise.
- **Recommendation.**
  1. Auto-name only from *resolved* pulls (|mean| ≥ σ, the same test as PATCH's
     `beliefState`, `main.js:13379`). With fewer than two resolved pulls, name the
     style by ear from its exemplar: **"like Warm Wash"**.
  2. Add hysteresis. A matched style keeps its previous auto-name until a
     different resolved top-2 has held for two consecutive refits.
  3. Keep chip order stable: by k, with new styles appended at the end.
  4. When K grows, say so once. The new chip shows a `new` tag for the session,
     and a toast reads **"A 4th style split off — like Warm Stab ▶"**.
- **Effort** M · **Confidence** high.

### TA2. Guesses are drawn as settled pulls, and the app contradicts its guide. **P1**, understandability and consistency
- **Evidence.**
  - DIRECTIONS caption: "Longer bar = stronger pull" (`main.js:16855`); the empty
    state says "Longer bar, stronger pull" (`16895`). The guide says **"Read the
    whiskers, not the bars"**, and so does the narration (dir5).
  - Bars are 4 px, glowing, in style colour. Whiskers are 1 px silk at 0.55 alpha
    (`main.js:17264-17277`) and hard to see (`vt-dir-07-guess.jpg`).
  - `vt-dir.json` `rows`: 35 of 36 intervals cross zero (`x`), for example
    `n_noise -0.188±0.19`.
  - STYLES draws the same coefficients with **no interval at all**, scaled per
    style (`main.js:17185-17197`). In `vt-styles-01-lens0.jpg`, *chorus & sweeps*
    (0.159±0.227, a guess) is the longest bar of style 1.
  - PATCH's node bank calls the same coefficient *"no lean either way"* and draws
    nothing (`main.js:13742`). Its whisker is also still capped at 16 px
    (`main.js:13749`), the bug `taste-geom.js` fixed for DIRECTIONS.
  - The guide's interactive figure promises "Red whiskers are the ones that have
    not [cleared zero]" (`reading-the-model.md`). No such mark exists in the app.
- **What the player experiences.** A long glowing bar reads as "you really like
  chorus". At 58 picks almost every bar is noise, and the caption tells them to
  read the bar. PATCH says "no lean" for the same number.
- **Principle.** Say what is true (ADR-004). The four states must never look
  alike. One concept should look the same everywhere.
- **Recommendation.** Use one three-state mark in STYLES, DIRECTIONS and PATCH:
  - **Settled** (interval clear of zero): a solid bar with its whisker.
  - **Guess** (interval crosses zero): a hollow 1 px outline bar at 35% alpha,
    the whisker at full silk, and the row label suffixed with "?".
  - Move PATCH's θ chip to `taste-geom.directionsBar` so its whisker is no longer
    capped.
  - DIRECTIONS caption: **"Where each style leans. Solid = it's sure. Hollow = still
    a guess — the thin line is how far it could be off."**
  - Above the rows, one line from the posterior: **"12 rows · 1 settled · least
    settled: loudness — picks between dense and sparse sounds would teach it
    most"** (builds on musical-instrument-review §4.3).
  - STYLES lists settled pulls only. With none, it says: **"No settled pulls yet —
    all guesses at 58 picks. Keep picking."**
- **Effort** M · **Confidence** high.

### TA3. Map size is relative, and the tooltip hides uncertainty. **P1**, understandability
- **Evidence.**
  - `taste-geom.js:26-41` spreads radius over the pool's own 10th to 90th
    percentile of sd, so every map has 2.5 px and 9 px dots.
  - At 6 picks (`vt-open-05-best.jpg`) the full range is visible. `vt-open.json`
    `best`: Warm Drone 2 std 1.14 → r 9. At 58 picks, Noisy Stab std 0.53 → r 2.5
    (`vt-hear.json` `targets`).
  - The guide says "Early in a session everything is big" (`reading-the-model.md`),
    which is false now.
  - Tooltip (`main.js:17379`): only "would like: N%". Bright Bell shows *93%* with
    std 1.41 (r 9), the least sure dot, and it tops the bank (`vt-map-01-end.jpg`).
- **What the player experiences.** After six picks the map already shows "firm
  yeses". The #1 patch in the bank is the one the model knows least about, and
  nothing on screen says so.
- **Principle.** Encodings must mean the same thing over time; don't make a
  number look more certain than it is.
- **Recommendation.**
  1. Keep the relative spread (the contrast fix was right), but floor it with an
     absolute scale: radius = max(relative, absolute(sd)), with absolute reaching
     9 px at sd ≥ 1.2. Early maps then come out mostly big, as the guide says.
  2. Tooltip line 2 gets words from absolute sd: **"would like 93% · a hunch"**
     (sd > 1.0), **"· leaning"** (0.6–1.0), **"· fairly sure"** (< 0.6). Use the
     same word in the bank row's `aria-label` and title.
  3. Legend: "sure ○ … ◯ unsure (on this map)". When the median sd is above 1.0,
     add the line **"Early days — most of this is a hunch."**
- **Effort** S–M · **Confidence** high.

### TA4. The map reports but does not invite; "maybe" exists only in the film. **P1**, understandability (actionability)
- **Evidence.**
  - "firm yes", "maybe", "Try a maybe" appear only in `script.json` (map4, map5,
    hear2, together3). `grep -i maybe apps/web/*.js index.html` finds nothing.
  - Finding a maybe means scanning for big bright dots among five ambers (TA6).
  - The map never shows your own verdicts. Noisy Pluck 2 has ★1 and still glows
    81%, later 78% (`vt-wrong-10-end.jpg`), with no mark of the disagreement.
- **What the player experiences.** They see a picture and do not know what to do
  with it. The film teaches the most useful move (explore a maybe), but the app
  never offers it.
- **Principle.** Every view should end in an action. Show the model's belief next
  to yours.
- **Recommendation.**
  1. Tooltip verdict (row 3), from glow × size: **"firm yes"**, **"maybe — worth a
     listen"**, **"probably not"**, **"no idea yet"**.
  2. A button at the legend's left: **"Hear a maybe ▸"**. It opens the brightest
     dot in the least-sure third and cycles on each press; `M` does the same from
     the keyboard.
  3. On opening a maybe, show one toast: **"A maybe: could be great, it doesn't
     know. ★ it, or pick it in a duel."**
  4. Draw your stars on the map as a thin silk ring, and cuts as a ✕. A ★1 on a
     bright dot gets the tooltip line **"you: ★1 · it still guesses 78% — keep
     telling it"**.
- **Effort** M · **Confidence** high.

### TA5. "see what changed ▸" lands on an unchanged map, then it jumps without explanation. **P1**, responsiveness and understandability
- **Evidence.**
  - `main.js:2342-2344`: the link runs `showView("taste")` and opens whichever tab
    was last used. It appears as soon as the fit *starts* (`wm-lamp` goes
    thinking).
  - `vt-wrong.json`: pick 11.06, link clicked 12.22, fit landed 13.45, so the old
    map shows for about 1.2 s.
  - On arrival, `drawMapTab` re-frames to the new min/max (`main.js:17086-17089`)
    with no transition. Compare `vt-wrong-01-row.jpg` with `vt-wrong-10-end.jpg`:
    the target dot moves 114 px, the lone left dot moves 115 px, and the cloud
    shifts about 200 px right.
  - The guide promises "somewhere you recognise stays where you left it".
- **What the player experiences.** They click "see what changed" and see no change.
  A second later everything moves at once, the chips are renamed (TA1), and they
  cannot find the sound they just taught it about.
- **Principle.** Show progress for work over 1 s; animate state changes so they
  can be followed; a link must deliver what it names.
- **Recommendation.**
  1. The link always opens **MAP**. While the fit runs, the TASTE caption reads
     **"redrawing your taste map…"** with the lamp pulsing, and the map dims to
     60%.
  2. On arrival, tween every dot by id over 400 ms (ease-out). Give the frame
     hysteresis: re-fit the bounds only when a point falls outside by more than
     10%.
  3. For 5 s, ring each dot whose would-like moved by 5 points or more and label
     it (**"81→78%"**).
  4. Add a one-line strip under the chips: **"What changed: Noisy Pluck 2 81→78% ·
     a 4th style split off · 3 names changed"**, which dismisses on the next
     gesture.
- **Effort** M · **Confidence** high.

### TA6. Five shades of amber cannot tell styles apart. **P1**, understandability and consistency
- **Evidence.**
  - `STYLE_COLORS` (`main.js:16707-16713`): amber, amber→dim, dim→silk,
    dim→deep, silk.
  - In `vt-dir-07-guess.jpg` the bars for styles 0 and 1 in each row look the same.
  - In `vt-map-00-start.jpg` the cream dots (style 2) look *dim*, which the legend
    says means "less liked", and glow uses alpha on the same dots
    (`main.js:17104-17106`).
  - The caption claims "islands are styles". Style 4 would be silk, the same as
    the live-patch ring and the whiskers.
- **What the player experiences.** They can't tell which bar or dot belongs to
  which chip. Pale dots read as unloved.
- **Principle.** One channel, one meaning. Amber means the model; glow is the
  only amber gradient the map should have.
- **Recommendation.** Stop encoding style by hue. Make the **chips the key**:
  hovering or clicking a chip's dot focuses that style in every tab.
  - MAP: its dots at full strength, the others at 20%, so "islands" become
    visible.
  - DIRECTIONS: only its bars and whiskers, at a readable width.
  - STYLES: its card expanded.
  - Default focus is the largest style; the focused chip gets an amber outline, and
    Esc or a second click clears focus.
  - Draw every dot in one amber, with glow as its alpha.
- **Effort** M · **Confidence** high.

### TA7. The style chips don't behave like the rest of the app's controls. **P2**, consistency and quality
- **Evidence.**
  - `.sc-play` has no `.playing` rule (`style.css:3051-3054`). The chip's ▶ passes
    no key, so a second press restarts instead of stopping (`main.js:16847`).
    CHANGELOG: the bank row's ▶ and EVOLVE's ▶ SAMPLE "light while it plays and
    stop on a second press".
  - The exemplar is never named; the live label stays *Sea Change*
    (`vt-styles-06-play-first.jpg`).
  - Auto-names render as placeholder text and so look dim and disabled; a user's
    name renders in silk (`main.js:16817`, `vt-styles-08-named.jpg`).
  - There is no edit affordance, and Esc does not revert a rename.
  - Chips are in k order but panels in share order (35/30/34 vs 35/34/30).
  - Raw hex colours `#14171c` and `#2c313a` in `.style-chip` break the token
    rule.
- **Recommendation.**
  - Chip layout: `● warm washes ✎ · 35% · ▶`, with the name in silk whatever its
    source (auto-names in italic).
  - ▶ tooltip: **"Hear Warm Wash — this style's best example"**. It lights while
    playing and stops on a second press (pass `key: "style-"+k`).
  - After playing, a toast: **"Warm Wash · best example of warm washes — open ▸"**.
  - Esc reverts a rename. Order chips as TA1.3 says, and tokenise the colours.
- **Effort** S · **Confidence** high.

### TA8. TRUST speaks statistics, not music. **P2**, understandability and quality
- **Evidence.**
  - `vt-trust-01-honest.jpg`: the axis labels (`main.js:16969-16974`) are "it said
    A would win this often" and "A actually won this often", with no ticks.
  - Headline: "35 forecasts · Brier 0.182 · 27% sharper than chance"
    (`17021-17024`), with a second line that repeats the 27% when
    check_n == n (`17026-17031`).
  - The footnote sits at the canvas's bottom edge (y≈936 of 940). The plot uses
    about 40% of the width and the right half is empty.
  - "sharper" is a calibration term of art; "A" means nothing outside a duel.
- **What the player experiences.** A statistician's chart. The one takeaway the
  film gives, "27% better than chance, keep picking", is buried in 10 px mono.
- **Principle.** Plain language first, detail on request. Engine bookkeeping is
  already hidden behind ⋯ › Show measurements (signatures in the tooltip,
  `main.js:17377`); apply the same rule here.
- **Recommendation.**
  1. **Fold** the diagram. x = "how sure it was of its pick" (50–100%, from
     max(p,1−p)); y = "how often you agreed". Add ticks at 50/60/70/80/90/100%.
     This is still a proper reliability diagram, and it removes "A".
  2. Put an HTML verdict on the right half, in large text:
     **"Its guesses beat a coin flip by 27%."** Under it:
     **"When it was about 70% sure, you agreed 8 times in 10."** (from the largest
     bin). Add a band: **Worth listening to** (skill ≥ 20% on ≥ 20 fair-test
     picks), **Getting there** (0–20%), or **Not yet** (≤ 0).
  3. Show Brier, `n=` and the provenance split only under Show measurements. Drop
     the duplicate line when check_n == n.
  4. CTA: **"Firm it up — 10 more picks ▸"** (to EVOLVE).
- **Effort** M · **Confidence** high (folding is sound because A/B sides are
  arbitrary; check the engine exposes per-forecast p and outcome, or fold the bins
  server-side).

### TA9. One concept has many words. **P2**, consistency
- **Evidence.**
  - The random-dealt comparison is called "35 check picks" (menubar,
    `main.js:2753`), "unbiased check duels" (TRUST, `17028`), "random pair — a fair
    test" (EVOLVE, `vt-open-03-mid.jpg`) and "duels dealt at random" (guide).
  - A choice is a "pick" (menubar), a "vote" (empty TRUST, `16899`), a "duel" and a
    "forecast".
  - "Your taste as separate styles — new **lenses** appear … Dim **lenses** are
    idle" (`16854`).
  - The tooltip says "the bench", the toast says "the workbench" (`17320`).
  - DIRECTIONS rows use chart labels ("noise srcs", "LFO mods", "gated mod",
    "stepped mods") while chips use `STYLE_WORDS` ("noise", "wobble", "gated
    modulation", "stepped modulation").
- **Recommendation.** One glossary, applied everywhere:
  - **pick** for any choice in copy.
  - **fair-test picks** for the random-dealt ones, matching EVOLVE: the menubar
    reads "27% better than chance · 35 fair-test picks".
  - **style**; drop "lens" from UI copy and the guide's UI descriptions.
  - **bench**.
  - DIRECTIONS row labels from `STYLE_WORDS[...].noun`, so a row and the chip
    built from it use the same word.
- **Effort** S · **Confidence** high.

### TA10. Early and empty states count the wrong thing. **P2**, understandability
- **Evidence.**
  - The CTA is fixed at `Start ${FIT_EVERY} quick picks →` (`main.js:16878`), and
    shows "START 6 QUICK PICKS" at *5 of 6 picks* (`vt-open-00-start.jpg`).
  - TRUST's empty state needs 20 forecasts but uses the same "6 quick picks" CTA
    (`16897-16901`).
  - STYLES' empty state promises "after a dozen picks" under a count of "n of 6"
    (`16888-16891`).
  - TRUST's pre-data copy says "indistinguishable from honest".
  - TASTE says "After your first 6 picks the model fits"; EVOLVE says "redraws your
    taste map".
- **Recommendation.** Compute every CTA from the remaining count:
  - MAP: **"1 more pick →"**.
  - STYLES: **"Your first style appears at pick 6; more split off as you teach
    it."**
  - TRUST: **"Before each pick it guesses which you'll choose. After 20 guesses it
    grades itself here — 14 to go →"**.
  - Use EVOLVE's words, "redraws your taste map", in all of them.
- **Effort** S · **Confidence** high.

### TA11. Opening a dot gives a premature toast, then a second one, and they go stale. **P2**, responsiveness and consistency
- **Evidence.**
  - `main.js:17320` and `17402` call `note("… selected — it's on the workbench and
    under your fingers")` at click time, before the bench has the patch.
  - The bench reply then adds "X on the bench" (`1487`), because map opens are not
    in `quietBench`.
  - In `vt-together-02-star5.jpg` the toast reads *"Warm Drone 2 on the bench
    +2"* while Bright Bell is live. Neither toast uses `replace:`.
- **Principle.** AGENTS.md: "A later word on the same thing replaces the earlier
  one"; say what is true.
- **Recommendation.** Remove the click-time toast. Show pending on the dot (a
  rotating dashed ring) and on the bank row (`opening`, already exists). On
  arrival, send one toast with `replace: "bench"`:
  **"Bright Bell — under your fingers · would like 93%, a hunch"**.
- **Effort** S · **Confidence** high.

### TA12. The keyboard walk is one-dimensional and silent. **P2**, accessibility and parity
- **Evidence.**
  - `main.js:17407-17408`: arrows step in x-sorted order, with Up = Left and
    Down = Right. Reaching a dot took 6 and 11 presses (`vt-together.json` walk).
  - No tooltip or live announcement for the cursor.
  - The canvas `aria-label` always says "Taste map" (`index.html:630`), even on
    STYLES, DIRECTIONS and TRUST, which have no text alternative.
  - Tabs have no `aria-controls` and no arrow-key roving (`index.html:621-624`).
- **Recommendation.**
  - Spatial navigation: each arrow goes to the nearest dot within a ±45° cone in
    its direction.
  - Show the TA3/TA4 tooltip at the cursor. An `aria-live="polite"` region reads
    **"Bright Bell. Would like 93 percent, a hunch. Maybe. Style warm washes."**
  - Space auditions the phrase, Enter opens, M finds the next maybe.
  - Give each tab its own aria-label, and keep an off-screen table of the
    STYLES/DIRECTIONS rows and the TRUST verdict.
- **Effort** M · **Confidence** high.

### TA13. Hearing works differently on each surface, and DIRECTIONS has no ear. **P2**, consistency and actionability
- **Evidence.**
  - Chip ▶ plays the audition phrase and does not open the patch
    (`main.js:16847`).
  - A dot click opens the patch and plays nothing (`17319`).
  - DIRECTIONS and STYLES rows are not interactive at all.
  - The musical-instrument review already asks that "every claim about sound
    [be] audible".
- **Recommendation.**
  - Dot: a click opens the patch *and* plays its phrase once, unless a key is
    held.
  - Chip ▶: plays and names the patch, and offers "open ▸" (TA7).
  - DIRECTIONS row: on hover or focus, show **"▶ more · ▶ less"**. These play the
    focused style's pool patches with the highest and lowest value of that
    coordinate, the nearest pool member rather than a new render.
- **Effort** M (the rows are M on their own) · **Confidence** medium.

### TA14. Reset is less safe than Load, and Save is silent. **P2**, quality and error prevention
- **Evidence.**
  - Load: *"Your current profile is downloaded first, so nothing is lost."*
    (`main.js:17552`).
  - Reset: "Every pick, star and generation is forgotten." It then deletes the
    whole `state` record and reloads (`17573-17580`). That record also carries the
    bank (saved patches, **My Patches 3** in the stills), stars, cuts, positions
    and PERFORM settings (`uiState()`, `main.js:530+`), none of which the question
    names.
  - Save shows no in-app confirmation (`vt-profile-02-save.jpg`).
  - The import toast says "its standardizer and history are now active"
    (`2072`).
- **Recommendation.**
  - Reset: **"Reset your taste profile? Your 58 picks, stars, 3 saved patches and
    generations are forgotten. A copy downloads first."** Buttons **"download &
    reset"** and **"keep it"**.
  - Save toast: **"Saved auracle-profile.json — 58 picks, 3 styles."**
  - Import toast: **"Profile loaded — 58 picks. Redrawing your taste map…"**
- **Effort** S · **Confidence** medium-high. Check which bank state survives
  `idbDel("state")` before writing the copy.

### TA15. The map footer and caption are jargon, and the guide's claim about them is off. **P2**, understandability and truth
- **Evidence.**
  - Footer: "axes = sound-space PCA · 29% of variance · 40 patches"
    (`main.js:17152`). Measured 29%, 30% and 32% across the stills, while the guide
    says "typically around half".
  - The caption says "islands are styles", which is not visible (TA6).
  - "Every patch you've heard", but the history ghosts are unexplained (TA19).
- **Recommendation.**
  - Footer: **"A flat view of 40 patches — close dots usually sound alike (it
    shows 29% of how they differ)."**
  - Caption: **"Brighter: it thinks you'd like it more. Bigger: it's less sure.
    Click a dot to play it."**
  - Guide: "often a third or less".
- **Effort** S · **Confidence** high.

### TA16. STYLES is sparse and inert. **P2**, quality and actionability
- **Evidence.**
  - `vt-styles-01-lens0.jpg`: each block is h/3, about 265 px, with about 90 px
    used.
  - No centre line and no toward/away labels. Bars are scaled per style
    (`maxAbs`, `main.js:17186`), so style A's longest bar is not comparable with
    style B's.
  - The exemplar lists (`views.styles[k].exemplars`, three each in the logs) are
    not shown.
- **Recommendation.** One card per style:
  - Name ✎ and **"35% of your bank"**.
  - **"sounds like: Warm Wash ▶ · Soft Wash 2 ▶ · Pump Room ▶"**.
  - **"leans toward: sweeps, supersaws · away from: treble, brightness"** (settled
    pulls only, with guesses as "maybe: …").
  - Actions **"⚡ breed more like this"** (the existing evolve-from on the
    exemplar) and **"open best ▸"**.
  - Draw bars on one shared scale if they stay.
- **Effort** M · **Confidence** high.

### TA17. The idle threshold differs in each place. **P2**, consistency
- **Evidence.** Chips hide styles below 2% (`main.js:16811`). STYLES dims below
  8% (`17171`). DIRECTIONS drops below 8% (`17211`). The caption says "Dim lenses
  are idle" with no number. A 5% style therefore has a chip with ▶ but no
  DIRECTIONS rows.
- **Recommendation.** One constant, `STYLE_IDLE = 0.08`, used everywhere. Idle
  styles fold into one quiet chip, **"+2 idle"**, whose tooltip reads "styles it
  has room for but no evidence of yet".
- **Effort** S · **Confidence** high.

### TA18. The menubar trust readout points to TRUST but is not a control. **P3**, consistency
- **Evidence.** `#skill` is a `<span>` (`index.html:91`) whose title ends "See
  TASTE → trust" (`main.js:2754`).
- **Recommendation.** Make it a button that opens TASTE › TRUST.
- **Effort** S · **Confidence** high.

### TA19. History ghosts look like sure-and-disliked dots. **P3**, understandability
- **Evidence.** Ghosts are drawn at r 2 px with alpha 0.16–0.36 and cannot be
  clicked (`main.js:17136-17143`). A sure, disliked pool dot is r 2.5 px with
  alpha about 0.4, and can be. Neither is in the legend.
- **Recommendation.** Draw ghosts as hollow 1 px rings, and add a legend entry:
  **"◌ heard before, no longer in the bank"**.
- **Effort** S · **Confidence** medium.

### TA20. Canvas text is too small for its job. **P3**, quality
- **Evidence.** Every label, the TRUST verdict and the map footer are 10 px mono
  in amber-dim (`main.js:16922`). The TRUST footnote touches the canvas's bottom
  edge (`vt-trust-01-honest.jpg`).
- **Recommendation.** Move verdicts and captions to HTML (as TA8 does); canvas
  labels at 11–12 px at least; keep 16 px clear of the canvas edge.
- **Effort** S · **Confidence** high.

---

## 4. Keep

- **TRUST's honesty machinery.** Forecasts are out-of-sample and one step ahead.
  The check-duel line is separate. Wilson 95% whiskers and hollow bins for n < 5
  (`main.js:16977-17010`). "not beating a coin flip yet" is the early answer, and
  edits you heard are scored apart from edits you only asserted. Change the words
  and layout (TA8), never the method.
- **Empty states are HTML with a working CTA.** The pre-fit map draws real dots
  under a translucent invitation instead of a void (`16930-16939`).
- **The map keeps its orientation** across refits and reloads. TA5 adds tweening
  on top of that; it does not replace it.
- **`taste-geom.js` as pure, unit-tested geometry**, including whiskers that are
  cut at the edge and marked with an arrowhead instead of being shortened. Extend
  it to PATCH (TA2).
- **Absolute glow**: the same logistic as the bank, so "it likes none of these"
  is expressible.
- **A renamed style keeps its name** and the name reaches EVOLVE's duel badges
  (`vt-wrong-03-against.jpg`) and PATCH. Colour semantics are right as well: an
  amber model with a green ▶ for sound.
- **Clicking a dot opens the patch and scrolls the bank to its row.** On touch
  the tap skips the hover tooltip.
- **Load asks and downloads your profile first.** Reset asks. Both use the same
  alarm.
- **Instant tabs** (about 45 ms) and synchronous hover.

---

## 5. Response-time budget

| Gesture | Target | Measured now (source) | Verdict |
|---|---|---|---|
| Switch TASTE tab | ≤ 100 ms to redraw | 40–50 ms click-to-done, synchronous draw (`vt-tabs.json` late: took 0.04–0.05 s) | Pass |
| Hover a dot → tooltip | ≤ 100 ms | Synchronous in `pointermove` (`main.js:17352`) | Pass |
| Arrow key → cursor moves | ≤ 100 ms | Synchronous redraw (`17413-17414`). But it takes 6 and 11 presses to reach a dot (`vt-together.json`) | Pass per key, fail per task (TA12) |
| Click a dot → acknowledged | ≤ 100 ms | Toast at click, but it claims the patch is there before it is (TA11) | Fast but untrue |
| Click a dot → patch on bench | ≤ 1 s | firm yes 0.32 s, maybe 1.13 s, dim 0.38 s (press end → `BENCHED` stamp, `vt-hear.json`) | Pass, maybe borderline |
| Chip ▶ → visible acknowledgement | ≤ 100 ms | None; `.sc-play.playing` has no style (TA7) | Fail |
| 6th pick → map lit | ≤ 1 s | about 0.5–0.7 s (pick 6.2, learned 6.30, lit 6.91, `vt-open.json`) | Pass |
| Pick at 58+ → refit visible in TASTE | progress ≤ 100 ms, result ≤ 1 s or show progress | 2.2–2.4 s (choose 11.06 → fitted 13.45, `vt-wrong.json`). "see what changed" shows the old map for about 1.2 s, with no progress on TASTE | Fail (TA5) |
| Rename a style → everywhere | ≤ 100 ms after Enter | Synchronous re-render (`16828-16838`). The `renamed` log shows it applied | Pass |
| Save taste profile → file | ≤ 1 s + in-app acknowledgement | Download 0.07 s after click (`vt-profile.json` downloads 5.66 vs click 5.59); no in-app word | Pass on speed, fail on acknowledgement (TA14) |
| Load profile → question | ≤ 100 ms | About 0.1 s (file 7.81 → `load-question` log 7.9) | Pass |
| Reset → question | ≤ 100 ms | Immediate alarm (`17574`) | Pass |
