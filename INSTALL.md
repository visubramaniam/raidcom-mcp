# Installing raidcom-mcp

raidcom-mcp only builds command text. It needs no access to a storage system, no credentials and no CCI installation.

## Choose an install method

The quickest way needs no install at all: connect your client to the public instance at `https://raidcom-mcp.onrender.com/mcp` (see [Use the hosted server](README.md#use-the-hosted-server)). To run it yourself, every release on GitHub has these files, with `SHA256SUMS` to check them:

| You use | Install with | Needs Node.js? |
|---|---|---|
| Claude (desktop or web), Microsoft 365 Copilot, GitHub Copilot | the [hosted server](README.md#use-the-hosted-server), as a connector | No |
| Claude Desktop | the [`.mcpb` extension](#claude-desktop-extension-mcpb) | No (Claude Desktop brings its own) |
| Claude Code | the [plugin](#claude-code-plugin) | Yes, 22.19 or later |
| Any MCP client, no Node.js installed | a [standalone package](#standalone-package) | No |
| Any MCP client, with Node.js | the [npm package](#from-the-npm-package) or [from source](#from-source) | Yes, 22.19 or later |
| A server for others to use | [Docker](#docker) or [HTTP](#run-over-http) | No |

### Verify your download

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

On macOS, use `shasum -a 256 -c SHA256SUMS --ignore-missing`; on Windows, compare `Get-FileHash <file>` with the line in `SHA256SUMS`.

## Claude Desktop extension (.mcpb)

1. Download `raidcom-mcp-<version>.mcpb`.
2. Open it, either by double-clicking it or by dragging it onto Claude Desktop.
3. Click **Install**, then enable the extension. There are no settings to fill in.

The extension runs with the Node.js built into Claude Desktop. To remove it, go to **Settings → Extensions**.

### Add the command-builder skill (optional)

The `raidcom-command-builder` skill guides Claude through finding a command, building it, and showing it with its warnings. The Claude Code plugin includes it. For Claude Desktop or claude.ai, download `raidcom-command-builder-<version>.zip` from the same release (don't unzip it) and upload it under **Settings → Capabilities → Skills**. Skills need a Pro, Max, Team or Enterprise plan with code execution turned on.

## Standalone package

Each standalone package contains the server and its own Node.js runtime:

| System | Package |
|---|---|
| macOS, Apple silicon | `raidcom-mcp-<version>-darwin-arm64.tar.gz` |
| macOS, Intel | `raidcom-mcp-<version>-darwin-x64.tar.gz` |
| Linux, x64 | `raidcom-mcp-<version>-linux-x64.tar.gz` |
| Linux, arm64 | `raidcom-mcp-<version>-linux-arm64.tar.gz` |
| Windows, x64 | `raidcom-mcp-<version>-win-x64.zip` |
| Windows, arm64 | `raidcom-mcp-<version>-win-arm64.zip` |

The Linux packages need glibc 2.28 or later (RHEL/Rocky 8+, Debian 10+, Ubuntu 20.04+). On Alpine Linux, use [Docker](#docker) or the npm package.

### macOS and Linux

```bash
sudo tar -xzf raidcom-mcp-<version>-linux-x64.tar.gz -C /opt
sudo ln -sf /opt/raidcom-mcp-<version>-linux-x64/bin/raidcom-mcp /usr/local/bin/raidcom-mcp
```

The server command is then `/usr/local/bin/raidcom-mcp`. The launcher follows the symlink to find its runtime.

### Windows

Unzip the archive to a folder such as `C:\Program Files\raidcom-mcp`. The server is started by its bundled `runtime\node.exe` running `dist\index.js`:

```powershell
& "C:\Program Files\raidcom-mcp\raidcom-mcp-<version>-win-x64\runtime\node.exe" "C:\Program Files\raidcom-mcp\raidcom-mcp-<version>-win-x64\dist\index.js"
```

From a Command Prompt you can also run `bin\raidcom-mcp.cmd`. In MCP client configs use `node.exe` and `index.js` as shown above, because clients often can't start `.cmd` files directly.

## Claude Code plugin

```
/plugin install raidcom-community --marketplace visubramaniam/raidcom-mcp
```

See [README.plugin.md](README.plugin.md).

## From the npm package

Most MCP clients can start it with `npx`, which downloads the package on first use:

```bash
npx -y raidcom-mcp   # MCP over stdio
```

Or install it once:

```bash
npm install -g raidcom-mcp
raidcom-mcp
```

Requires Node.js 22.19 or later (`node --version`).

## From source

```
git clone https://github.com/visubramaniam/raidcom-mcp.git
cd raidcom-mcp
npm ci
npm test
```

`npm test` builds the server, runs the unit tests and the search evaluation.

## Connect it to Claude

The examples use the npm package. For a source checkout, use `node /absolute/path/to/raidcom-mcp/dist/index.js` instead of `npx -y raidcom-mcp`; for a standalone package, use the launcher or `runtime/node dist/index.js` from the package folder.

### Claude Code

```
claude mcp add raidcom -- npx -y raidcom-mcp
```

Or connect to a server running over HTTP: `claude mcp add --transport http raidcom https://raidcom-mcp.onrender.com/mcp`.

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit config) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "raidcom": { "command": "npx", "args": ["-y", "raidcom-mcp"] }
  }
}
```

Or install the [`.mcpb` extension](#claude-desktop-extension-mcpb), or add a server running over HTTP as a custom connector (Settings → Connectors → Add custom connector).

### Other MCP clients

Any client that starts a stdio server can run `npx -y raidcom-mcp`. Clients that speak Streamable HTTP (GitHub Copilot in VS Code, Copilot Studio) can connect to a server running over HTTP; see [Use the hosted server](README.md#use-the-hosted-server) for their steps.

## Docker

Each release pushes a multi-arch image to `ghcr.io/visubramaniam/raidcom-mcp` (and Docker Hub, when configured). To build it yourself:

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

Clients that add servers as connectors (Claude, Microsoft 365 Copilot) can't send a fixed token: they connect without authentication or through OAuth, which this server doesn't implement. For them, leave out the token and set `RAIDCOM_HTTP_OPEN=true`.

Which settings are required depends on where it listens:

- **Loopback only** (the default `127.0.0.1`): a token, or `RAIDCOM_HTTP_OPEN=true`.
- **Reachable by other machines**: also TLS. Either give the server a certificate (`RAIDCOM_HTTP_TLS_CERT`, `RAIDCOM_HTTP_TLS_KEY`) or put it behind a reverse proxy or load balancer that ends TLS and set `RAIDCOM_HTTP_BEHIND_TLS_PROXY=true`.
- **A public name**: list it in `RAIDCOM_HTTP_ALLOWED_HOSTS` (for example `raidcom.example.com`), or requests are refused with 403 to defend against DNS rebinding.
- **Behind a proxy**: tell the server where to find the client's address, so the rate limits apply per user rather than per proxy. Use one of:
  - `RAIDCOM_HTTP_CLIENT_IP_HEADER`: a header the proxy sets to the client's address and overwrites on every request. Behind Cloudflare (Render, for example) that's `cf-connecting-ip`. This is the most reliable choice when your proxy has such a header.
  - `RAIDCOM_HTTP_TRUST_PROXY`: the number of proxies in front of the server (`true` means one). Each proxy adds an entry to `X-Forwarded-For`; the server takes the entry that many places from the right and ignores entries further left, which the client could have written. Too low a number makes every user look like the same proxy; too high lets a client choose its own address. Platforms with a CDN in front may not have a fixed number.

  To check, open `/healthz`. Behind a proxy it shows `client`, which should be your own public address (compare with `curl https://ifconfig.me`), and `forwarding`, the forwarding headers the server received. Set `RAIDCOM_HTTP_DEBUG_CLIENT=false` to leave `forwarding` out once the settings are right. The startup log also has a line starting `[raidcom-mcp] http:` that says where the client address comes from.

A public service that anyone may use can run with `RAIDCOM_HTTP_OPEN=true`: the server holds no secrets and cannot reach any array, so the risk is limited to load. The rate limit, the limit of 8 requests in progress per client, the request timeouts and the 256 KB body limit bound it.

### Hosting on Render

The public instance runs on Render as a Docker web service built from this repository. Its settings:

| Variable | Value |
|---|---|
| `RAIDCOM_TRANSPORT` | `http` |
| `RAIDCOM_HTTP_HOST` | `0.0.0.0` |
| `RAIDCOM_HTTP_PORT` | `10000` (Render's default port) |
| `RAIDCOM_HTTP_OPEN` | `true` |
| `RAIDCOM_HTTP_BEHIND_TLS_PROXY` | `true` |
| `RAIDCOM_HTTP_ALLOWED_HOSTS` | `raidcom-mcp.onrender.com` (or `*`) |
| `RAIDCOM_HTTP_CLIENT_IP_HEADER` | `cf-connecting-ip` |

To list the server on the [mcprush](https://mcprush.com) marketplace, also set `MCPRUSH_TOKEN` to the token mcprush issues and give mcprush the endpoint `https://raidcom-mcp.onrender.com/mcprush`. That endpoint answers only mcprush; `/mcp` stays open as before.

Set them in one place: either on the service's own **Environment** page, or in an environment group linked to the service. A variable set on the service itself overrides the same name in a linked group, so a value edited in the group can silently have no effect. If a change doesn't seem to apply, check the `[raidcom-mcp] http:` line in the deploy log.

### Check that it works

```
curl http://127.0.0.1:8361/healthz      # {"status":"ok","version":"..."}
curl -s http://127.0.0.1:8361/mcp -H "Authorization: Bearer $RAIDCOM_HTTP_TOKEN" \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You can also explore it with the MCP Inspector: `npm run inspect`.

## Running the commands it builds

raidcom-mcp does not run them. On a host with CCI installed and a running HORCM instance (see the `raidcom://notes/horcm-setup` resource), review the command or script and run it there. Scripts read credentials from `$RAIDCOM_USER` and `$RAIDCOM_PASSWORD` in your shell when built with `login: true`; they are never written into the script.

## Upgrading and uninstalling

| Installed with | Upgrade | Uninstall |
|---|---|---|
| Hosted server | Nothing to do | Remove the connector from your client |
| `npx` | Runs the latest version on each start (clear the npx cache to force it) | Remove the MCP entry from your client |
| `npm install -g` | `npm install -g raidcom-mcp@latest` | `npm uninstall -g raidcom-mcp` |
| `.mcpb` extension | Install the new release's `.mcpb` | Settings → Extensions |
| Claude Code plugin | `claude plugin update raidcom-community@raidcom-community` | `claude plugin uninstall raidcom-community@raidcom-community` |
| Standalone package | Unpack the new release next to the old one and update the path | Delete the folder |
| Source | `git pull && npm ci && npm test` | Delete the folder |
