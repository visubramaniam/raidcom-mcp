# Recipes

Recipes are ready-made, validated workflows. List them with `raidcom_list_recipes` and build one with `raidcom_build_recipe`; or just describe the task and the assistant will pick one. Parameters marked * are required. List parameters accept ranges such as `"100-109"`.

| Recipe | What it does | Parameters |
|---|---|---|
| `provision-fc-volumes` | Provision volumes to a Fibre Channel host. Create DP volumes in a pool, create a host group on one or more ports, set its host mode, register the host's WWNs and map the volumes to it. | `pool`*, `ldev_ids`*, `capacity`*, `ports`*, `host_grp`*, `host_mode`*, `host_mode_opt`, `wwns`* |
| `provision-iscsi-volumes` | Provision volumes to an iSCSI host. Create DP volumes, create an iSCSI target on a port, register the initiator's IQN and map the volumes. | `pool`*, `ldev_ids`*, `capacity`*, `ports`*, `target`*, `host_mode`*, `iqns`* |
| `provision-nvme-tcp-namespaces` | Provision namespaces to an NVMe/TCP host. Create volumes, an NVM subsystem with its ports, register the host NQN, add namespaces and give the host access to them. | `pool`*, `ldev_ids`*, `capacity`*, `ns_ids`*, `nvm_subsystem_id`*, `nvm_subsystem_name`, `ports`*, `host_nqn`* |
| `create-dp-pool` | Create a Dynamic Provisioning pool. Create a pool from existing LDEVs (or a parity group), then check it. | `pool_id`*, `pool_name`*, `pool_ldevs`*, `warning_threshold`, `depletion_threshold` |
| `grow-dp-pool` | Add pool volumes to a pool. Expand an existing Dynamic Provisioning pool with more pool volumes. raidcom cannot shrink a pool. | `pool_id`*, `pool_ldevs`* |
| `extend-dp-volume` | Extend DP volumes. Grow DP volumes online. The capacity is the amount to ADD, not the new size, and the change cannot be undone. | `ldev_ids`*, `add_capacity`* |
| `unmap-and-delete-volumes` | Unmap and delete volumes. Remove the LU paths of volumes, then delete the volumes. Destructive. | `ports`*, `host_grp`*, `ldev_ids`* |
| `rename-host-group` | Rename a host group. raidcom has no rename for host groups: adding a group with the same ID and a new name renames it. Find the ID first. | `port`*, `host_grp_id`*, `new_name`* |
| `create-command-device` | Create a command device. Create a small volume, turn it into a command device and map it to the CCI host. | `pool`*, `ldev_id`*, `capacity`*, `security`, `port`*, `host_grp`*, `lun_id` |
| `reclaim-zero-pages` | Reclaim zero pages. Start zero page reclamation on DP volumes and check that it finished. | `ldev_ids`* |
| `inventory-report` | Read-only inventory of a storage system. Commands that report ports, parity groups, pools, host groups and LDEVs. Nothing is changed. | none |
| `create-copy-group` | Create device groups and a copy group. Put primary and secondary LDEVs into device groups and tie them together in a copy group, ready for paircreate. | `primary_group`*, `primary_ldevs`*, `secondary_group`*, `secondary_ldevs`*, `copy_group`*, `device_prefix`* |
| `check-async-result` | Check an asynchronous command. Show the result of asynchronous commands and look up an error code. | `request_id` |
| `create-mainframe-pool` | Create a mainframe (3390) Dynamic Provisioning pool. Create a parity group with the 3390-V mainframe emulation type, create and quick-format 3390-V LDEVs on it, optionally assign them an SSID, and make them the volumes of a DP pool. | `parity_grp_id`*, `drive_locations`*, `raid_type`*, `ldev_ids`*, `ldev_capacity`*, `ssid`, `pool_id`*, `pool_name`* |

## Example

```json
{ "recipe": "provision-fc-volumes",
  "params": { "pool": 0, "ldev_ids": ["256-259"], "capacity": "100G", "ports": ["CL1-A", "CL2-A"],
              "host_grp": "esx01", "host_mode": "VMWARE_EX", "wwns": ["21000024ff8a1b2c"] },
  "model": "vsp-one-b28", "global": { "instance": 0 }, "lock_resource": true }
```

produces a script that creates four LDEVs, creates the `esx01` host group on both ports, sets its host mode, registers the WWN and maps every LDEV on both ports, with `get command_status` after the asynchronous steps.

## Adding a recipe

Recipes live in `spec/recipes.json`. Each has a title, summary, keywords, parameters, steps (the same format as `raidcom_build_script`, with `{param}` templates and an optional `when` naming the parameters a step needs) and notes. Add sample parameters to `tests/unit/recipes.test.mjs`, which builds every recipe. See [[Contributing]].
