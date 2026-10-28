# Deploying

raidcom-mcp runs anywhere Node.js 22.19+ runs, or without Node.js using the standalone packages or Docker. It needs no access to storage systems, no credentials and no CCI installation, and it makes no outbound network requests.

| You want | Use |
|---|---|
| Your own assistant on your own machine | [stdio](#local-over-stdio) via npm, a standalone package, the Claude Desktop extension or the Claude Code plugin |
| A shared endpoint for a team or the public | [HTTP](#hosted-over-http), usually in [Docker](#docker) behind a TLS proxy |

## Local, over stdio

**npm** (most clients):
```bash
npx -y raidcom-mcp            # or: npm install -g raidcom-mcp && raidcom-mcp
```
Claude Code: `claude mcp add raidcom -- npx -y raidcom-mcp`

Claude Desktop (`claude_desktop_config.json`):
```json
{ "mcpServers": { "raidcom": { "command": "npx", "args": ["-y", "raidcom-mcp"] } } }
```

**Claude Desktop extension.** Download `raidcom-mcp-<version>.mcpb` from the [releases](https://github.com/visubramaniam/raidcom-mcp/releases), double-click it, and click **Install**. No settings.

**Standalone packages** (no Node.js needed): `raidcom-mcp-<version>-<platform>.tar.gz|zip` for macOS, Linux and Windows on x64 and arm64. Unpack and run `bin/raidcom-mcp` (or `runtime\node.exe dist\index.js` on Windows). Check downloads against `SHA256SUMS`.

**Claude Code plugin:**
```
/plugin install raidcom-community --marketplace visubramaniam/raidcom-mcp
```
It installs the server from a lockfile and adds the `raidcom-command-builder` skill.

**From source:**
```bash
git clone https://github.com/visubramaniam/raidcom-mcp.git && cd raidcom-mcp
npm ci && npm test          # builds and runs the tests
node dist/index.js
```

## Hosted, over HTTP

Set `RAIDCOM_TRANSPORT=http`. The MCP endpoint is `/mcp` (stateless Streamable HTTP), and `/healthz` reports health. Because it's stateless, any number of instances can run behind a load balancer.

The server refuses to start with unsafe settings, so you choose explicitly:

1. **Authentication.** Either `RAIDCOM_HTTP_TOKEN` (32+ characters; clients send `Authorization: Bearer <token>`) or `RAIDCOM_HTTP_OPEN=true`.
   Connector-style clients (Claude, Microsoft 365 Copilot) can't send a fixed token; they connect unauthenticated or with OAuth, which raidcom-mcp doesn't implement. For them, run open. That's reasonable here: the server holds no secrets and can't reach any array.
2. **TLS.** Listening on anything but loopback requires `RAIDCOM_HTTP_TLS_CERT` + `RAIDCOM_HTTP_TLS_KEY`, or `RAIDCOM_HTTP_BEHIND_TLS_PROXY=true` when a proxy or load balancer ends TLS.
3. **Host names.** Add your public name to `RAIDCOM_HTTP_ALLOWED_HOSTS` (or `*`), or requests are refused with 403.
4. **Client address.** Behind a proxy, tell the server where the real client address is, so rate limits apply per user:
   - `RAIDCOM_HTTP_CLIENT_IP_HEADER=cf-connecting-ip` behind Cloudflare (or another header your proxy sets and overwrites), or
   - `RAIDCOM_HTTP_TRUST_PROXY=<number of proxies>` to count `X-Forwarded-For` entries from the right.

   Check it: `curl https://<your host>/healthz` shows `client` (should be your own address, compare `curl https://ifconfig.me`) and, by default, `forwarding` (the headers it received). Set `RAIDCOM_HTTP_DEBUG_CLIENT=false` to hide `forwarding` once it's right.

Load limits: 120 requests/minute per client (`RAIDCOM_HTTP_RATE_LIMIT`), 8 requests in progress per client and 64 in all, 256 KB bodies, 10 s for headers and 15 s for the whole request.

At startup the server logs one line with its effective settings (never the token), for example:
```
[raidcom-mcp] http: client address from the cf-connecting-ip header; rate limit 120/min per client; hosts *; TLS by the proxy in front; debug client on (...); mcprush endpoint off
```
and warns about any `RAIDCOM_` variable it doesn't recognise. Read that line whenever a setting doesn't seem to take effect.

## Docker

Each release publishes a multi-arch image (amd64, arm64):
```bash
docker run -i --rm ghcr.io/visubramaniam/raidcom-mcp:latest                     # stdio
docker run -d -p 8361:8361 \
  -e RAIDCOM_TRANSPORT=http -e RAIDCOM_HTTP_HOST=0.0.0.0 -e RAIDCOM_HTTP_OPEN=true \
  -e RAIDCOM_HTTP_BEHIND_TLS_PROXY=true -e RAIDCOM_HTTP_ALLOWED_HOSTS=raidcom.example.com \
  -e RAIDCOM_HTTP_TRUST_PROXY=1 \
  ghcr.io/visubramaniam/raidcom-mcp:latest
```
The image runs as the unprivileged `node` user, has no npm or other package managers, needs no volumes and works with a read-only root filesystem. See [README.docker.md](https://github.com/visubramaniam/raidcom-mcp/blob/main/README.docker.md) for a `docker-compose.yml`.

## Render (how the public instance runs)

A Docker web service built from the repository, with:

| Variable | Value |
|---|---|
| `RAIDCOM_TRANSPORT` | `http` |
| `RAIDCOM_HTTP_HOST` | `0.0.0.0` |
| `RAIDCOM_HTTP_PORT` | `10000` |
| `RAIDCOM_HTTP_OPEN` | `true` |
| `RAIDCOM_HTTP_BEHIND_TLS_PROXY` | `true` |
| `RAIDCOM_HTTP_ALLOWED_HOSTS` | `raidcom-mcp.onrender.com` or `*` |
| `RAIDCOM_HTTP_CLIENT_IP_HEADER` | `cf-connecting-ip` (Render sits behind Cloudflare) |

Keep the variables in **one** place. A variable on the service itself overrides the same name in a linked environment group, so editing the group can silently do nothing. See [[Troubleshooting]].

## Other platforms

Anything that runs a container or a Node.js process works: AWS ECS/Fargate or App Runner, Azure Container Apps, Google Cloud Run, Fly.io, Kubernetes. The checklist is the same: HTTP transport, TLS at the load balancer (`RAIDCOM_HTTP_BEHIND_TLS_PROXY=true`), your host name in `RAIDCOM_HTTP_ALLOWED_HOSTS`, the right client-address setting, and a health check on `/healthz`.

## Listing on mcprush

With `MCPRUSH_TOKEN` set, a second endpoint (`/mcprush`, or `RAIDCOM_HTTP_MCPRUSH_PATH`) answers only requests carrying that token in `x-mcprush-token`. Give mcprush that endpoint; `/mcp` stays as it is.
