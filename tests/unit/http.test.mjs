import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { RateLimiter } from "../../dist/http.js";

const TOKEN = "t".repeat(40);
let child;
let base;

function start(env) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [new URL("../../dist/index.js", import.meta.url).pathname], {
      env: { ...process.env, RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_PORT: "0", ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let log = "";
    c.stderr.on("data", (d) => {
      log += d;
      const m = /listening on (http:\/\/\S+)/.exec(log);
      if (m) resolve({ c, url: m[1] });
    });
    c.once("exit", (code) => reject(new Error(`exited ${code}: ${log}`)));
  });
}

before(async () => {
  const s = await start({ RAIDCOM_HTTP_TOKEN: TOKEN, RAIDCOM_HTTP_RATE_LIMIT: "20" });
  child = s.c;
  base = s.url;
});
after(() => child?.kill());

const rpc = (body, headers = {}) =>
  fetch(base, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
const auth = { authorization: `Bearer ${TOKEN}` };

test("health needs no token", async () => {
  const r = await fetch(new URL("/healthz", base));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("token is required and checked", async () => {
  const init = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  assert.equal((await rpc(init)).status, 401);
  assert.equal((await rpc(init, { authorization: "Bearer wrong" })).status, 401);
  const ok = await rpc(init, auth);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /raidcom_build_command/);
});

test("a tool call works over HTTP and builds text only", async () => {
  const r = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "raidcom_build_command", arguments: { command: "get port" } } }, auth);
  assert.match(await r.text(), /raidcom get port/);
});

test("other paths, methods, hosts and origins are refused", async () => {
  assert.equal((await fetch(new URL("/other", base))).status, 404);
  assert.equal((await fetch(base, { headers: auth })).status, 405);
  const status = await new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { ...auth, host: "evil.example.com", "content-type": "application/json" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end("{}");
  });
  assert.equal(status, 403);
  assert.equal((await rpc({}, { ...auth, origin: "https://evil.example.com" })).status, 403);
});

test("bad bodies", async () => {
  const bad = await fetch(base, { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{nope" });
  assert.equal(bad.status, 400);
  const big = await fetch(base, { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ x: "a".repeat(300_000) }) });
  assert.equal(big.status, 413);
});

test("the rate limit answers 429", async () => {
  let last = 0;
  for (let i = 0; i < 40 && last !== 429; i++) last = (await rpc({ jsonrpc: "2.0", id: i, method: "ping" }, auth)).status;
  assert.equal(last, 429);
});

test("RateLimiter windows", () => {
  let t = 0;
  const rl = new RateLimiter(2, () => t);
  assert.ok(rl.allow("a") && rl.allow("a") && !rl.allow("a"));
  assert.ok(rl.allow("b"));
  t = 60_001;
  assert.ok(rl.allow("a"));
  assert.ok(new RateLimiter(0).allow("x"));
});

test("an open endpoint must be asked for", async () => {
  await assert.rejects(start({ RAIDCOM_HTTP_TOKEN: "" }), /RAIDCOM_HTTP_TOKEN/);
  const s = await start({ RAIDCOM_HTTP_OPEN: "true" });
  try {
    const r = await fetch(s.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(r.status, 200);
  } finally {
    s.c.kill();
  }
});
