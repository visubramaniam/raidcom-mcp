# Minimal HORCM configuration for raidcom

A file with only `HORCM_CMD` is enough to run raidcom. Save it as `/etc/horcm0.conf` for instance 0.

Physical command device (the volume is mapped to this host and shows up as a SCSI device):

    HORCM_CMD
    \\.\CMD-<serial>-<ldev#>:/dev/sd*

Out-of-band (IP) command device, which needs only network access to the controller or SVP:

    HORCM_CMD
    \\.\IPCMD-<ip address>-31001

Both forms can be mixed in one file. Out-of-band command devices are slower, so prefer a physical command device
for long scripts.

Find command devices on Linux with `ls /dev/sd* | raidscan -find`.

Start the instance and log in:

    horcmstart.sh 0
    export HORCMINST=0
    raidcom -login <user> <password>

Replication (paircreate and friends) additionally needs `HORCM_MON`, `HORCM_LDEV` or `HORCM_DEV`, and
`HORCM_INST` sections. Those commands are outside this server's scope.
