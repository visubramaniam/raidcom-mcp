#!/usr/bin/env node
// Installs the packed .tgz into an empty folder (as a user would) and checks that the installed server starts and
// answers over stdio and HTTP. Usage: node tests/smoke/package-smoke.mjs release/raidcom-mcp-<version>.tgz <version>
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const [tgz, version] = process.argv.slice(2);
if (!tgz || !version) {
  console.error("usage: package-smoke.mjs <package.tgz> <version>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "raidcom-smoke-"));
writeFileSync(join(dir, "package.json"), "{}");
execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent", resolve(tgz)], { cwd: dir, stdio: "inherit" });
const entry = join(dir, "node_modules", "raidcom-mcp", "dist", "index.js");

function stdio() {
  return new Promise((done, fail) => {
    const c = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "inherit"] });
    const timer = setTimeout(() => { c.kill(); fail(new Error("stdio check timed out")); }, 20_000);
    const waiting = new Map();
    createInterface({ input: c.stdout }).on("line", (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
    const call = (id, method, params = {}) => new Promise((r) => { waiting.set(id, r); c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
    (async () => {
      const init = await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
      assert.equal(init.result.serverInfo.version, version, "server reports the package version");
      c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      assert.equal((await call(2, "tools/list")).result.tools.length, 8);
      const r = await call(3, "tools/call", { name: "raidcom_build_command", arguments: { command: "add lun", options: { "-port": ["CL1-A-0"], "-ldev_id": 200, "-lun_id": 1 }, global: { instance: 0 } } });
      assert.match(r.result.content[0].text, /raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1 -I0/);
      clearTimeout(timer);
      c.kill();
      done();
    })().catch((e) => { c.kill(); fail(e); });
  });
}

function http() {
  return new Promise((done, fail) => {
    const c = spawn(process.execPath, [entry], { env: { ...process.env, RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_PORT: "0", RAIDCOM_HTTP_OPEN: "true" }, stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => { c.kill(); fail(new Error("http check timed out")); }, 20_000);
    let log = "";
    c.stderr.on("data", async (d) => {
      log += d;
      const m = /listening on (http:\/\/\S+)\/mcp/.exec(log);
      if (!m) return;
      try {
        const res = await fetch(`${m[1]}/healthz`);
        assert.equal(res.status, 200);
        assert.equal((await res.json()).version, version);
        clearTimeout(timer);
        c.kill();
        done();
      } catch (e) { c.kill(); fail(e); }
    });
  });
}

await stdio();
console.log("stdio ok");
await http();
console.log("http ok");
