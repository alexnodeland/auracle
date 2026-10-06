export const meta = {
  name: 'ship-issues',
  description: 'Build, review, fix, re-check and finalize auracle issues, each on its own claude/ branch and worktree; returns the head, title, body and open items the operator needs to push and queue the PR',
  whenToUse: 'Prefer ONE issue per run (or a small bundle of issues that share files), so each completion notifies on its own: a run returns only when its slowest item is done. Each item needs its worktree created from origin/main first (make worktree TOPIC=<topic>: .claude/worktrees/<topic>). Runs when the maintainer asks for a wave or for this workflow by name (it spends many tokens); the ship-wave skill has the steps around it.',
  phases: [
    { title: 'Build', detail: 'the area agent builds and commits in the worktree' },
    { title: 'Review', detail: 'the reviewer agent, read-only, on the branch' },
    { title: 'Fix', detail: 'every blocking and should-fix finding, the nits and the in-area open items, fixed on the branch' },
    { title: 'Verify', detail: 'the reviewer re-checks the blocking findings' },
    { title: 'Finalize', detail: 'rebased onto origin/main, the quick gates again, the PR checks on the title and body' },
  ],
}

// args: {
//   items: [{ issue, closes?: [n], refs?: [n], branch: 'claude/<topic>', port,
//             worktree: '$REPO/.claude/worktrees/<topic>' (the main checkout's .claude/worktrees/),
//             agentType?: 'web-engineer' | 'engine-engineer' | 'docs-writer' | 'film-producer',
//             notes?: 'what remains', decisions?: 'already made', avoid?: 'files not to touch' }],
//   session?: 'https://claude.ai/code/session_…'   // this operator session's link
// }
// With a session, every commit's last line is `Claude-Session: <session>` and
// the PR body's last line is the link; without one, neither has it.
//
// Returns { workflow, session, items: [{ issue, branch, worktree, status, problems, final, review, verify,
// fix_rounds }] }: `final` is the finalized report (head, title, body, closes and refs, needs_full_ci,
// voice drafts, decisions, open items by kind). `scripts/ops/wf_result.py` reads it, or the run's journal
// while it is still going, and writes the PR body. An item is `ready` only when every agent it needed came
// back (one skipped or dead gives null): a fix that did not return, or a blocking finding no re-check
// confirmed fixed, is a problem.

const REPO = 'alexnodeland/auracle'
const MAX_FIX_ROUNDS = 2

function need(ok, what) {
  if (!ok) throw new Error(`ship-issues: ${what}`)
}
need(args && typeof args === 'object' && !Array.isArray(args), 'args is an object, {items: [...], session}, passed as JSON (not as a string)')
need(Array.isArray(args.items) && args.items.length > 0, 'args.items lists at least one item')
for (const it of args.items) {
  need(it && Number.isInteger(it.issue), 'every item has an issue number')
  need(typeof it.branch === 'string' && it.branch.startsWith('claude/'), `#${it.issue}: branch is claude/<topic>`)
  need(typeof it.worktree === 'string' && it.worktree.startsWith('/'), `#${it.issue}: worktree is an absolute path`)
  need(Number.isInteger(it.port), `#${it.issue}: port is a number (8771 and up)`)
}
const SESSION = typeof args.session === 'string' && args.session ? args.session : null
need(!SESSION || /^https:\/\/claude\.ai\/code\/session_\w+$/.test(SESSION), 'session is a https://claude.ai/code/session_… link')

// The operator's rules a stage needs. The rest (descriptions stay true, drop
// nothing, tests at the lowest level, the gates) is in the AGENTS.md files
// every agent is given.
const RULES = `Rules for this run (docs/process.md; the operator's):
- Work only in your worktree, never in the main checkout. Commit only: never push, open or edit a PR, comment on GitHub, or merge; the operator does all of that. Never change any git config. Run git with the GIT_* variables unset (env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git ...).
- Commit with: git -c user.name="Alex Nodeland" -c user.email="nodeland.alex@gmail.com" -c core.fsmonitor=false commit (a dev-check inside a commit once hung on git's fsmonitor socket). Small commits, each leaving the app working; a loose conventional prefix (fix(web):, feat(engine):, tests:, docs:, ci:); a body that says what was wrong and why this is the fix; "Refs #<issue>" in the body.${SESSION ? ` The LAST line of every message, exactly: Claude-Session: ${SESSION}` : ''}
- No hand-written attribution: no Co-Authored-By, no "generated with" line, no model name or version.
- Browser runs only through www/video/tools/one_browser.sh with AURACLE_TEST_PORT set to your port: the specs you add or touch, with --repeat-each=3 on a new or changed spec (CI has no burn-in, so this is it). Never a full suite. tests/web needs its packages once: cd tests/web && npm ci.
- Rust builds and tests under nice -n 10, in the worktree's own target/. After Rust the app calls, make wasm before any browser run.
- A change a player, listener or site reader can notice gets a changelog.d/<topic>.md entry (changelog.d/README.md, the changelog skill's voice). Nothing else touches CHANGELOG.md.
- New words for www/brand/voice.md's word table (a label, a toast, a refusal, a guide phrase): reuse the approved words where they are true. A new phrase you can't avoid is built with your best draft, voice.md is NOT edited, and the phrase goes in voice_drafts; the maintainer approves the batch.
- In-area problems are fixed in this branch: a bug, a flaky or vacuous test, or an untrue description in what the branch touches does not leave as an open item. Only a choice for the maintainer (kind decision) or work in another area (kind other_area) leaves the PR.
- Scratch files go in a directory of your own (mktemp -d), outside every checkout.`

const TITLE = /^(feat|fix|docs|tests|test|ci|build|refactor|perf|chore|revert|style|release)(\([^()\s]+\))?!?: \S/
const BODY_DOC = `Markdown, for the PR: ## What (what changed for a player or a contributor, and why), ## How (the decisions a reviewer should look at), ## Checks (the gates, the specs and their counts, the review and what it found, what was fixed or declined and why); then one "Closes #n" line for each issue in closes and one "Refs #n" line for each in refs, each on a line of its own (one keyword, one issue)${SESSION ? `; the LAST line is exactly ${SESSION}` : '; no session link'}`

const FINDING = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    line: { type: 'integer' },
    summary: { type: 'string', description: 'the defect, in one or two sentences' },
    scenario: { type: 'string', description: 'concrete inputs or state, and the wrong result' },
    other_area: { type: 'boolean', description: 'true when the fix belongs to an area this branch does not touch' },
  },
  required: ['file', 'summary', 'scenario'],
}
const OPEN_ITEM = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['in_area', 'decision', 'other_area', 'note'],
      description: 'in_area: work in what this branch touches that is not done yet (the fix stage does it; the final report has none). decision: a choice only the maintainer can make; the text is the exact question. other_area: work in an area this branch does not touch; it becomes an issue. note: something the operator should know that needs no work.',
    },
    text: { type: 'string' },
  },
  required: ['kind', 'text'],
}
const VOICE = {
  type: 'object',
  properties: {
    words: { type: 'string', description: 'the exact words proposed' },
    where: { type: 'string', description: 'where they appear: the file and the label, toast, status line or page' },
    voice_md_row: { type: 'string', description: "the row for www/brand/voice.md's word table, as Markdown" },
  },
  required: ['words', 'where', 'voice_md_row'],
}
const REPORT_PROPS = {
  head: { type: 'string', description: 'full SHA of the branch head' },
  commits: { type: 'array', items: { type: 'string' }, description: 'short SHA and subject of each commit on the branch' },
  summary: { type: 'string', description: 'what changed and why, for a reviewer' },
  gates: { type: 'array', items: { type: 'string' }, description: 'each gate run and its result' },
  browser_runs: { type: 'array', items: { type: 'string' }, description: 'each browser run: specs, repeat count, passed and failed' },
  user_visible: { type: 'boolean' },
  changelog_fragment: { type: ['string', 'null'], description: 'the changelog.d/ file added, or null' },
  voice_drafts: { type: 'array', items: VOICE },
  decisions: { type: 'array', items: { type: 'string' }, description: 'choices you made that the issue left open, each with its reason' },
  before_after: { type: 'string', description: 'for anything moved or retired: before -> after by mouse, keyboard and touch; empty when nothing moved' },
  closes: { type: 'array', items: { type: 'integer' }, description: 'issues this branch finishes' },
  refs: { type: 'array', items: { type: 'integer' }, description: 'issues this branch advances without finishing' },
  needs_full_ci: {
    type: 'object',
    properties: { value: { type: 'boolean' }, reason: { type: 'string', description: 'which changed file puts it in the Slow suite (docs/process.md § CI and merging), or why none does' } },
    required: ['value', 'reason'],
  },
  open_items: { type: 'array', items: OPEN_ITEM },
  pr_title: { type: 'string', description: 'type(scope): what is true now, as recent PR titles are (gh -R alexnodeland/auracle pr list --state merged --limit 10)' },
  pr_body: { type: 'string', description: BODY_DOC },
}
const REPORT_REQUIRED = Object.keys(REPORT_PROPS)
const REPORT = { type: 'object', properties: REPORT_PROPS, required: REPORT_REQUIRED }
const FINAL = {
  type: 'object',
  properties: {
    ...REPORT_PROPS,
    base: { type: 'string', description: "origin/main's full SHA, which the branch now sits on" },
    conflicts: { type: 'string', description: 'what conflicted in the rebase and how each was resolved, or "none"' },
    pr_checks: { type: 'string', description: 'what scripts/pr_checks.py title and links printed, last run' },
  },
  required: [...REPORT_REQUIRED, 'base', 'conflicts', 'pr_checks'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    blocking: { type: 'array', items: FINDING, description: 'a wrong result, a dropped capability, an untrue description, a test that can pass vacuously or that a slow runner can fail' },
    should_fix: { type: 'array', items: FINDING, description: 'every other finding in what the branch touches; it is fixed in this branch' },
    maintainers_call: { type: 'array', items: FINDING, description: 'a choice only the maintainer can make' },
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
const inArea = r => (r && r.open_items ? r.open_items.filter(o => o.kind === 'in_area') : [])
const issueList = ns => (ns && ns.length ? ns.map(n => `#${n}`).join(', ') : 'none')

// What the code can check without an agent: the title's type, the body's
// issue lines against closes and refs, the session line, and what is left.
function problemsOf(r, item) {
  const out = []
  if (!TITLE.test(r.pr_title || '')) out.push(`the title has no conventional type: ${r.pr_title}`)
  const body = r.pr_body || ''
  const lines = body.split('\n').map(l => l.trim())
  const closing = new Set(), refs = new Set()
  for (const l of lines) {
    const c = /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\.?$/i.exec(l)
    if (c) closing.add(Number(c[1]))
    else if (/^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#\d+\s*[,;&/]/i.test(l) || /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#\d+\s+(?:and|&)\s/i.test(l)) {
      out.push(`a closing keyword with a list closes only its first issue: ${l}`)
    }
    const f = /^refs?:?\s+(.*)$/i.exec(l)
    if (f) for (const m of f[1].matchAll(/#(\d+)/g)) refs.add(Number(m[1]))
  }
  for (const n of r.closes || []) if (!closing.has(n)) out.push(`closes #${n}, but the body has no "Closes #${n}" line`)
  for (const n of closing) if (!(r.closes || []).includes(n)) out.push(`the body closes #${n}, which closes does not list`)
  for (const n of r.refs || []) if (!refs.has(n)) out.push(`refs #${n}, but the body has no "Refs #${n}" line`)
  if (!closing.size && !refs.size && !/^no issue:/im.test(body)) out.push('the body names no issue')
  for (const n of item.closes || []) if (!(r.closes || []).includes(n)) out.push(`planned to close #${n}; the report does not (say why in the body)`)
  if (SESSION) {
    const last = lines.filter(Boolean).pop()
    if (last !== SESSION) out.push('the body does not end with the session link')
  }
  for (const o of inArea(r)) out.push(`an in-area item is left: ${o.text}`)
  return out
}

function build(item) {
  return agent(
    `You are building GitHub issue #${item.issue} of ${REPO}. Read it first: gh -R ${REPO} issue view ${item.issue} --comments.
Worktree: ${item.worktree} (branch ${item.branch}, already created from origin/main). Browser port: ${item.port}.
Planned: closes ${issueList(item.closes || [item.issue])}; refs ${issueList(item.refs)}. Say in closes and refs what the branch really does.

What remains, from triage:
${item.notes || '- the issue says'}

Decisions already made (do not re-ask):
${item.decisions || '- none beyond the issue'}

Do not touch: ${item.avoid || 'nothing in particular'}.

${RULES}

Gates before you report: the check skill's set for what you changed (make web-check for JS; make dev-check always; make fmt-check lint and the crate's tests for Rust, and make mutants DIFF=1; make wasm-check when the wasm crate or what it calls changed), and the specs you added or touched.

Report with the structured output. needs_full_ci: docs/process.md § CI and merging lists what the Slow suite covers. open_items carry a kind; in-area work is done, not listed. The pr_title and pr_body are drafts the operator will use.`,
    { label: `build #${item.issue}`, phase: 'Build', agentType: item.agentType, schema: REPORT },
  )
}

function review(report, item) {
  return agent(
    `Review branch ${item.branch} for issue #${item.issue} of ${REPO}. Worktree: ${item.worktree}; the diff is git -C ${item.worktree} diff origin/main...HEAD (fetch origin first). Read the issue: gh -R ${REPO} issue view ${item.issue} --comments.

The builder's report:
${json(report)}

Hunt for, running things where you can:
- a wrong result (run the gates and the touched tests yourself; for a fix, confirm its test fails without it);
- a dropped capability (by mouse, keyboard and touch; check the before -> after against the old code);
- an untrue description (guide, reference, in-app copy, docs/architecture, AGENTS.md files, comments, the PR body's claims);
- a test that can pass vacuously, that a slow runner can fail (ADR-022), or at the wrong level (docs/notes/test-audit-2026-10/rubric.md);
- new words for voice.md's table not listed as voice drafts; a user-visible change with no changelog.d/ entry;
- needs_full_ci, closes or refs that the diff does not bear out.

Rank them: blocking (a wrong result, a dropped capability, an untrue description, a vacuous or slow-runner-flaky test); should_fix (every other finding in what the branch touches: the builder fixes it in this branch); maintainers_call (only a choice the maintainer must make); nits. Mark a finding other_area when its fix belongs elsewhere.

Read-only: change nothing in any checkout; scratch files in a directory of your own (mktemp -d). Browser runs, if needed, through one_browser.sh on port ${item.port + 100}.`,
    { label: `review #${item.issue}`, phase: 'Review', agentType: 'reviewer', effort: 'xhigh', schema: REVIEW },
  )
}

function fix(report, item, rv, round) {
  const items = inArea(report)
  return agent(
    `Continue issue #${item.issue} in worktree ${item.worktree} (branch ${item.branch}, head ${report.head}, browser port ${item.port}). Fix every finding below in new commits on the branch, then return the full report again.

Blocking:
${fmt(rv.blocking)}

Should fix:
${fmt(rv.should_fix)}

Your own in-area open items (do them; they do not leave the PR):
${items.map(o => `- ${o.text}`).join('\n') || '- none'}

Nits (fix them unless one is wrong; say which you declined and why):
${fmt(rv.nits)}

The maintainer's call: make the choice only where the issue, its decisions or keeping today's behavior settles it, and say what you chose in decisions; otherwise leave it as an open item of kind decision with the exact question.
${fmt(rv.maintainers_call)}

A finding marked as another area's becomes an open item of kind other_area, unless it is a one-line fix the branch already touches.

Your report so far:
${json(report)}

${RULES}

Gates again, for what you changed. Return the full report, updated: the new head, every commit on the branch, no in_area open item left, and the pr_body saying what the review found and what was fixed or declined and why.`,
    { label: `fix #${item.issue}${round > 1 ? ` r${round}` : ''}`, phase: 'Fix', agentType: item.agentType, schema: REPORT },
  )
}

function verify(report, item, blocking, round) {
  return agent(
    `Re-check only these blocking findings on branch ${item.branch} (worktree ${item.worktree}, head ${report.head}) for issue #${item.issue} of ${REPO}. For each, confirm the fix resolves it at its cause: run the relevant test, and where a test was added, confirm it fails without the fix. Review that delta, not the whole branch. Read-only: change nothing in any checkout.

${fmt(blocking)}`,
    { label: `verify #${item.issue}${round > 1 ? ` r${round}` : ''}`, phase: 'Verify', agentType: 'reviewer', effort: 'high', schema: VERIFY },
  )
}

function finalize(report, item, known) {
  return agent(
    `Finalize branch ${item.branch} for issue #${item.issue} of ${REPO}, in worktree ${item.worktree} (head ${report.head}). Nothing is pushed yet, so a plain rebase is safe.

1. Rebase onto origin/main: git -C ${item.worktree} fetch -q origin, then git -C ${item.worktree} -c merge.conflictStyle=diff3 rebase origin/main (diff3, so each conflict carries its base). On a conflict, python3 scripts/ops/rows_resolve.py <file>... resolves the line-wise ones (a docs table's rows, the Makefile's DEV_CHECKS line, a list): it keeps origin/main's lines and applies the branch's changes to them, and refuses a real overlap. Resolve what it refuses by hand, keeping both sides' intent; git add, then GIT_EDITOR=true git rebase --continue. If a conflict needs a decision, git rebase --abort and report it in conflicts and as an open item of kind decision.
2. The quick gates again, for what the branch changes against origin/main (the check skill's set; make dev-check always), and the specs it touches when the rebase brought in changes to them or to what they test (one_browser.sh, port ${item.port}).
3. The PR checks, as CI runs them: write the body to a file in your scratch directory, then PR_TITLE="<title>" PR_BODY="$(cat <file>)" python3 scripts/pr_checks.py title, and the same with links (it reads the issues on GitHub with gh). Fix the title or the body until both pass.${known.length ? `\n   The workflow found these already: ${known.join('; ')}.` : ''}
4. needs_full_ci again, from the files the branch changes against origin/main (docs/process.md § CI and merging).

${RULES}

Return the report again, updated: the new head, every commit, base, conflicts, pr_checks, and a pr_title and pr_body that pass. pr_body: ${BODY_DOC}.`,
    { label: `finalize #${item.issue}`, phase: 'Finalize', agentType: item.agentType, schema: FINAL },
  )
}

const results = await pipeline(
  args.items,
  async (_, item) => ({ build: await build(item) }),
  async (s, item) => (s.build ? { ...s, review: await review(s.build, item) } : s),
  async (s, item) => {
    if (!s.build) return s
    let report = s.build
    let rounds = 0
    let verified = null
    // A fix round that did not return (a skipped or dead agent gives null),
    // and the blocking findings no re-check has yet confirmed fixed: either
    // keeps the item from `ready`.
    let lost = null
    const rv = s.review
    let open = rv ? rv.blocking : []
    if (rv && (rv.blocking.length || rv.should_fix.length || rv.nits.length || rv.maintainers_call.length || inArea(report).length)) {
      const fixed = await fix(report, item, rv, ++rounds)
      if (fixed) report = fixed
      else lost = `the fix did not return: the review's ${rv.blocking.length} blocking, ${rv.should_fix.length} should-fix and ${rv.nits.length} nit finding(s) and ${inArea(report).length} in-area item(s) are not done on the branch`
      while (fixed && open.length) {
        verified = await verify(report, item, open, rounds)
        if (!verified) break
        if (verified.all_resolved) { open = []; break }
        if (verified.remaining.length) open = verified.remaining
        if (!verified.remaining.length || rounds >= MAX_FIX_ROUNDS) break
        const again = await fix(report, item, { blocking: open, should_fix: [], maintainers_call: [], nits: [] }, ++rounds)
        if (!again) { lost = `fix round ${rounds} did not return`; break }
        report = again
      }
    } else if (!rv && inArea(report).length) {
      const fixed = await fix(report, item, { blocking: [], should_fix: [], maintainers_call: [], nits: [] }, ++rounds)
      if (fixed) report = fixed
      else lost = `the fix did not return: ${inArea(report).length} in-area item(s) are not done on the branch`
    }
    return { ...s, report, verify: verified, rounds, open, lost }
  },
  async (s, item) => {
    if (!s.build) return s
    const final = await finalize(s.report, item, problemsOf(s.report, item))
    return { ...s, final }
  },
)

const items = results.map((s, i) => {
  const item = args.items[i]
  const base = { issue: item.issue, branch: item.branch, worktree: item.worktree }
  if (!s || !s.build) return { ...base, status: 'failed', problems: ['the build did not return: read its transcript, then brief a fresh agent or run again'] }
  const final = s.final || s.report
  const problems = problemsOf(final, item)
  if (!s.review) problems.push('the review did not return: review the branch (review-pr) before the PR')
  if (!s.final) problems.push('finalize did not return: rebase, the gates and the PR checks are still to do')
  if (s.lost) problems.push(s.lost)
  if (s.open && s.open.length) {
    problems.push(s.verify && !s.lost
      ? `${s.open.length} blocking finding(s) remain after ${s.rounds} fix round(s)`
      : `the fix or its re-check did not return; ${s.open.length} blocking finding(s) unresolved`)
  }
  return {
    ...base,
    status: problems.length ? 'needs_attention' : 'ready',
    problems,
    final,
    review: s.review,
    verify: s.verify,
    fix_rounds: s.rounds,
  }
})
for (const it of items) log(`#${it.issue}: ${it.status}${it.problems && it.problems.length ? ` (${it.problems.length} problem(s))` : ''}`)
return { workflow: 'ship-issues', session: SESSION, items }
