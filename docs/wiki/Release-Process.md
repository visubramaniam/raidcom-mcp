# Release Process

Releasing is a pull request.

1. In a pull request, bump `version` in `package.json` (`npm version x.y.z --no-git-tag-version` also updates the lockfile) and in both places in `server.json`, and move the `## Unreleased` notes under a `## x.y.z — YYYY-MM-DD` heading in `CHANGELOG.md`.
2. Merge it. The **Tag release** workflow sees a version without a tag, checks the CHANGELOG heading, tags `vx.y.z` and starts **Release**.
3. **Release** then:
   - re-runs the tests;
   - builds every package: the npm tarball, the Claude Desktop extension, six standalone packages, the skill zip and `SHA256SUMS`;
   - smoke-tests the npm and Linux packages and attaches everything to a GitHub release, with the CHANGELOG section as its notes;
   - publishes to npm through trusted publishing, with provenance;
   - lists the version in the MCP Registry;
   - pushes the multi-arch Docker image to ghcr.io (and Docker Hub when its secrets are set);
   - tests the Windows packages on Windows x64 and arm64;
   - starts the plugin bump.
4. **Plugin release** opens a pull request that moves the Claude Code plugin to the new version, with its lockfile. Merging it tags `plugin-vx.y.z` and attaches the plugin zip.

Merges that don't change the version don't release anything.

## Re-running

Re-run **Release** from the Actions tab with an existing tag. Steps that are already done are skipped: npm and the MCP Registry check first, and uploads replace existing files. Docker's `latest` tag only moves for the newest version, and the plugin is only moved forward.

## Secrets and settings

| Name | Used for |
|---|---|
| npm trusted publisher (on npmjs.com: repository `visubramaniam/raidcom-mcp`, workflow `release.yml`) | Publishing without a stored token |
| `PLUGIN_PR_TOKEN` | Opening the plugin bump pull request so that CI runs on it |
| `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (optional) | Pushing the image to Docker Hub |

npm never accepts a version number twice, even after an unpublish. If a version is withdrawn, release the next one.
