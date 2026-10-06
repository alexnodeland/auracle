// What the saved workflows promise the operator, on scripted agents (`make
// dev-check`, its dev-ops part). check_workflows.mjs checks that every
// workflow runs soundly on any data its agents may return; these run the real
// workflow files with agents answering as a test says, and check what comes
// back:
//
// - ship-issues, fix-flake and mutants-burndown: an item is `ready` only when
//   every agent it needed came back. A skipped agent, or one that died on an
//   API error, gives null and the run goes on; a fix that did not return,
//   or a blocking finding no re-check confirmed fixed, keeps the item from
//   `ready`, since the operator ships every `ready` item.
// - review-pr: every finding is put to a refuter of its own, so none is lost
//   with another's refutation.
// - every workflow: each stage runs on the model its table below gives (opus
//   for the hard stages, sonnet for the easy ones), an operator's override
//   (`models`, and a ship-issues item's `model`) reaches that stage and no
//   other, a bad one throws before any agent is spent, and every prompt for
//   substantive work tells its agent to use the advisor. The agent
//   definitions default to opus and say the same of the advisor.
//
//     node --test scripts/ops/workflows.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compileWorkflow, dryRun, sample, DIR, ROOT, SAMPLES } from './check_workflows.mjs'

const load = name => compileWorkflow(readFileSync(join(DIR, `${name}.js`), 'utf8'))

async function run(name, args, answer, kill = -1) {
  const r = await dryRun(load(name), structuredClone(args), 'lean', undefined, { answer, kill })
  assert.equal(r.error, null, `${name} threw: ${r.error && r.error.stack}`)
  assert.deepEqual(r.stageErrors, [], `${name}: a stage threw`)
  return { labels: r.labels, result: r.result, item: r.result.items[0] }
}

const FINDING = { file: 'apps/web/main.js', line: 3, summary: 'a defect', scenario: 'a scenario' }

// Answers under which an item comes back `ready`: each agent's least data
// (its booleans true: a re-check that says all resolved, a proof that
// passed; its counts 0: no survivor left), a report whose title, issue lines
// and session line pass, a review with one blocking finding, and a crate
// measured with one survivor. `over(label)` replaces one agent's answer.
function ready(args, { closes = [], refs = [] }, over = () => undefined) {
  const lines = [...closes.map(n => `Closes #${n}`), ...refs.map(n => `Refs #${n}`)]
  return (opts, prompt, index) => {
    const mine = over(opts.label)
    if (mine !== undefined) return mine
    const p = opts.schema.properties
    const out = sample(opts.schema, 'lean')
    if ('pr_title' in p) {
      Object.assign(out, { pr_title: 'fix(web): the sample is true', pr_body: `## What\n\nIt.\n\n${lines.join('\n')}\n\n${args.session}`, closes, refs, open_items: [] })
    }
    if ('blocking' in p) out.blocking = [FINDING]
    if ('groups' in p) out.groups = [{ file: 'src/lib.rs', survivors: [{ line: 1, function: 'f', change: 'replace + with -' }] }]
    return out
  }
}

const SHIPPING = {
  'ship-issues': {
    args: SAMPLES['ship-issues'][0],
    issues: { closes: [300], refs: [177] },
    labels: ['build #300', 'review #300', 'fix #300', 'verify #300', 'finalize #300'],
  },
  'fix-flake': {
    args: SAMPLES['fix-flake'][0],
    issues: { closes: [304] },
    labels: ['diagnose #304', 'fix #304', 'prove #304', 'review #304', 'fix #304 review', 'verify #304', 'finalize #304'],
  },
  'mutants-burndown': {
    args: SAMPLES['mutants-burndown'][0],
    issues: { refs: [181] },
    labels: ['measure #181', 'kill #181 src/lib.rs', 'measure #181 after', 'review #181', 'fix #181', 'verify #181', 'finalize #181'],
    // A file's kill agent may die: the measure after it counts what is left.
    survives: ['kill #181 src/lib.rs'],
  },
}

for (const [name, c] of Object.entries(SHIPPING)) {
  test(`${name}: with every agent back, the item is ready`, async () => {
    const { labels, item } = await run(name, c.args, ready(c.args, c.issues))
    assert.deepEqual(labels, c.labels)
    assert.deepEqual(item.problems, [])
    assert.equal(item.status, 'ready')
  })

  test(`${name}: with any one agent gone, the item is not ready`, async () => {
    for (const [k, label] of c.labels.entries()) {
      const { item } = await run(name, c.args, ready(c.args, c.issues), k)
      if ((c.survives || []).includes(label)) {
        assert.equal(item.status, 'ready', `${label} dead: the measure after it says what is left`)
        continue
      }
      assert.notEqual(item.status, 'ready', `${label} dead, yet the item is ready`)
      assert.ok(item.problems.length, `${label} dead: no problem said`)
    }
  })

  test(`${name}: a fix or a re-check that did not return leaves the blocking finding unresolved`, async () => {
    // The cases the review of #177's workflows found shipping as `ready`.
    for (const stage of ['fix', 'verify']) {
      const k = c.labels.findIndex(l => l.startsWith(`${stage} `) && (name !== 'fix-flake' || stage !== 'fix' || l.endsWith(' review')))
      const { item } = await run(name, c.args, ready(c.args, c.issues), k)
      assert.equal(item.status, 'needs_attention', c.labels[k])
      assert.ok(item.problems.includes('the fix or its re-check did not return; 1 blocking finding(s) unresolved'), `${c.labels[k]}: ${item.problems.join('; ')}`)
      if (stage === 'fix') assert.ok(item.problems.some(p => /did not return: .*1 blocking/.test(p)), item.problems.join('; '))
    }
  })
}

test('ship-issues: a second fix round, or its re-check, that did not return is a problem', async () => {
  const c = SHIPPING['ship-issues']
  const left = { all_resolved: false, remaining: [FINDING], notes: 'one left' }
  const over = label => (label === 'verify #300' ? left : undefined)
  const all = await run('ship-issues', c.args, ready(c.args, c.issues, over))
  assert.deepEqual(all.labels, ['build #300', 'review #300', 'fix #300', 'verify #300', 'fix #300 r2', 'verify #300 r2', 'finalize #300'])
  assert.equal(all.item.status, 'ready', 'the second round resolved it')
  const fix2 = await run('ship-issues', c.args, ready(c.args, c.issues, over), 4)
  assert.ok(fix2.item.problems.includes('fix round 2 did not return'), fix2.item.problems.join('; '))
  assert.ok(fix2.item.problems.includes('the fix or its re-check did not return; 1 blocking finding(s) unresolved'), fix2.item.problems.join('; '))
  const verify2 = await run('ship-issues', c.args, ready(c.args, c.issues, over), 5)
  assert.deepEqual(verify2.item.problems, ['the fix or its re-check did not return; 1 blocking finding(s) unresolved'])
  const stillLeft = await run('ship-issues', c.args, ready(c.args, c.issues, label => (label.startsWith('verify') ? left : undefined)))
  assert.deepEqual(stillLeft.item.problems, ['1 blocking finding(s) remain after 2 fix round(s)'])
})

test('ship-issues: should-fix findings a fix never made are a problem too (the fold-in rule)', async () => {
  const c = SHIPPING['ship-issues']
  const rv = { verdict: 'v', blocking: [], should_fix: [FINDING], maintainers_call: [], nits: [FINDING] }
  const { labels, item } = await run('ship-issues', c.args, ready(c.args, c.issues, label => (label === 'review #300' ? rv : undefined)), 2)
  assert.equal(labels[2], 'fix #300')
  assert.equal(item.status, 'needs_attention')
  assert.deepEqual(item.problems, ["the fix did not return: the review's 0 blocking, 1 should-fix and 1 nit finding(s) and 0 in-area item(s) are not done on the branch"])
})

test('review-pr: findings that share a place each get a refuter, and none is lost', async () => {
  // Two lenses on one file with no line, and two defects on one line from one lens.
  const by = {
    'review descriptions': [{ severity: 'should_fix', file: 'docs/process.md', summary: 'A', scenario: 'sA', evidence: 'eA' }],
    'review process': [{ severity: 'blocking', file: 'docs/process.md', summary: 'B', scenario: 'sB', evidence: 'eB' }],
    'review tests': [
      { severity: 'should_fix', file: 'scripts/ops/x.py', line: 10, summary: 'C', scenario: 'sC', evidence: 'eC' },
      { severity: 'nit', file: 'scripts/ops/x.py', line: 10, summary: 'D', scenario: 'sD', evidence: 'eD' },
    ],
  }
  const answer = refute => (opts, prompt) => {
    if (opts.label.startsWith('review ')) return { findings: by[opts.label] || [] }
    const which = /- scenario: s(\w)/.exec(prompt)[1]
    return { refuted: refute.includes(which), reason: `r${which}`, severity: which === 'B' ? 'blocking' : 'should_fix' }
  }
  const all = await dryRun(load('review-pr'), { pr: 250 }, 'lean', undefined, { answer: answer('') })
  assert.equal(all.labels.filter(l => l.startsWith('refute')).length, 4)
  assert.deepEqual(all.result.findings.map(f => f.summary), ['B', 'A', 'C', 'D'])
  const one = await dryRun(load('review-pr'), { pr: 250 }, 'lean', undefined, { answer: answer('C') })
  assert.deepEqual(one.result.findings.map(f => f.summary), ['B', 'A', 'D'])
  assert.deepEqual(one.result.refuted.map(f => f.summary), ['C'])
})

// ─── the model of each stage ────────────────────────────────────────────────

// Each workflow's stages: the pattern of the labels of its agents, and the
// model it runs on by default (the maintainer's rule, AGENTS.md § Tooling:
// opus for building, fixing, judging and the last gate on a finding; sonnet
// for what a script or a count settles: the first mutation measure, finalize,
// listing and reading one issue, review-pr's voice and process lenses). A new
// stage or label is a row here, or the test of labels below fails.
const STAGES = {
  'ship-issues': [
    ['build', /^build /, 'opus'],
    ['review', /^review /, 'opus'],
    ['fix', /^fix /, 'opus'],
    ['verify', /^verify /, 'opus'],
    ['finalize', /^finalize /, 'sonnet'],
  ],
  'fix-flake': [
    ['diagnose', /^diagnose /, 'opus'],
    ['fix', /^fix /, 'opus'],
    ['prove', /^prove /, 'opus'],
    ['review', /^review /, 'opus'],
    ['verify', /^verify /, 'opus'],
    ['finalize', /^finalize /, 'sonnet'],
  ],
  'mutants-burndown': [
    ['measure', /^measure \S+$/, 'sonnet'],
    ['kill', /^kill /, 'opus'],
    ['remeasure', /^measure \S+ after$/, 'opus'],
    ['review', /^review /, 'opus'],
    ['fix', /^fix /, 'opus'],
    ['verify', /^verify /, 'opus'],
    ['finalize', /^finalize /, 'sonnet'],
  ],
  'review-pr': [
    ['correctness', /^review correctness$/, 'opus'],
    ['descriptions', /^review descriptions$/, 'opus'],
    ['tests', /^review tests$/, 'opus'],
    ['voice', /^review voice$/, 'sonnet'],
    ['process', /^review process$/, 'sonnet'],
    ['refute', /^refute /, 'opus'],
  ],
  'triage-backlog': [
    ['list', /^list open issues$/, 'sonnet'],
    ['read', /^triage #/, 'sonnet'],
    ['plan', /^plan waves$/, 'opus'],
  ],
}
test('every saved workflow has its stages in the table above, and no other', () => {
  // A workflow added with no row here would pass every model test by not being run.
  const saved = readdirSync(DIR).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort()
  assert.deepEqual(Object.keys(STAGES).sort(), saved)
})

// The labels whose prompts need no advisor line: a pure listing, and a run
// that only counts mutants.
const NO_ADVISOR = [/^list open issues$/, /^measure \S+$/]
const other = m => (m === 'opus' ? 'sonnet' : 'opus')

// A run on rich scripted agents (every array one element long, every boolean
// false: each stage runs, the fix and re-check rounds included). Returns the
// model and the prompt of each agent by label, and the run's error, if any.
async function stages(name, args) {
  const prompts = {}
  const answer = (opts, prompt) => { prompts[opts.label] = prompt; return sample(opts.schema, 'rich') }
  const r = await dryRun(load(name), structuredClone(args), 'rich', undefined, { answer })
  const models = Object.fromEntries(r.labels.map((l, i) => [l, r.models[i]]))
  return { models, prompts, labels: r.labels, error: r.error, calls: r.calls, stageErrors: r.stageErrors }
}
const stageOf = (name, label) => {
  const hit = STAGES[name].filter(([, re]) => re.test(label))
  assert.equal(hit.length, 1, `${name}: the label "${label}" is in ${hit.length} stage(s) of STAGES`)
  return hit[0][0]
}
// The sample that reaches every stage: triage-backlog's first lists the issues.
const sampleOf = name => SAMPLES[name][0]

for (const name of Object.keys(STAGES)) {
  test(`${name}: each stage runs on the model its table gives`, async () => {
    const { models, error, stageErrors } = await stages(name, sampleOf(name))
    assert.equal(error, null, error && error.stack)
    assert.deepEqual(stageErrors, [])
    const seen = {}
    for (const [label, model] of Object.entries(models)) (seen[stageOf(name, label)] ??= new Set()).add(model)
    for (const [stage, , want] of STAGES[name]) {
      assert.deepEqual([...(seen[stage] || [])], [want], `${name}: ${stage} runs on ${want}`)
    }
  })

  test(`${name}: models overrides one stage and no other`, async () => {
    const base = (await stages(name, sampleOf(name))).models
    for (const [stage, , want] of STAGES[name]) {
      const { models, error } = await stages(name, { ...sampleOf(name), models: { [stage]: other(want) } })
      assert.equal(error, null, error && error.stack)
      assert.deepEqual(Object.keys(models), Object.keys(base))
      for (const [label, model] of Object.entries(models)) {
        const mine = stageOf(name, label) === stage
        assert.equal(model, mine ? other(want) : base[label], `${name}: models.${stage} = ${other(want)}, and ${label} runs on ${model}`)
      }
    }
  })

  test(`${name}: a bad models throws before any agent is spent`, async () => {
    const [first] = STAGES[name][0]
    for (const [bad, what] of [
      [{ nowhere: 'opus' }, /models\.nowhere is not a (stage|lens or refute)/],
      [{ [first]: 'haiku' }, new RegExp(`models\\.${first} is 'opus' or 'sonnet'`)],
      [{ [first]: undefined, [STAGES[name][1][0]]: 5 }, /models\.\w+ is 'opus' or 'sonnet'/],
      ['opus', /models is an object/],
      [['opus'], /models is an object/],
      [null, /models is an object/],
    ]) {
      const { error, calls } = await stages(name, { ...sampleOf(name), models: bad })
      assert.match(String(error && error.message), what, JSON.stringify(bad))
      assert.equal(calls, 0, `${JSON.stringify(bad)}: an agent was spent`)
    }
  })

  test(`${name}: each prompt for substantive work names the advisor`, async () => {
    const { prompts, error } = await stages(name, sampleOf(name))
    assert.equal(error, null, error && error.stack)
    assert.ok(Object.keys(prompts).length >= 2)
    for (const [label, prompt] of Object.entries(prompts)) {
      const needs = !NO_ADVISOR.some(re => re.test(label))
      assert.equal(/If an advisor tool is available, call it before you commit to an approach, when you are stuck or going in circles, and before you report done\./.test(prompt), needs, `${name}: ${label}${needs ? ' has no advisor line' : ' is a listing or a count, and has one'}`)
    }
  })
}

test('ship-issues: an item sets the model of its build and fix stages, and no other', async () => {
  const [item] = SAMPLES['ship-issues'][0].items
  const run = args => stages('ship-issues', { items: [item], ...args })
  const labels = ['build #300', 'review #300', 'fix #300', 'verify #300', 'fix #300 r2', 'verify #300 r2', 'finalize #300']
  const mine = { 'build #300': 'sonnet', 'fix #300': 'sonnet', 'fix #300 r2': 'sonnet' }
  const defaults = { 'build #300': 'opus', 'review #300': 'opus', 'fix #300': 'opus', 'verify #300': 'opus', 'fix #300 r2': 'opus', 'verify #300 r2': 'opus', 'finalize #300': 'sonnet' }

  const base = await run({})
  assert.deepEqual(base.labels, labels)
  assert.deepEqual(base.models, defaults)
  const sonnet = await run({ items: [{ ...item, model: 'sonnet' }] })
  assert.deepEqual(sonnet.models, { ...defaults, ...mine })
  // An item's model wins over models.build and models.fix; models still sets the stages an item does not.
  const opus = await run({ items: [{ ...item, model: 'opus' }], models: { build: 'sonnet', fix: 'sonnet', review: 'sonnet', finalize: 'opus' } })
  assert.deepEqual(opus.models, { ...defaults, 'review #300': 'sonnet', 'finalize #300': 'opus' }, 'an item model wins over models.build and models.fix, and only there')
  // Two items, each on its own.
  const second = { ...item, issue: 301, closes: [301], branch: 'claude/b', worktree: '/tmp/auracle/.claude/worktrees/b', port: 8802, model: 'sonnet' }
  const both = await run({ items: [item, second] })
  assert.equal(both.models['build #300'], 'opus')
  assert.equal(both.models['build #301'], 'sonnet')
  assert.equal(both.models['review #301'], 'opus')
  for (const bad of ['haiku', 5, null]) {
    const r = await run({ items: [{ ...item, model: bad }] })
    assert.match(String(r.error && r.error.message), /#300: model is 'opus' or 'sonnet'/, String(bad))
    assert.equal(r.calls, 0)
  }
})

test('the agent definitions default to opus and say to use the advisor', () => {
  const dir = join(ROOT, '.claude', 'agents')
  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  assert.ok(files.length >= 6)
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8')
    const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
    assert.match(front, /^model: opus$/m, `${f}: model: opus in its frontmatter`)
    assert.equal((body.match(/If an advisor tool is available, call it/g) || []).length, 1, `${f}: the advisor line, once, in its body`)
  }
})
