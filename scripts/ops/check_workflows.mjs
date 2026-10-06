#!/usr/bin/env node
// The saved Claude Code workflows (.claude/workflows/*.js) are sound: each one
// parses, declares its meta the way the Workflow tool reads it, and runs to
// its end on stubbed agents (`make dev-check`, its dev-ops part; the
// after-edit hook runs it on a workflow as it is edited).
//
//     node scripts/ops/check_workflows.mjs            every workflow
//     node scripts/ops/check_workflows.mjs FILE ...   these files
//
// A workflow file is not an ES module: it starts with `export const meta =
// {...}` and its body ends with a top-level `return`, so `node --check`
// refuses it, and nothing else would notice a typo until a run spent tokens
// on it. For each file this checks:
//
// - **meta** is a pure literal, as the tool requires: no variable, call,
//   spread or template interpolation (each is named where it is). It has a
//   `name` (the file's name), a `description`, and only the keys the tool
//   reads; every phase the body names is in `meta.phases`, and every phase
//   there is named by the body.
// - **no clock and no dice:** `Date.now()`, `Math.random()` and an argless
//   `new Date()` throw in a workflow (they would break resume), and so does
//   anything of Node's (`require`, `import`, `process`, `fetch`). Found by
//   reading the source, and again at run time by stubs that throw.
// - **a dry run:** the body, wrapped in an async function, runs against
//   stubbed globals for each sample of `args` in SAMPLES, three ways: every
//   agent answers with data its schema allows, its arrays one element long,
//   its booleans false and its nullable fields filled (`rich`); with the
//   least data its schema allows, its arrays empty and its booleans true
//   (`lean`); every agent fails and returns null (`dead`, as a skipped or
//   dead agent does); and `rich` again once per agent call with that one
//   agent dead. `pipeline()` and `parallel()` keep the tool's semantics (no
//   barrier between a pipeline's stages; a throwing stage or thunk gives
//   null; a stage that gives null ends its item, and no later stage runs on
//   it). In `rich`, `lean` and one agent dead no stage may throw, since a
//   stage that throws there has a bug the tool would hide as a null; in
//   every run the run must return a value JSON can carry. Whether a dead
//   agent leaves an item `ready` is a property of each workflow, asserted
//   in scripts/ops/workflows.test.mjs. Every agent call has a label, a
//   prompt with no `undefined`, `NaN` or `[object Object]` in it, only the
//   options the tool takes, a known agent type, and a schema the tool
//   accepts (an object at the root, `required` within `properties`).
// - **a model on every call:** each agent() call passes `model: 'opus'` or
//   `model: 'sonnet'`, chosen by how hard its stage is (the maintainer's rule,
//   AGENTS.md § Tooling). Found by reading the source (every call site, even
//   one no sample reaches), and again at run time (the value). That an
//   operator's override reaches the right stage is asserted in
//   scripts/ops/workflows.test.mjs.
// - **bad args fail fast:** `args` passed as a string (the tool's
//   documented mistake: a JSON-encoded object reaches the script as one
//   string) throws before any agent is spent, and so do missing `args`,
//   unless the workflow takes none (then that run is checked too).
//
// Node's standard library only.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')
export const DIR = join(ROOT, '.claude', 'workflows')

const SESSION = 'https://claude.ai/code/session_00000000000000000000'

// One or more `args` per workflow, as an operator would pass them. A new
// workflow adds its own here, or the check fails.
export const SAMPLES = {
  'ship-issues': [
    {
      items: [
        {
          issue: 300, closes: [300], refs: [177], branch: 'claude/sample', worktree: '/tmp/auracle/.claude/worktrees/sample', port: 8800,
          agentType: 'web-engineer', notes: 'What remains.', decisions: '- one', avoid: 'apps/web/perform.js',
        },
      ],
      session: SESSION,
    },
    {
      items: [
        { issue: 301, branch: 'claude/a', worktree: '/tmp/auracle/.claude/worktrees/a', port: 8801, model: 'sonnet', notes: 'A.' },
        { issue: 302, closes: [302, 303], branch: 'claude/b', worktree: '/tmp/auracle/.claude/worktrees/b', port: 8802, agentType: 'engine-engineer', notes: 'B.' },
      ],
      models: { review: 'sonnet', finalize: 'opus' },
    },
  ],
  'fix-flake': [
    {
      spec: 'patch_facts', test_title: 'a sound opens', run_id: 123456, issue: 304, branch: 'claude/flake-304',
      worktree: '/tmp/auracle/.claude/worktrees/flake-304', port: 8803, session: SESSION,
    },
    {
      spec: 'tests/web/perform_touch.spec.js', test_title: 'a touch plays', run_id: 123457, branch: 'claude/flake', worktree: '/tmp/auracle/.claude/worktrees/flake', port: 8804,
      models: { diagnose: 'sonnet', prove: 'opus' },
    },
  ],
  'triage-backlog': [{ session: SESSION }, { issues: [1, 2, 3], models: { read: 'opus', plan: 'sonnet' } }],
  'review-pr': [
    { pr: 250 },
    { branch: 'claude/sample', worktree: '/tmp/auracle/.claude/worktrees/sample', models: { voice: 'opus', refute: 'sonnet' } },
  ],
  'mutants-burndown': [
    { crate: 'auracle-taste', branch: 'claude/mutants-taste', worktree: '/tmp/auracle/.claude/worktrees/mutants-taste', session: SESSION, issue: 181 },
    { crate: 'auracle-grammar', branch: 'claude/mutants-grammar', worktree: '/tmp/auracle/.claude/worktrees/mutants-grammar', models: { kill: 'sonnet', measure: 'opus' } },
  ],
}

const META_KEYS = new Set(['name', 'description', 'whenToUse', 'phases'])
const PHASE_KEYS = new Set(['title', 'detail', 'model'])
const AGENT_OPTS = new Set(['label', 'phase', 'schema', 'model', 'effort', 'isolation', 'agentType'])
// The models a workflow's agents run on: opus for the hard stages, sonnet for
// the easy ones (the Agent tool's own aliases, which the workflow tool shares).
export const MODELS = new Set(['opus', 'sonnet'])
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'])
// Claude Code's own agent types, beside the repo's (.claude/agents/*.md).
const BUILT_IN_AGENTS = ['general-purpose']

export function agentTypes(root = ROOT) {
  const dir = join(root, '.claude', 'agents')
  const own = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)) : []
  return new Set([...BUILT_IN_AGENTS, ...own])
}

// ─── meta ───────────────────────────────────────────────────────────────────

const PREFIX = /^export const meta = \{/

// The end of the string or template literal that starts at i (its quote).
function skipString(src, i) {
  const q = src[i]
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue }
    if (src[j] === q) return j + 1
  }
  return -1
}

/** The meta literal's text and where it ends, or a problem. */
export function metaText(src) {
  if (!PREFIX.test(src)) return { problem: 'does not begin with `export const meta = {` (the tool reads it there, first)' }
  const start = src.indexOf('{')
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i)
      if (end < 0) return { problem: 'meta has a string that never closes' }
      i = end - 1
    } else if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
    } else if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      if (close < 0) return { problem: 'meta has a comment that never closes' }
      i = close + 1
    } else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return { text: src.slice(start, i + 1), end: i + 1 }
  }
  return { problem: "meta's braces never close" }
}

/** What makes the literal impure: [] when it is a plain literal. */
export function impurities(text) {
  const out = []
  let prev = ''
  for (let i = 0; i < text.length;) {
    const c = text[i]
    const rest = text.slice(i)
    if (/\s/.test(c)) { i++; continue }
    if (rest.startsWith('//')) { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; continue }
    if (rest.startsWith('/*')) { i = text.indexOf('*/', i) + 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(text, i)
      const lit = text.slice(i, end)
      if (c === '`' && lit.includes('${')) out.push(`template interpolation in ${lit.slice(0, 40)}`)
      i = end; prev = 'value'; continue
    }
    if (rest.startsWith('...')) { out.push('a spread (`...`)'); i += 3; continue }
    const num = /^-?(\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|\.\d+)/.exec(rest)
    if (num && (c !== '-' || prev !== 'value')) { i += num[0].length; prev = 'value'; continue }
    const id = /^[A-Za-z_$][\w$]*/.exec(rest)
    if (id) {
      const word = id[0]
      i += word.length
      const after = text.slice(i).trimStart()
      if (['true', 'false', 'null'].includes(word)) { prev = 'value'; continue }
      if (after.startsWith(':') && (prev === '{' || prev === ',')) { prev = 'key'; continue }
      out.push(after.startsWith('(') ? `a call: \`${word}(\`` : `an identifier: \`${word}\``)
      prev = 'value'; continue
    }
    if ('{[,:'.includes(c)) { prev = c; i++; continue }
    if ('}]'.includes(c)) { prev = 'value'; i++; continue }
    out.push(c === '(' || c === ')' ? 'a call or a group: `(`' : `an operator: \`${c}\``)
    i++
  }
  return out
}

export function checkMeta(meta, name) {
  const out = []
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ['meta is not an object']
  for (const k of Object.keys(meta)) if (!META_KEYS.has(k)) out.push(`meta has a key the tool does not read: ${k}`)
  if (meta.name !== name) out.push(`meta.name is ${JSON.stringify(meta.name)}; the file's name is ${name}`)
  if (typeof meta.description !== 'string' || !meta.description.trim()) out.push('meta.description is missing')
  if (meta.whenToUse !== undefined && typeof meta.whenToUse !== 'string') out.push('meta.whenToUse is not a string')
  if (meta.phases !== undefined) {
    if (!Array.isArray(meta.phases)) out.push('meta.phases is not a list')
    else for (const p of meta.phases) {
      if (!p || typeof p.title !== 'string' || !p.title) out.push('a phase in meta.phases has no title')
      else for (const k of Object.keys(p)) if (!PHASE_KEYS.has(k)) out.push(`phase ${p.title} has a key the tool does not read: ${k}`)
    }
  }
  return out
}

// ─── the source ─────────────────────────────────────────────────────────────

const FORBIDDEN = [
  [/\bDate\.now\s*\(/, 'Date.now() (throws in a workflow: pass a time in args)'],
  [/\bMath\.random\s*\(/, 'Math.random() (throws in a workflow: vary the prompt by index)'],
  [/\bnew\s+Date\s*\(\s*\)/, 'new Date() with no argument (throws in a workflow)'],
  [/\brequire\s*\(/, 'require() (a workflow has no Node APIs)'],
  [/\bimport\s*\(|^\s*import\s/m, 'import (a workflow has no modules)'],
  [/\bprocess\.\w/, 'process (a workflow has no Node APIs)'],
  [/\bfetch\s*\(/, 'fetch() (a workflow has no network)'],
]

// Lines that are comments, so a comment may name a phase it no longer uses.
function code(src) {
  return src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
}

/** The source as code only: comments dropped, each string, template text and
 * regular expression literal emptied (a template's `${…}` is code, and kept),
 * so a prompt may say "docs/process.md" or "never Date.now()". What is dropped
 * becomes spaces (its newlines stay), so every character of code is at its
 * place in the source, and a line number there is the file's. */
export function codeOnly(src) {
  const blank = text => text.replace(/[^\n]/g, ' ')
  let out = ''
  let i = 0
  const braces = [] // one entry per open `{`: true when it opened a template's `${`
  let last = '' // the last significant character of code, to tell a regex from a division
  const regexCanStart = () => last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /\b(return|typeof|case|of|in|await|yield)$/.test(out)
  function template() { // from just after a backtick, or after a template's `}`
    const from = i
    for (; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue }
      if (src[i] === '`') { out += blank(src.slice(from, i)) + '`'; i++; last = '`'; return }
      if (src[i] === '$' && src[i + 1] === '{') { out += blank(src.slice(from, i)) + '${'; i += 2; braces.push(true); last = '{'; return }
    }
    out += blank(src.slice(from))
  }
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (c === '/' && n === '/') { const a = i; while (i < src.length && src[i] !== '\n') i++; out += blank(src.slice(a, i)); continue }
    if (c === '/' && n === '*') { const a = i, e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += blank(src.slice(a, i)); continue }
    if (c === '"' || c === "'") { const a = i, e = skipString(src, i); i = e < 0 ? src.length : e; out += c + blank(src.slice(a + 1, Math.max(a + 1, i - 1))) + (e < 0 ? '' : c); last = c; continue }
    if (c === '`') { i++; out += '`'; template(); continue }
    if (c === '/' && regexCanStart()) {
      const a = i
      let j = i + 1, cls = false
      for (; j < src.length && src[j] !== '\n'; j++) {
        if (src[j] === '\\') { j++; continue }
        if (src[j] === '[') cls = true
        else if (src[j] === ']') cls = false
        else if (src[j] === '/' && !cls) break
      }
      i = j + 1
      while (/[a-z]/.test(src[i] || '')) i++
      out += blank(src.slice(a, i)); last = '/'; continue
    }
    if (c === '{') braces.push(false)
    if (c === '}' && braces.length && braces.pop()) { out += '}'; i++; template(); continue }
    out += c
    if (!/\s/.test(c)) last = c
    i++
  }
  return out
}

/** The pieces of `text` between its top-level commas, as [from, to) offsets.
 * Depth rises on `(`, `[` and `{` (a template's `${` too) and falls on their
 * closers, so a comma inside a nested call, list or object is not a split. */
function splitTop(text, from = 0, to = text.length) {
  const parts = []
  let depth = 0
  let start = from
  for (let i = from; i < to; i++) {
    const c = text[i]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === ',' && depth === 0) { parts.push([start, i]); start = i + 1 }
  }
  if (text.slice(start, to).trim()) parts.push([start, to])
  return parts
}

/** The keys of the options object (the call's second argument) that the call
 * names itself: `{ label: …, model }` gives label and model; what is nested
 * (a schema's own `model` property) is not the call's. `text` is the code and
 * `src` the source it was made from, character for character, which still
 * holds a quoted key's name. { problem } when the options cannot be read:
 * absent, or not an object literal. */
function optionKeys(text, src, open, close) {
  const args = splitTop(text, open + 1, close)
  if (args.length < 2) return { problem: 'passes no options (label, phase, model, schema)' }
  const [from, to] = args[1]
  const at = from + (/^\s*/.exec(text.slice(from, to))[0].length)
  if (text[at] !== '{') return { problem: 'has options that are not an object literal, so its model cannot be read' }
  const keys = []
  for (const [a, b] of splitTop(text, at + 1, text.lastIndexOf('}', to))) {
    const entry = text.slice(a, b)
    const k = a + (/^\s*/.exec(entry)[0].length)
    if (text[k] === '"' || text[k] === "'") keys.push(src.slice(k + 1, text.indexOf(text[k], k + 1)))
    else {
      const id = /^[A-Za-z_$][\w$]*/.exec(text.slice(k, b))
      if (id) keys.push(id[0]) // `key: value`, the shorthand `key`, or a method `key()`
    }
  }
  return { keys }
}

/** Each agent() call in the source's code, as { line, call, keys, problem }:
 * the line it starts on, its text from `agent(` to the matching `)` (strings
 * and comments blanked), and the keys of its options object (optionKeys). A
 * call named in a prompt or a comment is not one. */
export function agentCalls(src) {
  const text = codeOnly(src)
  const out = []
  for (const m of text.matchAll(/(?<![\w$.])agent\s*\(/g)) {
    let depth = 0
    const open = m.index + m[0].length - 1
    let i = open
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')' && --depth === 0) break
    }
    out.push({ line: text.slice(0, m.index).split('\n').length, call: text.slice(m.index, i + 1), ...optionKeys(text, src, open, i) })
  }
  return out
}

export function forbidden(body) {
  const text = codeOnly(body)
  return FORBIDDEN.filter(([re]) => re.test(text)).map(([, what]) => `calls ${what}`)
}

/** The phase titles the body names as literals: phase('X') and phase: 'X'. */
export function namedPhases(body) {
  const out = new Set()
  for (const re of [/\bphase\(\s*(['"])((?:(?!\1).)+)\1\s*\)/g, /\bphase:\s*(['"])((?:(?!\1).)+)\1/g]) {
    for (const m of code(body).matchAll(re)) out.add(m[2])
  }
  return out
}

// ─── schemas ────────────────────────────────────────────────────────────────

export function schemaProblems(s, where = 'schema', root = true) {
  const out = []
  if (!s || typeof s !== 'object') return [`${where} is not an object`]
  if (root && (s.type !== 'object' || !s.properties)) out.push(`${where} must be {type: 'object', properties} at its root`)
  const types = Array.isArray(s.type) ? s.type : s.type === undefined ? [] : [s.type]
  for (const t of types) if (!TYPES.has(t)) out.push(`${where} has an unknown type ${t}`)
  if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) out.push(`${where}.enum is empty`)
  if (types.includes('object') || s.properties) {
    const props = s.properties || {}
    for (const r of s.required || []) if (!(r in props)) out.push(`${where} requires ${r}, which is not in its properties`)
    for (const [k, v] of Object.entries(props)) out.push(...schemaProblems(v, `${where}.${k}`, false))
  }
  if (types.includes('array')) {
    if (!s.items) out.push(`${where} is an array with no items schema`)
    else out.push(...schemaProblems(s.items, `${where}[]`, false))
  }
  return out
}

/** Data `schema` allows: `rich` fills everything, `lean` the least it can. */
export function sample(schema, mode) {
  const rich = mode === 'rich'
  if (!schema || typeof schema !== 'object') return rich ? 'x' : ''
  if (Array.isArray(schema.enum)) return rich ? schema.enum[0] : schema.enum[schema.enum.length - 1]
  if ('const' in schema) return schema.const
  let t = schema.type
  if (Array.isArray(t)) t = !rich && t.includes('null') ? 'null' : t.find(x => x !== 'null') || 'null'
  if (t === undefined) t = schema.properties ? 'object' : schema.items ? 'array' : 'string'
  switch (t) {
    case 'object': {
      const props = schema.properties || {}
      const keys = rich ? Object.keys(props) : schema.required || []
      return Object.fromEntries(keys.map(k => [k, sample(props[k], mode)]))
    }
    case 'array': return rich ? [sample(schema.items, mode)] : []
    case 'integer': case 'number': return rich ? 1 : 0
    case 'boolean': return !rich
    case 'null': return null
    default: return rich ? 'x' : ''
  }
}

// ─── the dry run ────────────────────────────────────────────────────────────

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const GLOBALS = ['agent', 'pipeline', 'parallel', 'phase', 'log', 'args', 'budget', 'workflow']
// Shadowed so that using one fails here as it would in the tool.
const SHADOWED = ['Date', 'Math', 'process', 'require', 'fetch', 'Buffer', 'globalThis', 'module', 'exports']

function fakeDate() {
  const Real = Date
  function D(...a) {
    if (!new.target) throw new Error('Date() throws in a workflow')
    if (!a.length) throw new Error('new Date() with no argument throws in a workflow')
    return new Real(...a)
  }
  D.now = () => { throw new Error('Date.now() throws in a workflow') }
  D.parse = Real.parse
  D.UTC = Real.UTC
  return D
}

function fakeMath() {
  const M = Object.create(Math)
  M.random = () => { throw new Error('Math.random() throws in a workflow') }
  return M
}

export function compile(body) {
  return new AsyncFunction(...GLOBALS, ...SHADOWED, body)
}

/** A workflow file's body, compiled for dryRun (its meta declared as `meta`). */
export function compileWorkflow(src) {
  const m = metaText(src)
  if (m.problem) throw new Error(m.problem)
  const rest = src.slice(m.end).replace(/^;/, '')
  return compile(`const meta = ${m.text};\n${rest}`)
}

/** One run of the body. Resolves to what it recorded; never rejects.
 * `kill`: the index of the one agent call that dies (returns null), the rest
 * answering as `mode` says. `answer(opts, prompt, index)`: answers in place
 * of `mode`'s (a test's scripted agents). */
export async function dryRun(fn, args, mode, known = agentTypes(), { kill = -1, answer = null } = {}) {
  const rec = { calls: 0, labels: [], models: [], phases: new Set(), problems: [], stageErrors: [], result: undefined, error: null }
  const say = p => { if (!rec.problems.includes(p)) rec.problems.push(p) }
  async function agent(prompt, opts = {}) {
    const index = rec.calls++
    const label = opts && typeof opts.label === 'string' ? opts.label : '(no label)'
    rec.labels.push(label)
    rec.models.push(opts ? opts.model : undefined)
    if (typeof prompt !== 'string' || !prompt.trim()) say(`agent ${label}: the prompt is not a string, or is empty`)
    else for (const bad of ['undefined', 'NaN', '[object Object]']) {
      if (new RegExp(`(^|[^\\w])${bad.replace(/[[\]]/g, '\\$&')}([^\\w]|$)`).test(prompt)) say(`agent ${label}: the prompt has \`${bad}\` in it (an interpolation of something missing)`)
    }
    if (!opts || typeof opts !== 'object') say(`agent ${label}: opts is not an object`)
    else {
      for (const k of Object.keys(opts)) if (!AGENT_OPTS.has(k)) say(`agent ${label}: unknown option ${k}`)
      if (typeof opts.label !== 'string' || !opts.label) say('an agent call has no label (wf_result.py reads a running workflow by its labels)')
      if (opts.phase !== undefined) rec.phases.add(opts.phase)
      if (opts.effort !== undefined && !EFFORTS.has(opts.effort)) say(`agent ${label}: effort ${opts.effort} is not one of ${[...EFFORTS].join(', ')}`)
      if (opts.isolation !== undefined && opts.isolation !== 'worktree') say(`agent ${label}: isolation ${opts.isolation} is not 'worktree'`)
      if (opts.agentType !== undefined && !known.has(opts.agentType)) say(`agent ${label}: agent type ${opts.agentType} is not one of ${[...known].join(', ')}`)
      if (opts.model === undefined) say(`agent ${label}: no model (pass 'opus' or 'sonnet', by how hard the stage is)`)
      else if (!MODELS.has(opts.model)) say(`agent ${label}: model ${JSON.stringify(opts.model)} is not one of ${[...MODELS].join(', ')}`)
      if (opts.schema !== undefined) for (const p of schemaProblems(opts.schema)) say(`agent ${label}: ${p}`)
    }
    if (mode === 'dead' || index === kill) return null
    if (answer) return answer(opts, prompt, index)
    return opts && opts.schema ? sample(opts.schema, mode) : mode === 'rich' ? 'x' : ''
  }
  // As the tool's: a stage that returns null (or throws, which gives null)
  // ends its item, and no later stage runs on it.
  async function pipeline(items, ...stages) {
    if (!Array.isArray(items)) throw new TypeError('pipeline(): items is not an array')
    if (!stages.every(s => typeof s === 'function')) throw new TypeError('pipeline(): a stage is not a function')
    return Promise.all(items.map(async (item, i) => {
      let prev = item
      for (const stage of stages) {
        if (prev === null) break
        try { prev = await stage(prev, item, i) } catch (e) { rec.stageErrors.push(e); return null }
      }
      return prev
    }))
  }
  async function parallel(thunks) {
    if (!Array.isArray(thunks)) throw new TypeError('parallel(): not a list of thunks')
    return Promise.all(thunks.map(async t => {
      try {
        if (typeof t !== 'function') throw new TypeError('parallel(): an element is not a function')
        return await t()
      } catch (e) { rec.stageErrors.push(e); return null }
    }))
  }
  const phase = t => { if (typeof t !== 'string' || !t) say('phase() was called without a title'); rec.phases.add(t) }
  const log = m => { if (typeof m !== 'string') say('log() was called with something not a string') }
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const workflow = () => { throw new Error('workflow(): a nested workflow is not dry-run here') }
  try {
    rec.result = await fn(agent, pipeline, parallel, phase, log, args, budget, workflow,
      fakeDate(), fakeMath(), undefined, undefined, undefined, undefined, undefined, undefined, undefined)
  } catch (e) {
    rec.error = e
  }
  return rec
}

const describe = e => (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e))

/** Every problem with one workflow's source. */
export async function checkSource(name, src, samples = SAMPLES[name], known = agentTypes()) {
  const out = []
  const m = metaText(src)
  if (m.problem) return [m.problem]
  const impure = impurities(m.text)
  if (impure.length) return impure.map(p => `meta is not a pure literal: ${p}`)
  let meta
  try { meta = new Function(`"use strict"; return (${m.text})`)() } catch (e) { return [`meta does not evaluate: ${e.message}`] }
  out.push(...checkMeta(meta, name))
  const declared = new Set((Array.isArray(meta.phases) ? meta.phases : []).map(p => p && p.title))
  let rest = src.slice(m.end)
  if (rest.startsWith(';')) rest = rest.slice(1)
  const body = `const meta = ${m.text};\n${rest}`
  out.push(...forbidden(rest))
  for (const c of agentCalls(src)) {
    if (c.problem) out.push(`line ${c.line}: this agent() call ${c.problem}`)
    else if (!c.keys.includes('model')) out.push(`line ${c.line}: this agent() call passes no \`model\` ('opus' or 'sonnet', by how hard the stage is)`)
  }
  const named = namedPhases(rest)
  for (const t of named) if (!declared.has(t)) out.push(`phase ${JSON.stringify(t)} is used but not in meta.phases`)
  for (const t of declared) if (!named.has(t)) out.push(`meta.phases has ${JSON.stringify(t)}, which the body never names`)
  let fn
  try { fn = compile(body) } catch (e) { return [...out, `does not parse: ${e.message}`] }
  if (!samples || !samples.length) return [...out, `no sample args for ${name} in scripts/ops/check_workflows.mjs (SAMPLES)`]
  // Args passed as a string must throw before any agent is spent. No args at
  // all may be a call the workflow takes (every field optional): then it
  // runs as cleanly as a sample does; else it throws as early.
  const asString = await dryRun(fn, JSON.stringify(samples[0]), 'lean', known)
  if (!asString.error) out.push(`with args passed as a string, the run went on (${asString.calls} agent call(s)) instead of throwing at once`)
  else if (asString.calls) out.push(`with args passed as a string, ${asString.calls} agent call(s) were made before it threw`)
  const none = await dryRun(fn, undefined, 'lean', known)
  if (none.error && none.calls) out.push(`with no args, ${none.calls} agent call(s) were made before it threw`)
  if (!none.error) {
    out.push(...none.problems.map(p => `no args: ${p}`))
    for (const e of none.stageErrors) out.push(`no args: a stage threw: ${describe(e)}`)
  }
  for (const [i, args] of samples.entries()) {
    let rich = null
    for (const mode of ['rich', 'lean', 'dead']) {
      const r = await dryRun(fn, structuredClone(args), mode, known)
      if (mode === 'rich') rich = r
      const where = `sample ${i + 1}, ${mode}`
      out.push(...r.problems.map(p => `${where}: ${p}`))
      if (r.error) out.push(`${where}: the run threw: ${describe(r.error)}`)
      else if (r.result === undefined) out.push(`${where}: the run returned nothing (end the script with a return)`)
      else {
        try { JSON.stringify(r.result) } catch (e) { out.push(`${where}: what the run returned is not JSON: ${e.message}`) }
      }
      if (mode !== 'dead') for (const e of r.stageErrors) out.push(`${where}: a stage threw: ${describe(e)}`)
      for (const t of r.phases) if (t && !declared.has(t)) out.push(`${where}: phase ${JSON.stringify(t)} ran but is not in meta.phases`)
      if (mode === 'rich' && !r.calls && !r.error) out.push(`${where}: no agent was called`)
    }
    // One agent dead at a time, the rest answering richly: an agent skipped,
    // or dead on an API error, mid-run. No stage may throw on its null, and
    // the run still returns.
    for (let k = 0; rich && !rich.error && k < rich.calls; k++) {
      const r = await dryRun(fn, structuredClone(args), 'rich', known, { kill: k })
      const where = `sample ${i + 1}, rich with agent ${JSON.stringify(rich.labels[k])} dead`
      if (r.error) out.push(`${where}: the run threw: ${describe(r.error)}`)
      else if (r.result === undefined) out.push(`${where}: the run returned nothing`)
      for (const e of r.stageErrors) out.push(`${where}: a stage threw: ${describe(e)}`)
    }
  }
  return [...new Set(out)]
}

export async function main(argv) {
  const files = argv.length
    ? argv.map(f => resolve(f))
    : existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.js')).sort().map(f => join(DIR, f)) : []
  let failed = 0
  const names = new Set()
  for (const f of files) {
    const name = basename(f, '.js')
    names.add(name)
    const problems = await checkSource(name, readFileSync(f, 'utf8'))
    if (problems.length) {
      failed++
      console.log(`  ${name}: ${problems.length} problem(s)`)
      for (const p of problems) console.log(`    ${p}`)
    }
  }
  if (!argv.length) for (const n of Object.keys(SAMPLES)) {
    if (!names.has(n)) { failed++; console.log(`  SAMPLES names ${n}, which is not in .claude/workflows/`) }
  }
  console.log(`  workflows: ${files.length} checked, ${failed} with problems`)
  return failed ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
