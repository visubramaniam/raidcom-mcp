# Quick Start

The fastest way is the public instance: nothing to install, no account, no sign-in.

**Endpoint:** `https://raidcom-mcp.onrender.com/mcp`

## 1. Connect your assistant

**Claude (desktop or web)**
1. Settings → Connectors → **Add custom connector**.
2. Name it `raidcom`, paste the endpoint, and leave the advanced (OAuth) settings empty.
3. Enable it for a chat from the tools menu.

**Claude Code**
```bash
claude mcp add --transport http raidcom https://raidcom-mcp.onrender.com/mcp
```
Run `/mcp` in a session to check it's connected.

**GitHub Copilot (VS Code)**

Add to `.vscode/mcp.json` (or run **MCP: Add Server → HTTP** from the Command Palette):
```json
{ "servers": { "raidcom": { "type": "http", "url": "https://raidcom-mcp.onrender.com/mcp" } } }
```
Open Copilot Chat in **Agent** mode and enable the `raidcom_*` tools.

**Microsoft 365 Copilot (Copilot Studio agent)**
1. Your agent → **Tools → Add a tool → New tool → Model Context Protocol**.
2. Name `raidcom`, the endpoint as the URL, a description such as *Builds and validates Hitachi raidcom commands and scripts*.
3. Authentication **None** → **Create** → **Create a new connection** → **Add to agent**.

Prefer to run it locally? `npx -y raidcom-mcp` starts it over stdio; see [[Deploying]].

## 2. Ask for something

Try these:

- *Which raidcom command maps a volume to a host group?*
- *Give esx01 four 100 GB volumes from pool 0 on CL1-A and CL2-A on a VSP One B28. The host WWN is 21000024ff8a1b2c.*
- *Write a script that creates LDEVs 300 to 307 of 50 GB in pool 1, using instance 0, with the resource group locked.*
- *Check this command for a B28: `raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 3000`* (LUN 3000 is out of range, and it says so).
- *Create a mainframe pool from parity group 1-2 with LDEVs dd:00 to dd:0f.*

Tell it your model (for example *VSP One B28*, *VSP 5000*, *E990*) so values are checked against that model's limits, and your HORCM instance number so it's written as `-I<n>`.

## 3. Run the result yourself

raidcom-mcp only builds text. Copy the command or script to a host with CCI installed and a running HORCM instance, read it through, and run it. For anything you haven't run before on that array, try it first with `-checkmode precheck` (ask the assistant to add it).

Scripts with `login: true` read credentials from `$RAIDCOM_USER` and `$RAIDCOM_PASSWORD` in your shell; they're never written into the script.
