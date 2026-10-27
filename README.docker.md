# Running raidcom-mcp with Docker

## Build

```
docker build -t raidcom-mcp .
```

## Stdio (a local client)

```
docker run -i --rm raidcom-mcp
```

## Hosted over HTTP

```
docker run -d --name raidcom-mcp -p 8361:8361 \
  -e RAIDCOM_TRANSPORT=http \
  -e RAIDCOM_HTTP_HOST=0.0.0.0 \
  -e RAIDCOM_HTTP_TOKEN="$(openssl rand -hex 32)" \
  -e RAIDCOM_HTTP_BEHIND_TLS_PROXY=true \
  -e RAIDCOM_HTTP_ALLOWED_HOSTS=raidcom.example.com \
  -e RAIDCOM_HTTP_TRUST_PROXY=true \
  raidcom-mcp
curl http://127.0.0.1:8361/healthz
```

Put a reverse proxy or load balancer in front that ends TLS and forwards `/mcp` and `/healthz` to port 8361. Leave out `RAIDCOM_HTTP_TOKEN` and set `RAIDCOM_HTTP_OPEN=true` for a public service without authentication. The container runs as the unprivileged `node` user, needs no volumes, and needs no outbound network access.

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
      RAIDCOM_HTTP_TRUST_PROXY: "true"
      RAIDCOM_HTTP_TOKEN: ${RAIDCOM_HTTP_TOKEN:?set a token}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8361/healthz"]
      interval: 30s
```
