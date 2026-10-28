# How It Works

```
 your request ──▶ AI assistant ──▶ raidcom-mcp tools ──▶ checked command / script ──▶ you run it on a CCI host
                                     │
                                     ├─ search      (which command?)
                                     ├─ catalogue   (178 commands, syntax grammar, option shapes)
                                     ├─ limits      (per-model ID and port ranges)
                                     ├─ builder     (validate + render, shell-safe)
                                     └─ scripts     (foreach / zip, async waits, locking, recipes)
```

raidcom-mcp never connects to a storage system. Everything below happens in memory, per request.

## The catalogue

`spec/raidcom-catalog.json` is generated from the *CCI Command Reference* (MK-90RD7009) by `scripts/generate-catalog.mjs`. For each `raidcom <action> <object>` it keeps:

- a one-line summary and the supported models;
- every **syntax form**, parsed into a grammar tree: sequences, alternatives `{a | b}`, optional groups `[...]`, repeated values `...`;
- every **option**: how many values it takes, their placeholders, and the literal words it accepts (for example `-status enable_fullallocation | disable_fullallocation`);
- the command lines of the manual's **examples**.

It also records whether a command reads, changes or destroys (`get`/`delete`/`initialize`, ...) and whether it runs asynchronously. A small overrides table fixes the few places where the manual's syntax is wrong, and an additions table adds options real systems accept that the syntax line omits (such as `-emulation` on `add parity_grp` for mainframe).

## Search

`raidcom_list_commands` ranks commands with BM25 over the catalogue, weighting the command name, summary, options and example questions (`spec/examples.json`), expanding synonyms (*volume* → *ldev*, *map* → *lun*) and boosting the action implied by the verb (*create* → `add`, *show* → `get`). It reports a confidence: **high** when the top result leads clearly and matches most words, **low** on a tie, so the assistant knows when to ask. `tests/search-eval.mjs` scores 70 sample requests and fails if accuracy drops.

## Validation and rendering

`raidcom_build_command` takes the command name, options as JSON, the model and global options (`instance`, `pair_type`, `serial`, `checkmode`, ...). It:

1. resolves loosely written option names (`ldev-id`, `LDEV_ID`) to the catalogue spelling, or suggests the closest;
2. picks the syntax form that fits the given options best, and reports missing required options (or warns, with `strict: false`);
3. checks each value: count, accepted words, LDEV IDs (decimal, `0x` hex or CU:LDEV `dd:0f`), LUNs, pool IDs, ports (`CL1-A`, `CL1-A-3`) and serials against the model's limits;
4. checks values for shell safety: special characters are refused, values with spaces or `#` are quoted, and values that start with `-` are refused;
5. renders the command, with notes (asynchronous, destructive, use `-checkmode precheck`, lock the resource group).

## Scripts and recipes

`raidcom_build_script` takes steps, each a command with options, optionally repeated with `foreach` (every combination) or `zip` (values advance together). `{var}` in option values is filled from the loop. Every expanded command goes through the same validator; the script is returned only if all of them pass. The script:

- uses a `run` wrapper that stops at the first failure;
- adds `raidcom get command_status` after asynchronous commands, before the next step that depends on them;
- can wrap everything in `raidcom lock resource` / `unlock resource`, and add `raidcom -login` reading `$RAIDCOM_USER`/`$RAIDCOM_PASSWORD` from the shell;
- exports `HORCMINST` and any variables a recipe needs.

Recipes (`spec/recipes.json`) are named step lists with parameters; see [[Recipes]].

## Transports

Over **stdio** the client starts the server as a subprocess. Over **HTTP** it's stateless Streamable HTTP on `/mcp`: each POST gets a fresh server instance, so there's no session state and instances scale horizontally. See [[Deploying]].
