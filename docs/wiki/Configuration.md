# Configuration

All settings are environment variables. Values are trimmed; true/false settings accept any case, and any other value for them stops the server with a message naming the setting. At startup the server warns about `RAIDCOM_` variables it doesn't recognise (a typo, or a stray space in the name).

## Transport

| Variable | Default | Meaning |
|---|---|---|
| `RAIDCOM_TRANSPORT` | `stdio` | `stdio` or `http` |
| `RAIDCOM_HTTP_HOST` | `127.0.0.1` | Address to listen on |
| `RAIDCOM_HTTP_PORT` | `8361` | Port (`0` picks a free one) |

## Access

| Variable | Default | Meaning |
|---|---|---|
| `RAIDCOM_HTTP_TOKEN` | none | Bearer token (32+ characters). Required unless `RAIDCOM_HTTP_OPEN=true` |
| `RAIDCOM_HTTP_OPEN` | `false` | Serve without a token |
| `RAIDCOM_HTTP_ALLOWED_HOSTS` | loopback only | Extra `Host` values to accept, comma-separated (`*` for any) |
| `RAIDCOM_HTTP_ALLOWED_ORIGINS` | none | `Origin` values to accept (`*` for any). Most MCP clients send none |
| `MCPRUSH_TOKEN` | none | Enables the mcprush gateway endpoint, which requires this token in `x-mcprush-token` |
| `RAIDCOM_HTTP_MCPRUSH_PATH` | `/mcprush` | Path of that endpoint |

## TLS

| Variable | Default | Meaning |
|---|---|---|
| `RAIDCOM_HTTP_TLS_CERT`, `RAIDCOM_HTTP_TLS_KEY` | none | PEM files; the server then speaks HTTPS itself |
| `RAIDCOM_HTTP_BEHIND_TLS_PROXY` | `false` | A proxy or load balancer ends TLS. Needed for non-loopback addresses without a certificate |

## Proxies and limits

| Variable | Default | Meaning |
|---|---|---|
| `RAIDCOM_HTTP_CLIENT_IP_HEADER` | none | A header the proxy sets to the client's address, e.g. `cf-connecting-ip` |
| `RAIDCOM_HTTP_TRUST_PROXY` | `false` | Number of proxies appending to `X-Forwarded-For` (`true` = 1) |
| `RAIDCOM_HTTP_DEBUG_CLIENT` | `true` | `/healthz` shows the forwarding headers of the caller's request. `false` to hide |
| `RAIDCOM_HTTP_RATE_LIMIT` | `120` | Requests per minute per client (`0` for none) |

Fixed limits: 8 requests in progress per client and 64 in all, 256 KB request bodies, 10 s to send headers and 15 s for the whole request.

## Data files

| Variable | Default | Meaning |
|---|---|---|
| `RAIDCOM_CATALOG` | bundled | Path to another `raidcom-catalog.json` |
| `RAIDCOM_LIMITS` | bundled | Path to another `limits.json` |
| `RAIDCOM_RECIPES` | bundled | Path to another `recipes.json` |
| `RAIDCOM_EXAMPLES` | bundled | Path to another `examples.json`; empty turns example questions off |
