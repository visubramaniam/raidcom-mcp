import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog } from "./helpers.mjs";
import { buildScript, buildRecipe, expandList } from "../../dist/recipes.js";

const recipes = JSON.parse(readFileSync(new URL("../../spec/recipes.json", import.meta.url), "utf8")).recipes;

const SAMPLE = {
  "provision-fc-volumes": { pool: 0, ldev_ids: ["100-103"], capacity: "100G", ports: ["CL1-A", "CL2-A"], host_grp: "esx01", host_mode: "VMWARE_EX", wwns: ["210000e08b0256f8", "210000e08b0256f9"] },
  "provision-iscsi-volumes": { pool: 0, ldev_ids: ["100-101"], capacity: "50G", ports: ["CL3-A"], target: "db01", host_mode: "LINUX/IRIX", iqns: ["iqn.1994-05.com.redhat:db01"] },
  "provision-nvme-tcp-namespaces": { pool: 0, ldev_ids: ["100-101"], capacity: "50G", ns_ids: ["1-2"], nvm_subsystem_id: 1, nvm_subsystem_name: "subsys1", ports: ["CL1-A"], host_nqn: "nqn.2014-08.org.nvmexpress:uuid:1234" },
  "create-dp-pool": { pool_id: 1, pool_name: "pool1", pool_ldevs: ["200-203"], warning_threshold: 70, depletion_threshold: 80 },
  "grow-dp-pool": { pool_id: 1, pool_ldevs: ["204-205"] },
  "extend-dp-volume": { ldev_ids: ["100-102"], add_capacity: "10G" },
  "unmap-and-delete-volumes": { ports: ["CL1-A"], host_grp: "esx01", ldev_ids: ["100-101"] },
  "rename-host-group": { port: "CL1-A", host_grp_id: 1, new_name: "esx02" },
  "create-command-device": { pool: 0, ldev_id: 300, capacity: "100M", security: 3, port: "CL1-A", host_grp: "mgmt", lun_id: 0 },
  "reclaim-zero-pages": { ldev_ids: ["100-101"] },
  "inventory-report": {},
  "create-copy-group": { primary_group: "pvol", primary_ldevs: ["100-101"], secondary_group: "svol", secondary_ldevs: ["200-201"], copy_group: "cg1", device_prefix: "dev" },
  "check-async-result": {},
};

test("every recipe has sample parameters and builds a valid script", () => {
  for (const id of Object.keys(recipes)) assert.ok(SAMPLE[id], `no sample for ${id}`);
  for (const [id, recipe] of Object.entries(recipes)) {
    const r = buildRecipe(catalog, id, recipe, SAMPLE[id], { global: { instance: 0 }, lock_resource: !id.startsWith("inventory") });
    assert.ok(r.ok, `${id}: ${r.errors.join("; ")}`);
    assert.ok(r.script.startsWith("#!/bin/bash"));
    assert.ok(r.commands.length > 0);
  }
});

test("every recipe step names an existing command and parameters that exist", () => {
  for (const [id, recipe] of Object.entries(recipes)) {
    for (const s of recipe.steps) {
      assert.ok(catalog.find(s.command), `${id}: unknown command ${s.command}`);
      if (s.when) assert.ok(s.when in recipe.params, `${id}: when=${s.when} is not a parameter`);
    }
  }
});

test("provisioning expands to the right number of commands", () => {
  const r = buildRecipe(catalog, "provision-fc-volumes", recipes["provision-fc-volumes"], SAMPLE["provision-fc-volumes"]);
  const count = (re) => r.commands.filter((c) => re.test(c.command)).length;
  assert.equal(count(/^raidcom add ldev /), 4);
  assert.equal(count(/^raidcom add lun /), 8);
  assert.equal(count(/^raidcom add hba_wwn /), 4);
  assert.equal(count(/^raidcom add host_grp /), 2);
});

test("missing and unknown parameters are reported", () => {
  const r = buildRecipe(catalog, "grow-dp-pool", recipes["grow-dp-pool"], { pool_id: 1, bogus: 1 });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => /Unknown parameter "bogus"/.test(e)));
  assert.ok(r.errors.some((e) => /"pool_ldevs" is required/.test(e)));
});

test("errors in an expanded command name the step and the loop value", () => {
  const r = buildScript(catalog, { steps: [{ title: "make", command: "add ldev", options: { "-pool": 0, "-ldev_id": "{n}", "-capacity": "1G" }, foreach: { n: ["100", "99999"] } }] });
  assert.ok(!r.ok);
  assert.match(r.errors[0], /step 1 \(make\) with n=99999: .*outside/);
  assert.equal(r.script, undefined);
});

test("scripts: run wrapper, async status, lock, login without credentials", () => {
  const r = buildScript(catalog, {
    steps: [
      { command: "add ldev", options: { "-pool": 0, "-ldev_id": "{n}", "-capacity": "1G" }, foreach: { n: "100-101" } },
      { command: "get ldev", options: { "-ldev_id": "{n}" }, foreach: { n: "100-101" } },
    ],
    global: { instance: 3 },
    login: true,
    lock_resource: true,
  });
  assert.ok(r.ok, r.errors.join(";"));
  const lines = r.script.split("\n");
  assert.ok(lines.includes("export HORCMINST=3"));
  assert.ok(lines.some((l) => l.includes("raidcom -login") && l.includes('"$RAIDCOM_USER"')));
  const iStatus = lines.findIndex((l) => l.includes("get command_status"));
  const iLun = lines.findIndex((l) => l.includes("get ldev"));
  const iLdev = lines.findLastIndex((l) => l.includes("add ldev"));
  assert.ok(iLdev < iStatus && iStatus < iLun, "async commands are followed by command_status before the next step");
  assert.ok(lines.indexOf("run raidcom lock resource -I3") < iLdev);
  assert.ok(r.script.trim().split("\n").at(-1).includes("-logout"));
});

test("zip pairs values; foreach is a product; limits hold", () => {
  const z = buildScript(catalog, { steps: [{ command: "add lun", options: { "-port": ["CL1-A-0"], "-ldev_id": "{l}", "-lun_id": "{u}" }, zip: { l: "100-102", u: "0-2" } }] });
  assert.ok(z.ok);
  assert.deepEqual(z.commands.map((c) => c.command), ["raidcom add lun -port CL1-A-0 -ldev_id 100 -lun_id 0", "raidcom add lun -port CL1-A-0 -ldev_id 101 -lun_id 1", "raidcom add lun -port CL1-A-0 -ldev_id 102 -lun_id 2"]);
  assert.ok(!buildScript(catalog, { steps: [{ command: "add lun", options: {}, zip: { a: "1-3", b: "1-2" } }] }).ok);
  assert.ok(!buildScript(catalog, { steps: [{ command: "get ldev", options: { "-ldev_id": "{n}" }, foreach: { n: "0-400", m: "0-400" } }] }).ok);
});

test("expandList", () => {
  assert.deepEqual(expandList(["100-102", "7", "x"]), [100, 101, 102, 7, "x"]);
  assert.deepEqual(expandList("1,2 3"), [1, 2, 3]);
  assert.throws(() => expandList("5-1"), /backwards/);
  assert.throws(() => expandList("0-100000"), /more than/);
});

test("destructive scripts carry a warning note", () => {
  const r = buildRecipe(catalog, "unmap-and-delete-volumes", recipes["unmap-and-delete-volumes"], SAMPLE["unmap-and-delete-volumes"]);
  assert.ok(r.ok, r.errors.join(";"));
  assert.ok(r.notes.some((n) => /delete or initialize/.test(n)));
});
