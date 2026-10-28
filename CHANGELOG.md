# Changelog

## Unreleased

## 0.1.3 — 2026-10-28

### Added

- **`RAIDCOM_HTTP_CLIENT_IP_HEADER`** reads the client's address from a header a trusted proxy sets, such as `cf-connecting-ip` behind Cloudflare. On Render, which sits behind Cloudflare, counting `X-Forwarded-For` entries gave a Cloudflare address, so every user shared the rate limit and the in-progress cap of their Cloudflare edge.
- **`RAIDCOM_HTTP_DEBUG_CLIENT=true`** makes `/healthz` show the forwarding headers it received, to choose the proxy settings.

## 0.1.2 — 2026-10-27

0.1.0 and 0.1.1 were withdrawn from npm and can't be published again there; this is the first version on npm since. 0.1.1's GitHub release and Docker image stay available.

### Security

- **Script text could carry shell commands through two global options.** `global.pair_type` was written into scripts without a check (`"pair_type": "$(id)"` produced `run raidcom lock resource -I$(id)0`), and `global.instance` was only checked when a step produced at least one command (`"instance": "0;id"` produced `export HORCMINST=0;id`). All global options are now checked once, before anything is written: `pair_type` must be H, M, TC or SI, `instance` and `unit` whole numbers from 0 to 9999, and unknown global options are refused.
- **A value starting with `#` was written unquoted,** so the shell treated the rest of the line as a comment and dropped options after it, including `-checkmode precheck`. Values containing `#` are now always quoted.
- **Values that start with `-` and a letter are refused,** so a value such as `"CL1-A-0 -IH9"` can't add options of its own.
- **LDEV IDs that aren't numbers** (`abc`, `1e+308`) are now errors rather than warnings.

### Fixed

- **A request could stop or slow the HTTP server.** A range with numbers above 2^53 made range expansion loop until the process ran out of memory; very long command names took seconds of CPU; large `foreach` and `zip` lists were expanded before the 500-command limit was checked. Ranges now only use exact numbers, lists stop at the limit while they are expanded, and names longer than 64 characters are refused before any matching.
- **Slow clients could take every HTTP slot.** Clients now have 10 seconds to send headers and 15 to send the whole request, and one address may have at most 8 requests in progress.
- **Behind a trusted proxy, the rate limit used the client-supplied X-Forwarded-For entry.** `RAIDCOM_HTTP_TRUST_PROXY` now takes the number of proxies in front of the server (`true` still means one), and the client address is the entry that many places from the right, as Express does it. With proxies configured, `/healthz` shows the address the server takes as the caller's, to check the number. The limiter remembers at most 10,000 addresses.
- **Empty `foreach` or `zip` lists, or a script with no commands,** are errors instead of an empty script reported as success.
- **`raidcom_check_command`:** the two words after `-login` are always dropped, even when the password starts with `-`; a bare `-I` and a repeated option are reported.
- **Names such as `constructor` or `__proto__`** in queries, recipe IDs, parameters and option names no longer crash a tool or slip past checks.
- **`create-dp-pool`:** giving only one of the two thresholds is an error instead of being ignored.
- **Search confidence:** a tie between the top results is now rated low, and the search evaluation checks that high-confidence results are right at least 85% of the time.
- **Release pipeline:**
  - the MCP Registry rejected `server.json` (description over 100 characters);
  - the plugin bump never started after automatic releases; Release now starts it once npm has the version;
  - plugin releases no longer become the repository's "latest" release;
  - the CHANGELOG heading checks match the exact version;
  - rebuilding an older release no longer moves the Docker `latest` tag back;
  - the Windows test uses the smoke test from the tag;
  - the Windows package tests run again (the job was missing from 0.1.1's Release workflow);
  - the plugin's lockfile is audited and watched by Dependabot.

## 0.1.1 — 2026-10-26

### Added

- **More release packages.** Every release now also has a Claude Desktop extension (`.mcpb`), standalone packages for macOS, Linux and Windows (x64 and arm64) with a Node.js runtime bundled, and a zip of the `raidcom-command-builder` skill, besides the npm package and the Docker image. `SHA256SUMS` covers them all. The Windows packages are tested on Windows x64 and arm64 machines. CI builds the Desktop extension, the skill zip and the Linux x64 standalone package on every pull request and smoke-tests them. INSTALL.md has a section for each.
- **Claude Code plugin `raidcom-community`** (`plugin/`, listed by `.claude-plugin/marketplace.json`; see README.plugin.md). It installs the server from a pinned npm version and adds the `raidcom-command-builder` skill. It needs no settings. The Plugin release workflow opens a pull request that moves the plugin to each new server release (including the lockfile), and tags `plugin-v<version>` and creates a GitHub release with the plugin zip when that pull request is merged.
- **Security scanning in CI.** CodeQL (security-extended queries) runs on every pull request, push to `main` and weekly. Dependency review fails a pull request that adds a vulnerable dependency. A Security audit workflow runs `npm audit` on the runtime dependencies and a Trivy scan of the Docker image on pull requests that touch dependencies or the Dockerfile, and weekly.
- **Recipe `create-mainframe-pool`:** creates a mainframe parity group (always `-emulation 3390-V`, not a parameter), assigns an SSID, creates and quick-formats 3390 LDEVs and makes them a DP pool, with `HORCC_DRIVEOPERATION=1` exported at the top of the script. Recipes can now export environment variables (`env`).
- **CU:LDEV notation** (`dd:0f`) is accepted for LDEV IDs and range-checked, and ranges such as `dd:00-dd:0f` expand in recipes and scripts.
- `add parity_grp` accepts `-emulation`, which the manual's syntax line leaves out but mainframe-capable systems use. The generator records it as an addition.
- **The Release workflow also pushes the image to Docker Hub** (`subramaniamv/raidcom-mcp`) when the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets are set; otherwise it pushes to ghcr.io only.
- **Build, CI and release pipeline.** CI now also builds the npm package and installs it into an empty folder to check it starts over stdio and HTTP (`npm run package`, `npm run smoke`). Merging a pull request that bumps `version` in `package.json` tags the commit (the Tag release workflow, which requires a matching `CHANGELOG.md` section) and starts the Release workflow: it re-runs the tests, attaches the package and `SHA256SUMS` to a GitHub release, publishes to npm with provenance, lists the version in the MCP Registry and pushes a multi-arch image to ghcr.io.

## 0.1.0

First version.

- Eight read-only MCP tools: `raidcom_list_commands`, `raidcom_describe_command`, `raidcom_build_command`, `raidcom_check_command`, `raidcom_build_script`, `raidcom_list_recipes`, `raidcom_build_recipe`, `raidcom_model_limits`.
- A catalogue of 178 commands (218 syntax forms, 562 examples) generated from the Command Reference, with per-model limits for VSP One Block 24/26/28, VSP 5000 series and VSP E series.
- Thirteen recipes: FC, iSCSI and NVMe/TCP provisioning, DP pools, extending and deleting volumes, command devices, zero-page reclaim, inventory, copy groups.
- Stdio and stateless Streamable HTTP transports (bearer token, TLS or proxy, host and origin checks, rate limit).
- Build-only by design: no tool connects to a storage system or runs a command.
