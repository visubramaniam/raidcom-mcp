# Running raidcom-mcp with Docker

## Get the image

Each release pushes a multi-arch image (amd64, arm64) to GitHub Container Registry:

```
docker pull ghcr.io/visubramaniam/raidcom-mcp:latest
```

Or build it from this repository:

```
docker build -t raidcom-mcp .
```

The examples below use the local name `raidcom-mcp`; use `ghcr.io/visubramaniam/raidcom-mcp:latest` for the published image.

## Stdio (a local client)

```
docker run -i --rm raidcom-mcp
```

## Hosted over HTTP

Behind a reverse proxy that ends TLS, with a token (for clients that can send one):

```
docker run -d --name raidcom-mcp -p 8361:8361 \
  -e RAIDCOM_TRANSPORT=http \
  -e RAIDCOM_HTTP_HOST=0.0.0.0 \
  -e RAIDCOM_HTTP_TOKEN="$(openssl rand -hex 32)" \
  -e RAIDCOM_HTTP_BEHIND_TLS_PROXY=true \
  -e RAIDCOM_HTTP_ALLOWED_HOSTS=raidcom.example.com \
  -e RAIDCOM_HTTP_TRUST_PROXY=1 \
  raidcom-mcp
curl http://127.0.0.1:8361/healthz
```

For clients that add servers as connectors (Claude, Microsoft 365 Copilot), which can't send a fixed token, leave out `RAIDCOM_HTTP_TOKEN` and set `RAIDCOM_HTTP_OPEN=true` instead.

Put a reverse proxy or load balancer in front that ends TLS and forwards `/mcp` and `/healthz` to port 8361. Then tell the server where the client's address comes from, so the rate limits apply per user:

- `RAIDCOM_HTTP_TRUST_PROXY=1` (as above) when exactly one proxy appends to `X-Forwarded-For`; use the number of proxies if there are more;
- `RAIDCOM_HTTP_CLIENT_IP_HEADER=cf-connecting-ip` instead, behind Cloudflare.

Check with `curl https://<your name>/healthz`: `client` should be your own address. See [INSTALL.md](INSTALL.md#run-over-http).

The container runs as the unprivileged `node` user, has no npm or other package managers, needs no volumes and needs no outbound network access.

Example `docker-compose.yml`:

```yaml
services:
  raidcom-mcp:
    build: .
    restart: unless-stopped
    ports: ["127.0.0.1:8361:8361"]
    read_only: true
    environment:
      RAIDCOM_TRANSPORT: http
      RAIDCOM_HTTP_HOST: 0.0.0.0
      RAIDCOM_HTTP_BEHIND_TLS_PROXY: "true"
      RAIDCOM_HTTP_ALLOWED_HOSTS: raidcom.example.com
      RAIDCOM_HTTP_TRUST_PROXY: "1"
      RAIDCOM_HTTP_TOKEN: ${RAIDCOM_HTTP_TOKEN:?set a token}
      # or, for connector clients: remove the token and set RAIDCOM_HTTP_OPEN: "true"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8361/healthz"]
      interval: 30s
```
