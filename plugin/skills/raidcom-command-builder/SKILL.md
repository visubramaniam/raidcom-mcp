---
name: raidcom-command-builder
description: Build and check Hitachi raidcom commands and CCI scripts with the raidcom MCP server: provisioning LDEVs, LUN paths, host groups and pools. It only builds text and never runs anything.
---

# Building raidcom commands

Use the `raidcom` MCP server. It builds and validates command text from structured arguments; it never connects to a storage system, so say "here is the command" and never "I ran it".

## Steps

1. **Find the command.** If you don't know its exact name, call `raidcom_list_commands` with the request in plain words. If confidence is low, show the top candidates and ask which fits.
2. **Check a common job first.** `raidcom_list_recipes` covers provisioning to FC, iSCSI and NVMe/TCP hosts, DP pools, mainframe pools, extending and deleting volumes, command devices, zero-page reclaim and inventory. Use `raidcom_build_recipe` when one fits.
3. **Learn the options.** `raidcom_describe_command` lists the syntax forms and each option's values. Use it when unsure which options a command needs.
4. **Build.** One command: `raidcom_build_command`. Many similar commands: `raidcom_build_script` with `foreach` or `zip`, not repeated calls. Pass `model` when the user names one (for example VSP One Block 28 or VSP E990) so IDs and ports are checked against its limits, and `global.instance` for the HORCM instance.
5. **Check an existing command** the user pastes with `raidcom_check_command`.

## Rules

- Ask for values you don't have (pool, LDEV IDs, ports, host group name, WWNs) rather than inventing them. Never reuse example values as if they were the user's.
- Show the exact `command` or `script` from the result, then any warnings and notes. A result with errors has no command: fix the arguments, don't write the command by hand.
- Say clearly when a command deletes, initializes or unmaps, and that scripts should be reviewed before they run.
- If a "needs <option>" error looks wrong after `raidcom_describe_command` (the manual's syntax lines are sometimes incomplete), retry with `strict: false` and mention the warning.
- Running the result is the user's job, on a host with CCI installed and a running HORCM instance. The `raidcom://notes/horcm-setup` resource describes that host.
