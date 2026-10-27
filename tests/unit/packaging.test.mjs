// Checks the Claude Desktop extension manifest and the skill that is also packaged as a zip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tools } from "../../dist/tools.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("packaging/mcpb/manifest.json"));

test("the extension manifest lists exactly the server's tools", () => {
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), tools().map((t) => t.name).sort());
  for (const t of manifest.tools) assert.ok(t.description.length > 10, t.name);
});

test("the extension runs the bundled server and needs no settings", () => {
  assert.equal(manifest.name, "raidcom-mcp");
  assert.equal(manifest.server.entry_point, "dist/index.js");
  assert.deepEqual(manifest.server.mcp_config.args, ["${__dirname}/dist/index.js"]);
  assert.equal(manifest.user_config, undefined);
  assert.ok(manifest.compatibility.runtimes.node.includes("22.19"));
});

test("the skill meets the upload limits (name up to 64 of a-z 0-9 -, description up to 200 characters)", () => {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(read("plugin/skills/raidcom-command-builder/SKILL.md"))[1];
  const field = (k) => new RegExp(`^${k}: (.*)$`, "m").exec(head)[1].trim();
  assert.match(field("name"), /^[a-z0-9-]{1,64}$/);
  assert.ok(field("description").length <= 200, `${field("description").length} characters`);
});

test("server.json and package.json agree", () => {
  const pkg = JSON.parse(read("package.json"));
  const server = JSON.parse(read("server.json"));
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].version, pkg.version);
  assert.equal(server.name, pkg.mcpName);
});
