# Contributing to raidcom-mcp

Thanks for helping. This is a community project, not an official Hitachi Vantara product.

## Ways to help

- Report a command the manual shows that the validator rejects (use the *Catalogue problem* form).
- Report a question that finds the wrong command (*Search problem*).
- Add recipes, example questions, or model limits.
- Improve the generator for a newer Command Reference.

## Before you start

raidcom-mcp is **build-only** and will stay so. Changes that connect to storage systems, run commands, or read files at request time won't be accepted. Please open an issue before a large change.

## Setting up

```
git clone https://github.com/visubramaniam/raidcom-mcp.git
cd raidcom-mcp
npm ci
npm test
```

Node.js 22.19 or later. `npm test` builds, runs `tests/unit/*.test.mjs` and the search evaluation.

## Making a change

1. Branch from `main`.
2. Make the change with a test (a bug fix gets a test that fails without it).
3. `npm test`, and add a line under `## Unreleased` in `CHANGELOG.md`.
4. Open a pull request; the template has the checklist.

## No real data, no copied manuals

Don't include serial numbers, WWNs, host names, IP addresses or user names from a real system. Don't commit the Hitachi PDFs or text extracted from them (`.gitignore` blocks the usual names), and don't paste manual prose into the catalogue, recipes or docs: write in your own words.

## Code style

TypeScript, strict, ESM. Comments explain why. No new runtime dependencies without a strong reason.

## Common changes

### Improving search

`tests/cases.mjs` holds request/expected-command pairs in a tuning set and a held-out set. Add example questions for a command in `spec/examples.json`, or synonyms in `src/search.ts`, then run `node tests/search-eval.mjs`. Raise the thresholds in that file when scores improve; never lower them. Don't tune against the held-out set.

### Fixing a catalogue entry

Fix it in `scripts/generate-catalog.mjs` (its `OVERRIDES` table is for places where the manual's syntax is wrong) and regenerate with your copy of the manual, rather than editing `spec/raidcom-catalog.json` by hand. `tests/unit/catalog.test.mjs` replays the manual's examples.

### Adding a recipe

Add it to `spec/recipes.json` in your own words and add sample parameters to `tests/unit/recipes.test.mjs`, which builds every recipe.

### Adding model limits

Edit `spec/limits.json` from the appendices of the Command Reference for that model, and add a test in `tests/unit/builder.test.mjs`.

## Releases

Maintainers bump `package.json` and `server.json`, move the `Unreleased` notes under a dated heading in `CHANGELOG.md`, and tag.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence of the project.
