# raidcom conventions

These notes cover what surrounds a raidcom command. This server only builds command text; the commands run on a
host that has Command Control Interface (CCI) installed and can reach the storage system.

## Before the first command

- A HORCM instance must be running on the host (`horcmstart.sh <instance>`), and its configuration file needs a
  `HORCM_CMD` section that names a command device (a small LDEV mapped to the host) or an IP command device
  (`\\.\IPCMD-<SVP or controller IP>-31001`). Select the instance with `HORCMINST` or the `-I<n>` option.
- raidcom needs a login: `raidcom -login <user> <password>`. Without it raidcom prompts for every array in the
  HORCM file. Log out when finished (`raidcom -logout`); the array only keeps a limited number of logins.
- The account needs storage administration rights to run changing commands.

## Serial numbers (`-s`)

Needed when the HORCM file lists more than one array. The number you type is not always the number on the
label: VSP 5000 series add a leading 5 (label 12345 becomes 512345), VSP G1x00 and VSP F1500 add a leading 3
(312345). Pass `model` so the server checks the range.

## Instances (`-I`)

`-I0` selects instance 0. `-IH0` and `-ITC0` pick the TrueCopy / Universal Replicator / global-active device
side, `-IM0` and `-ISI0` the ShadowImage / Thin Image side. Without `-I`, the `HORCMINST` and `HORCC_MRCF`
environment variables decide.

## Asynchronous commands

Many changing commands (`add ldev`, `add lun` with `-request_id auto`, `modify ldev -status ...`, pool and
parity group operations) return before the array has finished. Run `raidcom reset command_status` before them and
`raidcom get command_status` afterwards; an empty error column means success. The array keeps only the first error
of a login session until it is reset, so without the reset, `get command_status` can report an old failure and hide
the error codes of a new one. Give a code from the SSB columns to `raidcom get error_message` to read the
reason. Only a limited number of asynchronous commands can be queued at once, so very large batches should be
split.

## Resource locking

Changing commands should run with the resource group locked so other tools (Storage Navigator, Ops Center,
other raidcom users) do not change the same objects at the same time:

    raidcom lock resource -I0
    ... changing commands ...
    raidcom unlock resource -I0

`raidcom lock resource -time <seconds>` limits how long the lock may be held; `-automatic_unlock` releases it
automatically.

## Checking before changing

`-checkmode precheck` makes raidcom check a command without applying it. Use it first on commands you have not
run before on a given model.

## LDEV numbers

Commands take decimal numbers (`-ldev_id 256`), hexadecimal with a 0x prefix, or CU:LDEV in hexadecimal as used for
mainframe volumes (`-ldev_id dd:0f`). `-fx` prints LDEV numbers in
hexadecimal. Ranges like `-ldev_id 100-110` are accepted by the reporting commands.
