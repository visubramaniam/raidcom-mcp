import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog } from "./helpers.mjs";
import { build, shellQuote } from "../../dist/builder.js";

const ok = (req) => {
  const r = build(catalog, req);
  assert.ok(r.ok, r.errors.join("\n"));
  return r;
};
const bad = (req) => {
  const r = build(catalog, req);
  assert.ok(!r.ok, `expected errors, got: ${r.command}`);
  assert.equal(r.command, undefined);
  return r.errors.join("\n");
};

test("builds a simple command with a global instance", () => {
  const r = ok({ command: "add ldev", options: { "-pool": 0, "-ldev_id": 256, "-capacity": "100G" }, global: { instance: 0 } });
  assert.equal(r.command, "raidcom add ldev -pool 0 -ldev_id 256 -capacity 100G -I0");
  assert.deepEqual(r.argv.slice(0, 3), ["raidcom", "add", "ldev"]);
  assert.equal(r.async, true);
  assert.equal(r.readOnly, false);
  assert.ok(r.notes.some((n) => /command_status/.test(n)));
});

test("option names may be written loosely", () => {
  const r = ok({ command: "raidcom add lun", options: { port: ["cl1-a-0"], LDEV_ID: 200, "lun-id": 1 } });
  assert.equal(r.command, "raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1");
});

test("a port and host group name travel together", () => {
  assert.equal(ok({ command: "add hba_wwn", options: { "-port": ["CL1-A", "esx01"], "-hba_wwn": "210000e08b0256f8" } }).command, "raidcom add hba_wwn -port CL1-A esx01 -hba_wwn 210000e08b0256f8");
  // "CL1-A esx01" written as one string is two values
  assert.equal(ok({ command: "add hba_wwn", options: { "-port": "CL1-A esx01", "-hba_wwn": "210000e08b0256f8" } }).command, "raidcom add hba_wwn -port CL1-A esx01 -hba_wwn 210000e08b0256f8");
});

test("a value list is written in order", () => {
  assert.equal(ok({ command: "get ldev", options: { "-ldev_id": [100, 101, 102] } }).command, "raidcom get ldev -ldev_id 100 101 102");
  assert.equal(ok({ command: "get ldev", options: { "-ldev_id": "100-110" } }).command, "raidcom get ldev -ldev_id 100-110");
});

test("switches and dropped options", () => {
  assert.equal(ok({ command: "get host_grp", options: { "-allports": true, "-key": false } }).command, "raidcom get host_grp -allports");
  assert.equal(ok({ command: "get port" }).command, "raidcom get port");
});

test("global options", () => {
  const r = ok({ command: "get ldev", options: { "-ldev_id": 5 }, model: "vsp-5000", global: { instance: 2, pair_type: "H", serial: 512345, fx: true, nomsg: true, unit: 1, checkmode: "precheck" } });
  assert.equal(r.command, "raidcom get ldev -nomsg -ldev_id 5 -IH2 -s 512345 -u 1 -fx -checkmode precheck");
  assert.match(bad({ command: "get port", global: { serial: "abc" } }), /digits only/);
  assert.match(bad({ command: "get port", model: "vsp-5000", global: { serial: 810001 } }), /500000 to 599999/);
});

test("read-only, changing and destructive commands are told apart", () => {
  assert.ok(ok({ command: "get port" }).readOnly);
  const d = ok({ command: "delete ldev", options: { "-ldev_id": 100 } });
  assert.ok(d.destructive);
  assert.ok(d.notes.some((n) => /removes configuration or data/.test(n)));
});

test("unknown command and option are reported with suggestions", () => {
  assert.match(bad({ command: "add lunn", options: {} }), /Closest: .*add lun/);
  assert.match(bad({ command: "add lun", options: { "-lunid": 1, "-port": "CL1-A-0", "-ldev_id": 1 } }), /not an option of raidcom add lun.*-lun_id/);
});

test("missing required options are errors, and strict=false turns them into warnings", () => {
  assert.match(bad({ command: "add lun", options: { "-ldev_id": 1 } }), /needs -port/);
  assert.match(bad({ command: "add ldev", options: { "-pool": 0, "-capacity": "1G" } }), /needs one of: -ldev_id/);
  const r = build(catalog, { command: "add lun", options: { "-ldev_id": 1 }, strict: false });
  assert.ok(r.ok);
  assert.ok(r.warnings.some((w) => /needs -port/.test(w)));
});

test("the right syntax form is matched", () => {
  const r = ok({ command: "add lun", options: { "-port": ["CL1-A-0"], "-grp_opt": "ldev", "-device_grp_name": ["grp1"] } });
  assert.match(r.form.title, /device group/);
  const r2 = ok({ command: "add lun", options: { "-port": ["CL1-A-0"], "-ldev_id": 5 } });
  assert.match(r2.form.title, /LDEV/);
});

test("options from different forms give a warning", () => {
  const r = build(catalog, { command: "add lun", options: { "-port": "CL1-A-0", "-ldev_id": 5, "-device_grp_name": "grp1", "-grp_opt": "ldev" } });
  assert.ok(r.ok);
  assert.ok(r.warnings.length > 0);
});

test("value counts", () => {
  assert.match(bad({ command: "add ldev", options: { "-pool": [1, 2], "-ldev_id": 5, "-capacity": "1G" } }), /takes at most 1 value/);
  assert.match(bad({ command: "add ldev", options: { "-pool": 1, "-ldev_id": [], "-capacity": "1G" } }) + "", /needs a value/);
});

test("words an option accepts only some of", () => {
  assert.match(bad({ command: "add ldev", options: { "-pool": 0, "-ldev_id": 5, "-capacity": "1G", "-status": "maybe" } }), /must be "enable_fullallocation" or "disable_fullallocation"/);
});

test("LDEV, LUN, pool and port limits follow the model", () => {
  assert.match(bad({ command: "get ldev", options: { "-ldev_id": 70000 } }), /outside 0 to 65279/);
  assert.match(bad({ command: "get ldev", options: { "-ldev_id": 20000 }, model: "B24" }), /outside 0 to 16383 for VSP One Block 24/);
  ok({ command: "get ldev", options: { "-ldev_id": 20000 }, model: "B28" });
  assert.match(bad({ command: "get ldev", options: { "-ldev_id": "100-70000" } }), /outside/);
  assert.match(bad({ command: "add lun", options: { "-port": "CL1-A-0", "-ldev_id": 1, "-lun_id": 3000 }, model: "B28" }), /outside 0 to 2047/);
  ok({ command: "add lun", options: { "-port": "CL1-A-0", "-ldev_id": 1, "-lun_id": 3000 }, model: "vsp-5000" });
  assert.match(bad({ command: "get host_grp", options: { "-port": "CL1-C" }, model: "B24" }), /port letter C is not available on VSP One Block 24/);
  assert.match(bad({ command: "get host_grp", options: { "-port": "CL9-F" }, model: "vsp-5000" }), /columns 9 to C only have ports A, B, C, D, J, K, L, M/);
  assert.match(bad({ command: "get host_grp", options: { "-port": "CL9-A" }, model: "B28" }), /port column 9 is outside/);
  assert.match(bad({ command: "get host_grp", options: { "-port": "CL1-A-300" } }), /above 254/);
  assert.match(bad({ command: "add ldev", options: { "-pool": 200, "-ldev_id": 1, "-capacity": "1G" } }), /pool ID 200 is outside 0 to 127/);
  assert.match(bad({ command: "add ldev", options: { "-pool": 80, "-ldev_id": 1, "-capacity": "1G" }, model: "B28" }), /outside 0 to 63 for VSP One Block 28/);
  ok({ command: "add ldev", options: { "-pool": "mypool", "-ldev_id": "0x10", "-capacity": "1G" } });
});

test("odd-looking values are warnings, not errors", () => {
  const r = build(catalog, { command: "get ldev", options: { "-ldev_id": "abc" } });
  assert.ok(r.ok);
  assert.ok(r.warnings.some((w) => /not a decimal number/.test(w)));
  assert.ok(build(catalog, { command: "add ldev", options: { "-pool": 0, "-ldev_id": 5, "-capacity": "big" } }).warnings.some((w) => /size/.test(w)));
  const r2 = build(catalog, { command: "get port", options: { "-port": "nonsense" } });
  assert.ok(r2.ok);
  assert.ok(r2.warnings.some((w) => /not a port name/.test(w)));
  assert.ok(build(catalog, { command: "get port", model: "bogus" }).warnings.some((w) => /Unknown model/.test(w)));
});

test("values that could be misread by a shell are refused or quoted", () => {
  for (const evil of ["a;rm -rf /", "$(id)", "`id`", "a|b", "a&b", "a>b", "x\ny", "it's", 'say "hi"', "a\\b", "{x}", "a*"]) {
    assert.match(bad({ command: "add host_grp", options: { "-port": "CL1-A", "-host_grp_name": evil } }), /not allowed/, JSON.stringify(evil));
  }
  // spaces are allowed in a name and get quoted
  assert.equal(ok({ command: "add host_grp", options: { "-port": "CL1-A", "-host_grp_name": "my host" } }).command, "raidcom add host_grp -port CL1-A -host_grp_name 'my host'");
  assert.equal(shellQuote("plain-1.2:3"), "plain-1.2:3");
  assert.equal(shellQuote("a b"), "'a b'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.match(bad({ command: "get port", global: { store: "a;b" } }), /plain file name/);
  assert.match(bad({ command: "get port", global: { instance: -1 } }), /whole number/);
});

test("options that were given twice, and unusable instance settings", () => {
  const r = build(catalog, { command: "get port", options: { "-key": "detail", key: "x" } });
  assert.ok(r.warnings.some((w) => /twice/.test(w)));
  assert.ok(build(catalog, { command: "get port", global: { pair_type: "H" } }).warnings.some((w) => /needs an instance/.test(w)));
});

test("mainframe CU:LDEV notation is accepted and range-checked", () => {
  assert.equal(ok({ command: "get ldev", options: { "-ldev_id": "dd:0f" }, global: { instance: 500 } }).command, "raidcom get ldev -ldev_id dd:0f -I500");
  assert.equal(ok({ command: "modify ldev", options: { "-ldev_id": "dd:00", "-ssid": "0014" } }).command, "raidcom modify ldev -ldev_id dd:00 -ssid 0014");
  assert.equal(build(catalog, { command: "get ldev", options: { "-ldev_id": "dd:0f" } }).warnings.length, 0);
  assert.match(bad({ command: "get ldev", options: { "-ldev_id": "ff:ff" } }), /outside 0 to 65279/);
  assert.ok(build(catalog, { command: "get ldev", options: { "-ldev_id": "dd:zz" } }).warnings.some((w) => /CU:LDEV/.test(w)));
});

test("add parity_grp accepts -emulation for mainframe parity groups", () => {
  const r = ok({ command: "add parity_grp", options: { "-parity_grp_id": "1-2", "-drive_location": ["0-1", "1-1"], "-emulation": "3390-V", "-raid_type": "6D2P" } });
  assert.match(r.command, /-emulation 3390-V/);
});
