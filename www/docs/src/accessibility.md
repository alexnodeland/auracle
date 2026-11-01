# Accessibility

<p class="lede">What works from the keyboard, with a screen reader, by touch,
and with reduced motion, and where Auracle still falls short. Coverage is
uneven, and this page says where.</p>

## Keyboard

**Everything about the patch can be reached from the keyboard,** wiring
included.

Each region is one tab stop, and the arrows move inside it. Tabbing through
several hundred rack controls would be unusable, so the bank’s list is one
stop, the patch is one stop (its modules walked with <kbd>←</kbd> and
<kbd>→</kbd> in signal order, <kbd>Enter</kbd> into one, <kbd>Esc</kbd> out),
and the catalog is one stop per group. The
bank’s three tabs are a tab list, one stop, whose <kbd>←</kbd> and
<kbd>→</kbd> show the next bank as they move; **Find a sound** and the
walkthrough’s **?** are a stop each between the tabs and the list.

**The levels.** <kbd>⌥↑</kbd> and <kbd>⌥↓</kbd> zoom out and in,
<kbd>⌥←</kbd> and <kbd>⌥→</kbd> go to EVOLVE and back, and <kbd>⌥1</kbd>–
<kbd>⌥5</kbd> go straight to a level, from anywhere but a text field or a
modal dialog (Alt off Apple platforms; in a text field there, Alt ← is the
browser’s Back). The levels at the stage’s right edge are a
navigation landmark named *Where you are*: each stop is a button named for its
level and what it is (*Taste: the sound among all sounds*), with its key in
`aria-keyshortcuts`, and the one you’re at is `aria-current="location"`.
Reached with <kbd>Tab</kbd>, the arrow keys walk them as they are drawn.
Clicking a stop moves focus into its level, so EVOLVE’s <kbd>←</kbd> and
<kbd>→</kbd> work at once. The menu bar names the level you’re at in a polite
live region, so a level key is announced where it went.

**The model view.** Holding <kbd>⌥</kbd> (Alt) shows it, under the same
rules; **MODEL** in the menu bar is a button whose <kbd>Enter</kbd> or
<kbd>Space</kbd> keeps it up (`aria-pressed`, and remembered across a reload),
and <kbd>Esc</kbd> ends it once nothing nearer takes the press. Its
tag, saying what the model believes and from how many picks, is a status, read
once as the view comes up. In PATCH, the belief line in the subtitle is a
status too, and the readout at the well's foot (a polite live region) reads
what the model makes of the selection; each worth chip names its family and
figure in its text, and each of the guess's runners-up is an image named for
its rank, its module and its lower bound. In PERFORM, each control's lean is
its description while the view is up, read with the control (*it leans
brighter*, with a **?** while it is a guess).

**⌘K.** <kbd>⌘K</kbd> (Ctrl K), **Find or do anything** in the menu bar, or
<kbd>?</kbd> away from PERFORM’s controls opens [one list of every
command](./levels.md#k-find-anything), so nothing the app does is only a
pointer’s. It is a modal dialog (`role="dialog"`, `aria-modal`) holding a
combobox: the focus stays in it (<kbd>Tab</kbd> walks its field and the two
links at its foot, the author and the source), the field names the row
<kbd>↑</kbd> and <kbd>↓</kbd> choose (`aria-activedescendant` over a
`listbox` of options), <kbd>↵</kbd> does it, and <kbd>Esc</kbd> closes it
and gives the focus back where it was (opened with a click on its button, it
leaves none, so <kbd>Space</kbd> plays after it). Each row’s name is its words and the
key that does the same, so the list reads the keys aloud as you walk it.
While it is open the keys are its field’s: nothing behind it hears them.

**PERFORM.** Its pads have keys, printed on each and given in
`aria-keyshortcuts`: <kbd>n</kbd> OFFER (NEXT), hold <kbd>b</kbd> PEEK,
<kbd>⇧↵</kbd> TAKE, and, once the sound has moved, <kbd>↵</kbd> KEEP with
nothing focused (a dial or BLEND turned with the mouse or a finger lets go of
the focus; one reached with <kbd>Tab</kbd> keeps it, and its Enter) and
<kbd>⇧⌫</kbd> BACK. They yield to a text field and a
modal dialog. Each named control and WANDER is a slider (arrows turn it,
<kbd>Home</kbd> centers it, <kbd>Enter</kbd> on a named control plays its
sweep and on WANDER freezes it); WANDER’s value reads *frozen* while it is,
since a slider cannot also be a toggle. BLEND is a native slider under the
faces while B holds an offer. **XY** in the well’s corner is a toggle button
(`aria-pressed`), and **HOW IT WORKS** a disclosure (`aria-expanded`); each
fills the well, and <kbd>Esc</kbd> inside it hands focus back to the button.
The moved bar’s KEEP and BACK leave the tab order while the sound is home.
The first-steps pill’s step is a status, read once as each new step comes up, and
its **×** is a button named *Stop showing these* (that level's steps). In PATCH,
<kbd>Home</kbd> and <kbd>End</kbd> walk to the first and last module only from
the canvas or with nothing in focus: on **VOL**, in a menu, in the catalog's
rows or under a dialog they keep their own meaning. **UNDO TO AS OPENED**
stays in the tab order when it can't go (`aria-disabled`), and pressing it
says why. The dashed face at OUT for the selected module's absence is
said in the readout (*Dashed at OUT: the sound without it, measured*, or
*silent without it*). Closing the catalog or TEACH with the keyboard puts the focus back
on the button that opened it; with the pointer, it lets the focus go, so
<kbd>Space</kbd> plays.

To place a module without a mouse:

1. Press <kbd>/</kbd> (or **ADD MODULE**) to open the catalog, and
   <kbd>Tab</kbd> to its groups.
2. Press <kbd>↑</kbd> and <kbd>↓</kbd> to choose a module.
3. Press <kbd>Enter</kbd> to pick it up.
4. Press <kbd>↑</kbd> and <kbd>↓</kbd> to walk the sockets it can go into.
   Each one is announced.
5. Press <kbd>Enter</kbd> to place it.

A setting on the rack (a wave, a filter mode) is a button: reached with the
keyboard, <kbd>Space</kbd> or <kbd>Enter</kbd> cycles it, and with
<kbd>Shift</kbd> it goes back. A click leaves no focus on it, so Space after a
click plays the sound you’re playing, as it does with a knob focused. Its name
says what it is set to (*VCO wave, sin*), and each change is read out.

PATCH's modules are announced as you walk them (*filter, module 3 of 5*);
the selected one's name and what it does are in the readout at the well's
foot, a live region. Every control in PATCH is a button or a knob a keyboard
reaches, the face at OUT included (it plays the sound), and on a touch screen
each is 40 px or more: the head's acts, the camera's corner, the menus, and a
module's sheet with its lane's buttons.

Focus is always visible, and a dialog returns focus to whatever opened it.
[Keyboard and MIDI](./keyboard.md) has the full map.

## Screen readers

- **The bank announces its cursor.** The list follows it with
  `aria-activedescendant`.
- **A bank row says its whole state:** its name, whether it’s saved, its
  rating, and the model’s guess (at rest too, though the guess is drawn only
  under the model view). The row’s buttons sit outside the tab order, so the
  label carries what they show, and <kbd>1</kbd>–<kbd>5</kbd>, <kbd>m</kbd> and
  <kbd>c</kbd> reach what they do.
- **The bank’s list is named by its tab** (*Pool*, *Saved*, *Presets*), and
  the tabs control it.
- **A socket says what will happen** when you arrow onto it: whether placing
  the module there inserts it, replaces what’s there, or shapes it.
- **Toasts** are read from a live region.
- **A lasting condition,** such as a sound muted because it failed its check,
  or an engine that has stopped, goes to a pinned alert that stays until it’s
  resolved, rather than a toast that might vanish before it’s read.

## Touch

Every rack gesture works under a finger on a tablet or a phone: knob drags,
cable pulls, locks, and the ⋯ menus.

Two rules make that work. Controls that own a drag claim the gesture before
the browser can, which leaves the rack’s frame its own panning. And whatever a
mouse finds by hovering (knob lock dots, a bank row’s actions) is shown
outright on a touch screen, because on a tablet, hover-to-reveal means never:
every bank row shows its actions (and every preset its **▶**) at rest, on a
line under its name, so a sound can be heard, rated, saved or cut without
opening it. On a phone a bank row is a list's row, as a phone's own are: its
name and its **▶** at rest, and swiped left it slides out its other
actions (**★**, save, cut) at its end; swipe it back, scroll the list or tap
another row and they go. They are still there for a screen reader, a
keyboard and a mouse: focus in the row slides them out as a swipe does. **MODEL**’s press and hold is the model view under a finger, and
two fingers spread or pinched on the stage zoom between the levels (two
that start on PATCH’s patch move no level); a tap on a stop in the levels
does the same. The stage keeps a pinch for the levels, so the browser does
not zoom the page there, by a pinch or by a double tap. A pinch still
zooms the page over the bank, the menu bar and the keys, and your system’s
own zoom works everywhere.
Small glyphs get an invisible pad for a finger, only on touch screens, so the
desktop is unchanged. A phone prints no keys: the key beside a button and the
letters on the keybed are left off, and the keybed keeps each C's octave. A
tablet keeps them, since it may have a keyboard.

### Two gestures: swipe up to pick, long press to see what the model believes

- **Swipe a card up to pick it.** In EVOLVE, put a finger on a card's face
  and swipe up: the card follows. Let go past a third of its height, or
  swipe up fast, and it is picked exactly as its **PICK** would pick it,
  with the same moment to take it back. Let go short of that and it settles
  back, picking nothing. A drag down or sideways is not the card's, and on
  a phone nothing under it scrolls either: the level stands still. Under reduced motion the card
  still follows the finger, and settles back without a slide.
- **Long press to see what the model believes.** A long press (about half a
  second, without moving) on an EVOLVE card, a bank row or TASTE's map shows
  the model view for as long as the finger stays down, as holding
  <kbd>⌥</kbd> does on a keyboard. A ring fills under the finger while you
  press; moving the finger first makes it an ordinary touch. Lift it and the
  view goes, and the long press opens nothing. With the model view already
  up (a tap on **MODEL** keeps it), a long press changes nothing. A bank
  row's actions stay on the row at rest; a long press does not replace
  them. On PATCH's rack a long press on a module keeps its own meaning: it
  opens the module's menu.
- **On PERFORM a long press on a control opens its figure** (see
  [Explain a control](./views/perform.md)).

Nothing is selected and no callout or magnifier opens under a long press:
on a phone no text in the app is selected by a finger, but in a field (a
tablet's and a touch laptop's text still selects).

### On a phone, a tablet and a narrow window

Every size starts the instrument. On a window under 1000 px wide (a tablet
held upright, a narrow desktop window) the bank leaves its column: the button
of three lines at the start of the menu bar opens it as a sheet over the
stage, and a sound chosen in it, a tap beside it, <kbd>Esc</kbd> or that
button again puts it away.

On a phone held upright:

- The levels are the bar along the bottom, each stop named under its icon:
  PERFORM (the sound under your hands) first, then PATCH, TASTE, LEARNING,
  then EVOLVE beside them. A tap goes there.
- **KEYS** at the bar's end brings the keys up over it: the octave, the
  volume, **REC** (its dot) and **KEYS ⋯** on one row, MIDI a row inside
  **KEYS ⋯**, and one octave across the screen under them, each key a finger wide (**span** in **KEYS ⋯** shows
  more). **KEYS** again puts them away.
- The bank rises from the bottom. Pull its handle down, or tap it, to put it
  away.
- Each level is one screen and stands still, as an app's view does, with
  the keys up or down: nothing in it scrolls, and what it is for (PERFORM's
  controls, EVOLVE's **PLAY** and **PICK**, the rack, the maps) is in sight.
  What says again what the bar says (a level's name over it) is left off,
  and with the keys up what is for looking at gives its room to what is for
  the hands: PERFORM's name and well (on a phone under 800 px tall),
  EVOLVE's map and the row under the pair, until the keys go down. Where a level holds more than one screen, a
  row of tabs under its head shows one part at a time: PERFORM's
  **controls** (with the pads) or **under the hood**, and LEARNING's **where
  liking rises**, **what it weighs** or **its forecasts**. A list scrolls,
  as a phone's own lists do: the bank's, the catalog's, the rows under the
  hood, and what LEARNING weighs. On a smaller phone, or with larger text, a level that cannot
  fit scrolls rather than cutting anything off. Nothing scrolls sideways.
- In the levels, the bank and the keys, every button, tab and field is at
  least 44 px each way, a finger's size
  (what is drawn on the rack at its zoom is the exception: a tapped module
  opens its settings in a sheet), and the octave's two keys are arrows (a
  phone has no Z and X to print).

On a phone on its side, the levels stay at the right edge with the keys'
button (a small keybed) under them, and the keys come up from the bottom.
Each level is one screen there too, LEARNING's map beside what it weighs and
its forecasts. On any touch screen the levels' stops are a finger's size.

A toast keeps clear of every control and each level's heading, at every
size but one: PERFORM with the keys up on a small phone (below). It stands
nearest the stage's bottom right, in free space or over the level's picture
(PERFORM's well, an EVOLVE card's, the rack, TASTE's map), and higher up the
level when nothing lower is free. On a phone held upright it is a banner as
wide as its words up to the screen's: one or two lines with its action
beside them, one at a time, in the free band of the level nearest its foot
(on PERFORM inside the well, over its floor under the sound's face; on
EVOLVE under the cards' corners, away from the thumb that swipes a card up).
On a phone on its side it stands where it is free, as on a wider screen.
Where PERFORM has no other room (on a small phone, or with the XY pad or HOW
IT WORKS filling the well), the first-steps pill steps aside while the toast
stands in its place: unseen, its × out of reach until the toast goes, its
step still read as it comes up. On a phone the banner then keeps to one row
if two would not fit, its words beside its action. With the keys up on a
small phone PERFORM has no room left even so, and a toast stands over the
foot of its knobs for its moment, their middles still free to turn. Swipe it
up to put it away (taking it back is its action's, as before).

## Hit targets

Hit areas are measured, not eyeballed. A knob’s whole face is grabbable,
including under its ticks, track, and value arc, and a jack answers across its
whole ring rather than only where its outline is drawn.

On a touch screen, where the rack is drawn small, the ▶ on the face at OUT
answers a finger 44 px across (not while sockets are lit, so it never stands
over the one beside it). While sockets are lit (a module in hand, a cable
being placed), a tap on bare panel goes to a lit socket when the finger
plainly means it: within 22 px of its middle, with no other lit socket
within one and a half times that distance. A cable let go on bare panel
goes in the same way from within 12 px; let go on a control, between two
sockets, or away from them, it does what it did before. With nothing lit, a
tap within 22 px of an out ○ (the same way, plainly meaning it) picks its
cable up, as a tap on it does, rather than opening that module's settings; a
drag from there still pans. A module's ⋯ and its lock reach out the same
way: a tap within 22 px of either, plainly meaning it, opens the menu or
locks the module, as a tap on it does. A tap on a module's name, a knob or a
socket is always that one's. An input that is not lit keeps its drawn size:
a tap there does nothing, and a drag from it pulls its cable out. UNDER THE
HOOD's rows are 44 px too, the hood showing three and scrolling on its own
to the rest.

## Color and contrast

Text meets **4.5:1** against its background. The palette has two tiers for
this: a text tier that clears the ratio, and a stroke tier for cable glow and
jack rings, where contrast rules don’t apply.

**Color is never the only signal.** Green and amber tell audio from
modulation, but every modulation cable also ends in a named destination, and
each jack is labeled as well as colored. The styles are colored on the taste
map, and named in words everywhere they appear.

## Type size

**No text in the panels is smaller than 11 px,** and none drawn on a canvas
(the scopes, and TASTE’s map and tabs) is smaller than 12 px.

The rack is the exception, because it’s drawn to its zoom. Its labels are 9 to
13 px at 1×, and grow as you zoom in. A label that would print smaller than
9 px, the rack's smallest at 1×, is left off, unless detail is set to full.
A module's name prints larger wherever it would print under the panels'
11 px, and the rack's fit stops where that larger name is 11 px, so no name
at the fit is smaller (a patch too big to fit at that size pans). A glyph on a button (▶, ✓) is sized to its
button.

Your browser’s own zoom (<kbd>⌘+</kbd> and <kbd>⌘−</kbd>; Ctrl + and Ctrl −
off a Mac) scales the whole page. Over the stage, <kbd>Ctrl</kbd> and the
wheel and a pinch don’t: they move between the levels there, and zoom the
patch in PATCH.

## Motion

The rack pulses modulation cables at their modulator’s rate. That pulse is
information, not decoration.

Moving between the levels, the level you leave fades and the one you reach
comes in from the other side while the face of the sound you’re playing
travels between them, for about two thirds of a second, with a light along
the levels from the stop you left to the one you reach.

Auracle follows your system’s reduced-motion setting, and follows it live if
you change it with the app open. With it on, the cable pulses, glows, and
transitions stop; a move between the levels is instant, with no face
traveling and no light along the levels; the rack jumps to a new layout or
view instead of gliding, and the bank’s rows jump to the model view’s order
rather than glide; a card waiting for its sound stops sweeping; and nothing
is drawn over a sound’s face while you play it, where it otherwise lights up
with what you hear. The scope still moves,
because what it shows is the sound, but it redraws ten times a second rather
than every frame. The guide and the reference follow the setting too.

## Known gaps

- **A phone pays for its boot.** A phone renders the same 40 sounds at boot
  as a desktop does, on a slower processor, so the first sound takes longer
  to be ready there.
- **The taste map is mostly visual.** Its sounds can be walked with the arrow
  keys, each card says the sound’s name and the model’s guess, and a pick is
  announced (*You picked Glass Pad over Soft Wash. Every rating moved.*).
  LEARNING’s weights carry the model’s leans as named qualities, each row
  read with its weight and whether it is still a guess. The map’s spatial
  reading has no other form.
- **Screen-reader support is deepest where it was tested.** The bank and the
  wiring path were built and checked with a screen reader. The scope’s
  settings and the picture download were not.
- **No high-contrast theme.** The palette clears AA, but there is no AAA mode
  and no way to raise contrast beyond it.

If you find something not listed here, [an
issue](https://github.com/alexnodeland/auracle/issues) helps.
