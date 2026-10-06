export const meta = {
  name: 'review-pr',
  description: 'Review one auracle PR or branch through five lenses in parallel (correctness and dropped capability, descriptions, tests, voice, CI and process), then have an independent agent try to refute each finding; returns only the survivors, ranked, each with its failure scenario',
  whenToUse: 'A PR or a claude/ branch before it is queued, when one reviewer is not enough: a large change, several areas, or a second opinion. Read-only. Runs when the maintainer asks for it by name (it spends many tokens).',
  phases: [
    { title: 'Review', detail: 'five reviewers, one lens each' },
    { title: 'Refute', detail: 'an independent agent tries to refute each finding' },
  ],
}

// args: { pr?: <number>, branch?: 'claude/<topic>', worktree?: '/abs/path' }: a PR, or a branch with its
// worktree. With a PR and no worktree, nothing is checked out: the diff and the files come from GitHub.
// Returns { workflow, target, findings: [{ severity, lenses, file, line, summary, scenario, evidence,
// verdict }], refuted: [...], lenses_failed: [...] }, findings most severe first.

const REPO = 'alexnodeland/auracle'

function need(ok, what) {
  if (!ok) throw new Error(`review-pr: ${what}`)
}
need(args && typeof args === 'object' && !Array.isArray(args), 'args is an object, {pr} or {branch, worktree}, passed as JSON (not as a string)')
need(args.pr === undefined || Number.isInteger(args.pr), 'pr is a number')
need(args.pr !== undefined || (typeof args.branch === 'string' && typeof args.worktree === 'string'), 'a pr, or a branch with its worktree')
need(args.worktree === undefined || (typeof args.worktree === 'string' && args.worktree.startsWith('/')), 'worktree is an absolute path')

const WT = args.worktree || null
const TARGET = args.pr !== undefined ? `PR #${args.pr}${args.branch ? ` (${args.branch})` : ''}` : `branch ${args.branch}`
const HOW = WT
  ? `The worktree is ${WT}: git -C ${WT} fetch -q origin, then the diff is git -C ${WT} diff origin/main...HEAD and the commits git -C ${WT} log origin/main..HEAD; read the files there.${args.pr !== undefined ? ` The PR's title, body and labels: gh -R ${REPO} pr view ${args.pr} --json title,body,labels,files,headRefOid.` : ''}`
  : `Nothing is checked out for it, and you check nothing out: the diff is gh -R ${REPO} pr diff ${args.pr}; its title, body, labels, files and head: gh -R ${REPO} pr view ${args.pr} --json title,body,labels,files,headRefOid,commits; a file at the head: gh api repos/${REPO}/contents/<path>?ref=<headRefOid> -H 'Accept: application/vnd.github.raw'.`
const READ_ONLY = 'Read-only: change nothing in any checkout, comment on nothing. Scratch files in a directory of your own (mktemp -d). A browser probe, if one is needed, runs through www/video/tools/one_browser.sh on a port of its own (8890 and up).'

const SEVERITY = ['blocking', 'should_fix', 'maintainers_call', 'nit']
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: SEVERITY, description: 'blocking: a wrong result, a dropped capability, an untrue description, a test that can pass vacuously or a slow runner can fail; should_fix: any other defect in what the change touches; maintainers_call: a choice only the maintainer can make; nit' },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string', description: 'the defect, in one or two sentences' },
          scenario: { type: 'string', description: 'concrete inputs or state, and the wrong result' },
          evidence: { type: 'string', description: 'what you ran or read that shows it: a command and its output, or file:line' },
        },
        required: ['severity', 'file', 'summary', 'scenario', 'evidence'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true unless the scenario is confirmed; true when uncertain' },
    reason: { type: 'string', description: 'why: what you ran or read' },
    severity: { type: 'string', enum: SEVERITY, description: 'the severity it deserves, if it stands' },
  },
  required: ['refuted', 'reason', 'severity'],
}

const LENSES = [
  {
    name: 'correctness',
    agentType: 'reviewer',
    effort: 'xhigh',
    brief: `Correctness and dropped capability. Does the change do what its PR and issues say, at the cause? Edge cases; ordering and concurrency in the worker lanes and the bench lane; a reply on every path; the area's invariants (its AGENTS.md and ADRs). Drop nothing: everything the change moved or retired still works by mouse, keyboard and touch (check a before -> after table against the old code, not the report). Run what you can: the gates, the touched tests, a probe.`,
  },
  {
    name: 'descriptions',
    agentType: 'truth-auditor',
    effort: 'high',
    brief: `Descriptions stay true (ADR-004), by the truth-pass skill's method (.claude/skills/truth-pass/SKILL.md): collect every description of each behavior the change touches (the guide in www/docs, the reference in www/reference, the landing page, the films' scripts, in-app copy, docs/architecture, the AGENTS.md files, the skills, comments, the PR body and the changelog.d/ entry), turn each into a checkable claim, and check it against the code at the change's head. Report each claim the change made false, or left false, as a finding.`,
  },
  {
    name: 'tests',
    agentType: 'reviewer',
    effort: 'high',
    brief: `The tests, by docs/notes/test-audit-2026-10/rubric.md: a test that can pass when the feature is broken (vacuous), one that can fail when the app is right (a wait on a time, an exact count a slow runner may double, a speed bound that is not a budget: ADR-022), one at the wrong level (lowest level that can prove it: crates/AGENTS.md § Writing a test), a fix with no test that fails without it, a test named for more than it checks, and in Rust a surviving mutant of the changed code (make mutants DIFF=1, or the Mutants job's summary).`,
  },
  {
    name: 'voice',
    agentType: 'reviewer',
    effort: 'high',
    brief: `Voice and new words (www/brand/voice.md, ADR-013): a new term, label, toast, refusal or guide phrase that voice.md's word table governs and that the PR does not list for the maintainer's approval; a row added to voice.md without that approval; a banned word, an em dash or a British spelling in copy (python3 www/checkwords.py --where <file>); a changelog.d/ entry not in the changelog skill's voice, or not written for someone who has never seen the repo.`,
  },
  {
    name: 'process',
    agentType: 'reviewer',
    effort: 'high',
    brief: `CI and process (docs/process.md): the title and body pass the PR checks (PR_TITLE=… PR_BODY=… python3 scripts/pr_checks.py title, and links); Closes and Refs name the right issues, one keyword per issue; a user-visible change has a changelog.d/ entry and CHANGELOG.md is untouched; the full-ci label is needed or not (§ CI and merging lists what the Slow suite covers); commits explain why, carry Refs #n and no hand-written attribution; no generated file edited by hand (root AGENTS.md rule 7); a quarantined test names its issue and a fixed one loses its tag; a new check is wired where CI runs it (ci.yml's changes job reaches the paths, make dev-check or web-check runs it); docs/process.md, the skills and testing.md's tables still describe what the change does to the process.`,
  },
]

phase('Review')
const lensResults = await parallel(LENSES.map(lens => () => agent(
  `Review ${TARGET} of ${REPO} through one lens only: ${lens.name}.

${HOW}

${lens.brief}

Only report a finding you can support with a concrete scenario (inputs, state, wrong result), with the evidence: what you ran or the code at file:line. Say nothing about the other lenses' ground. ${READ_ONLY}`,
  { label: `review ${lens.name}`, phase: 'Review', agentType: lens.agentType, effort: lens.effort, schema: FINDINGS },
)))
const lensesFailed = LENSES.filter((_, i) => !lensResults[i]).map(l => l.name)
if (lensesFailed.length) log(`lenses that did not return: ${lensesFailed.join(', ')}`)

// Plain code: one finding per place. The same file and line from two lenses
// is one finding, at the higher severity, with both lenses named.
const rank = s => SEVERITY.indexOf(s)
const merged = new Map()
lensResults.forEach((r, i) => {
  if (!r) return
  for (const f of r.findings) {
    const key = `${f.file}:${f.line || 0}`
    const had = merged.get(key)
    if (!had) merged.set(key, { ...f, lenses: [LENSES[i].name] })
    else {
      had.lenses.push(LENSES[i].name)
      if (rank(f.severity) < rank(had.severity)) Object.assign(had, { severity: f.severity, summary: f.summary, scenario: f.scenario })
      had.evidence += `\n(${LENSES[i].name}) ${f.summary}: ${f.evidence}`
    }
  }
})
const found = [...merged.values()]
log(`${found.length} finding(s) to test`)

phase('Refute')
const verdicts = await parallel(found.map((f, i) => () => agent(
  `Try to refute this review finding on ${TARGET} of ${REPO}. You did not write it. Read the code at the change's head, and run what settles it (a test, a probe, the gate it names).

${HOW}

The finding (from the ${f.lenses.join(' and ')} review, rated ${f.severity}):
- ${f.file}${f.line ? ':' + f.line : ''}: ${f.summary}
- scenario: ${f.scenario}
- evidence: ${f.evidence}

It stands only if you confirm the scenario: the inputs or state are reachable and the result is wrong. Refute it when the code does not do what it says, the scenario cannot happen, the defect is not the change's, or you cannot confirm it: when uncertain, refuted is true. If it stands, rate it again: ${SEVERITY.join(', ')}. ${READ_ONLY}`,
  { label: `refute ${i + 1}`, phase: 'Refute', agentType: 'reviewer', effort: 'high', schema: VERDICT },
)))

const findings = []
const refuted = []
found.forEach((f, i) => {
  const v = verdicts[i]
  if (v && !v.refuted) findings.push({ ...f, severity: v.severity, verdict: v.reason })
  else refuted.push({ file: f.file, line: f.line, summary: f.summary, why: v ? v.reason : 'its refuter did not return, so it was not confirmed' })
})
findings.sort((a, b) => rank(a.severity) - rank(b.severity) || b.lenses.length - a.lenses.length)
log(`${findings.length} finding(s) stand, ${refuted.length} refuted`)
return { workflow: 'review-pr', target: TARGET, findings, refuted, lenses_failed: lensesFailed }
