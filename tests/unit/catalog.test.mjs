// The catalogue is generated from the Command Reference. These tests replay every example from the manual through
// the parser and validator, so a parsing mistake in scripts/generate-catalog.mjs shows up here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog } from "./helpers.mjs";
import { build } from "../../dist/builder.js";
import { parseCommandLine } from "../../dist/cmdline.js";

test("the catalogue covers the raidcom command set", () => {
  assert.ok(catalog.commands.size >= 170, `only ${catalog.commands.size} commands`);
  for (const name of ["add ldev", "delete ldev", "extend ldev", "get ldev", "modify ldev", "add lun", "delete lun", "get lun", "add host_grp", "get host_grp", "modify host_grp", "add hba_wwn", "add hba_iscsi",
    "add dp_pool", "get pool", "modify pool", "get port", "modify port", "get parity_grp", "get command_status", "lock resource", "unlock resource", "add device_grp", "add copy_grp",
    "add nvm_subsystem", "add namespace", "add namespace_path", "add host_nqn", "add nvm_subsystem_port"]) {
    assert.ok(catalog.commands.has(name), `missing ${name}`);
  }
});

test("every command has a summary and at least one syntax form", () => {
  for (const [name, c] of catalog.commands) {
    assert.ok(c.summary.length > 5, `${name} has no summary`);
    assert.ok(c.forms.length >= 1, `${name} has no syntax form`);
    assert.ok(c.forms.every((f) => f.usage.startsWith(`raidcom ${name}`)), `${name} has a form that does not start with its own name`);
  }
});

test("find() accepts the usual spellings", () => {
  assert.equal(catalog.find("add lun")?.object, "lun");
  assert.equal(catalog.find("raidcom add lun")?.object, "lun");
  assert.equal(catalog.find("lun add")?.action, "add");
  assert.equal(catalog.find("ADD  LUN")?.object, "lun");
  assert.equal(catalog.find("add"), undefined);
  assert.ok(catalog.suggest("add lunn").includes("add lun"));
});

test("known commands are classified", async () => {
  const { isReadOnly, isDestructive } = await import("../../dist/catalog.js");
  assert.ok(isReadOnly(catalog.find("get ldev")));
  assert.ok(!isReadOnly(catalog.find("add ldev")));
  assert.ok(isDestructive(catalog.find("delete ldev")));
  assert.ok(isDestructive(catalog.find("initialize ldev")));
  assert.ok(!isDestructive(catalog.find("add lun")));
  assert.equal(catalog.find("add ldev").async, true);
  assert.equal(catalog.find("add host_grp").async, false);
});

test("option shapes: values per option", () => {
  const lun = catalog.find("add lun").flags;
  assert.deepEqual([lun["-port"].min, lun["-port"].max], [1, 2], "-port takes a port and an optional host group name");
  assert.equal(lun["-additional_port"].max, null, "-additional_port takes a list");
  assert.deepEqual([lun["-ldev_id"].min, lun["-ldev_id"].max], [1, 1]);
  assert.deepEqual(catalog.find("add ldev").flags["-status"].enum, ["enable_fullallocation", "disable_fullallocation"]);
  assert.equal(catalog.find("get ldev").flags["-ldev_id"].max, null);
});

test("replaying the manual's examples", () => {
  let total = 0;
  const failed = [];
  for (const [name, c] of catalog.commands) {
    for (const ex of c.examples) {
      total++;
      const p = parseCommandLine(catalog, ex.command);
      const r = p.request && !p.errors.length ? build(catalog, p.request) : undefined;
      if (!r?.ok || p.request.command !== name) failed.push(ex.command);
    }
  }
  assert.ok(total >= 500, `only ${total} examples`);
  const rate = 1 - failed.length / total;
  // The manual's syntax lines and examples disagree in a few places (options used in examples that the syntax does
  // not list, wrapped lines cut by a page break). Hold the line where it is; raise it when the generator improves.
  assert.ok(rate >= 0.95, `${failed.length} of ${total} examples fail (${(rate * 100).toFixed(1)}% pass):\n${failed.slice(0, 15).join("\n")}`);
});

test("the examples of the commands people use most all validate", () => {
  for (const name of ["add ldev", "add lun", "delete lun", "add host_grp", "add hba_wwn", "get lun", "get port", "get pool", "add dp_pool", "extend ldev", "lock resource", "unlock resource", "get command_status", "add device_grp"]) {
    for (const ex of catalog.find(name).examples) {
      const p = parseCommandLine(catalog, ex.command);
      assert.deepEqual(p.errors, [], ex.command);
      const r = build(catalog, p.request);
      assert.ok(r.ok, `${ex.command}: ${r.errors.join("; ")}`);
    }
  }
});

test("model limits cover the appendices", () => {
  const b28 = catalog.model("VSP One B28");
  assert.equal(b28.id, "vsp-one-b28");
  assert.deepEqual(b28.limits.ldev, [0, 49151]);
  assert.equal(catalog.model("5600").id, "vsp-5000");
  assert.equal(catalog.model("E990").limits.serial[0], 400000);
  assert.equal(catalog.model("nonsense"), undefined);
});

test("the example questions only name commands that exist", () => {
  const examples = JSON.parse(readFileSync(new URL("../../spec/examples.json", import.meta.url), "utf8"));
  for (const k of Object.keys(examples)) if (!k.startsWith("_")) assert.ok(catalog.commands.has(k), `unknown command ${k} in examples.json`);
});
