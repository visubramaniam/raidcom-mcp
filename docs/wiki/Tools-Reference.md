# Tools Reference

All eight tools are annotated read-only and non-destructive: they return text and change nothing anywhere.

| Tool | Title | Use it to |
|---|---|---|
| `raidcom_list_commands` | Find raidcom commands | Find the command for a task (`query`), or list commands by `action`/`object` |
| `raidcom_describe_command` | Describe a raidcom command | See syntax forms, options, accepted values and examples |
| `raidcom_build_command` | Build a raidcom command | Build and validate one command |
| `raidcom_check_command` | Check a raidcom command line | Validate and explain a command line you already have |
| `raidcom_build_script` | Build a raidcom script | Build a script from steps, with `foreach`/`zip` loops |
| `raidcom_list_recipes` | List raidcom recipes | List or search ready-made workflows |
| `raidcom_build_recipe` | Build a raidcom recipe script | Turn a recipe and its parameters into a script |
| `raidcom_model_limits` | Show storage model limits | Valid ID and port ranges for a model |

## Common arguments

- **`model`**: `vsp-one-b24`, `vsp-one-b26`, `vsp-one-b28`, `vsp-5000`, `vsp-e590`, `vsp-e790`, `vsp-e990`, `vsp-e1090`. Aliases like `B28`, `E990` or `5600` work. Without it, values are checked against the widest range of any model.
- **`global`**: `instance` (written `-I<n>`), `pair_type` (`H`, `M`, `TC`, `SI`; written `-IH<n>` etc.), `serial` (`-s`), `unit` (`-u`), `fx`, `nomsg`, `checkmode: "precheck"`, `store`.
- **`options`**: raidcom options keyed by name, with or without the dash. A value is a string or number; options that take several values take an array (`"-port": ["CL1-A-0", "esx01"]`); a switch is `true`.
- **`strict`**: default `true`. The manual's syntax lines are occasionally incomplete; `false` turns "needs <option>" errors into warnings. Unknown options and out-of-range values stay errors.

## Examples

**raidcom_build_command**
```json
{ "command": "add ldev", "options": { "-pool": 0, "-ldev_id": 256, "-capacity": "100G" }, "model": "B28", "global": { "instance": 0 } }
```
→ `raidcom add ldev -pool 0 -ldev_id 256 -capacity 100G -I0`

**raidcom_check_command**
```json
{ "command_line": "raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 3000", "model": "B28" }
```
→ error: `-lun_id: LUN 3000 is outside 0 to 2047 for VSP One Block 28`

**raidcom_build_script**
```json
{
  "steps": [
    { "title": "Create LDEVs", "command": "add ldev", "options": { "-pool": 0, "-ldev_id": "{n}", "-capacity": "10G" }, "foreach": { "n": "300-303" } },
    { "title": "Map them", "command": "add lun", "options": { "-port": ["CL1-A-0"], "-ldev_id": "{n}", "-lun_id": "{l}" }, "zip": { "n": "300-303", "l": "0-3" } }
  ],
  "global": { "instance": 0 },
  "lock_resource": true
}
```
→ a script that locks the resource group, resets the asynchronous error status, creates four LDEVs and checks them with `get command_status`, then does the same for mapping LDEV 300 to LUN 0, 301 to LUN 1, and so on, and unlocks.

**raidcom_build_recipe**
```json
{ "recipe": "create-dp-pool", "params": { "pool_id": 1, "pool_name": "gold", "pool_ldevs": ["300-307"] } }
```

Ranges: `"100-109"` (decimal) and `"dd:00-dd:0f"` (mainframe CU:LDEV); single LDEV IDs can also be `0x` hex. Lists and ranges stop at 500 values; a script holds at most 500 commands.

## Resources and prompts

- Resources: `raidcom://notes/conventions` (login, instances, serials, async commands, locking), `raidcom://notes/horcm-setup` (a minimal HORCM file), `raidcom://catalog/commands` (every command with its summary).
- Prompts: `build-raidcom-commands` (turn a task into commands) and `explain-raidcom-command` (explain and check a command line).
