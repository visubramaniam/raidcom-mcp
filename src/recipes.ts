// Scripts and recipes. A step names a command and its options; `foreach` and `zip` repeat it over lists, so
// "create LDEVs 100 to 109" is one step, not ten tool calls. Every expanded command goes through the same builder
// as raidcom_build_command, so a script is only produced when every command in it is valid.
import { type Catalog } from "./catalog.js";
import { build, checkGlobal, type BuildResult, type GlobalOptions, type OptionValue } from "./builder.js";

type Scalar = string | number;

export interface Step {
  title?: string;
  command: string;
  options?: Record<string, OptionValue>;
  /** Cartesian repeat: loop variable → list of values, a range such as "100-109", or (in recipes) a parameter name. */
  foreach?: Record<string, Scalar[] | string>;
  /** Parallel repeat: loop variable → list; all lists must have the same length. */
  zip?: Record<string, Scalar[] | string>;
  /** Recipes only: run the step when this parameter (or all of these parameters) was given. Giving only some of
   *  several is an error, so a value is never silently ignored. */
  when?: string | string[];
}

export interface ParamSpec {
  type: "string" | "array";
  required?: boolean;
  /** Array of numbers: "100-103" and "100,101" expand to single values. */
  range?: boolean;
  description: string;
}

export interface Recipe {
  title: string;
  summary: string;
  keywords: string[];
  params: Record<string, ParamSpec>;
  steps: Step[];
  notes: string[];
  /** Environment variables the script exports before the first command, e.g. HORCC_DRIVEOPERATION=1. */
  env?: Record<string, string>;
}

export interface BuiltCommand {
  step: number;
  title?: string;
  command: string;
  readOnly: boolean;
  destructive: boolean;
  async: boolean;
}

export interface ScriptRequest {
  steps: Step[];
  model?: string;
  global?: GlobalOptions;
  strict?: boolean;
  /** Add `raidcom -login` (user and password come from RAIDCOM_USER and RAIDCOM_PASSWORD in the shell) and `-logout`. */
  login?: boolean;
  /** Wrap the commands in `raidcom lock resource` and `raidcom unlock resource`. */
  lock_resource?: boolean;
  /** A heading comment for the script. */
  description?: string;
  /** Environment variables to export at the top of the script. */
  env?: Record<string, string>;
}

export interface ScriptResult {
  ok: boolean;
  script?: string;
  commands: BuiltCommand[];
  errors: string[];
  warnings: string[];
  notes: string[];
}

/** Most commands one request may expand to. */
export const MAX_COMMANDS = 500;

// ---------- value expansion ----------

/** "100-103" → 100..103, "1,2,5" → 1,2,5, "dd:00-dd:0f" → dd:00..dd:0f, a mix of these; other text is kept as is.
 *  Stops with an error past `max` values, so no input can make it run long or use much memory. */
export function expandList(input: Scalar | Scalar[], max = MAX_COMMANDS): Scalar[] {
  const out: Scalar[] = [];
  const push = (v: Scalar) => {
    if (out.length >= max) throw new Error(`the list has more than ${max} values`);
    out.push(v);
  };
  for (const item of Array.isArray(input) ? input : [input]) {
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${item} is not a usable value`);
      push(item);
      continue;
    }
    if (typeof item !== "string") throw new Error(`list values must be strings or numbers, not ${item === null ? "null" : typeof item}`);
    for (const part of item.split(/[,\s]+/).filter(Boolean)) {
      // CU:LDEV ranges such as dd:00-dd:0f, as used for mainframe volumes: expanded in the same format
      const h = /^([0-9a-f]{2}):([0-9a-f]{2})-([0-9a-f]{2}):([0-9a-f]{2})$/i.exec(part);
      // decimal ranges; 15 digits keeps both ends exact as JavaScript numbers
      const m = /^(\d{1,15})-(\d{1,15})$/.exec(part);
      if (h || m) {
        const a = h ? parseInt(h[1] + h[2], 16) : Number(m![1]);
        const b = h ? parseInt(h[3] + h[4], 16) : Number(m![2]);
        if (b < a) throw new Error(`range "${part}" runs backwards`);
        if (b - a + 1 > max - out.length) throw new Error(`range "${part}" has more than ${max} values`);
        const lower = part === part.toLowerCase();
        for (let n = a; n <= b; n++) {
          if (!h) push(n);
          else {
            const x = n.toString(16).padStart(4, "0");
            push(`${x.slice(0, 2)}:${x.slice(2)}`[lower ? "toLowerCase" : "toUpperCase"]());
          }
        }
      } else push(/^\d{1,15}$/.test(part) ? Number(part) : part);
    }
  }
  return out;
}

const refs = (s: string) => [...s.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);

type Scope = Record<string, Scalar | Scalar[] | undefined>;

/** A scope value by name. Only the scope's own entries count, so "{constructor}" or "{__proto__}" find nothing. */
const lookup = (scope: Scope, name: string) => (Object.hasOwn(scope, name) ? scope[name] : undefined);
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Substitutes {name} in a template. Undefined when it names something that has no value. */
function fill(template: string, scope: Scope): Scalar | Scalar[] | undefined {
  const whole = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(template);
  if (whole) {
    const v = lookup(scope, whole[1]);
    return v === undefined || (Array.isArray(v) && v.length === 0) || v === "" ? undefined : v;
  }
  let missing = false;
  const text = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = lookup(scope, name);
    if (v === undefined || Array.isArray(v) || v === "") {
      missing = true;
      return "";
    }
    return String(v);
  });
  return missing ? undefined : text;
}

/** One concrete option set from a step's templates. An option whose template has no value is left out. */
function fillOptions(options: Record<string, OptionValue> | undefined, scope: Scope): Record<string, OptionValue> {
  // no prototype, so an option named "__proto__" is an ordinary (and then unknown) option
  const out: Record<string, OptionValue> = Object.create(null);
  for (const [flag, raw] of Object.entries(options ?? {})) {
    if (typeof raw === "boolean") {
      out[flag] = raw;
      continue;
    }
    const templates = Array.isArray(raw) ? raw : [raw];
    const values: Scalar[] = [];
    for (const t of templates) {
      if (t === null || t === undefined) continue;
      if (typeof t === "number") values.push(t);
      else {
        // a template that names a parameter nobody gave contributes nothing, so optional trailing values drop out
        const v = fill(t, scope);
        if (v === undefined) continue;
        if (Array.isArray(v)) values.push(...v);
        else values.push(v);
      }
    }
    if (values.length) out[flag] = values;
  }
  return out;
}

/** Checks that a step's option values are what a template can be: text, numbers, switches, or lists of these. */
function checkOptions(options: unknown): void {
  if (options === undefined || options === null) return;
  if (typeof options !== "object" || Array.isArray(options)) throw new Error("options must be an object of option names and values");
  for (const [flag, v] of Object.entries(options)) {
    const ok = (x: unknown) => x === null || typeof x === "string" || typeof x === "number";
    if (!(ok(v) || typeof v === "boolean" || (Array.isArray(v) && v.every(ok)))) throw new Error(`option ${flag}: a value must be text, a number, true/false or a list of text and numbers`);
  }
}

function loopValues(name: string, spec: unknown, params: Scope, max: number): Scalar[] {
  if (!VAR_NAME.test(name)) throw new Error(`"${name}" is not a usable variable name (letters, digits and _)`);
  let values: Scalar[];
  if (typeof spec === "string" && Object.hasOwn(params, spec)) {
    const p = params[spec];
    values = p === undefined ? [] : Array.isArray(p) ? p : [p];
    if (values.length > max) throw new Error(`${name} has more than ${max} values`);
  } else if (typeof spec === "string" || typeof spec === "number" || Array.isArray(spec)) values = expandList(spec as Scalar | Scalar[], max);
  else throw new Error(`${name} must be a list or a range such as "100-109"`);
  if (!values.length) throw new Error(`${name} has no values`);
  return values;
}

/** Every variable binding a step runs with, at most `max` of them. */
function bindings(step: Step, params: Scope, max: number): Array<Record<string, Scalar>> {
  let combos: Array<Record<string, Scalar>> = [{}];
  for (const [what, spec] of [["zip", step.zip], ["foreach", step.foreach]] as const) {
    if (spec !== undefined && (spec === null || typeof spec !== "object" || Array.isArray(spec))) throw new Error(`${what} must be an object of variable names and lists`);
    if (spec && !Object.keys(spec).length) throw new Error(`${what} is empty; leave it out or give at least one variable`);
  }
  if (step.zip) {
    const lists = Object.entries(step.zip).map(([k, v]) => [k, loopValues(k, v, params, max)] as const);
    const n = lists[0][1].length;
    for (const [k, l] of lists) if (l.length !== n) throw new Error(`zip lists must have the same length (${lists[0][0]} has ${n}, ${k} has ${l.length})`);
    combos = Array.from({ length: n }, (_, i) => Object.fromEntries(lists.map(([k, l]) => [k, l[i]])));
  }
  for (const [k, v] of Object.entries(step.foreach ?? {})) {
    const values = loopValues(k, v, params, max);
    if (combos.length * values.length > max) throw new Error(`the step would produce more than ${max} commands`);
    combos = combos.flatMap((c) => values.map((x) => ({ ...c, [k]: x })));
  }
  return combos;
}

// ---------- scripts ----------

export function buildScript(catalog: Catalog, req: ScriptRequest, params: Scope = {}): ScriptResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const commands: BuiltCommand[] = [];
  const lines: string[] = [];
  let total = 0;
  let pendingAsync = false;
  // The global options are written into lines of their own (HORCMINST, lock, login), so they are checked here, once,
  // before anything is written, and not only when a command is built.
  const modelHit = catalog.model(req.model);
  const gc = checkGlobal(req.global, modelHit?.limits ?? catalog.models.get("generic")!, !!modelHit);
  if (gc.errors.length) return { ok: false, commands: [], errors: gc.errors.map((e) => `global: ${e}`), warnings: [], notes: [] };
  const inst = gc.instanceFlag ? ` ${gc.instanceFlag}` : "";
  if (!Array.isArray(req.steps) || !req.steps.length) return { ok: false, commands: [], errors: ["steps must be a non-empty list"], warnings: [], notes: [] };

  const flushAsync = () => {
    if (!pendingAsync) return;
    lines.push(`run raidcom get command_status${inst}`);
    pendingAsync = false;
  };

  req.steps.forEach((step, si) => {
    const title = step && typeof step === "object" && typeof step.title === "string" ? step.title : undefined;
    const label = `step ${si + 1}${title ? ` (${title})` : ""}`;
    let combos: Array<Record<string, Scalar>>;
    try {
      if (!step || typeof step !== "object" || typeof step.command !== "string") throw new Error("a step needs a command name, such as {\"command\": \"add ldev\", \"options\": {...}}");
      checkOptions(step.options);
      combos = bindings(step, params, MAX_COMMANDS - total);
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      return;
    }
    total += combos.length;
    if (total > MAX_COMMANDS) {
      errors.push(`${label}: the script would have more than ${MAX_COMMANDS} commands`);
      return;
    }
    // a step that starts with a command that is not asynchronous first waits for the pending asynchronous ones
    if (catalog.find(step.command) && !catalog.find(step.command)!.async) flushAsync();
    if (title) lines.push("", `# ${title.replace(/[\r\n]+/g, " ")}`);
    for (const combo of combos) {
      const scope: Scope = { ...params, ...combo };
      const options = fillOptions(step.options, scope);
      const r: BuildResult = build(catalog, { command: step.command, options, model: req.model, global: req.global, strict: req.strict });
      if (!r.ok) {
        const where = Object.keys(combo).length ? ` with ${Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(", ")}` : "";
        for (const m of r.errors) errors.push(`${label}${where}: ${m}`);
        continue;
      }
      for (const w of r.warnings) if (!warnings.includes(`${label}: ${w}`)) warnings.push(`${label}: ${w}`);
      commands.push({ step: si + 1, title, command: r.command!, readOnly: !!r.readOnly, destructive: !!r.destructive, async: !!r.async });
      if (!r.async && pendingAsync) flushAsync();
      lines.push(`run ${r.command}`);
      if (r.async) pendingAsync = true;
    }
  });
  flushAsync();
  if (!errors.length && !commands.length) errors.push("The script would contain no commands.");
  if (errors.length) return { ok: false, commands: [], errors, warnings, notes };

  if (commands.some((c) => c.async)) notes.push("Commands that run asynchronously are followed by `raidcom get command_status`; read its output before moving on.");
  if (commands.some((c) => c.destructive)) notes.push("The script contains commands that delete or initialize. Read it through before running it.");

  const head: string[] = ["#!/bin/bash", "# Generated by raidcom-mcp. The server only builds text; it has not run anything on a storage system."];
  if (req.description) head.push(`# ${req.description.replace(/[\r\n]+/g, " ")}`);
  head.push("# Review before running. Run it on a host with CCI installed and a running HORCM instance.", "");
  if (gc.instance !== undefined) head.push(`export HORCMINST=${gc.instance}`);
  for (const [k, v] of Object.entries(req.env ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || !/^[A-Za-z0-9_.:-]*$/.test(v)) throw new Error(`unsafe environment variable ${k}`);
    head.push(`export ${k}=${v}`);
  }
  head.push('run() { "$@" || { echo "FAILED: $*" >&2; exit 1; }; }', "");
  if (req.login) head.push(`# Set RAIDCOM_USER and RAIDCOM_PASSWORD in your shell; they are not part of this script.`, `run raidcom -login "$RAIDCOM_USER" "$RAIDCOM_PASSWORD"${inst}`);
  if (req.lock_resource) head.push(`run raidcom lock resource${inst}`);
  const tail: string[] = [""];
  if (req.lock_resource) tail.push(`run raidcom unlock resource${inst}`);
  if (req.login) tail.push(`run raidcom -logout${inst}`);

  return { ok: true, script: [...head, ...lines.filter((l, i) => !(l === "" && i === 0)), ...tail].join("\n") + "\n", commands, errors, warnings, notes };
}

// ---------- recipes ----------

export interface RecipeBuild extends ScriptResult {
  recipe?: string;
}

/** Checks the parameters of a recipe and returns the values to substitute. */
function recipeScope(recipe: Recipe, given: Record<string, unknown>, errors: string[]): Scope {
  const scope: Scope = {};
  for (const k of Object.keys(given)) if (!Object.hasOwn(recipe.params, k)) errors.push(`Unknown parameter "${k}". This recipe takes: ${Object.keys(recipe.params).join(", ") || "none"}.`);
  for (const [name, spec] of Object.entries(recipe.params)) {
    const v = given[name];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
      if (spec.required) errors.push(`Parameter "${name}" is required: ${spec.description}`);
      continue;
    }
    try {
      if (spec.type === "array") {
        const list = Array.isArray(v) ? (v as Scalar[]) : [v as Scalar];
        scope[name] = spec.range ? expandList(list) : list.flatMap((x): Scalar[] => (typeof x === "string" ? x.split(/[,\s]+/).filter(Boolean) : [x]));
      } else scope[name] = typeof v === "number" ? v : String(v);
    } catch (e) {
      errors.push(`Parameter "${name}": ${(e as Error).message}`);
    }
  }
  return scope;
}

export function buildRecipe(catalog: Catalog, id: string, recipe: Recipe, given: Record<string, unknown>, opts: Omit<ScriptRequest, "steps"> = {}): RecipeBuild {
  const errors: string[] = [];
  const scope = recipeScope(recipe, given, errors);
  if (errors.length) return { ok: false, recipe: id, commands: [], errors, warnings: [], notes: [] };
  // a step with `when` runs if all its parameters were given; some but not all is a mistake worth reporting
  const steps = recipe.steps.filter((s) => {
    if (!s.when) return true;
    const names = Array.isArray(s.when) ? s.when : [s.when];
    const have = names.filter((n) => lookup(scope, n) !== undefined);
    if (have.length && have.length < names.length) errors.push(`Give ${names.join(" and ")} together (only ${have.join(", ")} was given).`);
    return have.length === names.length;
  });
  if (errors.length) return { ok: false, recipe: id, commands: [], errors, warnings: [], notes: [] };
  const r = buildScript(catalog, { ...opts, steps, description: opts.description ?? recipe.title, env: recipe.env }, scope);
  return { ...r, recipe: id, notes: [...r.notes, ...recipe.notes] };
}
