# Changelog

## Unreleased

### Added

- **Security scanning in CI.** CodeQL (security-extended queries) runs on every pull request, push to `main` and weekly. Dependency review fails a pull request that adds a vulnerable dependency. A Security audit workflow runs `npm audit` on the runtime dependencies and a Trivy scan of the Docker image on pull requests that touch dependencies or the Dockerfile, and weekly.

### Added

- **The Release workflow also pushes the image to Docker Hub** (`subramaniamv/raidcom-mcp`) when the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets are set; otherwise it pushes to ghcr.io only.

### Added

- **Build, CI and release pipeline.** CI now also builds the npm package and installs it into an empty folder to check it starts over stdio and HTTP (`npm run package`, `npm run smoke`). Merging a pull request that bumps `version` in `package.json` tags the commit (the Tag release workflow, which requires a matching `CHANGELOG.md` section) and starts the Release workflow: it re-runs the tests, attaches the package and `SHA256SUMS` to a GitHub release, publishes to npm with provenance, lists the version in the MCP Registry and pushes a multi-arch image to ghcr.io.

## 0.1.0

First version.

- Eight read-only MCP tools: `raidcom_list_commands`, `raidcom_describe_command`, `raidcom_build_command`, `raidcom_check_command`, `raidcom_build_script`, `raidcom_list_recipes`, `raidcom_build_recipe`, `raidcom_model_limits`.
- A catalogue of 178 commands (218 syntax forms, 562 examples) generated from the Command Reference, with per-model limits for VSP One Block 24/26/28, VSP 5000 series and VSP E series.
- Thirteen recipes: FC, iSCSI and NVMe/TCP provisioning, DP pools, extending and deleting volumes, command devices, zero-page reclaim, inventory, copy groups.
- Stdio and stateless Streamable HTTP transports (bearer token, TLS or proxy, host and origin checks, rate limit).
- Build-only by design: no tool connects to a storage system or runs a command.
