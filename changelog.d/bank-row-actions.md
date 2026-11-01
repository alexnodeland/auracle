### Fixed: a bank row's actions and stars no longer cover its name

- **Pointing at a row, or opening its stars, leaves its name readable.** The
  actions (▶, ★, save, cut) sat over the end of the row, and the five stars
  over the actions' place, so a name like *Bright Sweep With A Long Name* read
  *Bright Swe*, and a short one went under the stars altogether: you could not
  see which sound you were about to rate or cut. A row is now two lines, the
  name on the first with the row's whole width, and the actions or the stars
  on the second. A name too long for the row ends in an ellipsis, and the
  whole of it is in its tooltip. A row is a little taller than it was, 48 px
  where it was 40, and the same height with the actions or the stars out as
  without, so no row moves when you point at one (`bank_names_uncovered.spec.js`,
  #534).
- **On a phone, the actions you swipe out and the stars give the name their
  room.** The name ends where they begin, in an ellipsis, rather than running
  under them. A phone on its side now has a wider bank sheet, so a swiped row
  still shows most of its name.
- **On a tablet 1024 px wide, a row's cut can be reached.** The bank is
  narrower there than four buttons a finger's size, and the last, cut, sat
  past its end. The buttons now share the row's width, and the stars take the
  line the actions leave without changing the row's height.
- **A preset's name has the row's whole width.** IN POOL moved from the end of
  its name to the line under it, beside the ▶, and no longer takes room from
  the name or crosses it when the ▶ shows.
