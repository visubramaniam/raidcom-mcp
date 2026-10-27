// MCP tool definitions. Descriptions are written for the calling model: they say when to use each tool, what the
// arguments look like, and give a worked example, because that is what turns a free-text request into valid
// arguments.
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const globalSchema = {
  type: "object",
  description: "Settings that apply to the whole command, not to one raidcom option.",
  properties: {
    instance: { type: "integer", minimum: 0, description: "CCI instance number: written as -I<n>. Example: 0." },
    pair_type: { type: "string", enum: ["H", "M", "TC", "SI"], description: "With instance: H or TC for TrueCopy, Universal Replicator and global-active device; M or SI for ShadowImage, Volume Migration and Thin Image." },
    serial: { type: ["string", "integer"], description: "Storage system serial number (-s), needed when the HORCM file lists several arrays. VSP 5000 series add a leading 5, VSP G1x00 and VSP F1500 a leading 3." },
    unit: { type: "integer", minimum: 0, description: "Unit ID of the command device (-u)." },
    fx: { type: "boolean", description: "Print LDEV numbers in hexadecimal (-fx)." },
    nomsg: { type: "boolean", description: "Suppress messages (-nomsg)." },
    checkmode: { type: "string", enum: ["precheck"], description: "Check the command without changing the array (-checkmode precheck)." },
    store: { type: "string", description: "File name for the implementation-check file (-store)." },
  },
  additionalProperties: false,
} as const;

const modelSchema = {
  type: "string",
  description:
    "Storage model, so values are checked against its limits: vsp-one-b24, vsp-one-b26, vsp-one-b28, vsp-5000, vsp-e590, vsp-e790, vsp-e990, vsp-e1090. Aliases such as B28 or E990 work. " +
    "Omit it to check against the widest range of any model.",
} as const;

const optionsSchema = {
  type: "object",
  description:
    "raidcom options and their values, keyed by option name with or without the leading dash. A value is a string or number; an option that takes several values (for example -port takes a port and an optional host group name) " +
    "takes an array: {\"-port\": [\"CL1-A-0\", \"esx01\"]}. An option with no value (a switch such as -allports) is true. Example for `add lun`: {\"-port\": [\"CL1-A-0\"], \"-ldev_id\": 200, \"-lun_id\": 1}.",
  additionalProperties: { type: ["string", "number", "boolean", "array"], items: { type: ["string", "number"] } },
} as const;

const strictSchema = {
  type: "boolean",
  description:
    "Default true. The command catalogue is parsed from the manual, whose syntax lines are occasionally incomplete, so a \"needs <option>\" error can be a false alarm. " +
    "If one looks wrong after reading raidcom_describe_command, retry with strict=false: missing-option errors then become warnings. Unknown options and out-of-range values stay errors.",
} as const;

const stepSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short label, written into the script as a comment." },
    command: { type: "string", description: "Command name, e.g. \"add ldev\"." },
    options: optionsSchema,
    foreach: {
      type: "object",
      description:
        "Repeat the step for every value (cartesian product when there are several variables). Variable → list or range: {\"ldev\": \"100-109\"} or {\"port\": [\"CL1-A\", \"CL2-A\"]}. " +
        "Reference a variable in option values as {ldev}. Example: options {\"-ldev_id\": \"{ldev}\"} with foreach {\"ldev\": \"100-109\"} writes ten commands.",
      additionalProperties: { type: ["string", "array"], items: { type: ["string", "number"] } },
    },
    zip: {
      type: "object",
      description: "Like foreach, but the variables advance together and the lists must have the same length: {\"ldev\": \"100-103\", \"lun\": \"0-3\"} pairs LDEV 100 with LUN 0, 101 with 1, and so on.",
      additionalProperties: { type: ["string", "array"], items: { type: ["string", "number"] } },
    },
  },
  required: ["command"],
  additionalProperties: false,
} as const;

export function tools(): Tool[] {
  return [
    {
      name: "raidcom_list_commands",
      description:
        "Find raidcom commands. Use this first when you do not know the exact command name. With no arguments, lists every object (ldev, lun, host_grp, pool, ...) with the actions available on it. " +
        "With `query` (plain words, e.g. \"map a volume to a host group\", \"grow a pool\", \"show free ldev ids\"), ranks matching commands and rates the confidence of the top result. " +
        "With `action` and/or `object`, lists exactly those commands. Then call raidcom_describe_command, or raidcom_build_command if you already know the options.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What you want to do, in plain words." },
          action: { type: "string", description: "Only this action: add, delete, get, modify, extend, initialize, set, reset, ..." },
          object: { type: "string", description: "Only this object: ldev, lun, host_grp, hba_wwn, pool, dp_pool, port, parity_grp, ..." },
          limit: { type: "integer", minimum: 1, maximum: 40, description: "Maximum results for a query (default 10)." },
        },
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "raidcom_describe_command",
      description:
        "Everything needed to build one raidcom command: what it does, which models support it, whether it is read-only, destructive or asynchronous, each syntax form, every option with the number and kind of values it takes " +
        "(and the words it accepts, where it accepts only a few), and examples. Call it before raidcom_build_command when you are unsure which options a command needs or which of its syntax forms fits the request.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command name, e.g. \"add lun\" or \"raidcom get ldev\"." },
          option: { type: "string", description: "Only describe this option, e.g. \"-ldev_id\"." },
        },
        required: ["command"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "raidcom_build_command",
      description:
        "Build one raidcom command from structured arguments and validate it. Nothing is executed and no storage system is contacted: you get command text to review and run elsewhere. " +
        "Unknown options, wrong value counts, missing required options, bad port names and out-of-range LDEV, LUN, pool and serial numbers are reported as errors with a fix. " +
        "Example: {\"command\": \"add ldev\", \"options\": {\"-pool\": 0, \"-ldev_id\": 256, \"-capacity\": \"100G\"}, \"model\": \"vsp-one-b28\", \"global\": {\"instance\": 0}} → `raidcom add ldev -pool 0 -ldev_id 256 -capacity 100G -I0`. " +
        "For many similar commands use raidcom_build_script, not repeated calls. When the user asks for a command, show them the `command` from the result.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command name: action and object, e.g. \"add lun\", \"get ldev\", \"modify host_grp\"." },
          options: optionsSchema,
          model: modelSchema,
          global: globalSchema,
          strict: strictSchema,
        },
        required: ["command"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "raidcom_check_command",
      description:
        "Validate and explain a raidcom command line the user already has (for example one pasted from a runbook). It is parsed, not executed: shell operators such as ; | & > are refused. " +
        "Returns the normalised command, what each option means, and every problem found. Credentials after -login are dropped.",
      inputSchema: {
        type: "object",
        properties: {
          command_line: { type: "string", description: "One raidcom command, e.g. \"raidcom add lun -port CL1-A-0 -ldev_id 200 -lun_id 1\"." },
          model: modelSchema,
          strict: strictSchema,
        },
        required: ["command_line"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "raidcom_build_script",
      description:
        "Build a shell script of raidcom commands from steps. Each step is a command with options, optionally repeated with `foreach` (every combination) or `zip` (values advance together), so \"create LDEVs 100 to 109 in pool 0, then map each to port CL1-A\" is two steps. " +
        "Every expanded command is validated; the script is returned only if all of them are valid, otherwise you get the errors per step. The script checks each command's exit status, adds `raidcom get command_status` after asynchronous commands, " +
        "and can lock the resource group and log in (credentials are read from RAIDCOM_USER and RAIDCOM_PASSWORD in the user's shell, never written into the script). Nothing is executed.",
      inputSchema: {
        type: "object",
        properties: {
          steps: { type: "array", minItems: 1, items: stepSchema },
          model: modelSchema,
          global: globalSchema,
          strict: strictSchema,
          login: { type: "boolean", description: "Add raidcom -login / -logout using $RAIDCOM_USER and $RAIDCOM_PASSWORD." },
          lock_resource: { type: "boolean", description: "Wrap the commands in raidcom lock resource / unlock resource. Recommended for changing commands." },
          description: { type: "string", description: "A one-line comment for the top of the script." },
        },
        required: ["steps"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "raidcom_list_recipes",
      description:
        "Ready-made workflows: provision volumes to an FC, iSCSI or NVMe/TCP host, create or grow a pool, extend or delete volumes, create a command device, reclaim zero pages, read-only inventory, copy groups. " +
        "With no arguments lists them. With `recipe`, shows its parameters and steps. With `query`, ranks recipes by keyword. Use raidcom_build_recipe to turn one into a script.",
      inputSchema: {
        type: "object",
        properties: {
          recipe: { type: "string", description: "Recipe ID to show in detail, e.g. provision-fc-volumes." },
          query: { type: "string", description: "Words describing the task, e.g. \"new ESXi host\"." },
        },
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "raidcom_build_recipe",
      description:
        "Build the script for a recipe from its parameters (see raidcom_list_recipes). Lists such as ldev_ids accept ranges: [\"100-109\"]. " +
        "Example: recipe provision-fc-volumes with {\"pool\": 0, \"ldev_ids\": [\"100-103\"], \"capacity\": \"100G\", \"ports\": [\"CL1-A\", \"CL2-A\"], \"host_grp\": \"esx01\", \"host_mode\": \"VMWARE_EX\", \"wwns\": [\"210000e08b0256f8\"]}. " +
        "Returns the script and the individual commands. Nothing is executed.",
      inputSchema: {
        type: "object",
        properties: {
          recipe: { type: "string", description: "Recipe ID." },
          params: { type: "object", description: "Recipe parameters.", additionalProperties: true },
          model: modelSchema,
          global: globalSchema,
          strict: strictSchema,
          login: { type: "boolean", description: "Add raidcom -login / -logout using $RAIDCOM_USER and $RAIDCOM_PASSWORD." },
          lock_resource: { type: "boolean", description: "Wrap the commands in raidcom lock resource / unlock resource." },
        },
        required: ["recipe", "params"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "raidcom_model_limits",
      description:
        "Valid parameter ranges for a storage model (serial number, LDEV ID, pool ID, LU number, port names), taken from the Command Reference appendices. Without `model`, lists the models.",
      inputSchema: { type: "object", properties: { model: modelSchema } },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
  ];
}
