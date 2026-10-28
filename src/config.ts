// Server settings, read once from the environment, and helpers for the bundled data files.
import { existsSync, readFileSync } from "node:fs";
import { createSecureContext } from "node:tls";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Path of a file bundled with the server (spec/, package.json). */
export const bundled = (...parts: string[]) => join(root, ...parts);

/** Reads a JSON file, naming the file in the error if it cannot be parsed. */
export function loadJson<T>(path: string, what: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    throw new Error(`[raidcom-mcp] cannot read ${what} at ${path}: ${(e as Error).message}`);
  }
}

/** Like loadJson, but returns `fallback` when the path is empty or the file does not exist. */
export function loadOptionalJson<T>(path: string | undefined, what: string, fallback: T): T {
  return path && existsSync(path) ? loadJson<T>(path, what) : fallback;
}

export const VERSION: string = loadJson<{ version: string }>(bundled("package.json"), "package.json").version;

export interface ServerConfig {
  catalogPath: string;
  limitsPath: string;
  recipesPath: string;
  examplesPath: string;
}

export function loadServerConfig(env = process.env): ServerConfig {
  return {
    catalogPath: env.RAIDCOM_CATALOG || bundled("spec", "raidcom-catalog.json"),
    limitsPath: env.RAIDCOM_LIMITS || bundled("spec", "limits.json"),
    recipesPath: env.RAIDCOM_RECIPES || bundled("spec", "recipes.json"),
    // An empty RAIDCOM_EXAMPLES turns the example questions off.
    examplesPath: env.RAIDCOM_EXAMPLES ?? bundled("spec", "examples.json"),
  };
}

/** Settings for RAIDCOM_TRANSPORT=http; undefined when the server runs over stdio. */
export interface HttpConfig {
  host: string;
  /** 0 asks the OS for a free port; the port in use is logged at startup. */
  port: number;
  /** Bearer token clients must send. Empty means the endpoint is open, which needs RAIDCOM_HTTP_OPEN=true. */
  token: string;
  /** Extra Host header values to accept, beyond the loopback names for the port in use. Required for a public name. */
  allowedHosts: string[];
  /** Origin header values to accept. Requests with any other Origin are refused; most MCP clients send none. */
  allowedOrigins: string[];
  /** Certificate chain and private key (PEM): the server then speaks HTTPS itself. */
  tls?: { cert: Buffer; key: Buffer };
  /** TLS is ended by a reverse proxy or load balancer in front of this server. */
  behindTlsProxy: boolean;
  /** Requests per minute per client address (0 = no limit). */
  rateLimitPerMinute: number;
  /**
   * Number of proxies in front of the server that add to X-Forwarded-For (0: don't read the header). The client
   * address is the entry that many places from the right: the one the outermost trusted proxy added.
   */
  trustProxy: number;
  /**
   * A header that a trusted proxy sets to the client's address, such as cf-connecting-ip behind Cloudflare. Takes
   * precedence over X-Forwarded-For. Only set it when every request passes through that proxy, which overwrites
   * whatever the client sent in the header.
   */
  clientIpHeader?: string;
  /** /healthz also shows the forwarding headers it received, to find the right proxy settings. */
  debugClient: boolean;
}

const MIN_TOKEN_LENGTH = 32;

/** RAIDCOM_HTTP_CLIENT_IP_HEADER: a header name, lower-cased. */
function clientHeader(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(v)) throw new Error(`[raidcom-mcp] RAIDCOM_HTTP_CLIENT_IP_HEADER must be a header name such as cf-connecting-ip, not "${v}"`);
  return v.toLowerCase();
}

/** RAIDCOM_HTTP_TRUST_PROXY: unset or false → 0, true → 1, or a number of proxies from 1 to 10. */
function proxyHops(v: string | undefined): number {
  if (v === undefined || v === "" || v === "false" || v === "0") return 0;
  if (v === "true") return 1;
  if (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 10) return Number(v);
  throw new Error(`[raidcom-mcp] RAIDCOM_HTTP_TRUST_PROXY must be true, false or the number of proxies in front of the server (1 to 10), not "${v}"`);
}
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** True for addresses that only this machine can reach. */
export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Reads the TLS certificate and key, checking that they are valid PEM and belong together. */
function loadTls(env: NodeJS.ProcessEnv): HttpConfig["tls"] {
  const certPath = env.RAIDCOM_HTTP_TLS_CERT;
  const keyPath = env.RAIDCOM_HTTP_TLS_KEY;
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) throw new Error("[raidcom-mcp] Set both RAIDCOM_HTTP_TLS_CERT and RAIDCOM_HTTP_TLS_KEY to serve HTTPS, or neither");
  const read = (path: string, what: string) => {
    try {
      return readFileSync(path);
    } catch (e) {
      throw new Error(`[raidcom-mcp] cannot read the TLS ${what} at ${path}: ${(e as Error).message}`);
    }
  };
  const tls = { cert: read(certPath, "certificate"), key: read(keyPath, "key") };
  try {
    createSecureContext(tls);
  } catch (e) {
    throw new Error(`[raidcom-mcp] RAIDCOM_HTTP_TLS_CERT and RAIDCOM_HTTP_TLS_KEY are not a usable certificate and key: ${(e as Error).message}`);
  }
  return tls;
}

/**
 * Reads the transport settings. The server only builds text, so it holds no secrets, but a public endpoint is
 * still guarded: a bearer token (or an explicit RAIDCOM_HTTP_OPEN=true), TLS for any address other machines can
 * reach, and a per-client rate limit.
 */
export function loadHttpConfig(env = process.env): HttpConfig | undefined {
  const transport = (env.RAIDCOM_TRANSPORT || "stdio").toLowerCase();
  if (transport === "stdio") return undefined;
  if (transport !== "http") throw new Error(`[raidcom-mcp] RAIDCOM_TRANSPORT must be stdio or http, not "${env.RAIDCOM_TRANSPORT}"`);
  const host = env.RAIDCOM_HTTP_HOST || "127.0.0.1";
  const port = Number(env.RAIDCOM_HTTP_PORT ?? 8361);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`[raidcom-mcp] RAIDCOM_HTTP_PORT must be a port number, not "${env.RAIDCOM_HTTP_PORT}"`);
  const token = env.RAIDCOM_HTTP_TOKEN ?? "";
  const open = env.RAIDCOM_HTTP_OPEN === "true";
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`[raidcom-mcp] RAIDCOM_HTTP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters. Generate one with: openssl rand -hex 32`);
  }
  if (!token && !open) {
    throw new Error(
      `[raidcom-mcp] RAIDCOM_TRANSPORT=http needs RAIDCOM_HTTP_TOKEN (clients send it as "Authorization: Bearer <token>"; generate one with: openssl rand -hex 32), ` +
        `or RAIDCOM_HTTP_OPEN=true to serve anyone who can reach the port. The server only builds command text, so an open endpoint is a choice, not a risk to your arrays.`,
    );
  }
  const tls = loadTls(env);
  const behindTlsProxy = env.RAIDCOM_HTTP_BEHIND_TLS_PROXY === "true";
  if (!isLoopback(host) && !tls && !behindTlsProxy) {
    throw new Error(
      `[raidcom-mcp] RAIDCOM_HTTP_HOST=${host} would accept connections from other machines over plain HTTP. ` +
        `Set RAIDCOM_HTTP_TLS_CERT and RAIDCOM_HTTP_TLS_KEY to serve HTTPS, or RAIDCOM_HTTP_BEHIND_TLS_PROXY=true if a proxy or load balancer ends TLS in front of this server.`,
    );
  }
  const rate = Number(env.RAIDCOM_HTTP_RATE_LIMIT ?? 120);
  if (!Number.isFinite(rate) || rate < 0) throw new Error(`[raidcom-mcp] RAIDCOM_HTTP_RATE_LIMIT must be a number of requests per minute (0 for none), not "${env.RAIDCOM_HTTP_RATE_LIMIT}"`);
  return {
    host,
    port,
    token,
    allowedHosts: list(env.RAIDCOM_HTTP_ALLOWED_HOSTS),
    allowedOrigins: list(env.RAIDCOM_HTTP_ALLOWED_ORIGINS),
    tls,
    behindTlsProxy,
    rateLimitPerMinute: Math.floor(rate),
    trustProxy: proxyHops(env.RAIDCOM_HTTP_TRUST_PROXY),
    clientIpHeader: clientHeader(env.RAIDCOM_HTTP_CLIENT_IP_HEADER),
    debugClient: env.RAIDCOM_HTTP_DEBUG_CLIENT === "true",
  };
}
