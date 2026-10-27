import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHttpConfig, loadServerConfig, isLoopback } from "../../dist/config.js";

const TOKEN = "a".repeat(40);

test("stdio is the default", () => {
  assert.equal(loadHttpConfig({}), undefined);
  assert.equal(loadHttpConfig({ RAIDCOM_TRANSPORT: "stdio" }), undefined);
  assert.throws(() => loadHttpConfig({ RAIDCOM_TRANSPORT: "carrier-pigeon" }), /stdio or http/);
});

test("http needs a token or an explicit open flag", () => {
  assert.throws(() => loadHttpConfig({ RAIDCOM_TRANSPORT: "http" }), /RAIDCOM_HTTP_TOKEN/);
  assert.equal(loadHttpConfig({ RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_OPEN: "true" }).token, "");
  assert.throws(() => loadHttpConfig({ RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_TOKEN: "short" }), /at least 32/);
  const c = loadHttpConfig({ RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_TOKEN: TOKEN });
  assert.equal(c.port, 8361);
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.rateLimitPerMinute, 120);
});

test("non-loopback addresses need TLS or a declared proxy", () => {
  const base = { RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_TOKEN: TOKEN, RAIDCOM_HTTP_HOST: "0.0.0.0" };
  assert.throws(() => loadHttpConfig(base), /plain HTTP/);
  const c = loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true", RAIDCOM_HTTP_ALLOWED_HOSTS: "a.example.com, b.example.com", RAIDCOM_HTTP_TRUST_PROXY: "true" });
  assert.deepEqual(c.allowedHosts, ["a.example.com", "b.example.com"]);
  assert.ok(c.trustProxy);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_TLS_CERT: "/nonexistent" }), /both RAIDCOM_HTTP_TLS_CERT and RAIDCOM_HTTP_TLS_KEY/);
});

test("port and rate limit are validated", () => {
  const base = { RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_OPEN: "true" };
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_PORT: "99999" }), /port number/);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_PORT: "abc" }), /port number/);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_RATE_LIMIT: "-1" }), /requests per minute/);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_RATE_LIMIT: "0" }).rateLimitPerMinute, 0);
});

test("isLoopback", () => {
  for (const h of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) assert.ok(isLoopback(h), h);
  for (const h of ["0.0.0.0", "10.0.0.1", "example.com", "::"]) assert.ok(!isLoopback(h), h);
});

test("bundled spec paths are the default and can be overridden", () => {
  const d = loadServerConfig({});
  assert.match(d.catalogPath, /spec[\\/]raidcom-catalog\.json$/);
  assert.equal(loadServerConfig({ RAIDCOM_CATALOG: "/x.json" }).catalogPath, "/x.json");
  assert.equal(loadServerConfig({ RAIDCOM_EXAMPLES: "" }).examplesPath, "");
});
