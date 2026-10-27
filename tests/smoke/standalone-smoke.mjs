#!/usr/bin/env node
// Smoke test for an unpacked standalone package, run with any Node.js 22+ (CI uses the package's own runtime):
//
//   node tests/smoke/standalone-smoke.mjs <unpacked package folder> <expected version>
//
// It checks that the bundled runtime runs, and that the server starts both through `runtime/node dist/index.js` (the
// command INSTALL.md gives for MCP clients) and through the bin/ launcher (`raidcom-mcp.cmd` on Windows), answers
// initialize with the right version, lists its eight tools and builds a command. Nothing is contacted.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [dir, expected] = process.argv.slice(2);
if (!dir || !expected) { console.error("usage: standalone-smoke.mjs <package folder> <expected version>"); process.exit(2); }
const windows = process.platform === "win32";
const node = join(dir, "runtime", windows ? "node.exe" : "node");
const launcher = join(dir, "bin", windows ? "raidcom-mcp.cmd" : "raidcom-mcp");
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`ok   ${msg}`);

for (const f of [node, launcher, join(dir, "dist", "index.js")]) if (!existsSync(f)) fail(`missing ${f}`);
const info = spawnSync(node, ["-p", "process.platform + ' ' + process.arch + ' ' + process.version"], { encoding: "utf8" });
if (info.status !== 0) fail(`bundled runtime didn't run: ${info.stderr}`);
ok(`bundled runtime: ${info.stdout.trim()}`);

const requests = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "raidcom_build_command", arguments: { command: "add lun", options: { "-port": ["CL1-A-0"], "-ldev_id": 200, "-lun_id": 1 }, global: { instance: 0 } } } },
];

function session(label, command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    const responses = new Map();
    let out = "", err = "";
    const done = (why) => { clearTimeout(timer); child.kill(); resolve({ responses, err, why }); };
    const timer = setTimeout(() => done("timed out after 60 s"), 60_000);
    child.on("error", (e) => done(`could not start: ${e.message}`));
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      out += d;
      let i;
      while ((i = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        responses.set(m.id, m);
        if (m.id === 1) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        if (responses.size === requests.length) done();
      }
    });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

async function check(label, command, args, options) {
  const { responses, err, why } = await session(label, command, args, options);
  if (why) fail(`${label}: ${why}\n${err}`);
  const version = responses.get(1)?.result?.serverInfo?.version;
  if (version !== expected) fail(`${label}: server reports version ${version}, expected ${expected}`);
  const n = responses.get(2)?.result?.tools?.length;
  if (n !== 8) fail(`${label}: ${n} tools listed, expected 8`);
  const text = responses.get(3)?.result?.content?.[0]?.text ?? "";
  if (!text.includes("raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1 -I0")) fail(`${label}: unexpected build result: ${text.slice(0, 200)}`);
  ok(`${label}: version ${version}, 8 tools, command built`);
}

await check("runtime/node dist/index.js", node, [join(dir, "dist", "index.js")], {});
// A .cmd file needs a shell on Windows.
await check("bin launcher", windows ? `"${launcher}"` : launcher, [], windows ? { shell: true } : {});
