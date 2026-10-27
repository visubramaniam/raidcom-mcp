import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog } from "./helpers.mjs";
import { parseCommandLine, splitWords } from "../../dist/cmdline.js";
import { build } from "../../dist/builder.js";

test("splitWords honours quotes", () => {
  assert.deepEqual(splitWords(`raidcom add host_grp -host_grp_name 'my host' -port "CL1-A"`), ["raidcom", "add", "host_grp", "-host_grp_name", "my host", "-port", "CL1-A"]);
  assert.equal(splitWords("a 'b"), undefined);
  assert.deepEqual(splitWords(`a ""`), ["a", ""]);
});

test("parses a plain command into a request that builds", () => {
  const p = parseCommandLine(catalog, "raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1 -IH2");
  assert.deepEqual(p.errors, []);
  assert.equal(p.request.command, "add lun");
  assert.equal(p.request.global.instance, 2);
  assert.equal(p.request.global.pair_type, "H");
  const r = build(catalog, p.request);
  assert.ok(r.ok);
  assert.equal(r.command, "raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1 -IH2");
});

test("a leading prompt and line continuations are accepted", () => {
  const p = parseCommandLine(catalog, "$ raidcom get ldev \\\n  -ldev_id 5");
  assert.deepEqual(p.errors, []);
  assert.equal(p.request.command, "get ldev");
});

test("shell operators are refused, but not inside quotes", () => {
  for (const evil of ["raidcom get port; rm -rf /", "raidcom get port | sh", "raidcom get port && id", "raidcom get port > x", "raidcom get port $(id)", "raidcom get port `id`"]) {
    const p = parseCommandLine(catalog, evil);
    assert.equal(p.request, undefined, evil);
    assert.match(p.errors[0], /shell operator/);
  }
  const q = parseCommandLine(catalog, `raidcom add host_grp -port CL1-A -host_grp_name 'a;b'`);
  assert.equal(q.errors.length, 0);
  assert.equal(build(catalog, q.request).ok, false, "the builder still refuses the value");
});

test("multiple lines, other programs and malformed lines are refused", () => {
  assert.match(parseCommandLine(catalog, "raidcom get port\nraidcom get pool").errors[0], /one raidcom command/);
  assert.match(parseCommandLine(catalog, "ls -l").errors[0], /must start with "raidcom"/);
  assert.match(parseCommandLine(catalog, "raidcom -login user pass").errors[0], /Expected/);
  assert.match(parseCommandLine(catalog, "raidcom get port 'x").errors[0], /unclosed quote/);
  assert.ok(parseCommandLine(catalog, "raidcom get nothing").errors.length > 0);
});

test("credentials after -login never reach the output", () => {
  const p = parseCommandLine(catalog, "raidcom get port -login admin s3cret");
  const all = JSON.stringify(p);
  assert.ok(!all.includes("s3cret"));
});

// ---------- regressions from the 2026-10-26 audit ----------

test("the two words after -login are always dropped, even when they look like options", () => {
  const p = parseCommandLine(catalog, "raidcom get ldev -ldev_id 1 -login admin -Hunter2pw");
  assert.ok(!JSON.stringify(p).includes("Hunter2pw"));
  assert.ok(!JSON.stringify(p).includes("admin"));
  assert.deepEqual(p.errors, []);
});

test("a bare -I is an error and a repeated option is reported", () => {
  assert.match(parseCommandLine(catalog, "raidcom get ldev -ldev_id 1 -I").errors[0], /needs an instance number/);
  assert.match(parseCommandLine(catalog, "raidcom get ldev -ldev_id 1 -ldev_id 2").warnings.join(), /given twice/);
});

test("pair types and instance numbers from a command line still pass the global checks", () => {
  const p = parseCommandLine(catalog, "raidcom get ldev -ldev_id 1 -ISI3");
  assert.equal(build(catalog, p.request).command, "raidcom get ldev -ldev_id 1 -ISI3");
});

test("repeated global options are reported, and a non-number unit is shown as written", () => {
  assert.match(parseCommandLine(catalog, "raidcom get ldev -ldev_id 1 -I0 -I1").warnings.join(), /given twice/);
  assert.match(parseCommandLine(catalog, "raidcom get ldev -ldev_id 1 -s 512345 -s 512346").warnings.join(), /given twice/);
  const p = parseCommandLine(catalog, "raidcom get ldev -ldev_id 1 -u abc");
  assert.match(build(catalog, p.request).errors.join(), /"abc"/);
});
