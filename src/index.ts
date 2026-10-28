#!/usr/bin/env node
// MCP server that builds and checks Hitachi raidcom commands.
//
// Build-only by design: it validates structured requests against a catalogue generated from the Command Control
// Interface Command Reference and returns command text. It never connects to a storage system and has no tool that
// runs anything, so it can be hosted anywhere.
import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Catalog, type Command, commandName, isDestructive, isReadOnly } from "./catalog.js";
import { build, type BuildResult, type GlobalOptions, type OptionValue } from "./builder.js";
import { parseCommandLine } from "./cmdline.js";
import { CommandIndex } from "./search.js";
import { buildRecipe, buildScript, type Recipe, type Step } from "./recipes.js";
import { VERSION, bundled, loadHttpConfig, loadJson, loadOptionalJson, loadServerConfig } from "./config.js";
import { tools } from "./tools.js";

type Json = any;

/** Startup steps that read files: a bad file stops the server with one clear line instead of a stack trace. */
function orExit<T>(load: () => T): T {
  try {
    return load();
  } catch (e) {
    const msg = (e as Error).message;
    console.error(msg.startsWith("[raidcom-mcp]") ? msg : `[raidcom-mcp] cannot start: ${msg}`);
    process.exit(1);
  }
}

const cfg = loadServerConfig();
const httpCfg = orExit(() => loadHttpConfig());
const catalog = orExit(() => new Catalog(cfg.catalogPath, cfg.limitsPath));
const questions = orExit(() => loadOptionalJson<Record<string, string[]>>(cfg.examplesPath, "example questions", {}));
const index = new CommandIndex(catalog.commands.values(), questions);
const recipes = orExit(() => loadJson<{ recipes: Record<string, Recipe> }>(cfg.recipesPath, "recipes").recipes);
const notes = {
  conventions: orExit(() => readFileSync(bundled("spec", "notes", "conventions.md"), "utf8")),
  horcm: orExit(() => readFileSync(bundled("spec", "notes", "horcm-setup.md"), "utf8")),
};

// ---------- helpers ----------

function text(t: string, isError = false) {
  return { content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) };
}
const json = (v: unknown, isError = false) => text(JSON.stringify(v), isError);

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const int = (v: unknown, fallback: number): number => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback;
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

const access = (c: Command) => (isReadOnly(c) ? "read-only" : isDestructive(c) ? "changes the array (destructive)" : "changes the array");

function section(title: string, items: string[]): string {
  return items.length ? `\n${title}:\n${items.map((i) => `- ${i}`).join("\n")}` : "";
}

function formatBuild(r: BuildResult): string {
  if (!r.ok) return `Not built.${section("Errors", r.errors)}${section("Warnings", r.warnings)}`;
  const kind = r.readOnly ? "read-only" : r.destructive ? "changes the array, destructive" : "changes the array";
  return `${r.command}\n\n(${kind}${r.async ? ", asynchronous" : ""}; form: ${r.form?.title ? r.form.title.replace(/:$/, "") : r.form?.usage ?? "n/a"})${section("Warnings", r.warnings)}${section("Notes", r.notes)}`;
}

// ---------- tool handlers ----------

function listCommands(args: Json) {
  const query = str(args.query).trim();
  const action = str(args.action).trim().toLowerCase();
  const object = str(args.object).trim().toLowerCase();
  const row = (c: Command) => `${commandName(c)} [${access(c)}${c.async ? ", async" : ""}]: ${c.summary}`;
  if (!query && !action && !object) {
    const byObject = new Map<string, string[]>();
    for (const c of catalog.commands.values()) byObject.set(c.object, [...(byObject.get(c.object) ?? []), c.action]);
    const lines = [...byObject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([o, a]) => `- ${o}: ${a.sort().join(", ")}`);
    return text(`${catalog.commands.size} raidcom commands (action object). Pass query, action or object to list them.\n\n${lines.join("\n")}`);
  }
  if (!query) {
    const found = [...catalog.commands.values()].filter((c) => (!action || c.action === action) && (!object || c.object === object));
    if (!found.length) return text("No commands match. Call with no arguments to see the objects and their actions.");
    return text(`${found.length} command(s):\n${found.map((c) => `- ${row(c)}`).join("\n")}`);
  }
  const limit = Math.min(Math.max(int(args.limit, 10) || 10, 1), 40);
  const r = index.search(query, { limit, action: action || undefined, object: object || undefined });
  if (!r.hits.length) return text("No commands matched. Try other words, or call with no arguments to see the objects.");
  const advice = {
    high: "Use the top result. Describe it if you need its options.",
    medium: "The top result is likely right. Check its description before building.",
    low: "Results are ambiguous. Describe the top 2 or 3 and choose by their descriptions, or search again with the object name (ldev, lun, host_grp, pool, ...).",
  }[r.confidence];
  return text(`Confidence: ${r.confidence.toUpperCase()}: ${r.reason}.\n${advice}\n\n${r.hits.map((h, i) => `${i + 1}. ${row(h.command)}`).join("\n")}`);
}

function describeCommand(args: Json) {
  const cmd = catalog.find(str(args.command));
  if (!cmd) return text(`Unknown raidcom command "${str(args.command)}". Closest: ${catalog.suggest(str(args.command)).join(", ")}. Use raidcom_list_commands to search.`, true);
  const only = str(args.option);
  const options = Object.entries(cmd.flags)
    .filter(([f]) => !only || f === (only.startsWith("-") ? only : `-${only}`))
    .map(([flag, shape]) => ({
      option: flag,
      usage: cmd.options[flag]?.usage,
      values: shape.max === 0 ? "none (a switch)" : `${shape.min === shape.max ? shape.min : `${shape.min}${shape.max === null ? " or more" : ` to ${shape.max}`}`}${shape.placeholders?.length ? `: ${shape.placeholders.map((p) => `<${p}>`).join(" ")}` : ""}`,
      ...(shape.enum ? { only: shape.enum } : shape.literals?.length ? { alsoAccepts: shape.literals } : {}),
      ...(cmd.options[flag]?.hints ? { values_listed_in_manual: cmd.options[flag].hints } : {}),
      description: cmd.options[flag]?.summary,
      ...(cmd.flags[flag] && (cmd.flags[flag] as { derived?: boolean }).derived ? { note: "described in the text of another option, not in the syntax line" } : {}),
    }));
  if (only && !options.length) return text(`raidcom ${commandName(cmd)} has no option "${only}". Options: ${Object.keys(cmd.flags).join(", ") || "none"}.`, true);
  return json({
    command: `raidcom ${commandName(cmd)}`,
    summary: cmd.summary,
    access: access(cmd),
    asynchronous: cmd.async,
    supported_storage_systems: cmd.supported.length ? cmd.supported : "see the Command Reference",
    syntax_forms: cmd.forms.map((f) => ({ ...(f.title ? { when: f.title } : {}), usage: f.usage })),
    options,
    examples: cmd.examples.slice(0, 8).map((e) => ({ ...(e.text ? { what: e.text } : {}), command: e.command })),
    reading_the_syntax: "[x] optional, {a | b} choose one, <x> a value you supply, ... one or more values.",
  });
}

function buildCommand(args: Json) {
  const r = build(catalog, {
    command: str(args.command),
    options: obj(args.options) as Record<string, OptionValue>,
    model: str(args.model) || undefined,
    global: obj(args.global) as GlobalOptions,
    strict: args.strict === false ? false : undefined,
  });
  return text(formatBuild(r), !r.ok);
}

function checkCommand(args: Json) {
  const parsed = parseCommandLine(catalog, str(args.command_line));
  if (!parsed.request) return text(`Not checked.${section("Errors", parsed.errors)}${section("Warnings", parsed.warnings)}`, true);
  const r = build(catalog, { ...parsed.request, model: str(args.model) || undefined, strict: args.strict === false ? false : undefined });
  const cmd = catalog.find(parsed.request.command)!;
  const explained = Object.keys(parsed.request.options ?? {}).map((raw) => {
    const flag = Object.keys(cmd.flags).find((f) => f.toLowerCase() === raw.toLowerCase());
    return flag ? `${flag}: ${cmd.options[flag]?.summary || "(no description in the manual)"}` : `${raw}: not an option of raidcom ${commandName(cmd)}`;
  });
  const errors = [...parsed.errors, ...r.errors];
  const warnings = [...parsed.warnings, ...r.warnings];
  const head = r.ok && !parsed.errors.length ? `${r.command}\n\nValid. raidcom ${commandName(cmd)}: ${cmd.summary} (${access(cmd)}${cmd.async ? ", asynchronous" : ""})` : `Problems found with raidcom ${commandName(cmd)}.`;
  return text(`${head}${section("Options", explained)}${section("Errors", errors)}${section("Warnings", warnings)}${r.ok ? section("Notes", r.notes) : ""}`, errors.length > 0);
}

function formatScript(r: ReturnType<typeof buildScript>, what: string) {
  if (!r.ok) return text(`No script built.${section("Errors", r.errors)}${section("Warnings", r.warnings)}`, true);
  const changing = r.commands.filter((c) => !c.readOnly).length;
  const destructive = r.commands.filter((c) => c.destructive).length;
  return text(`\`\`\`bash\n${r.script}\`\`\`\n\n${what}: ${r.commands.length} command(s), ${r.commands.length - changing} read-only, ${changing} changing${destructive ? `, ${destructive} destructive` : ""}.${section("Warnings", r.warnings)}${section("Notes", r.notes)}`);
}

function buildScriptTool(args: Json) {
  const steps = Array.isArray(args.steps) ? (args.steps as Step[]) : [];
  if (!steps.length) return text("steps must be a non-empty array of {command, options, foreach?, zip?}.", true);
  const r = buildScript(catalog, {
    steps: steps.map((s) => ({ ...obj(s), command: str(obj(s).command), options: obj(obj(s).options) as Record<string, OptionValue>, title: obj(s).title ? str(obj(s).title) : undefined })),
    model: str(args.model) || undefined,
    global: obj(args.global) as GlobalOptions,
    strict: args.strict === false ? false : undefined,
    login: args.login === true,
    lock_resource: args.lock_resource === true,
    description: args.description ? str(args.description) : undefined,
  });
  return formatScript(r, "Script");
}

function listRecipes(args: Json) {
  const id = str(args.recipe).trim();
  if (id) {
    const r = Object.hasOwn(recipes, id) ? recipes[id] : undefined;
    if (!r) return text(`Unknown recipe "${id}". Recipes: ${Object.keys(recipes).join(", ")}.`, true);
    return json({ recipe: id, title: r.title, summary: r.summary, params: r.params, steps: r.steps.map((s) => ({ title: s.title, command: s.command, options: s.options, ...(s.foreach ? { foreach: s.foreach } : {}), ...(s.zip ? { zip: s.zip } : {}), ...(s.when ? { only_when_given: s.when } : {}) })), notes: r.notes });
  }
  const query = str(args.query).toLowerCase().trim();
  let entries = Object.entries(recipes);
  if (query) {
    const w = query.split(/[^a-z0-9]+/).filter((x) => x.length > 1);
    entries = entries
      .map(([k, r]) => ({ k, r, s: w.filter((x) => `${k} ${r.title} ${r.summary} ${r.keywords.join(" ")}`.toLowerCase().includes(x)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => [x.k, x.r] as [string, Recipe]);
    if (!entries.length) return text(`No recipe matched. Recipes: ${Object.keys(recipes).join(", ")}.`);
  }
  return text(entries.map(([k, r]) => `- ${k}: ${r.title}. ${r.summary}`).join("\n"));
}

function buildRecipeTool(args: Json) {
  const id = str(args.recipe).trim();
  const recipe = Object.hasOwn(recipes, id) ? recipes[id] : undefined;
  if (!recipe) return text(`Unknown recipe "${id}". Recipes: ${Object.keys(recipes).join(", ")}.`, true);
  const r = buildRecipe(catalog, id, recipe, obj(args.params), {
    model: str(args.model) || undefined,
    global: obj(args.global) as GlobalOptions,
    strict: args.strict === false ? false : undefined,
    login: args.login === true,
    lock_resource: args.lock_resource === true,
  });
  return formatScript(r, recipe.title);
}

function modelLimits(args: Json) {
  const want = str(args.model).trim();
  if (!want) return json({ models: [...catalog.models.entries()].map(([id, m]) => ({ id, label: m.label, aliases: m.aliases })) });
  const m = catalog.model(want);
  if (!m) return text(`Unknown model "${want}". Models: ${[...catalog.models.keys()].join(", ")}.`, true);
  const l = m.limits;
  return json({
    model: m.id,
    label: l.label,
    serial_number: `${l.serial[0]} to ${l.serial[1]}`,
    ldev_id: `${l.ldev[0]} to ${l.ldev[1]}`,
    pool_id: `${l.pool[0]} to ${l.pool[1]}`,
    lun: `${l.lun[0]} to ${l.lun[1]}`,
    port_columns: l.portColumns.split("").join(", "),
    port_letters: l.portLetters.split("").join(", "),
    ...(l.portColumnsLimited ? { port_note: `columns ${l.portColumnsLimited.cols.split("").join(", ")} only have ports ${l.portColumnsLimited.letters.split("").join(", ")}` } : {}),
    host_group_id: "0 to 254",
    source: "Valid parameter ranges in the appendices of the CCI Command Reference",
  });
}

async function callTool(req: { params: { name: string; arguments?: Json } }) {
  const { name } = req.params;
  const args: Json = obj(req.params.arguments);
  try {
    switch (name) {
      case "raidcom_list_commands": return listCommands(args);
      case "raidcom_describe_command": return describeCommand(args);
      case "raidcom_build_command": return buildCommand(args);
      case "raidcom_check_command": return checkCommand(args);
      case "raidcom_build_script": return buildScriptTool(args);
      case "raidcom_list_recipes": return listRecipes(args);
      case "raidcom_build_recipe": return buildRecipeTool(args);
      case "raidcom_model_limits": return modelLimits(args);
      default: return text(`Unknown tool ${name}`, true);
    }
  } catch (e) {
    return text(`Error: ${(e as Error).message}`, true);
  }
}

// ---------- resources and prompts ----------

const resources = [
  { uri: "raidcom://notes/conventions", name: "raidcom conventions", description: "Login, instances, serial numbers, asynchronous commands, resource locking.", mimeType: "text/markdown" },
  { uri: "raidcom://notes/horcm-setup", name: "Minimal HORCM configuration", description: "What the host that runs raidcom needs.", mimeType: "text/markdown" },
  { uri: "raidcom://catalog/commands", name: "Command list", description: "Every raidcom command in the catalogue with its one-line summary.", mimeType: "text/markdown" },
];

function readResource(uri: string): string | undefined {
  if (uri === "raidcom://notes/conventions") return notes.conventions;
  if (uri === "raidcom://notes/horcm-setup") return notes.horcm;
  if (uri === "raidcom://catalog/commands") {
    return `# raidcom commands\n\nFrom ${catalog.source} (generated ${catalog.generated}).\n\n` + [...catalog.commands.values()].map((c) => `- \`raidcom ${commandName(c)}\` [${access(c)}]: ${c.summary}`).join("\n") + "\n";
  }
  return undefined;
}

const GUIDANCE =
  "You build raidcom commands for Hitachi VSP storage with the raidcom_* tools. The server only builds text; it never runs anything.\n" +
  "1. If you do not know the command, raidcom_list_commands with the user's words. 2. If unsure of its options, raidcom_describe_command. " +
  "3. Build with raidcom_build_command (one command) or raidcom_build_script / raidcom_build_recipe (several; use foreach or ranges instead of repeating calls). " +
  "4. Pass `model` when the user names one so IDs and ports are range-checked. 5. If a result has errors, fix the arguments and build again. " +
  "6. Show the user the command or script, say which commands change the array, and remind them to review it and to run changing commands under raidcom lock resource, ideally first with -checkmode precheck. " +
  "Never invent options: only use ones raidcom_describe_command lists. Ask the user for values you do not have (pool, LDEV IDs, ports, WWNs) instead of guessing them.";

const prompts = [
  { name: "build-raidcom-commands", description: "Turn a storage task into validated raidcom commands.", arguments: [{ name: "task", description: "What you want to do, e.g. \"present 4 x 100 GB volumes from pool 0 to host esx01 on CL1-A and CL2-A\"", required: true }, { name: "model", description: "Storage model, e.g. vsp-one-b28", required: false }] },
  { name: "explain-raidcom-command", description: "Explain and check an existing raidcom command line.", arguments: [{ name: "command_line", description: "The raidcom command", required: true }] },
];

function getPrompt(name: string, args: Record<string, string> = {}) {
  if (name === "build-raidcom-commands") {
    return { description: prompts[0].description, messages: [{ role: "user" as const, content: { type: "text" as const, text: `${GUIDANCE}\n\nTask: ${args.task ?? ""}${args.model ? `\nStorage model: ${args.model}` : ""}\n\nBuild the commands for this task with the raidcom tools. List anything you still need from me before building.` } }] };
  }
  if (name === "explain-raidcom-command") {
    return { description: prompts[1].description, messages: [{ role: "user" as const, content: { type: "text" as const, text: `Check this raidcom command with raidcom_check_command, then explain in plain words what it does, what it changes, and anything risky about it:\n\n${args.command_line ?? ""}` } }] };
  }
  throw new Error(`Unknown prompt ${name}`);
}

/** An MCP server with the tools. stdio uses one for the whole process; HTTP makes one per request. */
function createServer(): Server {
  const server = new Server(
    { name: "raidcom-mcp", version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: GUIDANCE },
  );
  const toolList = tools();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList }));
  server.setRequestHandler(CallToolRequestSchema, callTool);
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const body = readResource(req.params.uri);
    if (body === undefined) throw new Error(`Unknown resource ${req.params.uri}`);
    return { contents: [{ uri: req.params.uri, mimeType: "text/markdown", text: body }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => getPrompt(req.params.name, req.params.arguments));
  return server;
}

let listening = "";
if (httpCfg) {
  // Imported only here, so the stdio server never loads the HTTP stack.
  const { startHttp } = await import("./http.js");
  const { url } = await startHttp(httpCfg, createServer).catch((e): never => {
    console.error(`[raidcom-mcp] cannot listen on ${httpCfg.host}:${httpCfg.port}: ${(e as Error).message}`);
    process.exit(1);
  });
  listening = `, listening on ${url}${httpCfg.token ? "" : " (no token: open endpoint)"}`;
} else {
  await createServer().connect(new StdioServerTransport());
}
console.error(`[raidcom-mcp] ready: ${catalog.commands.size} commands, ${Object.keys(recipes).length} recipes, build-only${listening}`);
