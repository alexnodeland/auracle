// The workflow check's own tests (`make dev-check`, its dev-ops part): what it
// must refuse, and that a sound workflow passes. A check that silently stops
// refusing is worse than none: people trust it.
//
//     node --test scripts/ops/check_workflows.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkSource, impurities, codeOnly, sample, schemaProblems, dryRun, compile, metaText, DIR, SAMPLES } from './check_workflows.mjs'

const META = `export const meta = {
  name: 'demo',
  description: 'a demo',
  phases: [{ title: 'Build', detail: 'one agent' }],
}
`
const SCHEMA = `{ type: 'object', properties: { head: { type: 'string' }, ok: { type: 'boolean' }, items: { type: 'array', items: { type: 'string' } } }, required: ['head', 'ok', 'items'] }`
const BODY = `
if (!args || typeof args !== 'object') throw new Error('demo: args is an object')
const r = await agent(\`Build \${args.what}.\`, { label: 'build', phase: 'Build', schema: ${SCHEMA} })
return { head: r ? r.head : null }
`
const ARGS = [{ what: 'it' }]
const check = (src, args = ARGS) => checkSource('demo', src, args)

test('a sound workflow passes', async () => {
  assert.deepEqual(await check(META + BODY), [])
})

test('every saved workflow passes, and each has sample args', async () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.js'))
  assert.ok(files.length >= 5, 'the five saved workflows are there')
  for (const f of files) {
    const name = f.slice(0, -3)
    assert.ok(SAMPLES[name], `${name} has sample args`)
    assert.deepEqual(await checkSource(name, readFileSync(join(DIR, f), 'utf8')), [], name)
  }
})

test('meta must come first, as the tool reads it', async () => {
  const [p] = await check(`// a comment first\n${META}${BODY}`)
  assert.match(p, /does not begin with `export const meta = \{`/)
})

test('meta must be a pure literal', () => {
  assert.deepEqual(impurities(`{ name: 'a', n: -1, ok: true, x: null, list: ['a', "b", \`c\`], 'quoted': 1, // note
    nested: { k: 2.5e3 } }`), [])
  assert.match(impurities('{ name: NAME }').join(), /an identifier: `NAME`/)
  assert.match(impurities("{ name: make('a') }").join(), /a call: `make\(`/)
  assert.match(impurities('{ ...base, name: 1 }').join(), /a spread/)
  assert.match(impurities('{ name: `a ${b}` }').join(), /template interpolation/)
  assert.match(impurities('{ name }').join(), /an identifier: `name`/)
  assert.match(impurities('{ [key]: 1 }').join(), /an identifier: `key`/)
  assert.match(impurities("{ name: 'a' + 'b' }").join(), /an operator: `\+`/)
  assert.match(impurities('{ n: Math.PI }').join(), /an identifier: `Math`/)
})

test('an impure meta fails the file', async () => {
  const [p] = await check(META.replace("'demo'", 'NAME') + BODY)
  assert.match(p, /meta is not a pure literal: an identifier: `NAME`/)
})

test("meta's name is the file's, and its keys are the tool's", async () => {
  const problems = await check(META.replace("name: 'demo'", "name: 'other', when_to_use: 'x'") + BODY)
  assert.ok(problems.some(p => /meta.name is "other"; the file's name is demo/.test(p)), problems.join('\n'))
  assert.ok(problems.some(p => /a key the tool does not read: when_to_use/.test(p)), problems.join('\n'))
})

test('a phase the body uses must be in meta.phases, and each there must be used', async () => {
  const used = await check(META + BODY.replace("phase: 'Build'", "phase: 'Bild'"))
  assert.ok(used.some(p => /phase "Bild" is used but not in meta.phases/.test(p)), used.join('\n'))
  assert.ok(used.some(p => /meta.phases has "Build", which the body never names/.test(p)), used.join('\n'))
  // A phase named in a variable is caught when the dry run reaches it.
  const dynamic = await check(META + BODY.replace("phase: 'Build'", "phase: ['Bu', 'ild'].join('') + '!'"))
  assert.ok(dynamic.some(p => /phase "Build!" ran but is not in meta.phases/.test(p)), dynamic.join('\n'))
})

test('no clock, no dice and nothing of Node', async () => {
  for (const [call, want] of [
    ['Date.now()', /Date.now\(\)/],
    ['Math.random()', /Math.random\(\)/],
    ['new Date()', /new Date\(\) with no argument/],
    ["require('fs')", /require\(\)/],
    ['process.env.HOME', /process/],
    ["fetch('https://x')", /fetch\(\)/],
  ]) {
    const problems = await check(META + BODY.replace('return {', `const t = ${call}\nreturn {`))
    assert.ok(problems.some(p => want.test(p)), `${call}: ${problems.join('\n')}`)
  }
})

test('the words in a prompt or a comment are not calls', async () => {
  const src = META + `// Date.now() throws in a workflow
if (!args || typeof args !== 'object') throw new Error('demo: args is an object')
const r = await agent('Read docs/process.md; never call Date.now() or Math.random(): process the list.', { label: 'build', phase: 'Build' })
return { r }
`
  assert.deepEqual(await check(src), [])
  assert.doesNotMatch(codeOnly("const a = 'process.md' + `x ${'Date.now()'} y` /* Date.now() */"), /process\.|Date/)
  assert.match(codeOnly('const a = `x ${Date.now()} y`'), /Date\.now\(\)/)
  assert.doesNotMatch(codeOnly("const re = /it's process.md/; const b = 'x'"), /process|'x'/)
})

test('it does not parse: said, not thrown', async () => {
  const problems = await check(META + BODY.replace('return {', 'const = 1\nreturn {'))
  assert.ok(problems.some(p => /does not parse/.test(p)), problems.join('\n'))
})

test('a stage that throws on data its schema allows fails the check', async () => {
  // `rich` fills the array; this stage throws on it, which the tool would hide as a null.
  const src = META + `
if (!args || typeof args !== 'object') throw new Error('demo: args is an object')
const out = await pipeline([1], () => agent('Build it.', { label: 'build', phase: 'Build', schema: ${SCHEMA} }), r => r.items[0].toUpperCase().missing.call())
return out
`
  const problems = await check(src)
  assert.ok(problems.some(p => /sample 1, rich: a stage threw/.test(p)), problems.join('\n'))
})

test('a null from a dead agent may drop an item, but the run must return', async () => {
  const drops = META + `
if (!args || typeof args !== 'object') throw new Error('demo: args is an object')
const out = await pipeline([1], () => agent('Build it.', { label: 'build', phase: 'Build', schema: ${SCHEMA} }), r => r.head)
return out
`
  assert.deepEqual(await check(drops), [])
  const crashes = drops.replace('return out', 'return out.map(x => x.length)')
  const problems = await check(crashes)
  assert.ok(problems.some(p => /dead: the run threw/.test(p)), problems.join('\n'))
})

test('a stage that gives null ends its item, as in the tool', async () => {
  // The first stage drops its item on purpose; the second reads prev.head and
  // must not run on that null.
  const src = META + `
if (!args || typeof args !== 'object') throw new Error('demo: args is an object')
let later = 0
const out = await pipeline([1], async () => { await agent('Build it.', { label: 'build', phase: 'Build', schema: ${SCHEMA} }); return null }, prev => { later++; return prev.head })
return { out, later }
`
  assert.deepEqual(await check(src), [])
  const r = await dryRun(compile(src.slice(metaText(src).end)), { what: 'it' }, 'rich')
  assert.deepEqual(r.result, { out: [null], later: 0 })
})

test('one agent dead mid-run: a stage or a run that throws on its null is caught', async () => {
  // Sound with every agent alive, and with every agent dead (the first null
  // throws before the second agent is called); not with only the second dead.
  const src = META + `
if (!args || typeof args !== 'object') throw new Error('demo: args is an object')
const a = await agent('Build it.', { label: 'build', phase: 'Build', schema: ${SCHEMA} })
if (!a) return { head: null }
const b = await agent('Build it again.', { label: 'build again', phase: 'Build', schema: ${SCHEMA} })
return { head: a.head + b.head }
`
  const problems = await check(src)
  assert.ok(problems.some(p => /sample 1, rich with agent "build again" dead: the run threw/.test(p)), problems.join('\n'))
  assert.ok(!problems.some(p => /agent "build" dead/.test(p)), problems.join('\n'))
  assert.deepEqual(await check(src.replace('a.head + b.head', 'a.head + (b ? b.head : "")')), [])
})

test('a prompt that interpolates something missing is caught', async () => {
  const problems = await check(META + BODY.replace('args.what', 'args.whatt'))
  assert.ok(problems.some(p => /the prompt has `undefined` in it/.test(p)), problems.join('\n'))
  const obj = await check(META + BODY.replace('${args.what}', '${args}'))
  assert.ok(obj.some(p => /`\[object Object\]`/.test(p)), obj.join('\n'))
})

test("an agent call's options are the tool's", async () => {
  const problems = await check(META + BODY.replace("label: 'build',", "label: 'build', effort: 'huge', agentType: 'nobody', isolation: 'tmp', retries: 2,"))
  for (const want of [/effort huge/, /agent type nobody/, /isolation tmp/, /unknown option retries/]) {
    assert.ok(problems.some(p => want.test(p)), `${want}: ${problems.join('\n')}`)
  }
  const unlabelled = await check(META + BODY.replace("label: 'build', ", ''))
  assert.ok(unlabelled.some(p => /has no label/.test(p)), unlabelled.join('\n'))
})

test('a schema the tool would refuse is caught', async () => {
  assert.deepEqual(schemaProblems({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }), [])
  assert.match(schemaProblems({ type: 'array', items: {} }).join(), /at its root/)
  assert.match(schemaProblems({ type: 'object', properties: { a: { type: 'string' } }, required: ['b'] }).join(), /requires b/)
  assert.match(schemaProblems({ type: 'object', properties: { a: { type: 'array' } } }).join(), /no items schema/)
  assert.match(schemaProblems({ type: 'object', properties: { a: { type: 'text' } } }).join(), /unknown type text/)
})

test('sample data fits its schema, rich and lean', () => {
  const s = { type: 'object', properties: { a: { type: 'array', items: { type: 'integer' } }, b: { type: ['string', 'null'] }, c: { type: 'string', enum: ['x', 'y'] }, d: { type: 'boolean' }, e: { type: 'string' } }, required: ['a', 'b', 'c', 'd'] }
  assert.deepEqual(sample(s, 'rich'), { a: [1], b: 'x', c: 'x', d: false, e: 'x' })
  assert.deepEqual(sample(s, 'lean'), { a: [], b: null, c: 'y', d: true })
})

test('args passed as a string throw before any agent is spent', async () => {
  const lax = META + `
const r = await agent(\`Build \${String(args).length}.\`, { label: 'build', phase: 'Build' })
return { r }
`
  const problems = await check(lax)
  assert.ok(problems.some(p => /args passed as a string, the run went on/.test(p)), problems.join('\n'))
})

test('a workflow with no sample args is said to need one', async () => {
  const [p] = await checkSource('demo', META + BODY, undefined)
  assert.match(p, /no sample args for demo/)
})
