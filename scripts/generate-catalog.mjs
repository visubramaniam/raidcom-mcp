#!/usr/bin/env node
// Builds spec/raidcom-catalog.json from the text of the Hitachi "Command Control Interface Command Reference"
// (MK-90RD7009). The PDF itself is not part of this repository: convert your copy with
//
//   pdftotext -layout CCI_Command_Reference.pdf cci-reference.txt
//   node scripts/generate-catalog.mjs cci-reference.txt
//
// For every `raidcom <action> <object>` section the script keeps the command name, supported storage systems,
// a one-sentence summary, every syntax form (parsed into a small grammar tree), each option's value shape and a
// short description, and the command lines of the examples. It deliberately does not copy the manual's prose,
// output samples or tables. `tests/unit/catalog.test.mjs` replays every example through the validator, so a
// parsing mistake shows up as a failing test.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/generate-catalog.mjs <cci-reference.txt> [--out spec/raidcom-catalog.json]");
  process.exit(1);
}
const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? process.argv[outIdx + 1] : join(root, "spec", "raidcom-catalog.json");

const lines = readFileSync(input, "utf8").replace(/\f/g, "\n").split("\n");

// ---------- 1. split into command sections ----------

const HEADING = /^raidcom ([a-z_]+) ([a-z_]+)\s*$/;
const FURNITURE_CHAPTER = /^\s*(Chapter \d+:|Appendix [A-Z]:).*$/;
const FURNITURE_CCI = /^\s*Command Control Interface Command Reference\s+\d+\s*$/;

/** Removes page headers and footers, including the running title that follows a footer. */
function stripFurniture(sectionLines) {
  const kept = [];
  for (let i = 0; i < sectionLines.length; i++) {
    const l = sectionLines[i];
    if (FURNITURE_CHAPTER.test(l)) continue;
    if (FURNITURE_CCI.test(l)) {
      // the running title (indented command name) is the next non-blank line
      let j = i + 1;
      while (j < sectionLines.length && sectionLines[j].trim() === "") j++;
      if (j < sectionLines.length && /^\s+raidcom [a-z_ ]+$/.test(sectionLines[j]) && !/^\s*#/.test(sectionLines[j])) i = j;
      continue;
    }
    kept.push(l);
  }
  return kept;
}

const heads = [];
lines.forEach((l, i) => {
  const m = HEADING.exec(l);
  if (m) heads.push({ i, action: m[1], object: m[2] });
});
if (!heads.length) {
  console.error("No `raidcom <action> <object>` headings found. Is this the pdftotext -layout text of the Command Reference?");
  process.exit(1);
}
// The Appendices start after the last command.
let endOfBody = lines.length;
lines.forEach((l, i) => {
  if (i > heads[heads.length - 1].i && /^Appendix A:/.test(l)) endOfBody = Math.min(endOfBody, i);
});

// A command name that opens a syntax block is at the left margin too, so it looks like a second heading for the
// same command; its lines belong to the section before it.
const sections = [];
heads.forEach((h, n) => {
  const body = lines.slice(h.i + 1, n + 1 < heads.length ? heads[n + 1].i : endOfBody);
  const prev = sections[sections.length - 1];
  if (prev && prev.action === h.action && prev.object === h.object) prev.raw.push(`raidcom ${h.action} ${h.object}`, ...body);
  else sections.push({ ...h, raw: body });
});
for (const sec of sections) sec.lines = stripFurniture(sec.raw);

// ---------- 2. tokenizer and grammar for syntax lines ----------

const GLOBAL_FLAGS = new Set(["-I", "-s", "-u", "-fx", "-nomsg", "-checkmode", "-store", "-login", "-logout", "-resource", "-zt", "-load", "-h"]);

/** Joins a syntax block into one line and repairs wrapping damage ("-\nrequest_id"). */
function normalize(text) {
  return text
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/(^|[\s\[{|])-\s+(?=[a-z_])/g, "$1-")
    .replace(/([a-z0-9]) (_[a-z])/g, "$1$2") // "-hba_iscsi _name" wrapped inside a word
    .replace(/<\s+/g, "<")
    .replace(/\s+>/g, ">")
    .trim();
}

function tokenize(s) {
  const tokens = [];
  const re = /<[^>]*>|\.\.\.|-[A-Za-z][A-Za-z0-9_]*|[\[\]{}|]|[^\s\[\]{}|<]+/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[0];
    if (t.startsWith("<")) {
      const v = t.slice(1, -1).trim();
      // <y/n> names the two allowed words
      if (/^[a-z]+(\/[a-z]+)+$/.test(v) && v.length <= 12) tokens.push({ k: "{" }, ...v.split("/").flatMap((w, i) => (i ? [{ k: "|" }] : []).concat([{ k: "word", v: w }])), { k: "}" });
      else tokens.push({ k: "ph", v });
    }
    else if (t === "...") tokens.push({ k: "rep" });
    else if (/^-[A-Za-z]/.test(t)) tokens.push({ k: "flag", v: t });
    else if ("[]{}|".includes(t)) tokens.push({ k: t });
    else tokens.push({ k: "word", v: t });
  }
  return tokens;
}

/** Index of the bracket that closes the one opened at tokens[i]. */
function closer(tokens, i) {
  const open = tokens[i].k;
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    if (tokens[j].k === open) depth++;
    else if (tokens[j].k === close && --depth === 0) return j;
  }
  return tokens.length - 1;
}

const hasFlag = (tokens, a, b) => tokens.slice(a, b).some((t) => t.k === "flag");

/** The values that follow a flag: placeholders, literals, optional groups and choices. Returns [values, nextIndex]. */
function readValues(tokens, i) {
  const values = [];
  let j = i;
  while (j < tokens.length) {
    const t = tokens[j];
    if (t.k === "ph") {
      values.push({ k: "ph", v: t.v });
      j++;
    } else if (t.k === "word") {
      values.push({ k: "lit", v: t.v });
      j++;
    } else if (t.k === "rep") {
      if (values.length) values[values.length - 1].rep = true;
      j++;
    } else if (t.k === "[" || t.k === "{") {
      const end = closer(tokens, j);
      if (hasFlag(tokens, j + 1, end)) break; // a flag group, not a value group
      const inner = tokens.slice(j + 1, end);
      const alts = [[]];
      for (const x of inner) (x.k === "|" ? alts.push([]) : alts[alts.length - 1].push(x));
      const opt = t.k === "[";
      const choices = alts.map((a) => a.filter((x) => x.k === "ph" || x.k === "word").map((x) => (x.k === "ph" ? { k: "ph", v: x.v } : { k: "lit", v: x.v })));
      const rep = tokens[end + 1]?.k === "rep";
      if (rep) end;
      let flat = choices.flat();
      // `[Security value]`: several plain words in one group describe one value
      if (alts.length === 1 && flat.length > 1 && flat.every((x) => x.k === "lit" && /^[A-Z]/.test(x.v))) flat = [{ k: "ph", v: flat.map((x) => x.v).join(" ") }];
      if (alts.length > 1) values.push({ k: "choice", alts: flat, ...(opt ? { opt: true } : {}), ...(rep ? { rep: true } : {}) });
      else for (const v of flat) values.push({ ...v, ...(opt ? { opt: true } : {}), ...(rep ? { rep: true } : {}) });
      j = end + 1 + (rep ? 1 : 0);
    } else break;
  }
  return [values, j];
}

/** Recursive-descent parse of a syntax line into {t: flag|seq|alt|opt|grp}. */
function parseSyntax(tokens) {
  let pos = 0;
  function seq(stop) {
    const alts = [];
    let items = [];
    while (pos < tokens.length && !stop(tokens[pos])) {
      const t = tokens[pos];
      if (t.k === "|") {
        alts.push(items);
        items = [];
        pos++;
      } else if (t.k === "flag") {
        pos++;
        const [values, next] = readValues(tokens, pos);
        pos = next;
        items.push({ t: "flag", name: t.v, values });
      } else if (t.k === "[" || t.k === "{") {
        const open = t.k;
        pos++;
        const inner = seq((x) => x.k === "]" || x.k === "}");
        pos++; // closer
        // `{-limit_io | -limit_kb | -limit_mb} <value>`: one value list shared by every option in the group
        const bare = flagsIn(inner).filter((f) => f.values.length === 0);
        if (bare.length && bare.length === flagsIn(inner).length && (tokens[pos]?.k === "ph" || tokens[pos]?.k === "word")) {
          const [shared, next] = readValues(tokens, pos);
          pos = next;
          for (const f of bare) f.values = shared.map((v) => ({ ...v }));
        }
        if (tokens[pos]?.k === "rep") pos++;
        items.push({ t: open === "[" ? "opt" : "grp", item: inner });
      } else pos++; // stray word, placeholder or closer without opener
    }
    const node = (xs) => ({ t: "seq", items: xs });
    if (!alts.length) return node(items);
    alts.push(items);
    return { t: "alt", alts: alts.map(node) };
  }
  return seq(() => false);
}

/** Drops nodes that hold only global flags, empty groups and single-child wrappers. */
function simplify(n) {
  if (n.t === "flag") return GLOBAL_FLAGS.has(n.name) ? null : n;
  if (n.t === "seq") {
    const items = n.items.map(simplify).filter(Boolean);
    return items.length === 0 ? null : items.length === 1 ? items[0] : { t: "seq", items };
  }
  if (n.t === "alt") {
    const alts = n.alts.map(simplify);
    // an empty alternative (e.g. a trailing `|`) is dropped; a lone alternative collapses
    const real = alts.filter(Boolean);
    if (real.length === 0) return null;
    const node = real.length === 1 ? real[0] : { t: "alt", alts: real };
    // `{-a | reset}`: an alternative that is only a word means "nothing more is needed", so the group is optional
    return real.length < alts.length ? { t: "opt", item: node } : node;
  }
  const item = simplify(n.item);
  return item ? { t: n.t, item } : null;
}

function flagsIn(n, acc = []) {
  if (!n) return acc;
  if (n.t === "flag") acc.push(n);
  else if (n.t === "seq") n.items.forEach((x) => flagsIn(x, acc));
  else if (n.t === "alt") n.alts.forEach((x) => flagsIn(x, acc));
  else flagsIn(n.item, acc);
  return acc;
}

// ---------- 3. section parsing ----------

const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => l.trim() === "";

function firstSentence(text, max) {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  let s = m ? m[1] : flat;
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return s;
}

function parseSection(sec) {
  const L = sec.lines;
  const idx = (re, from = 0) => {
    for (let i = from; i < L.length; i++) if (re.test(L[i])) return i;
    return -1;
  };
  const syntaxAt = idx(/^\s*Syntax\b/);
  const optionsAt = idx(/^\s*Options and parameters/, Math.max(syntaxAt, 0));
  const exampleAt = idx(/^\s*Examples?\b/, Math.max(optionsAt, syntaxAt, 0));

  // supported systems and description (before Syntax)
  const head = L.slice(0, syntaxAt < 0 ? L.length : syntaxAt);
  const supported = [];
  const desc = [];
  const bullets = [];
  let inSupported = false;
  let inNote = false;
  for (const l of head) {
    const t = l.trim();
    if (/^Supported storage systems:/i.test(t)) { inSupported = true; continue; }
    if (inSupported) {
      if (t.startsWith("■")) { supported.push(t.replace(/^■\s*/, "")); continue; }
      if (t === "") continue;
      inSupported = false;
    }
    if (/^(Note|Notes|Caution|Warning|Important)\b/i.test(t)) inNote = true;
    if (t === "") { inNote = false; if (desc.length && desc[desc.length - 1] !== "\n") desc.push("\n"); continue; }
    if (!inNote && !/^■/.test(t)) desc.push(t);
    else if (!inNote && /^■/.test(t)) bullets.push(t.replace(/^■\s*/, ""));
  }
  const descText = desc.join(" ").replace(/\s*\n\s*/g, "\n").trim();
  const paragraphs = descText.split("\n").map((p) => p.trim()).filter(Boolean);
  let summary = firstSentence(paragraphs[0] ?? "", 220);
  if (summary.endsWith(":") && bullets.length) summary = firstSentence(`${summary} ${bullets.slice(0, 3).join("; ")}`, 220);
  const async = /executed asynchronously|runs? asynchronously/i.test(head.join(" "));

  // syntax forms
  const forms = [];
  if (syntaxAt >= 0) {
    const end = optionsAt >= 0 ? optionsAt : exampleAt >= 0 ? exampleAt : L.length;
    const paras = [];
    let cur = [];
    for (const l of L.slice(syntaxAt + 1, end)) {
      if (isBlank(l)) { if (cur.length) paras.push(cur); cur = []; } else cur.push(l.trim());
    }
    if (cur.length) paras.push(cur);
    let title = normalize(L[syntaxAt].replace(/^\s*Syntax\s*(for|when)?\s*/i, ""));
    let block = null;
    const flush = () => {
      if (block) forms.push({ title, text: normalize(block.join(" ")) });
      block = null;
    };
    for (const p of paras) {
      const first = p[0].replace(/^#\s*/, "");
      if (/^raidcom\b/.test(first)) {
        flush();
        block = [first, ...p.slice(1)];
      } else if (/^Supported storage systems/i.test(first)) {
        flush(); // a note about which models have this form, not a title
        title = "";
      } else if (/^[A-Z]/.test(first) && block === null) {
        title = normalize(p.join(" "));
      } else if (/^[A-Z]/.test(first) && block !== null) {
        flush();
        title = normalize(p.join(" "));
      } else if (block) block.push(...p); // continuation after a page break
    }
    flush();
  }
  const parsed = forms.map((f) => {
    const body = f.text.replace(/^raidcom\s+[a-z_]+\s+[a-z_]+\s*/, "");
    const ast = simplify(parseSyntax(tokenize(body))) ?? { t: "seq", items: [] };
    return { title: f.title, usage: f.text, ast };
  });

  // options
  const options = {};
  if (optionsAt >= 0) {
    const end = exampleAt >= 0 ? exampleAt : L.length;
    const body = L.slice(optionsAt + 1, end);
    const firstLine = body.find((l) => !isBlank(l));
    const base = firstLine ? indentOf(firstLine) : 0;
    let entry = null;
    const entries = [];
    const balanced = (s) => {
      const c = (a, b) => (s.match(new RegExp(`\\${a}`, "g")) || []).length - (s.match(new RegExp(`\\${b}`, "g")) || []).length;
      return c("[", "]") <= 0 && c("{", "}") <= 0 && c("<", ">") <= 0;
    };
    for (const l of body) {
      if (isBlank(l)) { if (entry) entry.gap = true; continue; }
      const t = l.trim();
      const isHeader = indentOf(l) <= base + 1 && /^\[?\s*-[A-Za-z]/.test(t);
      if (entry && !entry.closed && !balanced(entry.header.join(" "))) { entry.header.push(t); continue; }
      if (isHeader) {
        entry = { header: [t], desc: [], closed: false };
        entries.push(entry);
      } else if (entry) entry.desc.push(t);
    }
    for (const e of entries) {
      const usage = normalize(e.header.join(" "));
      const text = e.desc.join(" ");
      const hints = [...e.desc.join("\n").matchAll(/^■\s+([A-Za-z0-9_]+)(?:\s+-[a-z_]+\s+<[^>]+>)?\s*:/gm)].map((m) => m[1]);
      const ast = simplify(parseSyntax(tokenize(usage.replace(/^\[\s*/, "[").replace(/\s*\]$/, "]"))));
      for (const f of flagsIn(ast)) {
        if (!options[f.name] || usage.length < options[f.name].usage.length) {
          options[f.name] = { usage, summary: firstSentence(text, 170), rawText: text, ...(hints.length ? { hints: [...new Set(hints)] } : {}) };
        }
      }
    }
  }

  // examples: command lines only, with the sentence that introduces each
  const examples = [];
  if (exampleAt >= 0) {
    const body = L.slice(exampleAt);
    let intro = [];
    for (let i = 0; i < body.length; i++) {
      const raw = body[i];
      const t = raw.trim();
      const m = /^#?\s*(raidcom\s+(?:add|delete|get|modify|set|reset|initialize|extend|check|check_ext_storage|discover|disconnect|replace|monitor|reallocate|rename|lock|unlock|map|unmap|send)\b.*)$/.exec(t);
      if (m && !/^(Example|Examples)\b/i.test(t)) {
        let cmd = m[1].replace(/[–—]/g, "-");
        // A wrapped command continues on the next line when this one ends in a broken option ("-"), in an option
        // still waiting for its value, or when the next line starts with an option.
        while (i + 1 < body.length) {
          const lastTok = cmd.split(/\s+/).at(-1);
          // a page break leaves blank lines inside a wrapped command
          let k = i + 1;
          while (k < body.length && body[k].trim() === "" && k - i <= 6 && (lastTok.startsWith("-") || cmd.endsWith("-"))) k++;
          const nx = (body[k] ?? "").trim().replace(/[–—]/g, "-");
          if (!nx || /^#?\s*raidcom\b/.test(nx)) break;
          i = k - 1;
          const last = lastTok;
          const oneWord = /^\S+$/.test(nx);
          if (cmd.endsWith("-")) { cmd = (cmd.endsWith(" -") ? cmd : cmd) + nx; i++; }
          else if (/^-[A-Za-z]/.test(nx) || /^[\]}>]/.test(nx) || (last.startsWith("-") && oneWord)) { cmd += " " + nx; i++; }
          else if (last.startsWith("-") && /^[A-Za-z0-9_.:,\/"-]+(\s+[A-Za-z0-9_.:,\/"-]+)*$/.test(nx) && nx.split(/\s+/).length <= 4 && !/^[A-Z]{2,}\b/.test(nx)) { cmd += " " + nx; i++; }
          else break;
        }
        cmd = cmd.replace(/\s*\|\s*(rmawk|awk|grep|sed|sort|head|wc|more|tee)\b.*$/, "").replace(/\s*[>]\s*\S+\s*$/, "").trim();
        // prose that happens to start with "raidcom": the word after the object must be an option
        cmd = cmd.replace(/\s+(Enter\s+\S.*|REQID\s*:.*)$/, "").trim(); // prompts and output that follow a command
        if (/[<>]/.test(cmd) || (cmd.match(/"/g) || []).length % 2) continue; // a template or a command cut off by a page break
        const third = cmd.split(/\s+/)[3];
        if (!/^raidcom\s+[a-z_]+\s+[a-z_]+$/.test(cmd.split(/\s+-/)[0].trim()) || (third && !third.startsWith("-") && !/^[A-Za-z0-9_.:#\/-]+$/.test(third))) continue;
        examples.push({ text: intro.join(" ").trim().slice(0, 240), command: cmd });
        intro = [];
      } else if (t === "") {
        // keep intro across blank lines
      } else if (/^(Example\s*\d*:?|Examples:?)$/i.test(t)) {
        intro = [];
      } else if (/^[A-Z]/.test(t) && !/^\S+\s+\S+\s+\S+\s+\S+/.test(t.slice(0, 3)) && t.length > 20) {
        intro = [t];
      }
    }
  }
  return { summary, supported, async, forms: parsed, options, examples };
}

// ---------- 4. flag shapes (arity, literal values) merged over every form and the options table ----------

function valueShape(values) {
  const min = values.filter((v) => !v.opt).length;
  const rep = values.some((v) => v.rep);
  const max = rep ? null : values.length;
  return { min, max, values };
}

function flagTable(forms, options) {
  const table = {};
  const note = (f) => {
    const s = valueShape(f.values);
    const prev = table[f.name];
    const lits = f.values.flatMap((v) => (v.k === "lit" ? [v.v] : v.k === "choice" ? v.alts.filter((a) => a.k === "lit").map((a) => a.v) : []));
    const phs = f.values.flatMap((v) => (v.k === "ph" ? [v.v] : v.k === "choice" ? v.alts.filter((a) => a.k === "ph").map((a) => a.v) : []));
    const pure = f.values.length > 0 && f.values.every((v) => v.k === "lit" || (v.k === "choice" && v.alts.every((a) => a.k === "lit")));
    if (!prev) table[f.name] = { min: s.min, max: s.max, literals: new Set(lits), placeholders: new Set(phs), pureOnly: pure };
    else {
      prev.min = Math.min(prev.min, s.min);
      prev.max = prev.max === null || s.max === null ? null : Math.max(prev.max, s.max);
      lits.forEach((x) => prev.literals.add(x));
      phs.forEach((x) => prev.placeholders.add(x));
      prev.pureOnly = prev.pureOnly && pure;
    }
  };
  for (const f of forms) flagsIn(f.ast).forEach(note);
  for (const o of Object.values(options)) {
    const ast = simplify(parseSyntax(tokenize(o.usage.replace(/^\[\s*/, "[").replace(/\s*\]$/, "]"))));
    flagsIn(ast).forEach(note);
  }
  const res = {};
  for (const [name, t] of Object.entries(table)) {
    res[name] = {
      min: t.min,
      max: t.max,
      ...(t.placeholders.size ? { placeholders: [...t.placeholders] } : {}),
      ...(t.literals.size ? { literals: [...t.literals] } : {}),
      ...(t.pureOnly && t.literals.size ? { enum: [...t.literals] } : {}),
    };
  }
  return res;
}

// ---------- 5. assemble ----------

const commands = {};
for (const sec of sections) {
  const name = `${sec.action} ${sec.object}`;
  if (commands[name]) continue; // first occurrence wins
  const p = parseSection(sec);
  const flags = flagTable(p.forms, p.options);
  for (const [f, o] of Object.entries(p.options)) if (flags[f]) o.usage = o.usage;
  commands[name] = {
    action: sec.action,
    object: sec.object,
    summary: p.summary,
    supported: p.supported,
    async: p.async,
    forms: p.forms,
    flags,
    options: p.options,
    examples: p.examples,
  };
}

// An example may sit in another command's section; file it under the command it actually runs, and drop the
// ones that name no catalogued command (typos in the manual).
for (const [name, c] of Object.entries(commands)) {
  const keep = [];
  for (const ex of c.examples) {
    const [, a, o] = /^raidcom\s+(\S+)\s+(\S+)/.exec(ex.command) ?? [];
    const key = `${a} ${o}`;
    if (!commands[key]) continue;
    if (key === name) keep.push(ex);
    else if (!commands[key].examples.some((x) => x.command === ex.command) && !commands[key].moved?.some((x) => x.command === ex.command)) (commands[key].moved ??= []).push(ex);
  }
  c.examples = keep;
}
for (const c of Object.values(commands)) {
  for (const ex of c.moved ?? []) if (!c.examples.some((x) => x.command === ex.command)) c.examples.push(ex);
  delete c.moved;
}

// Options that are only described in the text of another option (`-ldev_list dp_volume -pool_id <pool id>`).
for (const c of Object.values(commands)) {
  for (const o of Object.values(c.options)) {
    for (const m of (o.rawText ?? "").matchAll(/(-[a-z]+_[a-z_]+)\s+<([^>]+)>/g)) {
      if (!c.flags[m[1]]) c.flags[m[1]] = { min: 1, max: 1, placeholders: [m[2].trim()], derived: true };
    }
  }
}
for (const c of Object.values(commands)) for (const o of Object.values(c.options)) delete o.rawText;

// Value shapes the manual shows in examples but not in the syntax line.
const OVERRIDES = {
  "initialize ldev": { "-operation": { max: 3 } },
  // The syntax line reads `{y | n} [Security value]`; the words after y/n are a second value, not alternatives.
  "modify ldev": { "-command_device": { enum: undefined } },
};
for (const [name, flagsPatch] of Object.entries(OVERRIDES)) {
  if (!commands[name]) continue;
  for (const [flag, patch] of Object.entries(flagsPatch)) if (commands[name].flags[flag]) Object.assign(commands[name].flags[flag], patch);
}

// Options that real systems accept but the manual's syntax line for the command leaves out. Each is added to the
// first form as an optional flag, and its source is recorded so the catalogue says where it came from.
const ADDITIONS = {
  "add parity_grp": [{ flag: "-emulation", placeholder: "emulation type", summary: "Emulation type for a mainframe parity group, e.g. 3390-V (not in the manual's syntax line; used on mainframe-capable systems)." }],
};
for (const [name, adds] of Object.entries(ADDITIONS)) {
  const c = commands[name];
  if (!c) continue;
  for (const a of adds) {
    if (c.flags[a.flag]) continue;
    c.flags[a.flag] = { min: 1, max: 1, placeholders: [a.placeholder] };
    c.options[a.flag] = { usage: `${a.flag} <${a.placeholder}>`, summary: a.summary, hints: [] };
    const ast = c.forms[0].ast;
    if (ast.t === "seq") ast.items.push({ t: "opt", item: { t: "flag", name: a.flag, values: [{ k: "ph", v: a.placeholder }] } });
    c.forms[0].usage += ` [${a.flag} <${a.placeholder}>]`;
  }
}

const catalog = {
  source: "Hitachi Command Control Interface Command Reference (MK-90RD7009), generated by scripts/generate-catalog.mjs",
  generated: new Date().toISOString().slice(0, 10),
  commands,
};
writeFileSync(out, JSON.stringify(catalog) + "\n");
const n = Object.keys(commands).length;
const forms = Object.values(commands).reduce((a, c) => a + c.forms.length, 0);
const exs = Object.values(commands).reduce((a, c) => a + c.examples.length, 0);
const noForms = Object.entries(commands).filter(([, c]) => !c.forms.length).map(([k]) => k);
console.log(`${n} commands, ${forms} syntax forms, ${exs} examples written to ${out}`);
if (noForms.length) console.log(`No syntax form found for: ${noForms.join(", ")}`);
