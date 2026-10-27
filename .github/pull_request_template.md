## What and why

<!-- What this changes, and the problem it solves. Link the issue if there is one, e.g. "Fixes #22". -->

## How it was tested

<!-- npm test, and anything else: the MCP Inspector, a Docker build. -->

## Checklist

- [ ] `npm test` passes (unit tests and the search evaluation).
- [ ] New behaviour has tests; a bug fix has a test that fails without it.
- [ ] No data from a real storage system is included: serial numbers, WWNs, host names, IP addresses or user names.
- [ ] No text copied from the Hitachi manuals beyond command names, option names and the command lines of examples.
- [ ] Docs describing the change are updated (README, INSTALL.md, README.docker.md, SECURITY.md as relevant).
- [ ] A line is added under `## Unreleased` in `CHANGELOG.md`, if users would notice the change.
- [ ] If search scores improved, their thresholds in `tests/search-eval.mjs` are raised. No threshold is lowered.

## Safety

<!-- raidcom-mcp only builds text. Does this change add anything that executes a command, reads files or reaches a network? If so it needs a very good reason: see SECURITY.md. Otherwise write "No change". -->
