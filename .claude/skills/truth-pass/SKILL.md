---
name: truth-pass
description: >
  Find every description of an Auracle behaviour (guide, reference, landing
  page, films, in-app copy, changelog) and make it true after a change, or
  find where the app falls short of what it says. Use after any change a
  player can see or hear, and before recording a film.
---

# Truth pass

The app is described in many places, and they must all be true
(ADR-004: `docs/decisions/004-descriptions-stay-true.md`). When a
description and the app disagree, fix the app unless the app is right.

## 1. Name the behaviour in the app's own words

Collect the words a player meets: control names, button labels, toast text,
status lines, tooltips, knob labels (`describe.rs`, `SITE_NAMES` in
`main.js`). Include old words if you renamed something.

## 2. Search every surface

```bash
rg -n -i "<word>|<old word>" \
  www/docs/src www/reference/src www/landing/index.html \
  www/video/films/*/script.json www/video/films/*/storyboard.md \
  apps/web/index.html apps/web/*.js README.md CHANGELOG.md changelog.d
```

| Surface | Holds |
| --- | --- |
| `www/docs/src/views/*.md` | What each view does (`play.md` is PATCH) |
| `www/docs/src/**` | Getting started, glossary, how-tos |
| `www/reference/src/**` | How it works; constants quoted by name |
| `www/landing/index.html` | The pitch and its captions |
| `www/video/films/*/script.json` | Narration; `shots.json`/`film.js` hold on-screen callouts |
| `apps/web/index.html`, `*.js` | In-app copy, help card, tooltips, first-steps strip |
| `CHANGELOG.md`, `changelog.d/*.md` | What changed: each release's notes; the entries waiting for the next one are one file per change in `changelog.d/` (the older ones under `[Unreleased]`) |

## 3. Decide, for each hit

- **True**: leave it.
- **The app changed and the text is now stale**: fix the text in the same
  change.
- **The text is right and the app falls short**: fix the app, or report it
  with steps, what you saw and what the text says.
- **A film says it**: films are recordings; a changed line needs re-voicing and
  re-rehearsal. Tell whoever owns the film, or note it for the next recording.

## 4. Check it live when you can

Descriptions of timing, wording and layout are only confirmed in the running
app (`make serve`, or a browser spec asserting the text). Say which claims
you verified live and which from code.
