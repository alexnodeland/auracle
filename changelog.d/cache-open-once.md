### Fixed: a first visit on a machine with many cores

- **A first visit opens about 1.4 s sooner on most machines with eight cores
  or more.** Auracle opens once the first 8 of its 40 sounds are measured,
  and up to six workers measure them side by side. On a first visit each of
  them set up the place where your browser keeps measured sounds for next
  time, and six at once waited on one another's writes before the first
  sounds could land. The engine now sets it up once, before they start: in
  Chromium on a 16-core machine a first visit opened after 0.9 to 1.1 s,
  where it took 2.3 to 2.5 s. With two workers (four cores, or in Chromium
  4 GB of memory or less) the wait was small, and a first visit opens as
  fast or a little sooner (`render-store.test.mjs`, #200).
