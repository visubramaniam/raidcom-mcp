import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHttpConfig, loadServerConfig, isLoopback, unknownSettings, describeHttp } from "../../dist/config.js";

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
  assert.equal(c.trustProxy, 1);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true", RAIDCOM_HTTP_TRUST_PROXY: "3" }).trustProxy, 3);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true", RAIDCOM_HTTP_TRUST_PROXY: "false" }).trustProxy, 0);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true" }).trustProxy, 0);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true", RAIDCOM_HTTP_TRUST_PROXY: "yes" }), /number of proxies/);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true", RAIDCOM_HTTP_CLIENT_IP_HEADER: "CF-Connecting-IP" }).clientIpHeader, "cf-connecting-ip");
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true", RAIDCOM_HTTP_CLIENT_IP_HEADER: "x y" }), /header name/);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true", RAIDCOM_HTTP_DEBUG_CLIENT: "true" }).debugClient, true);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_TLS_CERT: "/nonexistent" }), /both RAIDCOM_HTTP_TLS_CERT and RAIDCOM_HTTP_TLS_KEY/);
});

test("port and rate limit are validated", () => {
  const base = { RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_OPEN: "true" };
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_PORT: "99999" }), /port number/);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_PORT: "abc" }), /port number/);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_RATE_LIMIT: "-1" }), /requests per minute/);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_RATE_LIMIT: "0" }).rateLimitPerMinute, 0);
});

test("values are trimmed and true/false settings ignore case; anything else is an error", () => {
  const base = { RAIDCOM_TRANSPORT: " http\n", RAIDCOM_HTTP_OPEN: "True " };
  const c = loadHttpConfig({ ...base, RAIDCOM_HTTP_DEBUG_CLIENT: "true\n", RAIDCOM_HTTP_CLIENT_IP_HEADER: " cf-connecting-ip ", RAIDCOM_HTTP_PORT: " 10000 ", RAIDCOM_HTTP_TRUST_PROXY: "TRUE" });
  assert.equal(c.token, "");
  assert.equal(c.debugClient, true);
  assert.equal(c.clientIpHeader, "cf-connecting-ip");
  assert.equal(c.port, 10000);
  assert.equal(c.trustProxy, 1);
  assert.throws(() => loadHttpConfig({ ...base, RAIDCOM_HTTP_DEBUG_CLIENT: "yes" }), /must be true or false/);
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_DEBUG_CLIENT: "FALSE" }).debugClient, false);
  assert.equal(loadHttpConfig(base).debugClient, true, "on unless turned off");
  assert.equal(loadHttpConfig({ ...base, RAIDCOM_HTTP_DEBUG_CLIENT: " " }).debugClient, true);
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

test("unknown or mistyped RAIDCOM_ settings are reported by name, never with their value", () => {
  const w = unknownSettings({ "RAIDCOM_HTTP_DEBUG_CLIENT ": "true", RAIDCOM_HTTP_DEBUG_CLlENT: "true", raidcom_http_open: "true", RAIDCOM_HTTP_OPEN: "true", RAIDCOM_HTTP_TOKEN: "s3cret-s3cret", PATH: "/bin", RAIDCOM_SOMETHING_ELSE_ENTIRELY: "x" });
  assert.equal(w.length, 4, w.join("\n"));
  assert.match(w[0], /"RAIDCOM_HTTP_DEBUG_CLIENT ".*differs from RAIDCOM_HTTP_DEBUG_CLIENT only in spaces or case/);
  assert.match(w[1], /Did you mean RAIDCOM_HTTP_DEBUG_CLIENT/);
  assert.match(w[2], /only in spaces or case/);
  assert.doesNotMatch(w.join(), /s3cret|true/);
});

test("the HTTP summary line describes the proxy settings and never the token", () => {
  const c = loadHttpConfig({ RAIDCOM_TRANSPORT: "http", RAIDCOM_HTTP_TOKEN: "t".repeat(40), RAIDCOM_HTTP_CLIENT_IP_HEADER: "cf-connecting-ip", RAIDCOM_HTTP_DEBUG_CLIENT: "true" });
  const line = describeHttp(c);
  assert.match(line, /client address from the cf-connecting-ip header/);
  assert.match(line, /debug client on/);
  assert.doesNotMatch(line, /tttt/);
});
