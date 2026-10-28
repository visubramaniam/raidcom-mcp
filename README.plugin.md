# The raidcom-community Claude plugin

**raidcom-community** is a Claude plugin that installs the [raidcom-mcp](README.md) server, so Claude can turn a storage task into validated Hitachi `raidcom` commands and scripts. It also adds a skill, `raidcom-command-builder`, that guides Claude through the work.

> Not an official Hitachi Vantara product: raidcom-mcp and this plugin are an independent community project, not supported by or affiliated with Hitachi Vantara.

It is **build-only**. It needs no credentials and no access to a storage system, and it never runs a command. Claude shows you the command or script; you review it and run it on a host with CCI installed.

## Where it works

| Where | Works? |
|---|---|
| **Claude Code**: terminal, IDE extensions, and the desktop app's Code tab | Yes |
| **Claude chat** (claude.ai, desktop and mobile chat) | No: chat doesn't run plugins' local servers. Add the hosted server as a custom connector instead: `https://raidcom-mcp.onrender.com/mcp` ([details](README.md#use-the-hosted-server)) |

## Install

Requires Node.js 22.19 or later, with npm. In a Claude Code session:

```
/plugin install raidcom-community --marketplace visubramaniam/raidcom-mcp
```

Or from your shell:

```bash
claude plugin marketplace add visubramaniam/raidcom-mcp
claude plugin install raidcom-community@raidcom-community
```

Claude Code installs the server from the plugin's lockfile: the `raidcom-mcp` npm package and its dependencies, each pinned to an exact version and checked against an integrity hash. No install scripts run, and there are no settings to fill in.

## Use

Ask in plain language:

- *"Present four 100 GB volumes from pool 0 to host esx01 on CL1-A and CL2-A on a VSP One Block 28."*
- *"Write the commands to create a mainframe pool from these drives."*
- *"Check this command: raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1"*
- *"Which raidcom command shows free LDEV IDs?"*

Start the skill by name with `/raidcom-community:raidcom-command-builder`.

## Update, disable and uninstall

```bash
claude plugin update raidcom-community@raidcom-community
claude plugin disable raidcom-community@raidcom-community
claude plugin uninstall raidcom-community@raidcom-community
```

Each plugin version installs the matching `raidcom-mcp` version. The plugin moves to each new server release shortly after it's on npm (an automated pull request), and its own releases are tagged `plugin-v<version>`. [CHANGELOG.md](CHANGELOG.md) lists what changed.

## Privacy

The server runs on your computer, makes no network requests and stores nothing. Requests you make to Claude go to Anthropic as usual; the plugin adds nothing to them beyond the tool results.
