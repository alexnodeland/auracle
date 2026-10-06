// The lint for the browser specs and their helpers (#177 §1.2, #178): the
// Playwright plugin's recommended rules, and the house rules of
// tests/web/AGENTS.md that a syntax rule can see. `make web-check` runs it,
// and so CI's Web job, and the after-edit hook lints a file here when it is
// edited.
//
// Every rule is an error. Today's violations are in eslint-suppressions.json,
// counted per file and rule: a count may fall and never rise, and a file with
// no entry (a new spec) starts at zero. Fix a violation rather than suppress
// it; when you fix one, `npx eslint --prune-suppressions` records the fall
// (the lint fails until it does). `--suppress-all` is not run again: it
// would take every new violation into the baseline (a rule new to the set
// takes in its findings once, by name: `--suppress-rule <rule>`). How to fix
// each rule is in tests/web/AGENTS.md § The lint.
import { defineConfig } from "eslint/config";
import playwright from "eslint-plugin-playwright";

// The plugin's recommended set, every rule an error: ESLint's suppressions
// hold errors only, so a warning would be neither counted nor gated.
const recommended = Object.fromEntries(
  Object.entries(playwright.configs["flat/recommended"].rules).map(([rule, level]) => [rule, level === "off" ? "off" : "error"]),
);

// A house rule: each selector (esquery, as no-restricted-syntax takes them)
// reported with its message. A rule of its own rather than one
// no-restricted-syntax, so each has its own count in the suppressions: a file
// cannot trade one kind of violation for another and keep its count.
const restrict = (description, message, ...selectors) => ({
  meta: { type: "problem", docs: { description }, schema: [] },
  create: (context) => Object.fromEntries(selectors.map((s) => [s, (node) => context.report({ node, message })])),
});

// Code a spec hands the page to run: what it reads is the page's clock and
// the page's state, not the runner's.
const PAGE_SIDE = `CallExpression[callee.property.name=/^(evaluate|evaluateAll|evaluateHandle|addInitScript|waitForFunction|\\$eval|\\$\\$eval)$/] *`;
// main.js's debug hook, under both its names.
const AUR = "/^__(aur|ric)$/";
const AUR_READ = `MemberExpression:matches([object.object.name="window"][object.property.name=${AUR}], [object.name=${AUR}])`;
// The members of window.__aur a helper may read: the ones the suite read when
// the lint came in (#178). One more is a review decision, made here.
const AUR_ALLOWED = ["audioCtx", "audioIn", "getLive", "marks", "patch", "takes", "wb"];
// What a player does to the page: Playwright's actions.
const ACTIONS =
  "/^(click|dblclick|tap|press|pressSequentially|type|fill|clear|check|uncheck|setChecked|selectOption|selectText|setInputFiles|hover|focus|blur|dragTo|dispatchEvent|down|up|move|wheel|insertText)$/";
const EXPECT = 'CallExpression:matches([callee.name="expect"], [callee.object.name="expect"][callee.property.name="soft"])';
// A name that holds a duration: ms, took, elapsed, waitedMs, pickMs, OPEN_MS.
const DURATION =
  "/^(ms|dt|took|elapsed|waited|latency|duration|delay|lag)$|(Ms|MS|_ms|Elapsed|Took|Latency|Duration|Delay|Lag|Waited)$|^(ms|elapsed|took|latency|duration|delay|lag)[A-Z_]/";

const house = {
  meta: { name: "auracle" },
  rules: {
    "use-the-fixture": restrict(
      "a spec takes test and expect from ./fixtures",
      "Take test and expect from ./fixtures, not @playwright/test: the fixture fails a test on any page error and gives it the tap (app). tests/web/AGENTS.md § Writing a spec.",
      'CallExpression[callee.name="require"][arguments.0.value="@playwright/test"]',
      'ImportDeclaration[source.value="@playwright/test"]',
    ),
    "no-runner-clock": restrict(
      "no clock read on the runner in a spec",
      "No clock on the runner in a spec (ADR-022): wait for the state or the reply (app.reply, app.engine), mark a moment with app.now(), read the app's own marks with app.marks(), and record how long something took with app.budget().",
      `CallExpression[callee.property.name="now"]:matches([callee.object.name=/^(Date|performance)$/], [callee.object.property.name="performance"]):not(${PAGE_SIDE})`,
    ),
    "no-own-pageerror": restrict(
      "no pageerror listener outside the fixture",
      "No pageerror listener of a spec's own: the fixture's auto fixture pageErrors fails the test on any page error, on every page of its context.",
      'CallExpression[callee.property.name=/^(on|once|addListener|prependListener|waitForEvent)$/][arguments.0.value="pageerror"]',
    ),
    "no-aur-in-spec": restrict(
      "no read of window.__aur in a spec",
      "window.__aur is main's private state: assert what a player sees, or the engine's reply through the tap (app.reply, app.facts). A read a spec cannot do without goes in a named helper (fixtures.js, patch_page.js).",
      AUR_READ,
    ),
    "aur-allow-list": restrict(
      "a helper reads only the members of window.__aur on the allow-list",
      `This member of window.__aur is not on the allow-list (AUR_ALLOWED in eslint.config.mjs): ${AUR_ALLOWED.join(", ")}. Read what a player sees or what the tap heard, or add it to the list in review.`,
      `${AUR_READ}:not([property.name=/^(${AUR_ALLOWED.join("|")})$/])`,
    ),
    "no-read-after-action": restrict(
      "no one-shot expect(await …) straight after an action",
      "A one-shot read straight after an action races the app's answer to it. Wait for the state: await expect(locator).toHaveText(…) (or toHaveAttribute, toHaveCount, …), expect.poll(() => …), or app.reply(…).",
      `ExpressionStatement[expression.type="AwaitExpression"][expression.argument.callee.property.name=${ACTIONS}] + ExpressionStatement:has(${EXPECT} > AwaitExpression.arguments)`,
    ),
    "budget-not-expect": restrict(
      "a bound on how long something took is a budget",
      "How long something took is a budget, never an expect (ADR-022): app.budget(name, ms, limit), or budget from ./fixtures. An order on the app's clock compares two moments, not a moment and a limit.",
      'CallExpression[callee.property.name=/^toBeLessThan(OrEqual)?$/]:matches([callee.object.callee.name="expect"], [callee.object.callee.object.name="expect"][callee.object.callee.property.name="soft"])' +
        `:matches([callee.object.arguments.0.name=${DURATION}], [callee.object.arguments.0.property.name=${DURATION}])` +
        ':matches([arguments.0.type="Literal"], [arguments.0.name=/_MS$/])',
    ),
  },
};

export default defineConfig([
  { ignores: ["test-results/", "playwright-report/", "blob-report/", "all-blobs/"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  // The specs and their helpers are CommonJS. The .mjs files (shard.mjs,
  // changed.mjs, this one) are Node tools, not Playwright code: linted for
  // what any script is, without the plugin, whose describe-callback rule
  // takes shard.mjs's own describe() for Playwright's.
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    plugins: { playwright, auracle: house },
    rules: {
      ...recommended,
      // It takes the fixture's app.last(…) (a promise) for Locator.last(),
      // and its fix deletes the await the test needs: all five of its
      // findings were that.
      "playwright/no-useless-await": "off",
      "auracle/no-own-pageerror": "error",
    },
  },
  {
    files: ["**/*.spec.js"],
    rules: {
      "auracle/use-the-fixture": "error",
      "auracle/no-runner-clock": "error",
      "auracle/no-aur-in-spec": "error",
      "auracle/no-read-after-action": "error",
      "auracle/budget-not-expect": "error",
    },
  },
  // The fixture's helpers. fixtures.js is where @playwright/test comes in and
  // where the one pageerror listener is; shell.js and perform_budget.js are
  // required by it, so they cannot take it from ./fixtures.
  {
    files: ["**/*.js"],
    ignores: ["**/*.spec.js"],
    rules: { "auracle/aur-allow-list": "error" },
  },
  { files: ["fixtures.js"], rules: { "auracle/no-own-pageerror": "off" } },
  // It opens no page: it loads the built wasm in Node and compares what it
  // deals with the native engine's (testing.md). It has no app to tap and no
  // page to fail on.
  { files: ["boot_agrees.spec.js"], rules: { "auracle/use-the-fixture": "off" } },
]);
