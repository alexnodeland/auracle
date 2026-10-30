// A key tapped on a phone always sounds (#134): the maintainer, on an iPhone,
// now and then tapped a key and heard nothing and saw no face move.
//
// What this claims, on a phone held upright with touch:
//
// - With the audio context "interrupted" (iOS Safari's state after a call,
//   the lock screen, another app's audio or Control Centre; the app woke
//   only a "suspended" one), a key tapped asks the context to resume, on its
//   press and again on its lift (a touch's pointerdown is not a gesture iOS
//   lets start audio; its pointerup is), and its note goes to the live
//   voice.
// - A key struck after the octave was shifted up and back sends its note
//   once: the keybed gathered a set of listeners per rebuild.
//
// What it does not claim: that iOS itself resumes the context (Playwright's
// WebKit has no interruption to make); the state is put in the page
// (`app.audioState`).
const { test, expect } = require("./fixtures");

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("a key tapped while the audio is interrupted wakes it, and sounds once after octave shifts", async ({ page, app }) => {
  await app.boot();
  await page.locator("#keys-toggle").tap();
  await expect(page.locator("#keybar")).toBeVisible();
  await app.audioState("interrupted");
  await page.locator("#piano .pkey").nth(2).tap();
  await expect.poll(() => app.audioCounts(), "the interrupted context was not asked to resume, or the note never reached the voice")
    .toEqual({ resumes: expect.any(Number), notes: 1 });
  await expect.poll(async () => (await app.audioCounts()).resumes, "asked to resume on the press and the lift").toBeGreaterThanOrEqual(2);

  await app.audioState("running");
  await page.locator("#oct-up").tap();
  await page.locator("#oct-down").tap();
  await expect(page.locator("#oct-label")).toHaveText("C4");
  await app.audioCounts({ reset: true });
  await page.locator("#piano .pkey").nth(2).tap();
  await expect.poll(async () => (await app.audioCounts()).notes, "one tap struck the note more than once").toBe(1);
  await app.quiet();
  expect((await app.audioCounts()).notes, "one tap struck the note more than once").toBe(1);
});
