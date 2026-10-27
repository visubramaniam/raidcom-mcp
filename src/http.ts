// Streamable HTTP transport (RAIDCOM_TRANSPORT=http), stateless: every POST to /mcp gets its own MCP server and
// transport, which answer over an SSE stream and close with the response. The tools keep no per-client state, so
// there are no sessions to track or expire, and any number of instances can sit behind a load balancer.
//
// The checks run before the MCP layer sees a request, in this order: path (and /healthz), Host and Origin (against
// DNS rebinding and browser pages driving a local server), the rate limit, the bearer token, method, then body size.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { VERSION, type HttpConfig } from "./config.js";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/healthz";
/** Largest request body accepted: tool arguments are small. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Requests handled at once; more get 503. */
export const MAX_CONCURRENT = 64;
/** Requests one client address may have in progress at once, so a single client can't take every slot. */
export const MAX_PER_CLIENT = 8;
/** A client has this long to send its headers, and this long to send the whole request (ms). */
export const HEADERS_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 15_000;
/** Client addresses the rate limiter remembers at most. */
const MAX_TRACKED = 10_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Compares the Authorization header with the token in constant time (hashed first, so length doesn't leak). */
function authorized(header: string | undefined, token: Buffer): boolean {
  const m = /^Bearer[ \t]+(\S+)\s*$/i.exec(header ?? "");
  return !!m && timingSafeEqual(digest(m[1]), token);
}

/** The Host header values that name this server: loopback names for the port in use, plus any configured. */
function hostNames(cfg: HttpConfig, port: number): Set<string> {
  const names = ["localhost", "127.0.0.1", "[::1]"];
  if (!names.includes(cfg.host) && cfg.host !== "0.0.0.0" && cfg.host !== "::") names.push(cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host);
  return new Set([...names.map((n) => `${n}:${port}`), ...cfg.allowedHosts].map((h) => h.toLowerCase()));
}

function reject(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

class TooLarge extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Fixed-window request counter per client address. */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(private perMinute: number, private now: () => number = Date.now) {}

  /** Number of client addresses currently remembered (for tests). */
  get size(): number {
    return this.hits.size;
  }

  /** True when the request is allowed. */
  allow(key: string): boolean {
    if (this.perMinute <= 0) return true;
    const t = this.now();
    if (this.hits.size >= MAX_TRACKED) {
      for (const [k, v] of this.hits) if (t - v.start >= 60_000) this.hits.delete(k);
      // still full: forget the oldest windows (a Map iterates in insertion order), so memory stays bounded and the
      // sweep above runs rarely
      if (this.hits.size >= MAX_TRACKED) for (const k of [...this.hits.keys()].slice(0, MAX_TRACKED / 2)) this.hits.delete(k);
    }
    const h = this.hits.get(key);
    if (!h || t - h.start >= 60_000) {
      this.hits.set(key, { start: t, count: 1 });
      return true;
    }
    return ++h.count <= this.perMinute;
  }
}

/**
 * The client's address. Behind a trusted proxy it is the rightmost X-Forwarded-For entry: the one the proxy itself
 * added. Entries to its left come from the client and can say anything.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const last = (Array.isArray(xff) ? xff.at(-1) : xff)?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Starts listening, over HTTPS when a certificate is set; resolves once the port is open, with the URL clients should use. */
export async function startHttp(cfg: HttpConfig, createServer: () => Server): Promise<{ url: string; server: HttpServer }> {
  const token = cfg.token ? digest(cfg.token) : undefined;
  const origins = new Set(cfg.allowedOrigins.map((o) => o.toLowerCase()));
  const anyOrigin = origins.has("*");
  let hosts = new Set<string>();
  const anyHost = cfg.allowedHosts.includes("*");
  const limiter = new RateLimiter(cfg.rateLimitPerMinute);
  let active = 0;
  const perClient = new Map<string, number>();

  const refuse = (req: IncomingMessage, res: ServerResponse, status: number, message: string, headers?: Record<string, string>) => {
    console.error(`[raidcom-mcp] refused ${req.method} ${req.url} from ${clientAddress(req, cfg.trustProxy)}: ${status} ${message}`);
    reject(res, status, message, headers);
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === HEALTH_PATH && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : JSON.stringify({ status: "ok", version: VERSION }));
    }
    if (path !== MCP_PATH) return reject(res, 404, `Not found. The MCP endpoint is ${MCP_PATH}.`);
    if (!anyHost && !hosts.has((req.headers.host ?? "").toLowerCase())) return refuse(req, res, 403, "Host not allowed. Add it to RAIDCOM_HTTP_ALLOWED_HOSTS if this name should reach the server.");
    const origin = req.headers.origin;
    if (origin !== undefined && !anyOrigin && !origins.has(origin.toLowerCase())) return refuse(req, res, 403, "Origin not allowed. Add it to RAIDCOM_HTTP_ALLOWED_ORIGINS if this page should reach the server.");
    const client = clientAddress(req, cfg.trustProxy);
    if (!limiter.allow(client)) return refuse(req, res, 429, "Too many requests. Try again in a minute.", { "retry-after": "60" });
    if (token && !authorized(req.headers.authorization, token)) return refuse(req, res, 401, "Missing or wrong bearer token.", { "www-authenticate": 'Bearer realm="raidcom-mcp"' });
    // Stateless: no standalone SSE stream (GET) and no session to end (DELETE).
    if (req.method !== "POST") return reject(res, 405, "Method not allowed. Send MCP requests with POST.", { allow: "POST" });
    if (active >= MAX_CONCURRENT) return reject(res, 503, "Too many requests in progress. Try again shortly.", { "retry-after": "1" });
    const mine = perClient.get(client) ?? 0;
    if (mine >= MAX_PER_CLIENT) return refuse(req, res, 429, "Too many requests in progress from this address. Try again shortly.", { "retry-after": "1" });

    active++;
    perClient.set(client, mine + 1);
    res.on("close", () => {
      active--;
      const n = (perClient.get(client) ?? 1) - 1;
      if (n > 0) perClient.set(client, n);
      else perClient.delete(client);
    });
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      return e instanceof TooLarge
        ? reject(res, 413, `Request body larger than ${MAX_BODY_BYTES} bytes.`, { connection: "close" })
        : reject(res, 400, "Request body is not valid JSON.");
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error(`[raidcom-mcp] error handling request: ${(e as Error).message}`);
      if (!res.headersSent) reject(res, 500, "Internal server error.");
    }
  };
  // A client that sends its request slowly would otherwise hold a slot for Node's default of five minutes. The
  // timeouts are checked every second rather than Node's default of every 30 seconds.
  const timeouts = { headersTimeout: HEADERS_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS, connectionsCheckingInterval: 1_000 };
  const http: HttpServer = cfg.tls ? createHttpsServer({ ...timeouts, cert: cfg.tls.cert, key: cfg.tls.key }, handler) : createHttpServer(timeouts, handler);

  await new Promise<void>((resolve, rej) => {
    http.once("error", rej);
    http.listen(cfg.port, cfg.host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  hosts = hostNames(cfg, port);
  const shown = cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host;
  return { url: `${cfg.tls ? "https" : "http"}://${shown}:${port}${MCP_PATH}`, server: http };
}
