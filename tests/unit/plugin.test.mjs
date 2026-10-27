// Checks the Claude plugin in plugin/: its manifest, the marketplace that lists it, and that it runs exactly the
// raidcom-mcp version it depends on (which can only be a version already on npm, so it may trail package.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const json = (p) => JSON.parse(read(p));
const plugin = json("plugin/.claude-plugin/plugin.json");
const deps = json("plugin/package.json");
const pkg = json("package.json");
const market = json(".claude-plugin/marketplace.json");
const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i]), 0);

test("the marketplace lists the plugin", () => {
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, "./plugin");
});

test("the plugin runs the raidcom-mcp version it depends on", () => {
  const version = deps.dependencies["raidcom-mcp"];
  assert.match(version, /^\d+\.\d+\.\d+$/, "an exact version, not a range");
  assert.equal(plugin.version, version, "plugin.json version matches plugin/package.json's dependency");
  assert.equal(deps.version, version);
  assert.ok(cmp(version, pkg.version) <= 0, `the plugin (${version}) cannot be ahead of package.json (${pkg.version})`);
  assert.deepEqual(plugin.mcpServers.raidcom.args, ["${CLAUDE_PLUGIN_ROOT}/node_modules/raidcom-mcp/dist/index.js"]);
  if (existsSync(new URL("../../plugin/package-lock.json", import.meta.url))) {
    const lock = json("plugin/package-lock.json");
    assert.equal(lock.packages["node_modules/raidcom-mcp"].version, version, "the lockfile installs the same version");
  }
});

test("the plugin needs no settings and holds no secrets", () => {
  assert.equal(plugin.userConfig, undefined);
  assert.ok(!/secret|token|password/i.test(JSON.stringify(plugin.mcpServers)));
});

test("the skill has the frontmatter Claude Code needs", () => {
  const s = read("plugin/skills/raidcom-command-builder/SKILL.md");
  const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(s);
  assert.ok(m, "frontmatter with name and description");
  assert.equal(m[1], "raidcom-command-builder");
  // every tool the skill names exists
  const { tools } = { tools: ["raidcom_list_commands", "raidcom_list_recipes", "raidcom_build_recipe", "raidcom_describe_command", "raidcom_build_command", "raidcom_build_script", "raidcom_check_command"] };
  for (const t of tools) assert.ok(s.includes(t), t);
});

test("the plugin's licence is the project's", () => {
  assert.equal(read("plugin/LICENSE"), read("LICENSE"));
});
