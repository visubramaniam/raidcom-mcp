# raidcom-mcp

**raidcom-mcp** is an MCP server that lets an AI assistant (Claude, GitHub Copilot, Microsoft 365 Copilot or any other MCP client) write Hitachi `raidcom` commands, and get them right. You describe a storage task in plain English; it gives back validated commands or a ready-to-run script.

> raidcom-mcp is an independent community project (MIT licence), not an official Hitachi Vantara product.

## Introduction

Anyone who has provisioned storage with raidcom knows the routine: open the *CCI Command Reference*, find the command, work out which syntax form applies, check every option, and hope a port name or LDEV number isn't out of range for that model. Then repeat it for the next twenty volumes.

raidcom-mcp takes that work off your hands:

- **It knows the command set.** 178 raidcom commands, parsed from the Command Reference, with every syntax form and option.
- **It checks before you see anything.** Unknown options, missing required ones, wrong value counts, and LDEV, LUN, pool, serial and port values outside your model's limits are errors with a suggested fix.
- **It writes whole scripts.** Loops and ranges become a script that locks the resource group, waits for asynchronous commands and stops at the first failure.
- **It has recipes.** Fourteen ready-made workflows, from FC, iSCSI and NVMe/TCP provisioning to DP and mainframe pools.
- **It never touches your array.** It is build-only: it returns text, holds no credentials and connects to nothing. You review the output and run it on your own CCI host.

Example: *"Give esx01 four 100 GB volumes from pool 0 on CL1-A and CL2-A. It's a VSP One B28."* becomes a script with `add ldev`, `add host_grp`, `modify host_grp -host_mode`, `add hba_wwn` and `add lun` commands for both ports, every value checked against the B28's limits.

## Where to go next

| I want to | Page |
|---|---|
| Try it in five minutes | [[Quick Start]] |
| Run it myself, locally or for my team | [[Deploying]] |
| Understand what happens inside | [[How It Works]] |
| See every tool and its arguments | [[Tools Reference]] |
| See the ready-made workflows | [[Recipes]] |
| Set environment variables | [[Configuration]] |
| Know why this is MCP and not a RAG chatbot | [[Why MCP instead of RAG]] |
| Check what it does and doesn't do with data | [[Security and Privacy]] |
| Fix a problem | [[Troubleshooting]] |
| Help improve it | [[Contributing]] |
| Cut a release | [[Release Process]] |

Source code: https://github.com/visubramaniam/raidcom-mcp · npm: https://www.npmjs.com/package/raidcom-mcp
