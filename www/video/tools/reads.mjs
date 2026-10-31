// What a film.js reads, found in its text and never by running it. An
// illustrated film draws on a DOM that Node lacks, so validate.mjs cannot run
// it; but a film that cuts to takes of the app (launch) puts a pointer where
// a take measured a control, and a pointer drawn at a mark the take never
// measured falls back to the kit's estimate without a word (ADR-012: an
// estimate drawn as if measured). This reads those marks out of the source.
//
//   import { readsOf, scan } from "./reads.mjs";
//   const r = readsOf(src);   // { takes, marks }, or null if film.js reads no takes
//
// The convention a film.js follows for this to see its reads:
//
//   - a scene reads its take at the top of a block, by a string literal:
//     `const take = takes["l-play"];` (the shot's id in shots.json);
//   - a mark is read from it by a literal name: `ck.mark("bright")`,
//     `take.meta.rects.blend` or `take.meta.rects?.["blend"]`, or through a
//     local function that hands its first argument on to one of those
//     (`const rail = (lv) => ck?.mark(lv);` then `rail("patch")`).
//
// The marks read inside a block that reads a take are that take's (the shots
// that block reads); any other literal read is checked against every shot's.
// A name built at run time (`rects?.[name]` with a variable) cannot be seen.
// That is the check's limit: it finds what the source says, and nothing it
// has to guess.

const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof"]);
const AFTER_WHICH_A_SLASH_DIVIDES = new Set([")", "]", "}", "`", '"', "'"]);

/** `src` twice, each the same length with newlines kept: `plain`, with its
 *  comments blanked to spaces, and `code`, with its strings' insides, its
 *  template literals' text and its regular expressions blanked as well (their
 *  quotes and delimiters stay), so that structure (braces, calls, names) is
 *  read from `code` and a literal's text from `plain`, at the same index.
 *  `ok` is false when the text did not end where it began (a quote or a
 *  brace left open): a reader should not trust a scan that lost its place. */
export function scan(src) {
  const n = src.length;
  const plain = src.split("");
  const code = src.split("");
  const blank = (arr, from, to) => {
    for (let k = from; k < to; k++) if (arr[k] !== "\n") arr[k] = " ";
  };
  const modes = ["code"];
  const depths = [0];
  let ok = true;
  let last = "";
  let word = "";
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (modes[modes.length - 1] === "tpl") {
      if (c === "\\") {
        blank(code, i, Math.min(i + 2, n));
        i += 2;
      } else if (c === "`") {
        modes.pop();
        depths.pop();
        last = "`";
        i++;
      } else if (c === "$" && src[i + 1] === "{") {
        code[i] = " ";
        modes.push("code");
        depths.push(0);
        last = "{";
        i += 2;
      } else {
        if (c !== "\n") code[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      blank(plain, i, j);
      blank(code, i, j);
      i = j;
    } else if (c === "/" && src[i + 1] === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      blank(plain, i, j);
      blank(code, i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      if (src[j] !== c) ok = false;
      blank(code, i + 1, Math.min(j, n));
      last = c;
      word = "";
      i = Math.min(j + 1, n);
    } else if (c === "`") {
      modes.push("tpl");
      depths.push(0);
      last = "`";
      word = "";
      i++;
    } else if (c === "/" && (KEYWORDS_BEFORE_REGEX.has(word) || !(AFTER_WHICH_A_SLASH_DIVIDES.has(last) || /[\w$]/.test(last)))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n" && (src[j] !== "/" || inClass)) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j++;
      }
      if (src[j] !== "/") ok = false;
      blank(code, i + 1, Math.min(j, n));
      last = "/";
      word = "";
      i = Math.min(j + 1, n);
    } else {
      if (c === "{") depths[depths.length - 1]++;
      if (c === "}") {
        if (depths[depths.length - 1] === 0 && modes.length > 1) {
          modes.pop();
          depths.pop();
          last = "}";
          i++;
          continue;
        }
        depths[depths.length - 1]--;
      }
      if (/[\w$]/.test(c)) word = /[\w$]/.test(src[i - 1] || "") ? word + c : c;
      else if (!/\s/.test(c)) word = "";
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  if (modes.length !== 1 || depths[0] !== 0) ok = false;
  return { plain: plain.join(""), code: code.join(""), ok };
}

/** The matching `{ }` pairs of `code`, as [open, close] indices. */
function blocks(code) {
  const pairs = [];
  const open = [];
  for (let k = 0; k < code.length; k++) {
    if (code[k] === "{") open.push(k);
    else if (code[k] === "}" && open.length) pairs.push([open.pop(), k]);
  }
  return pairs;
}

/** The text of a string literal that opens at `at` in `plain`, when it is a
 *  plain name: no escape, no interpolation, on one line. */
function literalAt(plain, at) {
  const q = plain[at];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  const end = plain.indexOf(q, at + 1);
  if (end < 0) return null;
  const text = plain.slice(at + 1, end);
  return text && !/[\\\n$]/.test(text) ? text : null;
}

/** Where the expression or block that a function starts at `from` (just after
 *  its `=>`) ends in `code`: a `{ }` body to its brace, anything else to the
 *  `;` or `,` at its own level, or the bracket that closes the line. */
function bodyEnd(code, from, pairs) {
  let k = from;
  while (/\s/.test(code[k] || "")) k++;
  if (code[k] === "{") {
    const p = pairs.find(([o]) => o === k);
    return p ? p[1] : code.length;
  }
  let depth = 0;
  for (; k < code.length; k++) {
    const c = code[k];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) return k;
      depth--;
    } else if ((c === ";" || c === ",") && depth === 0) return k;
  }
  return code.length;
}

const line = (src, at) => src.slice(0, at).split("\n").length;

/** The takes film.js reads and the marks it reads from them:
 *    { takes: [{ id, line }], marks: [{ name, line, takes: [id…] }] }
 *  A mark's `takes` are the shots its block reads (empty: not in such a
 *  block). null when film.js reads no take by literal. Throws when the text
 *  cannot be scanned (a quote or a brace the scan could not match). */
export function readsOf(src) {
  if (!/\btakes\b/.test(src)) return null;
  const { plain, code, ok } = scan(src);
  if (!ok) throw new Error("film.js's text could not be scanned for the marks it reads from its takes (a quote, a regular expression or a brace the reader could not match)");
  const pairs = blocks(code);
  const innermost = (at) => {
    let best = null;
    for (const p of pairs) if (p[0] < at && at < p[1] && (!best || p[0] > best[0])) best = p;
    return best;
  };

  const takes = [];
  const takeRe = /\btakes\s*(?:\?\.)?\s*\[\s*(["'`])/g;
  for (let m; (m = takeRe.exec(code)); ) {
    const id = literalAt(plain, m.index + m[0].length - 1);
    if (id) takes.push({ id, line: line(src, m.index), at: m.index, scope: innermost(m.index) });
  }
  if (!takes.length) return null;

  // The marks read, by literal name, wherever they are in the file.
  const found = [];
  const add = (name, at) => name && found.push({ name, at });
  const markRe = /\.\s*mark\s*\(\s*(["'`])/g;
  for (let m; (m = markRe.exec(code)); ) add(literalAt(plain, m.index + m[0].length - 1), m.index);
  const dotRe = /\brects\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g;
  for (let m; (m = dotRe.exec(code)); ) add(m[1], m.index);
  const indexRe = /\brects\s*(?:\?\.)?\s*\[\s*(["'`])/g;
  for (let m; (m = indexRe.exec(code)); ) add(literalAt(plain, m.index + m[0].length - 1), m.index);

  // A local function that hands its first argument to one of those reads:
  // `const rail = (lv) => ck?.mark(lv);`, `function rc(name, fb) { … rects?.[name] … }`.
  const helpers = [];
  const arrowRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(\s*([A-Za-z_$][\w$]*)\b[^)]*\)|([A-Za-z_$][\w$]*))\s*=>/g;
  for (let m; (m = arrowRe.exec(code)); ) helpers.push({ name: m[1], param: m[2] || m[3], from: m.index + m[0].length });
  const funcRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\b[^)]*\)\s*(?=\{)/g;
  for (let m; (m = funcRe.exec(code)); ) helpers.push({ name: m[1], param: m[2], from: m.index + m[0].length });
  for (const h of helpers) {
    const p = h.param.replace(/\$/g, "\\$");
    const body = code.slice(h.from, bodyEnd(code, h.from, pairs));
    if (!new RegExp(`\\.\\s*mark\\s*\\(\\s*${p}\\s*[,)]|\\brects\\s*(?:\\?\\.)?\\s*\\[\\s*${p}\\s*\\]`).test(body)) continue;
    const n = h.name.replace(/\$/g, "\\$");
    const callRe = new RegExp(`(?<![\\w$.])${n}\\s*\\(\\s*(["'\`])`, "g");
    for (let m; (m = callRe.exec(code)); ) add(literalAt(plain, m.index + m[0].length - 1), m.index);
  }

  // Each read belongs to the innermost block that reads takes around it.
  const scopes = new Map();
  for (const t of takes) {
    const key = t.scope ? t.scope.join(":") : "file";
    if (!scopes.has(key)) scopes.set(key, { scope: t.scope, ids: [] });
    if (!scopes.get(key).ids.includes(t.id)) scopes.get(key).ids.push(t.id);
  }
  const marks = [];
  const seen = new Set();
  for (const f of found.sort((a, b) => a.at - b.at)) {
    let owner = null;
    for (const s of scopes.values()) {
      const inside = !s.scope || (s.scope[0] < f.at && f.at < s.scope[1]);
      if (inside && (!owner || (s.scope && (!owner.scope || s.scope[0] > owner.scope[0])))) owner = s;
    }
    const ids = owner ? owner.ids : [];
    const key = `${f.name}\0${ids.join(",")}\0${line(src, f.at)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    marks.push({ name: f.name, line: line(src, f.at), takes: ids });
  }
  return { takes: takes.map(({ id, line }) => ({ id, line })), marks };
}
