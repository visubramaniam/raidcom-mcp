# Changelog

## Unreleased

## 0.1.0

First version.

- Eight read-only MCP tools: `raidcom_list_commands`, `raidcom_describe_command`, `raidcom_build_command`, `raidcom_check_command`, `raidcom_build_script`, `raidcom_list_recipes`, `raidcom_build_recipe`, `raidcom_model_limits`.
- A catalogue of 178 commands (218 syntax forms, 562 examples) generated from the Command Reference, with per-model limits for VSP One Block 24/26/28, VSP 5000 series and VSP E series.
- Thirteen recipes: FC, iSCSI and NVMe/TCP provisioning, DP pools, extending and deleting volumes, command devices, zero-page reclaim, inventory, copy groups.
- Stdio and stateless Streamable HTTP transports (bearer token, TLS or proxy, host and origin checks, rate limit).
- Build-only by design: no tool connects to a storage system or runs a command.
