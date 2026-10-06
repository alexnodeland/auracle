export const meta = {
  name: 'mutants-burndown',
  description: "Run cargo-mutants over one auracle crate, kill each surviving mutant with a behavior assertion (or show it equivalent and exclude it narrowly, with its reason), measure again, review and finalize the branch; the operator pushes",
  whenToUse: "One crate's survivors (the issue Mutants weekly files, 'Mutants that survive', or a crate whose survivors keep PRs out of the queue), with a worktree created from origin/main (make worktree TOPIC=<topic>: .claude/worktrees/<topic>). Long: a crate's run takes hours, twice. Runs when the maintainer asks for it by name.",
  phases: [
    { title: 'Measure', detail: 'make mutants CRATE=<crate>, before and after, and the coverage floor (sonnet)' },
    { title: 'Kill', detail: 'one agent per file with survivors, one after another in the one worktree (opus)' },
    { title: 'Review', detail: 'the reviewer agent, read-only (opus), then the fixes (opus) and a re-check of the blocking ones (sonnet)' },
    { title: 'Finalize', detail: 'rebased onto origin/main, the quick gates again, the PR checks on the title and body (sonnet)' },
  ],
}

// args: { crate: 'auracle-taste', branch: 'claude/<topic>', worktree: '$REPO/.claude/worktrees/<topic>',
//         issue?: <n>, session?: 'https://claude.ai/code/session_…',
//         models?: { measure, kill, review, fix, verify, finalize: 'opus' | 'sonnet' } }
// Models, by how hard a stage is. Defaults: kill, review and fix opus (finding the behavior a mutant
// breaks and writing the test that asserts it; judging the tests; fixing what the review found);
// measure (the run before and the run after, each only counting), verify and finalize sonnet (a
// re-check of findings already fixed; a rebase, quick gates and the PR checks). `models` sets a
// stage's model, e.g. { kill: 'sonnet' } for a crate whose survivors are all plain. Every agent but
// the first measure also gets the advisor line: it calls the advisor, when there is one, before it
// commits to an approach, when stuck, and before it reports done.
// Returns { workflow, session, before, after, groups: [{ file, killed, equivalent, left }], items: [{ key, issue,
// branch, worktree, status, problems, final, review, verify }] }: the item in ship-issues' shape.
//
// The file groups run one after another in the one worktree, not side by side. Side by side in one
// checkout, their agents would race on git's index and on one target/, and each one's test run would
// build and test the others' half-written changes. A mutation run is CPU-bound, so several at once on
// one machine are each slower, not done sooner. Worktrees of their own (isolation: 'worktree') would
// each start a cold target/ (an optimized build of the crate each, many GB) and leave a last agent to
// merge the branches; and the workflow-authoring reference says such a worktree is made from the
// session's checkout rather than this branch (untested here).

const REPO = 'alexnodeland/auracle'

function need(ok, what) {
  if (!ok) throw new Error(`mutants-burndown: ${what}`)
}
need(args && typeof args === 'object' && !Array.isArray(args), 'args is an object, {crate, branch, worktree}, passed as JSON (not as a string)')
need(typeof args.crate === 'string' && /^auracle-[a-z]+$/.test(args.crate), 'crate is one of the workspace crates (auracle-<name>)')
need(typeof args.branch === 'string' && args.branch.startsWith('claude/'), 'branch is claude/<topic>')
need(typeof args.worktree === 'string' && args.worktree.startsWith('/'), 'worktree is an absolute path')
need(args.issue === undefined || args.issue === null || Number.isInteger(args.issue), 'issue, when given, is a number')
const SESSION = typeof args.session === 'string' && args.session ? args.session : null
need(!SESSION || /^https:\/\/claude\.ai\/code\/session_\w+$/.test(SESSION), 'session is a https://claude.ai/code/session_… link')

// The model of each stage, by how hard it is (see args above).
const MODELS = ['opus', 'sonnet']
const STAGE_MODELS = { measure: 'sonnet', kill: 'opus', review: 'opus', fix: 'opus', verify: 'sonnet', finalize: 'sonnet' }
const MODEL_ARGS = args.models === undefined ? {} : args.models
need(MODEL_ARGS && typeof MODEL_ARGS === 'object' && !Array.isArray(MODEL_ARGS), `models is an object, {${Object.keys(STAGE_MODELS).join(', ')}: 'opus' | 'sonnet'}`)
for (const [stage, m] of Object.entries(MODEL_ARGS)) {
  need(Object.keys(STAGE_MODELS).includes(stage), `models.${stage} is not a stage (${Object.keys(STAGE_MODELS).join(', ')})`)
  need(MODELS.includes(m), `models.${stage} is 'opus' or 'sonnet'`)
}
const modelOf = stage => MODEL_ARGS[stage] || STAGE_MODELS[stage]
const ADVISOR = 'If an advisor tool is available, call it before you commit to an approach, when you are stuck or going in circles, and before you report done.'

const CRATE = args.crate
const WT = args.worktree
const ISSUE = Number.isInteger(args.issue) ? args.issue : null
const KEY = ISSUE ? `#${ISSUE}` : CRATE
const RUN = `cd ${WT} && nice -n 19 make mutants CRATE=${CRATE}`

const RULES = `Rules for this run (docs/process.md; the operator's):
- Work only in your worktree, never in the main checkout. Commit only: never push, open or edit a PR, comment on GitHub, or merge; the operator does all of that. Never change any git config. Run git with the GIT_* variables unset (env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git ...).
- Commit with: git -c user.name="Alex Nodeland" -c user.email="nodeland.alex@gmail.com" -c core.fsmonitor=false commit. Small commits, one file's survivors each; a loose conventional prefix (tests(taste):, tests(grammar):); a body that says what the tests did not check and what they assert now;${ISSUE ? ` "Refs #${ISSUE}" in the body;` : ''}${SESSION ? ` the LAST line of every message, exactly: Claude-Session: ${SESSION}` : ''}
- No hand-written attribution: no Co-Authored-By, no "generated with" line, no model name or version.
- Rust tests run optimized (make test-crate CRATE=${CRATE}, or --profile test-fast), under nice, in the worktree's own target/. Mutation runs under nice -n 19: they hold the machine for hours.
- A survivor is killed by a test that asserts what the code does for a player or the engine's contract, at the lowest level that can prove it (crates/AGENTS.md § Writing a test, § Mutation testing; docs/notes/test-audit-2026-10/rubric.md): never a test written only to make the mutant fail. A mutant no behavior can show is equivalent: argue it, and exclude it in .cargo/mutants.toml with its reason in a comment above the entry, matched as narrowly as the mutant (the function and the change, never a line number, never a whole file).
- Coverage stays at its floor (make coverage; crates/coverage-baseline.json): a crate whose coverage rises gets make coverage-floors in the same branch.
- Scratch files go in a directory of your own (mktemp -d), outside every checkout.`

const TITLE = /^(feat|fix|docs|tests|test|ci|build|refactor|perf|chore|revert|style|release)(\([^()\s]+\))?!?: \S/
const BODY_DOC = `Markdown, for the PR: ## What (the crate's survivors before and after, by file), ## How (the behavior each new test asserts, and each mutant shown equivalent with its reason and its exclusion), ## Checks (the mutation runs' counts before and after, coverage at its floor, the gates, the review and what it found); then ${ISSUE ? `a "Refs #${ISSUE}" line, or "Closes #${ISSUE}" when no survivor is left in what it names` : 'a "Refs #n" line for each issue it advances, or a line starting "No issue:" saying why'}${SESSION ? `; the LAST line is exactly ${SESSION}` : '; no session link'}`

const COUNTS = {
  type: 'object',
  properties: {
    tested: { type: 'integer' },
    caught: { type: 'integer' },
    missed: { type: 'integer' },
    timeout: { type: 'integer' },
    unviable: { type: 'integer' },
  },
  required: ['tested', 'caught', 'missed', 'timeout', 'unviable'],
}
const MUTANT = {
  type: 'object',
  properties: { line: { type: 'integer' }, function: { type: 'string' }, change: { type: 'string', description: "cargo-mutants' description, e.g. replace + with -" } },
  required: ['line', 'function', 'change'],
}
const MEASURE = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    counts: COUNTS,
    groups: {
      type: 'array',
      description: 'the survivors, grouped by file (python3 scripts/mutants_report.py mutants.out)',
      items: { type: 'object', properties: { file: { type: 'string' }, survivors: { type: 'array', items: MUTANT } }, required: ['file', 'survivors'] },
    },
    kept: { type: 'string', description: 'where this run\'s mutants.out was copied, outside the worktree' },
    notes: { type: 'string' },
  },
  required: ['command', 'counts', 'groups', 'kept', 'notes'],
}
const KILL = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    killed: {
      type: 'array',
      items: { type: 'object', properties: { mutant: { type: 'string' }, test: { type: 'string', description: 'the test that now fails on it, and the behavior it asserts' } }, required: ['mutant', 'test'] },
    },
    equivalent: {
      type: 'array',
      items: { type: 'object', properties: { mutant: { type: 'string' }, reason: { type: 'string' }, exclusion: { type: 'string', description: 'the exclude_re entry added' } }, required: ['mutant', 'reason', 'exclusion'] },
    },
    left: {
      type: 'array',
      items: { type: 'object', properties: { mutant: { type: 'string' }, why: { type: 'string' } }, required: ['mutant', 'why'] },
    },
    confirmed: { type: 'string', description: "the focused run that confirms it (make mutants CRATE=… MUTANTS_ARGS='--file …') and its counts" },
    head: { type: 'string' },
  },
  required: ['file', 'killed', 'equivalent', 'left', 'confirmed', 'head'],
}
const FINDING = {
  type: 'object',
  properties: { file: { type: 'string' }, line: { type: 'integer' }, summary: { type: 'string' }, scenario: { type: 'string' }, other_area: { type: 'boolean' } },
  required: ['file', 'summary', 'scenario'],
}
const OPEN_ITEM = {
  type: 'object',
  properties: { kind: { type: 'string', enum: ['in_area', 'decision', 'other_area', 'note'] }, text: { type: 'string' } },
  required: ['kind', 'text'],
}
const REPORT_PROPS = {
  head: { type: 'string', description: 'full SHA of the branch head' },
  commits: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' },
  gates: { type: 'array', items: { type: 'string' }, description: 'each gate and its result: the crate tests, make coverage (every crate at its floor), make lint, make dev-check' },
  browser_runs: { type: 'array', items: { type: 'string' } },
  user_visible: { type: 'boolean' },
  changelog_fragment: { type: ['string', 'null'] },
  voice_drafts: { type: 'array', items: { type: 'object', properties: { words: { type: 'string' }, where: { type: 'string' }, voice_md_row: { type: 'string' } }, required: ['words', 'where', 'voice_md_row'] } },
  decisions: { type: 'array', items: { type: 'string' } },
  before_after: { type: 'string' },
  closes: { type: 'array', items: { type: 'integer' } },
  refs: { type: 'array', items: { type: 'integer' } },
  needs_full_ci: { type: 'object', properties: { value: { type: 'boolean' }, reason: { type: 'string' } }, required: ['value', 'reason'] },
  open_items: { type: 'array', items: OPEN_ITEM },
  pr_title: { type: 'string', description: `type(scope): what is true now, e.g. tests(${CRATE.replace('auracle-', '')}): every mutant of <what> is caught` },
  pr_body: { type: 'string', description: BODY_DOC },
}
const REPORT_REQUIRED = Object.keys(REPORT_PROPS)
const REPORT = { type: 'object', properties: { ...REPORT_PROPS, after: COUNTS }, required: [...REPORT_REQUIRED, 'after'] }
const FINAL = {
  type: 'object',
  properties: { ...REPORT_PROPS, base: { type: 'string' }, conflicts: { type: 'string' }, pr_checks: { type: 'string' } },
  required: [...REPORT_REQUIRED, 'base', 'conflicts', 'pr_checks'],
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

phase('Measure')
const before = await agent(
  `Measure the surviving mutants of ${CRATE} on branch ${args.branch} (worktree ${WT}, from origin/main).

Run ${RUN} (hours; cargo-mutants must be the Makefile's MUTANTS_VERSION: make setup installs it). Then python3 scripts/mutants_report.py mutants.out, and copy mutants.out out of the worktree, to a directory of your own. Return the counts and the survivors grouped by file (file, line, function, change), and say anything that stopped the run early.

Change nothing in the worktree but what the run writes (mutants.out is not committed).

${RULES}`,
  { label: `measure ${KEY}`, phase: 'Measure', agentType: 'engine-engineer', model: modelOf('measure'), schema: MEASURE },
)
if (!before) {
  return { workflow: 'mutants-burndown', session: SESSION, before: null, after: null, groups: [], items: [{ key: KEY, issue: ISSUE, branch: args.branch, worktree: WT, status: 'failed', problems: ['the first mutation run did not return'] }] }
}
const groups = before.groups.filter(g => g.survivors.length)
log(`${CRATE}: ${before.counts.missed} survivor(s) in ${groups.length} file(s)`)

const kills = []
let head = null
for (const [i, g] of groups.entries()) {
  const k = await agent(
    `Kill the surviving mutants of ${g.file} (crate ${CRATE}), on branch ${args.branch} in worktree ${WT}${head ? ` (head ${head})` : ''}. File ${i + 1} of ${groups.length}; the others are done one after another in this worktree, so commit yours before you report and touch no other file's tests but a shared helper you need.

The survivors (cargo-mutants changed this and every test of the crate's fast tier still passed):
${g.survivors.map(m => `- ${g.file}:${m.line} ${m.function}: ${m.change}`).join('\n')}

For each: find the behavior the change breaks and write the test that asserts it, in the module's tests (<module>/tests.rs); or argue it equivalent and exclude it narrowly in .cargo/mutants.toml with its reason. Confirm with a focused run: cd ${WT} && nice -n 19 make mutants CRATE=${CRATE} MUTANTS_ARGS='--file ${g.file}'. Then make test-crate CRATE=${CRATE} and make lint. One commit for the file.

${RULES}

${ADVISOR}`,
    { label: `kill ${KEY} ${g.file}`, phase: 'Kill', agentType: 'engine-engineer', model: modelOf('kill'), schema: KILL },
  )
  if (k) {
    kills.push(k)
    head = k.head
  } else {
    kills.push({ file: g.file, killed: [], equivalent: [], left: g.survivors.map(m => ({ mutant: `${g.file}:${m.line} ${m.function}: ${m.change}`, why: 'its agent did not return' })), confirmed: '', head: head || '' })
    log(`${g.file}: its agent did not return; its survivors are left`)
  }
}

let report = await agent(
  `Measure ${CRATE}'s mutants again on branch ${args.branch} (worktree ${WT}${head ? `, head ${head}` : ''}), after one agent per file killed or excluded its survivors.

1. ${RUN}, and python3 scripts/mutants_report.py mutants.out: the counts after.
2. make coverage: every crate at its floor; if ${CRATE}'s rose, make coverage-floors and commit the new floor.
3. make lint, make test-crate CRATE=${CRATE}, make dev-check.

Before: ${json(before.counts)}
Each file's agent reported:
${json(kills)}

${RULES}

Report with the structured output: after (the counts), the gates, every commit on the branch, a survivor still left as an open item (in_area when a test could still kill it; decision when it needs the maintainer), and the pr_title and pr_body drafts.

${ADVISOR}`,
  { label: `measure ${KEY} after`, phase: 'Measure', agentType: 'engine-engineer', model: modelOf('measure'), schema: REPORT },
)
if (!report) {
  return { workflow: 'mutants-burndown', session: SESSION, before: before.counts, after: null, groups: kills, items: [{ key: KEY, issue: ISSUE, branch: args.branch, worktree: WT, status: 'failed', problems: ['the second mutation run did not return; the branch holds the kills so far'] }] }
}
const after = report.after

const review = await agent(
  `Review branch ${args.branch} of ${REPO}: new tests and mutants.toml exclusions that kill ${CRATE}'s surviving mutants. Worktree: ${WT}; the diff is git -C ${WT} diff origin/main...HEAD (fetch origin first).

Before: ${json(before.counts)}; after: ${json(after)}.
Each file's report:
${json(kills)}

Hunt for: a test that kills its mutant without asserting a behavior (a test of an implementation detail, written only to fail on the mutant: docs/notes/test-audit-2026-10/rubric.md); a test at the wrong level, or not beside its module; a statistical bound from one seed; an exclusion that is not truly equivalent (find the behavior it hides), that matches more than its mutant (a whole function's mutants, a file, a line number), or has no reason; coverage below a floor; the crate's fast tier made slow. Rank them: blocking (a vacuous or implementation test, an exclusion hiding a behavior, a floor missed); should_fix (any other finding here, fixed in this branch); maintainers_call; nits.

Read-only: change nothing in any checkout.

${ADVISOR}`,
  { label: `review ${KEY}`, phase: 'Review', agentType: 'reviewer', model: modelOf('review'), effort: 'xhigh', schema: REVIEW },
)

// The review's blocking findings no re-check has yet confirmed fixed, and a
// fix that did not return (a skipped or dead agent gives null): either keeps
// the item from `ready`.
let verify = null
let open = review ? review.blocking : []
let lost = null
if (review && (review.blocking.length || review.should_fix.length || review.nits.length || review.maintainers_call.length)) {
  const fixed = await agent(
    `Continue ${CRATE}'s mutant burndown in worktree ${WT} (branch ${args.branch}, head ${report.head}). The review found these; fix each in new commits, and confirm each changed test still fails on its mutant (the focused run, MUTANTS_ARGS='--file <file>').

Blocking:
${fmt(review.blocking)}

Should fix:
${fmt(review.should_fix)}

Nits (fix them unless one is wrong; say which you declined and why):
${fmt(review.nits)}

The maintainer's call: choose only where keeping today's behavior settles it, and say so in decisions; otherwise leave an open item of kind decision with the exact question.
${fmt(review.maintainers_call)}

${RULES}

Your report so far:
${json(report)}

Return the full report, updated (the counts in after still true), with the pr_body saying what the review found and what was fixed or declined and why.

${ADVISOR}`,
    { label: `fix ${KEY}`, phase: 'Review', agentType: 'engine-engineer', model: modelOf('fix'), schema: REPORT },
  )
  if (fixed) report = fixed
  else lost = `the fix of the review's findings did not return: its ${review.blocking.length} blocking, ${review.should_fix.length} should-fix and ${review.nits.length} nit finding(s) are not done on the branch`
  if (fixed && review.blocking.length) {
    verify = await agent(
      `Re-check only these blocking findings on branch ${args.branch} (worktree ${WT}, head ${report.head}): ${CRATE}'s mutant burndown. For each, confirm the fix resolves it, running the focused mutation run or the test where it helps. Read-only.

${fmt(review.blocking)}

${ADVISOR}`,
      { label: `verify ${KEY}`, phase: 'Review', agentType: 'reviewer', model: modelOf('verify'), effort: 'high', schema: VERIFY },
    )
    if (verify && verify.all_resolved) open = []
    else if (verify && verify.remaining.length) open = verify.remaining
  }
}

const final = await agent(
  `Finalize branch ${args.branch} in worktree ${WT} (head ${report.head}): ${CRATE}'s mutant burndown. Nothing is pushed yet, so a plain rebase is safe.

1. git -C ${WT} fetch -q origin, then git -C ${WT} -c merge.conflictStyle=diff3 rebase origin/main. On a conflict, python3 scripts/ops/rows_resolve.py <file>... resolves the line-wise ones (mutants.toml's list, a baseline's rows) and refuses a real overlap; resolve what it refuses by hand, keeping both sides' intent; GIT_EDITOR=true git rebase --continue. A conflict that needs a decision: git rebase --abort, and report it.
2. The quick gates again: make fmt-check lint, make test-crate CRATE=${CRATE}, make coverage, make dev-check.
3. The PR checks: write the body to a file in your scratch directory, then PR_TITLE="<title>" PR_BODY="$(cat <file>)" python3 scripts/pr_checks.py title, and links. Fix the title or the body until both pass.
4. needs_full_ci: a change to a crate puts it in the Slow suite (docs/process.md § CI and merging).

${RULES}

Your report so far:
${json(report)}

Return the report again, updated: the new head, every commit, base, conflicts, pr_checks, and a pr_title and pr_body that pass. pr_body: ${BODY_DOC}.

${ADVISOR}`,
  { label: `finalize ${KEY}`, phase: 'Finalize', agentType: 'engine-engineer', model: modelOf('finalize'), schema: FINAL },
)

const last = final || report
const problems = []
if (!TITLE.test(last.pr_title || '')) problems.push(`the title has no conventional type: ${last.pr_title}`)
if (SESSION && (last.pr_body || '').split('\n').map(l => l.trim()).filter(Boolean).pop() !== SESSION) problems.push('the body does not end with the session link')
for (const o of (last.open_items || []).filter(o => o.kind === 'in_area')) problems.push(`an in-area item is left: ${o.text}`)
if (!review) problems.push('the review did not return: review the branch (review-pr) before the PR')
if (lost) problems.push(lost)
if (open.length) problems.push(verify ? `${open.length} blocking finding(s) remain after the fix` : `the fix or its re-check did not return; ${open.length} blocking finding(s) unresolved`)
if (!final) problems.push('finalize did not return: rebase, the gates and the PR checks are still to do')
if (after && after.missed) problems.push(`${after.missed} mutant(s) still survive`)
log(`${CRATE}: ${before.counts.missed} survivor(s) before, ${after ? after.missed : '?'} after`)
return {
  workflow: 'mutants-burndown',
  session: SESSION,
  before: before.counts,
  after,
  groups: kills,
  items: [{ key: KEY, issue: ISSUE, branch: args.branch, worktree: WT, status: problems.length ? 'needs_attention' : 'ready', problems, final: last, review, verify, labels: ['full-ci'] }],
}
