# Troubleshooting

## Adding the connector fails, or Claude asks to sign in

- Use the full endpoint, `https://<host>/mcp`, with `/mcp` and no trailing slash. Other paths return 404, which clients read as "sign-in needed".
- Leave the connector's OAuth / advanced settings empty.
- A server started with `RAIDCOM_HTTP_TOKEN` answers 401, which connector clients also read as "sign in". For Claude and Microsoft 365 Copilot connectors, run without a token and with `RAIDCOM_HTTP_OPEN=true`.
- Check the server directly:
  ```bash
  curl -s https://<host>/healthz                                              # {"status":"ok",...}
  curl -s -o /dev/null -w "%{http_code}\n" https://<host>/.well-known/oauth-protected-resource   # 404
  ```

## 403 "Host not allowed"

Add your public host name to `RAIDCOM_HTTP_ALLOWED_HOSTS` (or `*`).

## The server won't start

It refuses unsafe or unclear settings and says which one: no token and no `RAIDCOM_HTTP_OPEN=true`; a non-loopback address without TLS or `RAIDCOM_HTTP_BEHIND_TLS_PROXY=true`; a true/false setting with another value; an invalid port, header name or path. Read the first `[raidcom-mcp]` line of the log.

## A setting doesn't take effect

Read the startup log:
- `[raidcom-mcp] warning: ignoring unknown setting "..."`: the variable's name is misspelt or has a stray space.
- `[raidcom-mcp] http: ...`: the effective settings. If they're not what you set, the value is coming from somewhere else. On Render, a variable on the service itself overrides the same name in a linked environment group, so check both and keep each variable in one place.

## `/healthz` shows a proxy's address as `client`

The rate limits then apply per proxy, not per user. Look at the `forwarding` part of the same response:
- if `cf-connecting-ip` holds your address (Cloudflare, including Render), set `RAIDCOM_HTTP_CLIENT_IP_HEADER=cf-connecting-ip`;
- otherwise set `RAIDCOM_HTTP_TRUST_PROXY` to the number of entries from the right of `x-forwarded-for` at which your address appears.

Then confirm that `client` matches `curl https://ifconfig.me`, and that sending `-H 'X-Forwarded-For: 1.2.3.4'` doesn't change it.

## 429 "Too many requests"

Over 120 requests a minute (`RAIDCOM_HTTP_RATE_LIMIT`), or more than 8 at once, from one client address. If every user shares one address, fix the client address first (above).

## A command is rejected but the manual shows it

The catalogue is parsed from the manual, whose syntax lines are occasionally incomplete. If an error says "needs <option>" and the command is right, retry with `strict: false`; missing-option errors then become warnings. Please also open a **Catalogue problem** issue with the command line and the manual page.

## The search picks the wrong command

Name the command if you know it (`add lun`), or rephrase with the object (*volume*, *host group*, *pool*). Please open a **Search problem** issue with the exact words, so it can be added to the evaluation set.

## npm publish says it can't find the package file

`npm publish release/raidcom-mcp-x.y.z.tgz` is read as a GitHub repository name. Prefix the path: `npm publish ./release/raidcom-mcp-x.y.z.tgz`.
