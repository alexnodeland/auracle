export const meta = {
  name: 'fix-flake',
  description: 'Diagnose one flaky auracle browser test from the run that caught it, fix the test or the app at the cause, prove it under load and by mutation, review, and finalize the branch; the operator pushes',
  whenToUse: 'One flaky test (a Flaky: issue, or a red run a dequeued PR did not cause) with its worktree created from origin/main. Runs when the maintainer asks for it by name (it spends many tokens); the ship-wave skill has the steps around it.',
  phases: [
    { title: 'Diagnose', detail: "the run's failed log and trace, the spec and the app path, reproduced at throttle 4 and under load; the cause named" },
    { title: 'Fix', detail: 'the test, or the app when it is at fault; the quarantine tag comes out' },
    { title: 'Prove', detail: '--repeat-each=5 at throttle 4 and under load, and a mutation the test must fail on' },
    { title: 'Review', detail: 'the reviewer agent, read-only, then the fixes and a re-check of the blocking ones' },
    { title: 'Finalize', detail: 'rebased onto origin/main, the quick gates again, the PR checks on the title and body' },
  ],
}

// args: { spec: 'patch_facts' | 'tests/web/patch_facts.spec.js', test_title: '…', run_id: <the run that caught it>,
//         issue?: <its Flaky: issue>, branch: 'claude/<topic>', worktree: '/abs/path', port,
//         agentType?: 'web-engineer' (default), session?: 'https://claude.ai/code/session_…' }
// Returns { workflow, session, items: [{ key, issue, branch, worktree, status, problems, diagnosis, proof,
// final, review, verify, labels }] }, one item, in ship-issues' shape (scripts/ops/wf_result.py reads both).

const REPO = 'alexnodeland/auracle'
const MAX_ROUNDS = 2

function need(ok, what) {
  if (!ok) throw new Error(`fix-flake: ${what}`)
}
need(args && typeof args === 'object' && !Array.isArray(args), 'args is an object, {spec, test_title, run_id, branch, worktree, port}, passed as JSON (not as a string)')
need(typeof args.spec === 'string' && args.spec, 'spec names the spec file')
need(typeof args.test_title === 'string' && args.test_title, "test_title is the test's title")
need(Number.isInteger(Number(args.run_id)) && Number(args.run_id) > 0, 'run_id is the run that caught it')
need(args.issue === undefined || args.issue === null || Number.isInteger(args.issue), 'issue, when given, is a number')
need(typeof args.branch === 'string' && args.branch.startsWith('claude/'), 'branch is claude/<topic>')
need(typeof args.worktree === 'string' && args.worktree.startsWith('/'), 'worktree is an absolute path')
need(Number.isInteger(args.port), 'port is a number (8771 and up)')
const SESSION = typeof args.session === 'string' && args.session ? args.session : null
need(!SESSION || /^https:\/\/claude\.ai\/code\/session_\w+$/.test(SESSION), 'session is a https://claude.ai/code/session_… link')

const ISSUE = Number.isInteger(args.issue) ? args.issue : null
const FILE = args.spec.includes('/') ? args.spec : `tests/web/${args.spec.replace(/\.spec\.js$/, '')}.spec.js`
const NAME = FILE.replace(/^.*\//, '').replace(/\.spec\.js$/, '')
const KEY = ISSUE ? `#${ISSUE}` : NAME
const WT = args.worktree
const PORT = args.port
const BUILDER = args.agentType || 'web-engineer'
const RUN = `cd ${WT}/tests/web && AURACLE_TEST_PORT=${PORT} AURACLE_CPU_THROTTLE=4 ../../www/video/tools/one_browser.sh npx playwright test ${FILE.replace(/^tests\/web\//, '')} -g ${JSON.stringify(args.test_title)} --reporter=line`

// The operator's rules a stage needs; the AGENTS.md files hold the rest.
const RULES = `Rules for this run (docs/process.md; the operator's):
- Work only in your worktree, never in the main checkout. Commit only: never push, open or edit a PR, comment on GitHub, or merge; the operator does all of that. Never change any git config. Run git with the GIT_* variables unset (env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git ...).
- Commit with: git -c user.name="Alex Nodeland" -c user.email="nodeland.alex@gmail.com" -c core.fsmonitor=false commit. Small commits; a loose conventional prefix (tests:, fix(web):); a body that says what was wrong and why this is the fix;${ISSUE ? ` "Refs #${ISSUE}" in the body;` : ''}${SESSION ? ` the LAST line of every message, exactly: Claude-Session: ${SESSION}` : ''}
- No hand-written attribution: no Co-Authored-By, no "generated with" line, no model name or version.
- Browser runs only through www/video/tools/one_browser.sh with AURACLE_TEST_PORT=${PORT}; this test and the specs you touch, never a full suite. make wasm first when apps/web/pkg is missing or older than the Rust. tests/web needs its packages once: cd tests/web && npm ci.
- Load is made with a few busy loops (yes > /dev/null &), each PID written down and stopped by that PID when the run ends; never pkill -f.
- No retry, and no slack added in place of a cause (ADR-022: a slow runner may make a test slower, never wrong).
- In-area problems are fixed in this branch; only a choice for the maintainer (kind decision) or another area's work (kind other_area) leaves the PR.
- Scratch files go in a directory of your own (mktemp -d), outside every checkout.`

const TITLE = /^(feat|fix|docs|tests|test|ci|build|refactor|perf|chore|revert|style|release)(\([^()\s]+\))?!?: \S/
const BODY_DOC = `Markdown, for the PR: ## What (the flake: the test, the run that caught it, what failed), ## Cause (its class and the evidence: the trace, the log, the reproduction), ## Fix (the test or the app, and why this removes the cause rather than hiding it), ## Proof (the repeat runs at throttle 4 and under load with their counts, and the mutation the test failed on), ## Checks (the gates, the review and what it found); then ${ISSUE ? `a "Closes #${ISSUE}" line` : 'a "Refs #n" line for each issue it advances, or a line starting "No issue:" saying why'}${SESSION ? `; the LAST line is exactly ${SESSION}` : '; no session link'}`

const CAUSES = [
  'time-not-state', // a wait on a time where it should wait on a state, or on the reply to its own request (ADR-022, an engine fact)
  'runner-clock', // a promise about the app's own timeline read on the runner's clock, not by order, the app's marks, page.clock or AudioContext time
  'speed-bound', // a measurement of the machine's speed asserted where it should be a budget
  'overwritable-injection', // an injected reply the engine's own can overwrite
  'double-count', // an exact count of something a slow runner may do twice
  'early-read', // read before the state can have settled, or a request read before it can have been sent
  'app-race', // a real race in the app: the app is at fault
  'other',
]

const FINDING = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    line: { type: 'integer' },
    summary: { type: 'string' },
    scenario: { type: 'string', description: 'concrete inputs or state, and the wrong result' },
    other_area: { type: 'boolean', description: 'true when the fix belongs to an area this branch does not touch' },
  },
  required: ['file', 'summary', 'scenario'],
}
const OPEN_ITEM = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['in_area', 'decision', 'other_area', 'note'], description: 'in_area: not done yet in what this branch touches (the fix stage does it). decision: the exact question for the maintainer. other_area: another area\'s work, an issue. note: needs no work.' },
    text: { type: 'string' },
  },
  required: ['kind', 'text'],
}
const VOICE = {
  type: 'object',
  properties: { words: { type: 'string' }, where: { type: 'string' }, voice_md_row: { type: 'string' } },
  required: ['words', 'where', 'voice_md_row'],
}
const DIAGNOSIS = {
  type: 'object',
  properties: {
    cause_class: { type: 'string', enum: CAUSES },
    cause: { type: 'string', description: 'what happens, step by step, when it fails' },
    evidence: { type: 'array', items: { type: 'string' }, description: "what shows it: lines of the failed log, the trace's actions and timings, code at file:line" },
    at_fault: { type: 'string', enum: ['test', 'app', 'machine'] },
    reproduced: {
      type: 'object',
      properties: { how: { type: 'string', description: 'the commands, the throttle and the load' }, runs: { type: 'integer' }, failures: { type: 'integer' } },
      required: ['how', 'runs', 'failures'],
    },
    quarantined: { type: 'boolean', description: 'the test is tagged @quarantine now' },
    fix_plan: { type: 'string' },
    mutation_plan: { type: 'string', description: 'how to break the behavior the test claims, for the proof: the file and the change' },
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['cause_class', 'cause', 'evidence', 'at_fault', 'reproduced', 'quarantined', 'fix_plan', 'mutation_plan', 'files'],
}
const REPORT_PROPS = {
  head: { type: 'string', description: 'full SHA of the branch head' },
  commits: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' },
  gates: { type: 'array', items: { type: 'string' } },
  browser_runs: { type: 'array', items: { type: 'string' } },
  user_visible: { type: 'boolean' },
  changelog_fragment: { type: ['string', 'null'] },
  voice_drafts: { type: 'array', items: VOICE },
  decisions: { type: 'array', items: { type: 'string' } },
  before_after: { type: 'string' },
  closes: { type: 'array', items: { type: 'integer' } },
  refs: { type: 'array', items: { type: 'integer' } },
  needs_full_ci: {
    type: 'object',
    properties: { value: { type: 'boolean' }, reason: { type: 'string', description: 'which changed file puts it in the Slow suite (docs/process.md § CI and merging): a spec holding an @slow or @quarantine test does' } },
    required: ['value', 'reason'],
  },
  open_items: { type: 'array', items: OPEN_ITEM },
  pr_title: { type: 'string', description: 'type(scope): what is true now, e.g. tests: <the test> waits on <the state>, not on <the time>' },
  pr_body: { type: 'string', description: BODY_DOC },
}
const REPORT_REQUIRED = Object.keys(REPORT_PROPS)
const REPORT = { type: 'object', properties: REPORT_PROPS, required: REPORT_REQUIRED }
const FINAL = {
  type: 'object',
  properties: { ...REPORT_PROPS, base: { type: 'string' }, conflicts: { type: 'string' }, pr_checks: { type: 'string' } },
  required: [...REPORT_REQUIRED, 'base', 'conflicts', 'pr_checks'],
}
const RUNS = {
  type: 'object',
  properties: { command: { type: 'string' }, runs: { type: 'integer' }, failures: { type: 'integer' } },
  required: ['command', 'runs', 'failures'],
}
const PROOF = {
  type: 'object',
  properties: {
    repeat: RUNS,
    loaded: RUNS,
    mutation: {
      type: 'object',
      properties: {
        change: { type: 'string', description: 'the file and what was broken' },
        failed_as_expected: { type: 'boolean' },
        output: { type: 'string', description: 'the failing assertion, as printed' },
      },
      required: ['change', 'failed_as_expected', 'output'],
    },
    tree_clean: { type: 'boolean', description: 'git status is clean at the head you were given once you are done' },
    ok: { type: 'boolean', description: 'no failure in either run, the mutation caught, the tree clean' },
    notes: { type: 'string' },
  },
  required: ['repeat', 'loaded', 'mutation', 'tree_clean', 'ok', 'notes'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    blocking: { type: 'array', items: FINDING },
    should_fix: { type: 'array', items: FINDING },
    maintainers_call: { type: 'array', items: FINDING },
    nits: { type: 'array', items: FINDING },
  },
  required: ['verdict', 'blocking', 'should_fix', 'maintainers_call', 'nits'],
}
const VERIFY = {
  type: 'object',
  properties: { all_resolved: { type: 'boolean' }, remaining: { type: 'array', items: FINDING }, notes: { type: 'string' } },
  required: ['all_resolved', 'remaining', 'notes'],
}

const fmt = fs => fs.map(f => `- ${f.file}${f.line ? ':' + f.line : ''}: ${f.summary}\n  scenario: ${f.scenario}${f.other_area ? '\n  (another area)' : ''}`).join('\n') || '- none'
const json = x => JSON.stringify(x, null, 1)
const THE_TEST = `${FILE} '${args.test_title}'`

function problemsOf(r, proof) {
  const out = []
  if (!TITLE.test(r.pr_title || '')) out.push(`the title has no conventional type: ${r.pr_title}`)
  const lines = (r.pr_body || '').split('\n').map(l => l.trim())
  if (ISSUE) {
    if (!(r.closes || []).includes(ISSUE)) out.push(`closes does not list #${ISSUE}`)
    if (!lines.some(l => new RegExp(`^closes:?\\s+#${ISSUE}\\.?$`, 'i').test(l))) out.push(`the body has no "Closes #${ISSUE}" line`)
  } else if (!lines.some(l => /^(refs?:?\s+#\d+|no issue:)/i.test(l))) out.push('the body names no issue and has no "No issue:" line')
  if (SESSION && lines.filter(Boolean).pop() !== SESSION) out.push('the body does not end with the session link')
  for (const o of (r.open_items || []).filter(o => o.kind === 'in_area')) out.push(`an in-area item is left: ${o.text}`)
  if (!proof) out.push('no proof came back')
  else if (!proof.ok) out.push('the proof did not pass: read it before the PR')
  return out
}

phase('Diagnose')
const diagnosis = await agent(
  `Diagnose a flaky browser test of ${REPO}: ${THE_TEST}, which failed in run ${args.run_id}.${ISSUE ? ` Its issue: gh -R ${REPO} issue view ${ISSUE} --comments.` : ''}
Worktree: ${WT} (branch ${args.branch}, from origin/main). Browser port: ${PORT}.

1. The run: gh -R ${REPO} run view ${args.run_id} --log-failed (the first error and what led to it). Its merged browser report is an artifact named browser-report-* (gh api repos/${REPO}/actions/runs/${args.run_id}/artifacts lists them): gh -R ${REPO} run download ${args.run_id} -p 'browser-report-*' -D <your scratch directory>. The test's trace is a zip under the report's data/: read its actions, their timings, the console and the network (unzip it; trace.trace and trace.network are JSON lines).
2. The spec and the app path it drives: read the test, the fixture helpers it uses (tests/web/fixtures.js), and the app code behind each wait and assertion.
3. Reproduce it: ${RUN} --repeat-each=10, then the same under load (a few busy loops, each PID stopped by PID afterwards). Say how often it failed each way.
4. Name the cause's class: ${CAUSES.join(', ')} (ADR-022, docs/decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md; docs/process.md § Flakes; tests/web/AGENTS.md on waits). Say whether the test, the app or the machine is at fault: the app when it loses a race or never reaches a state it promises.
5. Plan the fix, and plan the mutation the proof will make: the smallest change to the app that breaks the behavior the test claims, so the fixed test must fail on it.

Change nothing committed: instrumentation is reverted and the tree clean before you report.

${RULES}`,
  { label: `diagnose ${KEY}`, phase: 'Diagnose', agentType: BUILDER, effort: 'high', schema: DIAGNOSIS },
)
if (!diagnosis) {
  log(`${KEY}: the diagnosis did not return`)
  return { workflow: 'fix-flake', session: SESSION, items: [{ key: KEY, issue: ISSUE, branch: args.branch, worktree: WT, status: 'failed', problems: ['the diagnosis did not return: read its transcript, then run again'] }] }
}
log(`${KEY}: ${diagnosis.cause_class}, the ${diagnosis.at_fault} at fault; reproduced ${diagnosis.reproduced.failures} of ${diagnosis.reproduced.runs}`)

function fix(report, extra, round) {
  return agent(
    `${report ? `Continue the fix of` : 'Fix'} the flaky test ${THE_TEST} in worktree ${WT} (branch ${args.branch}${report ? `, head ${report.head}` : ''}, browser port ${PORT}).

The diagnosis:
${json(diagnosis)}
${extra}
Fix the cause: the test when it is at fault, the app when it is (with a test that fails without the app's fix). ${diagnosis.quarantined ? `The test is tagged @quarantine${ISSUE ? ` for #${ISSUE}` : ''}: the tag and its { type: "issue" } annotation come out in this branch, and make spec-lint passes.` : ''} Run the test with ${RUN} --repeat-each=3 before you report.${ISSUE ? ` The branch closes #${ISSUE}.` : ''}

${RULES}

Gates: make web-check (it runs the spec lint), make dev-check, and make wasm-check plus the crate's tests if Rust changed.

Report with the structured output; the pr_title and pr_body are drafts the operator will use.${report ? `\n\nYour report so far:\n${json(report)}` : ''}`,
    { label: `fix ${KEY}${round > 1 ? ` r${round}` : ''}`, phase: 'Fix', agentType: BUILDER, schema: REPORT },
  )
}

function prove(report, round) {
  return agent(
    `Prove the fix of the flaky test ${THE_TEST} on branch ${args.branch} (worktree ${WT}, head ${report.head}, browser port ${PORT}). You did not write it: check it.

1. ${RUN} --repeat-each=5: every run passes.
2. The same under load (a few busy loops, each PID stopped by PID afterwards): every run passes.
3. The mutation: break the behavior the test claims (the diagnosis planned: ${diagnosis.mutation_plan}), run the test once, and confirm it fails on the assertion about that behavior, not on a timeout elsewhere. Then restore the file (git -C ${WT} checkout -- <file>) and confirm git -C ${WT} status is clean at ${report.head}. Never commit the mutation.

The cause it fixes: ${diagnosis.cause}

${RULES}`,
    { label: `prove ${KEY}${round > 1 ? ` r${round}` : ''}`, phase: 'Prove', agentType: BUILDER, schema: PROOF },
  )
}

let report = await fix(null, '', 1)
let proof = null
let rounds = 1
while (report) {
  proof = await prove(report, rounds)
  if (!proof || proof.ok || rounds >= MAX_ROUNDS) break
  const again = await fix(report, `\nThe proof failed; fix what it found:\n${json(proof)}\n`, ++rounds)
  if (!again) break
  report = again
}
if (!report) {
  return { workflow: 'fix-flake', session: SESSION, items: [{ key: KEY, issue: ISSUE, branch: args.branch, worktree: WT, status: 'failed', problems: ['the fix did not return'], diagnosis }] }
}

const review = await agent(
  `Review branch ${args.branch} of ${REPO}: a fix of the flaky test ${THE_TEST}. Worktree: ${WT}; the diff is git -C ${WT} diff origin/main...HEAD (fetch origin first).

The diagnosis:
${json(diagnosis)}

The builder's report:
${json(report)}

The proof:
${json(proof)}

Hunt for: a fix that hides the cause instead of removing it (slack, a longer timeout, a retry, a looser assertion: ADR-022); a test that now passes vacuously or no longer asserts the behavior it is named for; an app change with no test that fails without it; a wait on a time left in the test; the @quarantine tag or its annotation left in; a description of the test (its title, testing.md's spec table) made untrue; a wrong cause. Rank them: blocking (a wrong result, a vacuous or slow-runner-flaky test, an untrue description, a hidden cause); should_fix (any other finding in what the branch touches, fixed in this branch); maintainers_call; nits. Mark a finding other_area when its fix belongs elsewhere.

Read-only: change nothing in any checkout. Browser runs, if needed, through one_browser.sh on port ${PORT + 100}.`,
  { label: `review ${KEY}`, phase: 'Review', agentType: 'reviewer', effort: 'xhigh', schema: REVIEW },
)

let verify = null
if (review && (review.blocking.length || review.should_fix.length || review.nits.length || review.maintainers_call.length)) {
  const fixed = await agent(
    `Continue the fix of ${THE_TEST} in worktree ${WT} (branch ${args.branch}, head ${report.head}, port ${PORT}). The review found these; fix each in new commits.

Blocking:
${fmt(review.blocking)}

Should fix:
${fmt(review.should_fix)}

Nits (fix them unless one is wrong; say which you declined and why):
${fmt(review.nits)}

The maintainer's call: choose only where the issue or keeping today's behavior settles it, and say what you chose in decisions; otherwise leave an open item of kind decision with the exact question.
${fmt(review.maintainers_call)}

A finding marked as another area's becomes an open item of kind other_area.

Run ${RUN} --repeat-each=5 again after the changes.

${RULES}

Your report so far:
${json(report)}

Return the full report, updated, with the pr_body saying what the review found and what was fixed or declined and why.`,
    { label: `fix ${KEY} review`, phase: 'Review', agentType: BUILDER, schema: REPORT },
  )
  if (fixed) report = fixed
  if (fixed && review.blocking.length) {
    verify = await agent(
      `Re-check only these blocking findings on branch ${args.branch} (worktree ${WT}, head ${report.head}): the fix of ${THE_TEST}. For each, confirm the fix resolves it at its cause, running the test where it helps (through one_browser.sh on port ${PORT + 100}). Read-only.

${fmt(review.blocking)}`,
      { label: `verify ${KEY}`, phase: 'Review', agentType: 'reviewer', effort: 'high', schema: VERIFY },
    )
  }
}

const known = problemsOf(report, proof)
const final = await agent(
  `Finalize branch ${args.branch} in worktree ${WT} (head ${report.head}): the fix of ${THE_TEST}. Nothing is pushed yet, so a plain rebase is safe.

1. git -C ${WT} fetch -q origin, then git -C ${WT} -c merge.conflictStyle=diff3 rebase origin/main. On a conflict, python3 scripts/ops/rows_resolve.py <file>... resolves the line-wise ones (a docs table's rows, a list) and refuses a real overlap; resolve what it refuses by hand, keeping both sides' intent; GIT_EDITOR=true git rebase --continue. A conflict that needs a decision: git rebase --abort, and report it.
2. The quick gates again for what the branch changes (make web-check, make dev-check), and ${RUN} --repeat-each=3 on the rebased head.
3. The PR checks: write the body to a file in your scratch directory, then PR_TITLE="<title>" PR_BODY="$(cat <file>)" python3 scripts/pr_checks.py title, and links. Fix the title or body until both pass.${known.length ? `\n   The workflow found these already: ${known.join('; ')}.` : ''}
4. needs_full_ci again (a spec file holding an @slow or @quarantine test, the fixtures, or an app module the Slow suite covers: docs/process.md § CI and merging).

The proof, for the body:
${json(proof)}

${RULES}

Return the report again, updated: the new head, every commit, base, conflicts, pr_checks, and a pr_title and pr_body that pass. pr_body: ${BODY_DOC}.`,
  { label: `finalize ${KEY}`, phase: 'Finalize', agentType: BUILDER, schema: FINAL },
)

const last = final || report
const problems = problemsOf(last, proof)
if (!review) problems.push('the review did not return: review the branch (review-pr) before the PR')
if (verify && !verify.all_resolved) problems.push('blocking findings remain after the fix')
if (!final) problems.push('finalize did not return: rebase, the gates and the PR checks are still to do')
const labels = ['priority', ...(last.needs_full_ci && last.needs_full_ci.value ? ['full-ci'] : [])]
log(`${KEY}: ${problems.length ? 'needs attention' : 'ready'}`)
return {
  workflow: 'fix-flake',
  session: SESSION,
  items: [{
    key: KEY,
    issue: ISSUE,
    branch: args.branch,
    worktree: WT,
    status: problems.length ? 'needs_attention' : 'ready',
    problems,
    diagnosis,
    proof,
    final: last,
    review,
    verify,
    labels,
  }],
}
