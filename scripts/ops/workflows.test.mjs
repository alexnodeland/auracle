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
//
//     node --test scripts/ops/workflows.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileWorkflow, dryRun, sample, DIR, SAMPLES } from './check_workflows.mjs'

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
