# Contributing

Contributions are welcome, especially recipes, example questions, model limits and fixes where the manual parser got something wrong. The repository's [CONTRIBUTING.md](https://github.com/visubramaniam/raidcom-mcp/blob/main/CONTRIBUTING.md) is the authoritative guide; this page summarises it.

## Ground rules

- **Build-only, always.** Changes that connect to storage systems, run commands or read files at request time won't be accepted.
- **No real data.** No serial numbers, WWNs, host names, IP addresses or user names from real systems.
- **No manual text.** Don't commit the Hitachi PDFs or text extracted from them, and write descriptions in your own words.

## Setting up

```bash
git clone https://github.com/visubramaniam/raidcom-mcp.git && cd raidcom-mcp
npm ci
npm test           # builds, runs the unit tests and the search evaluation
npm run inspect    # try the tools in the MCP Inspector
```

Node.js 22.19 or later.

## Making a change

1. Branch from `main`.
2. Make the change with a test. A bug fix gets a test that fails without it.
3. Run `npm test`, and add a line under `## Unreleased` in `CHANGELOG.md` if users would notice.
4. Open a pull request. CI runs the tests on Node 22.19.0, 22 and 24, builds the packages, scans with CodeQL and audits dependencies.

## Common changes

| To | Edit | Check with |
|---|---|---|
| Improve search | `spec/examples.json` (example questions), synonyms in `src/search.ts` | `node tests/search-eval.mjs`. Raise thresholds when scores improve, never lower them, and don't tune against the held-out set |
| Fix a catalogue entry | `scripts/generate-catalog.mjs` (`OVERRIDES` / `ADDITIONS`), then regenerate from your copy of the manual | `tests/unit/catalog.test.mjs` replays the manual's examples |
| Add a recipe | `spec/recipes.json` | Add sample parameters to `tests/unit/recipes.test.mjs` |
| Add or fix model limits | `spec/limits.json`, from the Command Reference appendices | A test in `tests/unit/builder.test.mjs` |
| Change the plugin's skill | `plugin/skills/` | `tests/unit/plugin.test.mjs` |

Regenerating the catalogue:
```bash
pdftotext -layout CCI_Command_Reference.pdf cci-reference.txt
npm run generate-catalog -- cci-reference.txt
```

## Reporting problems

Use the issue forms: **Bug report**, **Search problem** (the wrong command was found), **Catalogue problem** (a valid command was rejected) or **Feature request**. Report security issues privately (see [[Security and Privacy]]).
