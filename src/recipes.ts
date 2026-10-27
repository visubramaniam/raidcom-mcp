// Scripts and recipes. A step names a command and its options; `foreach` and `zip` repeat it over lists, so
// "create LDEVs 100 to 109" is one step, not ten tool calls. Every expanded command goes through the same builder
// as raidcom_build_command, so a script is only produced when every command in it is valid.
import { type Catalog } from "./catalog.js";
import { build, type BuildResult, type GlobalOptions, type OptionValue } from "./builder.js";

type Scalar = string | number;

export interface Step {
  title?: string;
  command: string;
  options?: Record<string, OptionValue>;
  /** Cartesian repeat: loop variable → list of values, a range such as "100-109", or (in recipes) a parameter name. */
  foreach?: Record<string, Scalar[] | string>;
  /** Parallel repeat: loop variable → list; all lists must have the same length. */
  zip?: Record<string, Scalar[] | string>;
  /** Recipes only: run the step when this parameter was given. */
  when?: string;
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

/** "100-103" → 100..103, "1,2,5" → 1,2,5, a mix of both; other text is kept as is. */
export function expandList(input: Scalar | Scalar[]): Scalar[] {
  const out: Scalar[] = [];
  for (const item of Array.isArray(input) ? input : [input]) {
    if (typeof item === "number") {
      out.push(item);
      continue;
    }
    for (const part of String(item).split(/[,\s]+/).filter(Boolean)) {
      const m = /^(\d+)-(\d+)$/.exec(part);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (b < a) throw new Error(`range "${part}" runs backwards`);
        if (b - a + 1 > MAX_COMMANDS) throw new Error(`range "${part}" has more than ${MAX_COMMANDS} values`);
        for (let n = a; n <= b; n++) out.push(n);
      } else out.push(/^\d+$/.test(part) ? Number(part) : part);
    }
  }
  return out;
}

const refs = (s: string) => [...s.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);

type Scope = Record<string, Scalar | Scalar[] | undefined>;

/** Substitutes {name} in a template. Undefined when it names something that has no value. */
function fill(template: string, scope: Scope): Scalar | Scalar[] | undefined {
  const whole = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(template);
  if (whole) {
    const v = scope[whole[1]];
    return v === undefined || (Array.isArray(v) && v.length === 0) || v === "" ? undefined : v;
  }
  let missing = false;
  const text = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = scope[name];
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
  const out: Record<string, OptionValue> = {};
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

function loopValues(spec: Scalar[] | string, params: Scope): Scalar[] {
  if (Array.isArray(spec)) return expandList(spec);
  const p = params[spec];
  if (p !== undefined) return Array.isArray(p) ? p : [p];
  return expandList(spec);
}

/** Every variable binding a step runs with. */
function bindings(step: Step, params: Scope): Array<Record<string, Scalar>> {
  let combos: Array<Record<string, Scalar>> = [{}];
  if (step.zip) {
    const lists = Object.entries(step.zip).map(([k, v]) => [k, loopValues(v, params)] as const);
    const n = lists[0]?.[1].length ?? 0;
    for (const [k, l] of lists) if (l.length !== n) throw new Error(`zip lists must have the same length (${lists[0][0]} has ${n}, ${k} has ${l.length})`);
    combos = Array.from({ length: n }, (_, i) => Object.fromEntries(lists.map(([k, l]) => [k, l[i]])));
  }
  for (const [k, v] of Object.entries(step.foreach ?? {})) {
    const values = loopValues(v, params);
    combos = combos.flatMap((c) => values.map((x) => ({ ...c, [k]: x })));
    if (combos.length > MAX_COMMANDS) throw new Error(`the step would produce more than ${MAX_COMMANDS} commands`);
  }
  return combos;
}

// ---------- scripts ----------

const instanceFlag = (g: GlobalOptions | undefined) => (g?.instance !== undefined ? ` -I${g.pair_type ?? ""}${g.instance}` : "");

export function buildScript(catalog: Catalog, req: ScriptRequest, params: Scope = {}): ScriptResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const commands: BuiltCommand[] = [];
  const lines: string[] = [];
  let total = 0;
  let pendingAsync = false;
  const inst = instanceFlag(req.global);

  const flushAsync = () => {
    if (!pendingAsync) return;
    lines.push(`run raidcom get command_status${inst}`);
    pendingAsync = false;
  };

  req.steps.forEach((step, si) => {
    const label = `step ${si + 1}${step.title ? ` (${step.title})` : ""}`;
    let combos: Array<Record<string, Scalar>>;
    try {
      combos = bindings(step, params);
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
    if (step.title) lines.push("", `# ${step.title.replace(/[\r\n]+/g, " ")}`);
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
      commands.push({ step: si + 1, title: step.title, command: r.command!, readOnly: !!r.readOnly, destructive: !!r.destructive, async: !!r.async });
      if (!r.async && pendingAsync) flushAsync();
      lines.push(`run ${r.command}`);
      if (r.async) pendingAsync = true;
    }
  });
  flushAsync();
  if (errors.length) return { ok: false, commands: [], errors, warnings, notes };

  if (commands.some((c) => c.async)) notes.push("Commands that run asynchronously are followed by `raidcom get command_status`; read its output before moving on.");
  if (commands.some((c) => c.destructive)) notes.push("The script contains commands that delete or initialize. Read it through before running it.");

  const head: string[] = ["#!/bin/bash", "# Generated by raidcom-mcp. The server only builds text; it has not run anything on a storage system."];
  if (req.description) head.push(`# ${req.description.replace(/[\r\n]+/g, " ")}`);
  head.push("# Review before running. Run it on a host with CCI installed and a running HORCM instance.", "");
  if (req.global?.instance !== undefined) head.push(`export HORCMINST=${req.global.instance}`);
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
  for (const k of Object.keys(given)) if (!(k in recipe.params)) errors.push(`Unknown parameter "${k}". This recipe takes: ${Object.keys(recipe.params).join(", ") || "none"}.`);
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
  const steps = recipe.steps.filter((s) => !s.when || scope[s.when] !== undefined);
  const r = buildScript(catalog, { ...opts, steps, description: opts.description ?? recipe.title }, scope);
  return { ...r, recipe: id, notes: [...r.notes, ...recipe.notes] };
}
