# Installing raidcom-mcp

raidcom-mcp only builds command text. It needs no access to a storage system, no credentials and no CCI installation.

## Requirements

Node.js 22.19 or later (`node --version`), or Docker.

## From source

```
git clone https://github.com/visubramaniam/raidcom-mcp.git
cd raidcom-mcp
npm ci
npm test
```

`npm test` builds the server, runs the unit tests and the search evaluation.

## Connect it to Claude

### Claude Code

```
claude mcp add raidcom -- node /absolute/path/to/raidcom-mcp/dist/index.js
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit config) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "raidcom": { "command": "node", "args": ["/absolute/path/to/raidcom-mcp/dist/index.js"] }
  }
}
```

### Other MCP clients

Any client that starts a stdio server can run `node dist/index.js`. Clients that speak Streamable HTTP can use the hosted mode below.

## Docker

```
docker build -t raidcom-mcp .
docker run -i --rm raidcom-mcp                    # MCP over stdio
```

See [README.docker.md](README.docker.md) for hosting.

## Run over HTTP

```
export RAIDCOM_TRANSPORT=http
export RAIDCOM_HTTP_TOKEN=$(openssl rand -hex 32)
node dist/index.js
# [raidcom-mcp] ready: ... listening on http://127.0.0.1:8361/mcp
```

The transport is stateless: every request is independent, so any number of instances can sit behind a load balancer. Clients send `Authorization: Bearer <token>`.

Which settings are required depends on where it listens:

- **Loopback only** (the default `127.0.0.1`): a token, or `RAIDCOM_HTTP_OPEN=true`.
- **Reachable by other machines**: also TLS. Either give the server a certificate (`RAIDCOM_HTTP_TLS_CERT`, `RAIDCOM_HTTP_TLS_KEY`) or put it behind a reverse proxy or load balancer that ends TLS and set `RAIDCOM_HTTP_BEHIND_TLS_PROXY=true`.
- **A public name**: list it in `RAIDCOM_HTTP_ALLOWED_HOSTS` (for example `raidcom.example.com`), or requests are refused with 403 to defend against DNS rebinding.
- **Behind a proxy**: set `RAIDCOM_HTTP_TRUST_PROXY=true` so the rate limit sees the real client address, and only then.

A public service that anyone may use can run with `RAIDCOM_HTTP_OPEN=true`: the server holds no secrets and cannot reach any array, so the risk is limited to load, which the rate limit and the 256 KB body limit bound.

### Check that it works

```
curl http://127.0.0.1:8361/healthz
curl -s http://127.0.0.1:8361/mcp -H "Authorization: Bearer $RAIDCOM_HTTP_TOKEN" \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You can also explore it with the MCP Inspector: `npm run inspect`.

## Running the commands it builds

raidcom-mcp does not run them. On a host with CCI installed and a running HORCM instance (see the `raidcom://notes/horcm-setup` resource), review the command or script and run it there. Scripts read credentials from `$RAIDCOM_USER` and `$RAIDCOM_PASSWORD` in your shell when built with `login: true`; they are never written into the script.

## Upgrading and uninstalling

`git pull && npm ci && npm test`. To uninstall, remove the MCP entry from your client and delete the folder.
