# Why MCP instead of RAG

A natural first idea for "help me write raidcom commands" is retrieval-augmented generation (RAG): chunk the CCI Command Reference into a vector store, retrieve the relevant pages for each question, and let the model write the command. raidcom-mcp deliberately doesn't do that. This page explains why.

## What RAG gives you

With RAG, the model reads a few retrieved chunks of the manual and then **writes the command freehand**. Everything after retrieval is generation:

- **Nothing checks the output.** If the model drops a required option, invents one that sounds right (`-lunid`), gives `-port` the wrong number of values or uses LUN 3000 on a model that stops at 2047, the answer looks just as confident as a correct one. You find out when raidcom rejects it, or worse, when it accepts something you didn't mean.
- **Retrieval can miss.** Syntax lines, option tables and per-model limits live in different parts of the manual (limits are in the appendices). Chunking splits them, and similarity search can return the right command's prose but not its syntax form, or a neighbouring command (`get lun` instead of `add lun`).
- **No structure for scripts.** "Create LDEVs 100 to 199 and map each to two ports" is 300 commands. RAG leaves the model to write them all out, and long generated lists are exactly where models skip or repeat lines.
- **Nothing to test.** You can't write a unit test that says "this RAG answer is valid". You can only spot-check outputs.
- **You ship the manual.** A RAG index contains the manual's text. That's a copyright question for a public service.

## What MCP gives you

raidcom-mcp turns the manual into **data and code** once, then lets the model call tools:

| Concern | RAG | raidcom-mcp |
|---|---|---|
| Who writes the command | The model, token by token | Deterministic code, from structured arguments |
| Is it valid? | Unknown until you run it | Checked against the syntax grammar before it's returned |
| Model limits (LDEV, LUN, pool, port, serial) | Only if the right appendix chunk was retrieved | Always checked, per model |
| Wrong option name | Silently wrong | Error with the closest real option |
| 300 similar commands | Generated one by one | One `foreach` step, expanded by code |
| Shell safety | Whatever the model writes | Values validated and quoted; nothing can add shell syntax |
| Testable | Spot checks | 100 unit tests, every example in the manual replayed, a search evaluation with thresholds |
| Copyrighted text in the service | The manual itself | Command names, option shapes, limits and example command lines only |
| Works in | One chat app | Any MCP client: Claude, Copilot, VS Code, Copilot Studio, ... |

The model still does what it's good at: understanding the request, asking for missing values (WWNs, IDs), choosing the command with the search tool, and explaining the result. The part that has to be exactly right, the command text, is produced and checked by code.

## How the knowledge gets in

`scripts/generate-catalog.mjs` parses the Command Reference once into `spec/raidcom-catalog.json`: each command's syntax forms as a small grammar tree, each option's value count and accepted words, and the manual's example command lines. A unit test replays every example in the manual through the validator (about 96% pass; the rest are places where the manual's syntax lines and examples disagree, which `strict: false` covers). Per-model limits come from the manual's appendices into `spec/limits.json`. Search is BM25 over the catalogue with synonyms and example questions, and an evaluation set keeps its accuracy from regressing. See [[How It Works]].

## When RAG would still help

RAG is good at explanations: *"what does a command device do?"*, *"what's the difference between a host group and an iSCSI target?"*. The two approaches combine well. A RAG or documentation tool can answer the *why*, and raidcom-mcp produces the *how* as validated commands. raidcom-mcp already carries short notes on conventions and HORCM setup as MCP resources for the most common background questions.
