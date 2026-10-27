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

- **Shell safety.** Every value is checked: characters a shell treats specially (`; | & < > $ \` \ ' " { } * ?`, newlines) are refused, and a name containing spaces is single-quoted. `raidcom_check_command` refuses lines with shell operators outside quotes.
- **Validation.** Unknown options, wrong value counts, out-of-range IDs and malformed ports are errors, so a typo does not become a different command.
- **Labelling.** Results say whether a command is read-only, changing or destructive (delete, initialize, unmap, disconnect), and scripts with destructive steps say so.
- **Limits.** Scripts and recipes expand to at most 500 commands; ranges to at most 500 values.

The catalogue is parsed from a manual and can be wrong. Review every command before running it, and prefer `-checkmode precheck` (a global option) on a storage system you care about.

## HTTP transport

Off by default (`RAIDCOM_TRANSPORT=stdio`). When on:

- The server refuses to start without a bearer token (at least 32 characters) unless `RAIDCOM_HTTP_OPEN=true`, because an open endpoint should be a decision.
- Tokens are compared in constant time.
- Listening on anything but loopback requires TLS (own certificate) or an explicit `RAIDCOM_HTTP_BEHIND_TLS_PROXY=true`.
- `Host` and `Origin` headers are checked against an allow-list (defence against DNS rebinding and browser pages driving a local server).
- Per-client rate limit (default 120 requests a minute), 256 KB body limit, at most 64 requests in progress.
- The transport is stateless: no sessions, no cookies, nothing stored between requests.
- Refused requests are logged to stderr with the client address and the reason, never with the token or body.

Running a public instance: use a reverse proxy that ends TLS, set `RAIDCOM_HTTP_ALLOWED_HOSTS` to your name, set `RAIDCOM_HTTP_TRUST_PROXY` to the number of proxies in front (`true` for one) only when they set `X-Forwarded-For` themselves, and check `/healthz` shows your own address, and run the container read-only as the `node` user.

## Automated checks

Every pull request runs CodeQL and dependency review. Dependency changes and the Docker image are also audited (`npm audit`, Trivy) on pull requests that touch them and weekly. Findings appear in the repository's Security tab.

## Dependencies

One runtime dependency: `@modelcontextprotocol/sdk`. Dependabot proposes updates weekly; Actions are pinned by commit SHA and the Docker base image by digest.

## Hitachi material

The Hitachi manuals are copyrighted. This repository contains structured facts derived from the Command Reference (command names, option names, value shapes, limits, and the command lines of examples) but not its prose, tables or output samples, and does not contain the manuals.
