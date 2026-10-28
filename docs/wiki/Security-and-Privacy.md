# Security and Privacy

The full documents are in the repository: [SECURITY.md](https://github.com/visubramaniam/raidcom-mcp/blob/main/SECURITY.md) and [PRIVACY.md](https://github.com/visubramaniam/raidcom-mcp/blob/main/PRIVACY.md). This page is the short version.

## The design in one sentence

raidcom-mcp only builds text: it never connects to a storage system, never runs a command or a shell, holds no credentials, and keeps nothing between requests.

## What protects the person who runs the output

The real risk is a person copying a generated command into a shell, so everything written into a command or script is checked:

- characters a shell treats specially are refused; values with spaces or `#` are quoted;
- values starting with `-` are refused, so they can't add raidcom options;
- global options (instance, pair type, serial, ...) are validated before anything is written;
- command and option names come from the catalogue, never from the request;
- every value is range-checked for the model, so a typo doesn't become a different command;
- results say which commands change the array and which delete or initialize;
- scripts stop at the first failure, can lock the resource group, and never contain passwords.

Always review the output and prefer `-checkmode precheck` on an array you care about.

## What protects a hosted instance

Token or explicit open mode, TLS or an explicit TLS proxy, Host/Origin allow-lists, per-client rate and in-progress limits, request timeouts, body limits, a stateless transport, and logging of refused requests only (never bodies or tokens). See [[Deploying]].

## Data

- **Self-hosted:** collects and sends nothing.
- **Public instance:** receives your assistant's tool requests and connection data, processes them in memory, keeps nothing, and logs only refused requests (time, path, IP address, reason). It runs on Render behind Cloudflare.

## Automated checks

CodeQL (on every pull request and weekly), dependency review, `npm audit` and a Trivy scan of the Docker image, Dependabot, and a regression test for every security fix. Releases publish to npm with provenance, include `SHA256SUMS`, and the standalone packages bundle a signature-verified Node.js.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on the repository, not a public issue.
