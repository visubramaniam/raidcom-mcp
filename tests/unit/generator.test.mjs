// Runs the catalogue generator on a tiny synthetic "manual" so a change to the parser is caught without the PDF.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FIXTURE = `
Chapter 2: raidcom commands

raidcom add widget

Creates a widget on the storage system.

Syntax
raidcom add widget -port <port> [ <host group name> ] -size <value>

Options and parameters
-port <port>
    Specifies the port name.
-size <value>
    Specifies the size.

Examples
raidcom add widget -port CL1-A -size 10

raidcom get widget

Displays widgets.

Syntax
raidcom get widget [-key <keyword>]

Options and parameters
-key <keyword>
    Specifies a keyword.

Examples
raidcom get widget
`;

test("generates a catalogue from synthetic text", () => {
  const dir = mkdtempSync(join(tmpdir(), "gen-"));
  const input = join(dir, "ref.txt");
  const out = join(dir, "catalog.json");
  writeFileSync(input, FIXTURE);
  const script = new URL("../../scripts/generate-catalog.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, input, "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const cat = JSON.parse(readFileSync(out, "utf8"));
  const cmds = cat.commands ?? cat;
  const names = Array.isArray(cmds) ? cmds.map((c) => `${c.action} ${c.object}`) : Object.keys(cmds);
  assert.ok(names.includes("add widget") && names.includes("get widget"), names.join(","));
});

test("fails loudly when the input has no commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "gen-"));
  const input = join(dir, "empty.txt");
  writeFileSync(input, "nothing here\n");
  const script = new URL("../../scripts/generate-catalog.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, input, "--out", join(dir, "o.json")], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
});
