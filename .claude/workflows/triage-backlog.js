export const meta = {
  name: 'triage-backlog',
  description: "Read auracle's open issues one agent each, read-only, and plan waves: what can run together without sharing files, the bundles that share them, the chains that must go in order, and the maintainer's questions as one batch",
  whenToUse: 'Before a wave, to choose what to build next and in what groups. Read-only. Runs when the maintainer asks for a triage or a wave (one agent per issue spends many tokens); the ship-wave skill has the steps around it.',
  phases: [
    { title: 'List', detail: 'the open issues, when args names none' },
    { title: 'Read', detail: 'one agent per issue: what remains, its files, what it needs' },
    { title: 'Plan', detail: 'waves, bundles, chains and the questions for the maintainer' },
  ],
}

// args: { issues?: [n, ...] (default: every open issue), session?: 'https://claude.ai/code/session_…' }
// Returns { workflow, triaged: [...], missing: [n], overlaps: [{ a, b, files }], plan }. The plan's
// items are in ship-issues' item shape, less the worktree and the port, which the operator assigns.

const REPO = 'alexnodeland/auracle'

function need(ok, what) {
  if (!ok) throw new Error(`triage-backlog: ${what}`)
}
need(args === undefined || args === null || (typeof args === 'object' && !Array.isArray(args)), 'args is an object, {issues?, session?}, passed as JSON (not as a string); none reads every open issue')
const given = args && Array.isArray(args.issues) ? args.issues : null
need(!given || given.every(n => Number.isInteger(n)), 'issues lists issue numbers')

const AGENTS = ['web-engineer', 'engine-engineer', 'docs-writer', 'film-producer', 'general-purpose']
const READ_ONLY = `Read-only: change nothing in any checkout, comment on nothing, label nothing. Read code at origin/main (git -C <the main checkout> fetch -q origin; git show origin/main:<path>; git log origin/main --oneline --grep '#<n>'), not a working tree, which may be stale or another branch's.`

const LIST = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { number: { type: 'integer' }, title: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } },
        required: ['number', 'title', 'labels'],
      },
    },
  },
  required: ['issues'],
}
const ISSUE = {
  type: 'object',
  properties: {
    issue: { type: 'integer' },
    title: { type: 'string' },
    kind: { type: 'string', enum: ['bug', 'flake', 'task', 'enhancement', 'documentation', 'ci', 'film', 'umbrella', 'external'] },
    remaining: { type: 'string', description: 'concretely what is left to close it, as deliverables; "nothing" when it is closable now' },
    closable_now: { type: 'boolean', description: 'already done on origin/main; say by what in notes' },
    size: { type: 'string', enum: ['S', 'M', 'L', 'XL'], description: 'S: under an hour of agent work, one PR; M: a few hours, one PR; L: a day, maybe two PRs; XL: several PRs or a plan' },
    areas: { type: 'array', items: { type: 'string' }, description: 'area labels or directories the change reaches' },
    files: { type: 'array', items: { type: 'string' }, description: 'the paths the change would edit, as exactly as you can tell' },
    conflicts_with_files: { type: 'array', items: { type: 'string' }, description: "the shared files among them where another branch's edit would conflict: a docs table (docs/architecture/testing.md's tiers, gates or spec tables), the Makefile's DEV_CHECKS line, a spec's quarantine tag, a shared fixture" },
    depends_on: { type: 'array', items: { type: 'integer' }, description: 'issues that must merge first, and why in notes' },
    needs_user: { type: ['string', 'null'], description: 'the exact question only the maintainer can answer (a new word for voice.md, a design choice the issue leaves open, an external release, a recording that needs the machine), or null' },
    agentType: { type: 'string', enum: AGENTS },
    browser_heavy: { type: 'boolean', description: 'needs many browser runs or a recording (the one-browser queue)' },
    needs_full_ci: { type: 'boolean', description: 'the change reaches what the Slow suite covers (docs/process.md § CI and merging)' },
    notes: { type: 'string' },
  },
  required: ['issue', 'title', 'kind', 'remaining', 'closable_now', 'size', 'areas', 'files', 'conflicts_with_files', 'depends_on', 'needs_user', 'agentType', 'browser_heavy', 'needs_full_ci', 'notes'],
}
const ITEM = {
  type: 'object',
  properties: {
    issue: { type: 'integer', description: 'the main issue' },
    closes: { type: 'array', items: { type: 'integer' } },
    refs: { type: 'array', items: { type: 'integer' } },
    topic: { type: 'string', description: 'the branch is claude/<topic>, the worktree .claude/worktrees/<topic>' },
    agentType: { type: 'string', enum: AGENTS },
    notes: { type: 'string', description: 'what remains, for the builder' },
    decisions: { type: 'string', description: 'decisions already made, for the builder' },
    avoid: { type: 'string', description: 'files another item of the same wave edits' },
    needs_full_ci: { type: 'boolean' },
    why: { type: 'string' },
  },
  required: ['issue', 'closes', 'refs', 'topic', 'agentType', 'notes', 'decisions', 'avoid', 'needs_full_ci', 'why'],
}
const PLAN = {
  type: 'object',
  properties: {
    waves: {
      type: 'array',
      description: 'in order; the items of one wave share no file, and at most a few are browser-heavy',
      items: { type: 'object', properties: { name: { type: 'string' }, items: { type: 'array', items: ITEM }, why: { type: 'string' } }, required: ['name', 'items', 'why'] },
    },
    chains: {
      type: 'array',
      description: 'issues that must merge in this order, and why',
      items: { type: 'object', properties: { issues: { type: 'array', items: { type: 'integer' } }, why: { type: 'string' } }, required: ['issues', 'why'] },
    },
    questions: {
      type: 'array',
      description: "the maintainer's questions, as one batch; an issue waiting on one is in no wave",
      items: { type: 'object', properties: { issue: { type: 'integer' }, question: { type: 'string' } }, required: ['issue', 'question'] },
    },
    closable: {
      type: 'array',
      items: { type: 'object', properties: { issue: { type: 'integer' }, why: { type: 'string' } }, required: ['issue', 'why'] },
    },
    held: {
      type: 'array',
      description: 'issues in no wave and why: blocked, external, too big for one PR without a plan',
      items: { type: 'object', properties: { issue: { type: 'integer' }, why: { type: 'string' } }, required: ['issue', 'why'] },
    },
  },
  required: ['waves', 'chains', 'questions', 'closable', 'held'],
}

let numbers = given
if (!numbers) {
  phase('List')
  const listed = await agent(
    `List every open issue of ${REPO}: gh -R ${REPO} issue list --state open --limit 500 --json number,title,labels. Return each with its labels' names. ${READ_ONLY}`,
    { label: 'list open issues', phase: 'List', effort: 'low', schema: LIST },
  )
  numbers = listed ? listed.issues.map(i => i.number) : []
}
if (!numbers.length) {
  log('no open issue to triage')
  return { workflow: 'triage-backlog', triaged: [], missing: [], overlaps: [], plan: null }
}
log(`${numbers.length} issue(s) to read`)

phase('Read')
const read = await parallel(numbers.map(n => () => agent(
  `Triage issue #${n} of ${REPO} for the next wave of work.

Read it with its comments (gh -R ${REPO} issue view ${n} --comments), the plan, ADR or brief it links (docs/plans/, docs/decisions/), and the code it names, at origin/main. Judge what is already done (git log origin/main --oneline --grep '#${n}'; the PRs that name it: gh -R ${REPO} pr list --state all --search '${n}'), and what remains. A "blocked" label may be stale: check whether the blocker is still open.

List the files the change would edit as exactly as you can, and among them the shared ones another branch's edit would conflict with. Name anything only the maintainer can decide as one exact question. Be honest about size.

${READ_ONLY}`,
  { label: `triage #${n}`, phase: 'Read', effort: 'medium', schema: ISSUE },
)))
const triaged = read.filter(Boolean)
const missing = numbers.filter(n => !triaged.some(t => t.issue === n))
if (missing.length) log(`not triaged (their agents failed): ${missing.map(n => `#${n}`).join(', ')}`)

// Plain code: which issues name a file in common. The planner weighs the
// rest (a docs table both edit in different rows still conflicts).
const overlaps = []
const open = triaged.filter(t => !t.closable_now)
for (let i = 0; i < open.length; i++) {
  for (let j = i + 1; j < open.length; j++) {
    const a = new Set([...open[i].files, ...open[i].conflicts_with_files])
    const files = [...new Set([...open[j].files, ...open[j].conflicts_with_files])].filter(f => a.has(f))
    if (files.length) overlaps.push({ a: open[i].issue, b: open[j].issue, files })
  }
}

phase('Plan')
const plan = await agent(
  `Plan the next waves of work on ${REPO} from this triage of its open issues.

The triage, one entry per issue:
${JSON.stringify(triaged, null, 1)}

Pairs that name a file in common (exact paths):
${JSON.stringify(overlaps, null, 1)}

The rules (docs/process.md):
- Items of one wave share no file: two branches that edit the same lines (often a docs table's rows, the Makefile's DEV_CHECKS line, a spec's quarantine tag) can't merge in one queue batch, and the second is rebased by hand. Issues that share files and are small are one item, a bundle (one branch, closes each).
- One item is one PR sized for one review round; an XL issue needs a plan first, so it is held.
- At most two browser-heavy items in a wave (one machine, one browser queue); a recording runs alone.
- An issue waiting on the maintainer is in no wave: its question goes in questions, as one batch, exact.
- Issues that must merge in order are a chain; only the first can be in a wave.
- Closable issues are listed apart, with what closed them.

Give each item a topic for its branch (claude/<topic>), the agent type, the builder's notes and decisions, and what to avoid (files another item of the same wave edits). Read-only: change nothing, comment on nothing.`,
  { label: 'plan waves', phase: 'Plan', effort: 'high', schema: PLAN },
)
if (plan) log(`${plan.waves.length} wave(s), ${plan.chains.length} chain(s), ${plan.questions.length} question(s) for the maintainer`)
return { workflow: 'triage-backlog', triaged: triaged.sort((a, b) => a.issue - b.issue), missing, overlaps, plan }
