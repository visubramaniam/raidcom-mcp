// Validates a structured request against the catalogue and renders it as a raidcom command line.
//
// A request is a command name ("add lun"), an object of options ({"-port": ["CL1-A-0"], "-ldev_id": 200}) and a
// few global settings (instance, serial number). Validation is layered so the model gets precise, fixable
// messages instead of a rejected command with no explanation:
//   errors    the command would be refused by raidcom, or cannot be written safely; nothing is built
//   warnings  the command is built, but something looks wrong (an option from a different syntax form, an
//             unusual value)
//   notes     what to do around the command (asynchronous completion, resource locking)
import { type Catalog, type Command, type ModelLimits, type Node, commandName, distance, isDestructive, isReadOnly } from "./catalog.js";

export type OptionValue = string | number | boolean | Array<string | number> | null | undefined;

export interface GlobalOptions {
  /** CCI instance number: -I<n>, or -IH<n> / -IM<n> / -ITC<n> / -ISI<n> with pair_type. */
  instance?: number;
  /** H or TC for TrueCopy, Universal Replicator and global-active device; M or SI for ShadowImage, Volume Migration and Thin Image. */
  pair_type?: "H" | "M" | "TC" | "SI";
  /** Serial number (-s). VSP 5000 series add a leading 5, VSP G1x00 and VSP F1500 a leading 3. */
  serial?: string | number;
  /** Unit ID of the command device (-u). */
  unit?: number;
  /** Show LDEV numbers in hexadecimal (-fx). */
  fx?: boolean;
  /** Suppress messages (-nomsg). */
  nomsg?: boolean;
  /** Precheck: run the command without changing the array (-checkmode precheck). */
  checkmode?: "precheck";
  /** Write the implementation-check file (-store <file>). */
  store?: string;
}

export interface BuildRequest {
  command: string;
  options?: Record<string, OptionValue>;
  model?: string;
  global?: GlobalOptions;
  /**
   * Default true. With false, "a required option is missing" is reported as a warning instead of an error. The
   * catalogue is parsed from the manual, whose syntax lines are occasionally incomplete; this is the way past a
   * false alarm. Unknown options, wrong value counts and out-of-range values stay errors.
   */
  strict?: boolean;
}

export interface BuildResult {
  ok: boolean;
  /** The command line, quoted for a POSIX shell. Present only when ok. */
  command?: string;
  /** The same command as separate arguments, unquoted. */
  argv?: string[];
  name?: string;
  /** The syntax form the options matched. */
  form?: { title: string; usage: string };
  readOnly?: boolean;
  destructive?: boolean;
  async?: boolean;
  errors: string[];
  warnings: string[];
  notes: string[];
}

// ---------- small helpers ----------

/** Characters allowed in a value written without quotes. `#` is not among them: a word starting with it would make
 *  the shell ignore the rest of the line, so a value containing it is always quoted. */
const PLAIN = /^[A-Za-z0-9_.:\/@+,=%-]+$/;
/** Characters allowed in a value at all: plain ones and spaces (the value is then quoted). */
const SAFE = /^[A-Za-z0-9_.:\/@#+,=% -]+$/;

/** Single-quotes a value when it contains anything but plain characters. */
export function shellQuote(v: string): string {
  return PLAIN.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`;
}

/** Values of one option as strings. `true` is an option without a value; `false`, null and undefined drop it. */
function toValues(v: OptionValue): string[] | undefined {
  if (v === undefined || v === null || v === false) return undefined;
  if (v === true) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}

function expandName(flag: string): string {
  return flag.startsWith("-") ? flag : `-${flag}`;
}

/** Finds the catalogue spelling of an option the caller wrote loosely (ldev_id, -LDEV_ID, ldev-id). */
function resolveFlag(cmd: Command, raw: string): string | undefined {
  const flags = Object.keys(cmd.flags);
  const want = expandName(raw);
  if (flags.includes(want)) return want;
  const norm = (s: string) => s.toLowerCase().replace(/-/g, "_");
  return flags.find((f) => norm(f) === norm(want));
}

function nearest(cmd: Command, raw: string, n = 3): string[] {
  const want = expandName(raw).toLowerCase();
  return Object.keys(cmd.flags)
    .map((f) => ({ f, d: distance(f.toLowerCase(), want) - (f.toLowerCase().includes(want.slice(1)) || want.includes(f.toLowerCase().slice(1)) ? 3 : 0) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.f);
}

// ---------- grammar evaluation ----------

interface Fit {
  missing: string[];
  used: Set<string>;
  /** Options given together that belong to different alternatives. */
  leftovers: Set<string>;
}

const flagsOf = (n: Node, acc: string[] = []): string[] => {
  if (n.t === "flag") acc.push(n.name);
  else if (n.t === "seq") n.items.forEach((x) => flagsOf(x, acc));
  else if (n.t === "alt") n.alts.forEach((x) => flagsOf(x, acc));
  else flagsOf(n.item, acc);
  return acc;
};

const label = (n: Node) => [...new Set(flagsOf(n))].join(" ");

function fit(n: Node, given: Set<string>): Fit {
  switch (n.t) {
    case "flag":
      return given.has(n.name) ? { missing: [], used: new Set([n.name]), leftovers: new Set() } : { missing: [n.name], used: new Set(), leftovers: new Set() };
    case "seq": {
      const out: Fit = { missing: [], used: new Set(), leftovers: new Set() };
      for (const item of n.items) {
        const r = fit(item, given);
        out.missing.push(...r.missing);
        r.used.forEach((x) => out.used.add(x));
        r.leftovers.forEach((x) => out.leftovers.add(x));
      }
      return out;
    }
    case "opt": {
      // Nothing inside an optional group is required, whatever was given: the manual shares options such as
      // -request_id between groups, so insisting on "the rest of the group" would reject valid commands.
      const used = new Set(flagsOf(n.item).filter((f) => given.has(f)));
      return { missing: [], used, leftovers: new Set() };
    }
    case "grp":
      return fit(n.item, given);
    case "alt": {
      const fits = n.alts.map((a) => fit(a, given));
      const started = fits.map((f, i) => ({ f, i })).filter((x) => x.f.used.size > 0);
      if (!started.length) return { missing: [`one of: ${n.alts.map(label).join(" | ")}`], used: new Set(), leftovers: new Set() };
      started.sort((a, b) => a.f.missing.length - b.f.missing.length || b.f.used.size - a.f.used.size || a.i - b.i);
      const best = started[0].f;
      const leftovers = new Set(best.leftovers);
      for (const other of started.slice(1)) other.f.used.forEach((x) => !best.used.has(x) && leftovers.add(x));
      return { missing: best.missing, used: best.used, leftovers };
    }
  }
}

// ---------- value checks ----------

const LDEV_FLAGS = new Set(["-ldev_id", "-tse_ldev_id", "-ese_ldev_id", "-mapping_ldev_id"]);
const num = (s: string) => (/^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? Number(s) : NaN);

function parsePort(v: string, limits: ModelLimits): { ok: boolean; message?: string; normal: string } {
  const m = /^CL([0-9A-Z])-([A-Z])(?:-(\d{1,3}))?$/i.exec(v);
  if (!m) return { ok: false, normal: v, message: `"${v}" is not a port name like CL1-A (or CL1-A-0 with a host group ID)` };
  const col = m[1].toUpperCase();
  const letter = m[2].toUpperCase();
  const normal = `CL${col}-${letter}${m[3] !== undefined ? `-${m[3]}` : ""}`;
  if (!limits.portColumns.includes(col)) return { ok: false, normal, message: `port column ${col} is outside ${limits.label} (columns ${limits.portColumns[0]} to ${limits.portColumns.at(-1)})` };
  if (!limits.portLetters.includes(letter)) return { ok: false, normal, message: `port letter ${letter} is not available on ${limits.label} (valid: ${limits.portLetters.split("").join(", ")})` };
  const lim = limits.portColumnsLimited;
  if (lim && lim.cols.includes(col) && !lim.letters.includes(letter)) return { ok: false, normal, message: `port columns ${lim.cols[0]} to ${lim.cols.at(-1)} only have ports ${lim.letters.split("").join(", ")}` };
  if (m[3] !== undefined && Number(m[3]) > 254) return { ok: false, normal, message: `host group ID ${m[3]} is above 254` };
  return { ok: true, normal };
}

interface Ctx {
  cmd: Command;
  limits: ModelLimits;
  modelGiven: boolean;
  errors: string[];
  warnings: string[];
}

/** Checks (and normalises) the values of one option. Returns the values to write. */
function checkValues(flag: string, values: string[], ctx: Ctx): string[] {
  const { cmd, limits, errors, warnings } = ctx;
  const shape = cmd.flags[flag];
  const range = (what: string, n: number, [lo, hi]: [number, number]) => {
    if (n < lo || n > hi) errors.push(`${flag}: ${what} ${n} is outside ${lo} to ${hi}${ctx.modelGiven ? ` for ${limits.label}` : " (the widest range of any model; pass `model` for a tighter check)"}`);
  };
  if (shape) {
    if (values.length < shape.min) errors.push(`${flag} needs ${shape.min === 1 ? "a value" : `at least ${shape.min} values`}${shape.placeholders?.length ? ` (${shape.placeholders.map((p) => `<${p}>`).join(" ")})` : ""}`);
    if (shape.max !== null && values.length > shape.max) {
      errors.push(`${flag} takes at most ${shape.max} value${shape.max === 1 ? "" : "s"}${shape.placeholders?.length ? ` (${shape.placeholders.map((p) => `<${p}>`).join(" ")})` : ""}; got ${values.length}: ${values.join(" ")}`);
    }
    if (shape.enum) {
      for (const v of values) {
        if (!shape.enum.some((e) => e.toLowerCase() === v.toLowerCase())) errors.push(`${flag} must be ${shape.enum.map((e) => `"${e}"`).join(" or ")}, not "${v}"`);
      }
    }
  }
  const out = [...values];
  const literals = shape?.literals ?? [];
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (!SAFE.test(v)) {
      errors.push(`${flag}: value ${JSON.stringify(v)} contains characters that are not allowed in a raidcom value (letters, digits and _ . : / @ # + , = % - and spaces are)`);
      continue;
    }
    if (literals.some((l) => l.toLowerCase() === v.toLowerCase())) continue;
    // raidcom would read a value such as -IH9 as an option of its own
    if (/^\s*-[A-Za-z]/.test(v)) {
      errors.push(`${flag}: value "${v}" starts with "-", so raidcom would read it as an option. Give each option separately in \`options\`.`);
      continue;
    }
    if (LDEV_FLAGS.has(flag)) {
      const parts = v.split("-");
      // mainframe notation: CU:LDEV in hex, e.g. dd:0f (CU 0xdd, LDEV 0x0f) is LDEV number 0xdd0f
      const cuLdev = (x: string) => (/^[0-9a-f]{1,2}:[0-9a-f]{2}$/i.test(x) ? parseInt(x.replace(":", ""), 16) : Number.NaN);
      const nums = parts.map((x) => (x.includes(":") ? cuLdev(x) : num(x)));
      if (parts.length > 2 || nums.some(Number.isNaN)) errors.push(`${flag}: "${v}" is not a decimal number, 0x hex number, CU:LDEV such as dd:0f, or range such as 100-110`);
      else nums.forEach((n) => range("LDEV ID", n, limits.ldev));
    } else if (flag === "-lun_id") {
      const n = num(v);
      if (Number.isNaN(n)) warnings.push(`-lun_id: "${v}" is not a number`);
      else range("LUN", n, limits.lun);
    } else if (flag === "-pool" || flag === "-pool_id") {
      if (/^\d+$/.test(v)) range("pool ID", Number(v), limits.pool);
    } else if ((flag === "-port" && i === 0) || flag === "-additional_port") {
      const p = parsePort(v, limits);
      if (p.ok) out[i] = p.normal;
      else if (/^CL/i.test(v)) errors.push(`${flag}: ${p.message}`);
      else warnings.push(`${flag}: ${p.message}`);
    } else if (flag === "-parity_grp_id" && !/^\d+-\d+$/.test(v)) {
      warnings.push(`-parity_grp_id: "${v}" is not in the form gno-sgno, for example 1-1`);
    } else if (flag === "-capacity" && !/^\d+(\.\d+)?\s?[A-Za-z]{0,5}$/.test(v)) {
      warnings.push(`-capacity: "${v}" does not look like a size such as 100G, 500M or 2T`);
    }
  }
  return out;
}

// ---------- global options ----------

const PAIR_TYPES = ["H", "M", "TC", "SI"];
/** Largest instance number accepted; HORCM instance numbers are small, this only keeps nonsense out. */
const MAX_INSTANCE = 9999;
/** Longest command name or option name looked up; longer input is refused before any fuzzy matching. */
const MAX_NAME = 64;

export interface GlobalCheck {
  errors: string[];
  warnings: string[];
  /** Written right after the object (`-nomsg`). */
  head: string[];
  /** Written at the end. */
  tail: string[];
  /** The instance option on its own (`-I0`, `-IH1`), or "" when no instance was given; used by scripts. */
  instanceFlag: string;
  /** The instance number, when one was given. */
  instance?: number;
}

/**
 * Validates the global options. Every value that reaches command or script text goes through here, whether the
 * caller is build() or a script, so nothing in `global` is ever written unchecked.
 */
export function checkGlobal(raw: unknown, limits: ModelLimits, modelGiven: boolean): GlobalCheck {
  const out: GlobalCheck = { errors: [], warnings: [], head: [], tail: [], instanceFlag: "" };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    out.errors.push("global must be an object such as {\"instance\": 0}");
    return out;
  }
  const g = raw as Record<string, unknown>;
  const known = ["instance", "pair_type", "serial", "unit", "fx", "nomsg", "checkmode", "store"];
  for (const k of Object.keys(g)) if (!known.includes(k)) out.errors.push(`"${k}" is not a global option. Known: ${known.join(", ")}`);
  if (g.nomsg === true) out.head.push("-nomsg");
  else if (g.nomsg !== undefined && g.nomsg !== false) out.errors.push("nomsg must be true or false");

  if (g.pair_type !== undefined && (typeof g.pair_type !== "string" || !PAIR_TYPES.includes(g.pair_type))) {
    out.errors.push(`pair_type must be one of ${PAIR_TYPES.join(", ")}, not ${JSON.stringify(g.pair_type)}`);
  } else if (g.pair_type !== undefined && g.instance === undefined) out.warnings.push("pair_type needs an instance number; it was ignored");
  if (g.instance !== undefined) {
    if (typeof g.instance !== "number" || !Number.isSafeInteger(g.instance) || g.instance < 0 || g.instance > MAX_INSTANCE) {
      out.errors.push(`instance must be a whole number from 0 to ${MAX_INSTANCE}, not ${JSON.stringify(g.instance)}`);
    } else {
      out.instance = g.instance;
      out.instanceFlag = `-I${(g.pair_type as string | undefined) ?? ""}${g.instance}`;
      out.tail.push(out.instanceFlag);
    }
  }
  if (g.serial !== undefined) {
    const s = typeof g.serial === "number" || typeof g.serial === "string" ? String(g.serial) : "";
    if (!/^\d{4,8}$/.test(s)) out.errors.push(`serial must be digits only, for example 810123 (got ${JSON.stringify(g.serial)})`);
    else {
      const n = Number(s);
      if (n < limits.serial[0] || n > limits.serial[1]) {
        const msg = `serial ${s} is outside ${limits.serial[0]} to ${limits.serial[1]}${modelGiven ? ` for ${limits.label}` : ""}. VSP 5000 series serials start with 5 (500000 to 599999) and VSP G1x00 / VSP F1500 add a leading 3`;
        (modelGiven ? out.errors : out.warnings).push(msg);
      }
      out.tail.push("-s", s);
    }
  }
  if (g.unit !== undefined) {
    if (typeof g.unit !== "number" || !Number.isSafeInteger(g.unit) || g.unit < 0 || g.unit > MAX_INSTANCE) out.errors.push(`unit must be a whole number from 0 to ${MAX_INSTANCE}, not ${JSON.stringify(g.unit)}`);
    else out.tail.push("-u", String(g.unit));
  }
  if (g.fx === true) out.tail.push("-fx");
  else if (g.fx !== undefined && g.fx !== false) out.errors.push("fx must be true or false");
  if (g.checkmode !== undefined) {
    if (g.checkmode !== "precheck") out.errors.push(`checkmode must be "precheck", not ${JSON.stringify(g.checkmode)}`);
    else out.tail.push("-checkmode", "precheck");
  }
  if (g.store !== undefined) {
    if (typeof g.store !== "string" || !PLAIN.test(g.store) || g.store.startsWith("-")) out.errors.push(`store must be a plain file name (letters, digits and _ . : / @ + , = % -, not starting with -), not ${JSON.stringify(g.store)}`);
    else out.tail.push("-store", g.store);
  }
  if (out.errors.length) {
    out.head = [];
    out.tail = [];
    out.instanceFlag = "";
  }
  return out;
}

// ---------- the builder ----------

function formLabel(f: { title: string; usage: string }) {
  return f.title ? `${f.title.replace(/:$/, "")}: ${f.usage}` : f.usage;
}

export function build(catalog: Catalog, req: BuildRequest): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const fail = (): BuildResult => ({ ok: false, errors, warnings, notes });

  if (typeof req.command !== "string" || !req.command.trim()) {
    errors.push("command must be a command name such as \"add lun\"");
    return fail();
  }
  if (req.command.length > MAX_NAME) {
    errors.push(`Unknown raidcom command (the name is longer than ${MAX_NAME} characters). Use raidcom_list_commands to search.`);
    return fail();
  }
  const cmd = catalog.find(req.command);
  if (!cmd) {
    errors.push(`Unknown raidcom command "${req.command}". Closest: ${catalog.suggest(req.command).join(", ")}. Use raidcom_list_commands to search.`);
    return fail();
  }
  const name = commandName(cmd);

  const modelHit = catalog.model(req.model);
  if (req.model && !modelHit) warnings.push(`Unknown model "${req.model}", so model-specific limits were not applied. Known: ${[...catalog.models.keys()].filter((k) => k !== "generic").join(", ")}.`);
  const limits = modelHit?.limits ?? catalog.models.get("generic")!;
  const ctx: Ctx = { cmd, limits, modelGiven: !!modelHit, errors, warnings };

  // options → catalogue spelling → values
  const given = new Map<string, string[]>();
  const options = req.options ?? {};
  if (typeof options !== "object" || Array.isArray(options)) {
    errors.push("options must be an object of option names and values, such as {\"-ldev_id\": 200}");
    return fail();
  }
  for (const [raw, v] of Object.entries(options)) {
    const values = toValues(v);
    if (values === undefined) continue;
    if (raw.length > MAX_NAME) {
      errors.push(`An option name longer than ${MAX_NAME} characters is not an option of raidcom ${name}.`);
      continue;
    }
    const flag = resolveFlag(cmd, raw);
    if (!flag) {
      errors.push(`"${raw}" is not an option of raidcom ${name}. Closest: ${nearest(cmd, raw).join(", ") || "none (this command has no options)"}.`);
      continue;
    }
    let vals = values;
    const shape = cmd.flags[flag];
    // "CL1-A-0 Linux" for an option that takes a port and a host group name is two values written as one
    if (vals.length === 1 && /\s/.test(vals[0]) && shape.max !== 1) vals = vals[0].trim().split(/\s+/);
    if (given.has(flag)) warnings.push(`${flag} was given twice; the last value is used`);
    given.set(flag, vals);
  }

  // which syntax form fits best
  const set = new Set(given.keys());
  let chosen: { form: Command["forms"][number]; fit: Fit } | undefined;
  let bestScore = Infinity;
  for (const form of cmd.forms) {
    const f = fit(form.ast, set);
    const extras = [...set].filter((x) => !f.used.has(x)).length;
    const score = f.missing.length * 10 + extras;
    if (score < bestScore) {
      bestScore = score;
      chosen = { form, fit: f };
    }
  }
  if (chosen) {
    const required: string[] = chosen.fit.missing.map((m) => `raidcom ${name} needs ${m}`);
    if (required.length && cmd.forms.length > 1) required.push(`Syntax forms of raidcom ${name}:\n${cmd.forms.map((f) => `  - ${formLabel(f)}`).join("\n")}`);
    if (req.strict === false) warnings.push(...required);
    else errors.push(...required);
    const extras = [...set].filter((x) => !chosen!.fit.used.has(x));
    for (const x of extras) {
      const elsewhere = cmd.forms.filter((f) => f !== chosen!.form && flagsOf(f.ast).includes(x));
      const inThis = flagsOf(chosen.form.ast).includes(x);
      if (inThis) warnings.push(`${x} is an alternative to another option you gave; raidcom expects one or the other (${chosen.form.usage})`);
      else if (elsewhere.length) warnings.push(`${x} belongs to a different syntax form than the one matched (${chosen.form.usage}); describe the command to see each form`);
      else warnings.push(`${x} is not part of any syntax form of raidcom ${name} but is listed among its options`);
    }
  }

  // values
  const rendered: Array<[string, string[]]> = [];
  for (const [flag, values] of given) rendered.push([flag, checkValues(flag, values, ctx)]);

  // global options
  const gc = checkGlobal(req.global, limits, !!modelHit);
  errors.push(...gc.errors);
  warnings.push(...gc.warnings);
  const head = gc.head;
  const tail = gc.tail;
  const g = (req.global ?? {}) as GlobalOptions;

  if (errors.length) return fail();

  const argv = ["raidcom", cmd.action, cmd.object, ...head];
  for (const [flag, values] of rendered) argv.push(flag, ...values);
  argv.push(...tail);

  const readOnly = isReadOnly(cmd);
  const destructive = isDestructive(cmd);
  if (cmd.async) notes.push("Runs asynchronously: confirm it finished with `raidcom get command_status` before relying on the result (add -request_id auto where the command accepts it).");
  if (destructive) notes.push("This command removes configuration or data. Check the target IDs before running it.");
  if (!readOnly && !g.checkmode) notes.push("Use global.checkmode=precheck to have raidcom check the command without changing the array.");
  if (!readOnly) notes.push("Changing commands should run with the resource group locked (raidcom lock resource) when other users manage the array.");

  return {
    ok: true,
    command: argv.map(shellQuote).join(" "),
    argv,
    name,
    form: chosen ? { title: chosen.form.title, usage: chosen.form.usage } : undefined,
    readOnly,
    destructive,
    async: cmd.async,
    errors,
    warnings,
    notes,
  };
}
