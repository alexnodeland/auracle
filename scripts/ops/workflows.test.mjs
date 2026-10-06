// What the saved workflows promise the operator, on scripted agents (`make
// dev-check`, its dev-ops part). check_workflows.mjs checks that every
// workflow runs soundly on any data its agents may return; these run the real
// workflow files with agents answering as a test says, and check what comes
// back:
//
// - review-pr: every finding is put to a refuter of its own, so none is lost
//   with another's refutation.
//
//     node --test scripts/ops/workflows.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileWorkflow, dryRun, DIR } from './check_workflows.mjs'

const load = name => compileWorkflow(readFileSync(join(DIR, `${name}.js`), 'utf8'))

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
