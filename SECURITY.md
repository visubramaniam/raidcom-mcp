# Security

## Reporting a vulnerability

Please report security problems privately, using **Security → Report a vulnerability** on the repository, and not in a public issue. Include the version, what you did and what happened. You will get a reply within a few days.

## Security model

raidcom-mcp is **build-only**. By design it:

- never connects to a storage system, a CCI instance or any other network service;
- never starts a process, a shell or `raidcom`;
- reads no files at request time except its own bundled `spec/` files (or the files named by `RAIDCOM_CATALOG`, `RAIDCOM_LIMITS`, `RAIDCOM_RECIPES`, `RAIDCOM_EXAMPLES` at startup);
- holds and logs no credentials. Credentials after `-login` in a pasted command line are dropped, and scripts refer to `$RAIDCOM_USER` and `$RAIDCOM_PASSWORD` rather than containing values.

All tools are annotated read-only. The risk that remains is that a **person copies a command it built and runs it**. Controls:

- **Shell safety.** Everything written into a command or script is checked first:
  - option values: characters a shell treats specially (`; | & < > $ \` \ ' " { } * ?`, newlines) are refused; a value containing a space or `#` is single-quoted, so `#` can't start a comment that drops the rest of the line;
  - a value that starts with `-` and a letter is refused, so it can't add raidcom options of its own (`"CL1-A-0 -IH9"`);
  - global options (`instance`, `pair_type`, `serial`, `unit`, `store`, ...) are validated before anything is written, including the lines a script writes itself (`export HORCMINST`, `lock resource`, `-login`); unknown global options are refused;
  - command and option names in the output always come from the catalogue, never from the request;
  - `raidcom_check_command` refuses lines with shell operators outside quotes, and drops the two words after `-login`.
- **Validation.** Unknown options, wrong value counts, out-of-range or non-numeric IDs and malformed ports are errors, so a typo does not become a different command.
- **Labelling.** Results say whether a command is read-only, changing or destructive (delete, initialize, unmap, disconnect), and scripts with destructive steps say so.
- **Limits.** Scripts and recipes expand to at most 500 commands, and lists and ranges stop at 500 values while they are being expanded (ranges only use numbers JavaScript holds exactly). Command and option names longer than 64 characters are refused before any fuzzy matching. An empty `foreach` or `zip`, or a script with no commands, is an error rather than an empty script.

The catalogue is parsed from a manual and can be wrong. Review every command before running it, and prefer `-checkmode precheck` (a global option) on a storage system you care about.

## HTTP transport

Off by default (`RAIDCOM_TRANSPORT=stdio`). When on:

- The server refuses to start without a bearer token (at least 32 characters) unless `RAIDCOM_HTTP_OPEN=true`, because an open endpoint should be a decision.
- Tokens are compared in constant time.
- Listening on anything but loopback requires TLS (own certificate) or an explicit `RAIDCOM_HTTP_BEHIND_TLS_PROXY=true`.
- `Host` and `Origin` headers are checked against an allow-list (defence against DNS rebinding and browser pages driving a local server).
- Limits on load:
  - a per-client rate limit (default 120 requests a minute); the limiter remembers at most 10,000 addresses;
  - at most 8 requests in progress per client and 64 in all;
  - a 256 KB body limit;
  - clients have 10 seconds to send their headers and 15 seconds to send the whole request, so slow clients can't hold slots.
- The client address used for those limits is the connection's, unless a trusted proxy supplies it: `RAIDCOM_HTTP_CLIENT_IP_HEADER` (a header the proxy sets and overwrites, such as `cf-connecting-ip` behind Cloudflare) or `RAIDCOM_HTTP_TRUST_PROXY` (the number of proxies that append to `X-Forwarded-For`; entries further left, which a client could have written, are ignored). Set either only when every request passes through that proxy.
- `/healthz` reports the server's version and, unless `RAIDCOM_HTTP_DEBUG_CLIENT=false`, the address the server took as the caller's and the forwarding headers of the caller's own request, plus the internal address of the proxy connection. Turn it off once the proxy settings are right if you'd rather not show that.
- With `MCPRUSH_TOKEN` set, a second endpoint (`/mcprush` by default) serves the mcprush marketplace gateway. It answers only requests whose `x-mcprush-token` header matches (compared in constant time) and is exempt from the bearer token and the per-client limits, since all its traffic comes from mcprush; the overall limit of 64 requests in progress still applies. The token is never logged.
- The transport is stateless: no sessions, no cookies, nothing stored between requests.
- Refused requests are logged to stderr with the client address and the reason, never with the token or body. At startup the server logs one line with its effective HTTP settings (never the token) and warns about any `RAIDCOM_` variable it doesn't recognise, by name only.
- Settings are read strictly: values are trimmed, and a true/false setting with any other value stops the server instead of being taken as false.

Running a public instance: use a reverse proxy that ends TLS, set `RAIDCOM_HTTP_ALLOWED_HOSTS` to your name, configure the client address (`RAIDCOM_HTTP_CLIENT_IP_HEADER` or `RAIDCOM_HTTP_TRUST_PROXY`) and check `/healthz` shows your own address, and run the container read-only as the `node` user. MCP clients that add servers as connectors (Claude, Microsoft 365 Copilot) either connect without authentication or use OAuth, which this server doesn't implement, so a public instance for them runs with `RAIDCOM_HTTP_OPEN=true`. That is a reasonable choice for this server: it holds no secrets and can't reach any storage system, and the limits above bound the load.

## Automated checks

Every pull request runs CodeQL (security-extended queries; also weekly) and dependency review. The runtime dependencies, the Claude Code plugin's lockfile and the Docker image are audited (`npm audit`, Trivy) on pull requests that touch them and weekly. Findings appear in the repository's Security tab. The unit tests include a regression test for every security issue fixed so far (see the 0.1.2 entry in [CHANGELOG.md](CHANGELOG.md)).

## Dependencies

One runtime dependency: `@modelcontextprotocol/sdk`. Dependabot proposes updates weekly for it, the plugin's lockfile, the Actions and the Docker base image; Actions are pinned by commit SHA and the base image by digest.

## Releases

- The npm package is published from the Release workflow with npm trusted publishing (OIDC, no stored token) and a provenance attestation.
- Every GitHub release has `SHA256SUMS` for all its files.
- The standalone packages bundle a Node.js runtime whose archive is checked against the Node.js release's `SHASUMS256.txt`, whose GPG signature is verified against the Node.js release keys.
- The Docker image runs as the unprivileged `node` user, without npm, npx, corepack or yarn.
- The Claude Code plugin installs the server from a lockfile with integrity hashes.

## Hitachi material

The Hitachi manuals are copyrighted. This repository contains structured facts derived from the Command Reference (command names, option names, value shapes, limits, and the command lines of examples) but not its prose, tables or output samples, and does not contain the manuals.
