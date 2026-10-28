// End to end over stdio: starts the built server and talks JSON-RPC to it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

let child;
let nextId = 1;
const pending = new Map();

before(async () => {
  child = spawn(process.execPath, [new URL("../../dist/index.js", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  createInterface({ input: child.stdout }).on("line", (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});
after(() => child.kill());

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), 10_000);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const tool = async (name, args) => (await call("tools/call", { name, arguments: args })).result;
const textOf = (r) => r.content.map((c) => c.text).join("\n");

test("lists the eight build-only tools, all read-only, and no execute tool", async () => {
  const { tools } = (await call("tools/list")).result;
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "raidcom_build_command", "raidcom_build_recipe", "raidcom_build_script", "raidcom_check_command", "raidcom_describe_command", "raidcom_list_commands", "raidcom_list_recipes", "raidcom_model_limits",
  ]);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint === true && !/execute|run/.test(t.name)));
});

test("build_command returns the command", async () => {
  const r = await tool("raidcom_build_command", { command: "add lun", options: { "-port": ["CL1-A-0"], "-ldev_id": 200, "-lun_id": 1 }, model: "B28", global: { instance: 0 } });
  assert.ok(!r.isError);
  assert.match(textOf(r), /raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1 -I0/);
});

test("invalid input is an error result with a fix, not a crash", async () => {
  const r = await tool("raidcom_build_command", { command: "add lun", options: { "-ldev_id": 99999 } });
  assert.ok(r.isError);
  assert.match(textOf(r), /outside|needs -port/);
  const u = await tool("no_such_tool", {});
  assert.ok(u.isError || /unknown/i.test(textOf(u)));
});

test("list, describe, check, script, recipes and limits answer", async () => {
  const l = await tool("raidcom_list_commands", { query: "map a volume to a host group" });
  assert.match(textOf(l), /add lun/);
  assert.match(textOf(await tool("raidcom_list_commands", {})), /ldev/);
  assert.match(textOf(await tool("raidcom_describe_command", { command: "add lun" })), /-ldev_id/);
  assert.match(textOf(await tool("raidcom_check_command", { command_line: "raidcom get ldev -ldev_id 100" })), /raidcom get ldev -ldev_id 100/);
  const bad = await tool("raidcom_check_command", { command_line: "raidcom get port; id" });
  assert.match(textOf(bad), /shell operator/);
  const s = await tool("raidcom_build_script", { steps: [{ command: "add ldev", options: { "-pool": 0, "-ldev_id": "{n}", "-capacity": "1G" }, foreach: { n: "10-12" } }] });
  assert.match(textOf(s), /raidcom add ldev -pool 0 -ldev_id 12 -capacity 1G/);
  assert.match(textOf(await tool("raidcom_list_recipes", {})), /provision-fc-volumes/);
  const rb = await tool("raidcom_build_recipe", { recipe: "extend-dp-volume", params: { ldev_ids: ["100-101"], add_capacity: "10G" } });
  assert.match(textOf(rb), /raidcom extend ldev/);
  assert.match(textOf(await tool("raidcom_model_limits", { model: "E990" })), /ldev/i);
});

test("resources and prompts are served", async () => {
  const { resources } = (await call("resources/list")).result;
  assert.equal(resources.length, 3);
  const body = (await call("resources/read", { uri: resources[0].uri })).result.contents[0].text;
  assert.ok(body.length > 200);
  const { prompts } = (await call("prompts/list")).result;
  assert.equal(prompts.length, 2);
});

test("every tool has a title and complete annotations (MCP directory requirement)", async () => {
  const { tools } = (await call("tools/list")).result;
  for (const t of tools) {
    assert.ok(t.title && t.title.length <= 64, `${t.name} has no title`);
    assert.equal(t.annotations.title, t.title);
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.ok(t.name.length <= 64);
  }
});
