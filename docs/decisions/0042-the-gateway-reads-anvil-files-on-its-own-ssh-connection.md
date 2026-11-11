# ADR 0042 — The gateway reads Anvil's files over an SSH connection of its own

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-11-11 |
| **Affects** | [ADR 0040](0040-a-runs-output-on-scratch-downloads-as-a-zip-up-to-500-mb.md) (its "the backend already holds one SSH connection … and reads files over SFTP on it"); [ADR 0033](0033-wbm-output-is-read-on-anvil-by-the-toolkit.md) (the `nc` download's read); [`../architecture/gateway.md`](../architecture/gateway.md) |

## Context

The backend reads files on Anvil over SFTP: a run's output as a ZIP ([ADR 0040](0040-a-runs-output-on-scratch-downloads-as-a-zip-up-to-500-mb.md)),
a NetCDF subset ([ADR 0033](0033-wbm-output-is-read-on-anvil-by-the-toolkit.md)), and it removes the
subset when the stream ends. None of that is job management, yet it was done on the connection
`slurmly`, the job library, keeps for `sbatch`, `squeue` and `sacct`: three functions in
`app/services/slurm.py` (`stream_remote_file`, `sftp_session`, `remove_remote_file`) reached into
slurmly's private `client._transport._ensure_conn()`. The use began with the first file read and
grew by precedent; ADR 0040 states it in one sentence and weighs no alternative.

It had three costs, one of them found by measuring the 10 GiB ZIP of [ADR 0041](0041-the-zip-limit-is-10-gib.md)
on the dev pod:

- **A private API of a pinned commit** in three places, where a change of slurmly's internals
  breaks downloads.
- **One connection for everything**: a multi-GiB download and the job sweep shared it, and a
  folder listing took 0.5 s with one ZIP running and 1.1 s with three.
- **No say over the connection's settings**, and the settings were the largest cost. A
  sampling profiler on the dev pod (one 2.5 GiB ZIP) put 51% of the CPU in the socket `send` of
  SFTP read requests, 18% in `recv` and 25% in ChaCha20, and 1.5% in the ZIP writer.
  asyncssh cuts a read into 16 KiB requests when the server states no larger limit (65 536 round
  trips per GiB), and negotiated `chacha20-poly1305`. On the same data, one stream, the pod at
  1000m: 16 KiB and ChaCha20, 48 MB/s and 19.9 CPU-s per GiB; 64 KiB and ChaCha20, 116 MB/s and
  8.5; 64 KiB and `aes128-gcm`, 159 MB/s and 6.1; 128 KiB was no better than 64 KiB, because
  Anvil's `sftp-server` (OpenSSH 8.0p1) answers 65 536 bytes per read whatever is asked (measured
  on a 64 MiB read: requests of 64 KiB, 256 KiB and 1 MiB were each answered with 65 536 bytes, 1024
  reads in all, asyncssh asking again for the rest). slurmly's `connect` takes no cipher setting, so only a connection of
  the gateway's own can have them.

## Decision

**The gateway opens an asyncssh connection of its own for moving files, in
`app/services/anvil_files.py`, and no file read goes through slurmly any more.** slurmly keeps
what it is for: submitting, polling and cancelling jobs, and the shell commands the gateway
runs through `run_remote`.

- One connection per backend process, opened lazily, from the settings slurmly is given
  (`ANVIL_SSH_HOST`, `_PORT`, `_USERNAME`, `_KEY_CONTENT`, else `_KEY_PATH`), with the same
  host-key posture slurmly has (`known_hosts=None`). Without credentials it raises the same
  `AnvilNotConfigured`, so the routes' 503 `anvil_not_configured` is unchanged.
- **It is replaced when it is gone.** A closed connection is replaced on the next call, one
  that fails with a connection-level error (`ConnectionLost`, `DisconnectError`,
  `SFTPConnectionLost`, an `OSError`) is dropped so the next call reconnects, and a file error
  (`SFTPNoSuchFile`) does not drop it. A keepalive (30 s, three unanswered) notices one that
  went silent. Concurrent first callers open exactly one. The lifespan closes it at shutdown.
- **Tuned for bulk reads.** Reads are asked for in 64 KiB pieces (`READ_BLOCK_BYTES`), and the
  ciphers are tried in the order `aes128-gcm`, `aes256-gcm`, `chacha20-poly1305`, in front of
  everything else asyncssh offers, so a server without AES-GCM still connects.
- **A run's ZIP reads its bytes through one remote process, not SFTP.** SFTP costs a request
  per 64 KiB read, and Anvil's `sftp-server` answers no more (measured: requests of 256 KiB and
  1 MiB were each answered with 65 536 bytes). So an archive opens one exec channel running a
  small script with the login node's `/usr/bin/python3` (3.6.8, `-I`), which reads the listed
  files in archive order and writes them as frames: a 4-byte length and up to 1 MiB of data, a
  zero length at a file's end, and an error frame and exit status 3 for a file that is missing,
  a link (`O_NOFOLLOW`), not regular, of another size than listed, or that shrinks or grows while
  read. A plain `cat` was measured too and rejected: a file that changed size would shift the
  next file's bytes into this one's entry and the ZIP would be wrong without any error. The
  listing, the total and the path checks stay on SFTP, and `tree_archive` reads such a source in
  order with no read-ahead (`sequential=True`).
- **The script writes only what the gateway has asked for.** With a client slower than the
  stream, asyncssh 2.24.1 buffered without bound: on resuming a paused channel it refills the
  SSH window while megabytes are still held in the channel's buffer, so the server keeps
  sending (on dev the buffer reached 410 MiB with a 16 MiB window, and a 40 MB/s client got the
  pod OOM-killed at its 1 GiB limit). So the script's stdin carries, after the file list,
  credits: it writes nothing beyond the bytes granted, and the gateway grants 4 MiB at a time
  as it consumes, at most 8 MiB outstanding (`STREAM_CREDIT_BYTES`). If its stdin closes while it
  waits, it exits (status 4). Closing the archive ends the process and the channel.
- The API is `sftp_session()` (one SFTP channel per use), `open_for_read(sftp, path)`,
  `stream_files(entries)` with `read_file(path, size)` in order, `stream_file(path)` (the `nc`
  download, still SFTP), `remove_file(path)` and `close()`; `slurm.py` loses its three functions,
  and `run_files` and `wbm_output` call the new module. The behaviour of the routes does not
  change.

## What was measured

Dev, 2026-11-11: the backend image with this change, one pod at a CPU limit of 1000m, reading
the 10 GiB (40 files of 256 MiB) from Anvil scratch, the client a process in the dev frontend
pod calling the backend service and dropping the bytes (the ingress and the Next.js proxy are
not in the figures), as in ADR 0041.

| | ZIPs at once | Time each | In all | CPU |
|---|---|---|---|---|
| Before (slurmly's connection, 16 KiB, ChaCha20) | 1 | 194 s | 56 MB/s | 172 CPU-s, 17.2 per GiB |
| Before | 3 (a fourth asked) | 619 s | 52 MB/s | 562 CPU-s, 18.7 per GiB |
| Own connection, SFTP 64 KiB, AES-GCM | 1 | 65 s | 166 MB/s | 56 CPU-s, 5.6 per GiB, 0.86 core |
| Own connection, SFTP 64 KiB, AES-GCM | 3 | 207 s | 155 MB/s | 183 CPU-s, 6.1 per GiB, 0.88 core |
| **Framed stream with credits** (what this decides) | 1 | **48 s** | **223 MB/s** | 43 CPU-s, **4.3 per GiB** |
| **Framed stream with credits** | 3 | **122 to 135 s** | **237 MB/s** | 126 CPU-s, **4.2 per GiB**, 0.93 core |

Reading alone, without the ZIP and HTTP, the same 2.5 GiB took 6.0 CPU-s per GiB over SFTP,
3.6 with one `cat` per file and 3.0 with one process for all files; the rest of the 4.2 is the
ZIP writer, the checksums and the HTTP response. With the credits, a client inside the pod
reading at 40 MB/s held the server at 173 MB for its whole first GiB (the version without them
was killed within seconds), one reading as fast as it could at 175 MB; after that client left
mid-stream, no script was left running on the login node. The script was run on Anvil's own
Python 3.6.8: with a credit of 1 MiB it wrote exactly 1 048 576 bytes and waited, then exited 4
when its input closed; with enough credit it wrote 268 436 484 bytes for a 256 MiB file (the data
and 1028 bytes of frame headers) and exited 0.

Every ZIP was 10.00 GiB with `Content-Length` equal to the bytes sent and the first byte after
about 1.2 s, and the pod was never throttled. With the SFTP reads a folder listing took a median
of 0.40 s with one ZIP and 0.48 s with three (0.50 s and 0.76 s on slurmly's connection), and
with the framed stream 0.44 s and 0.82 s; a request that does not touch Anvil, a
median of 7 and 13 ms. Against the real server the negotiated cipher was `aes128-gcm`; an aborted
connection was replaced by the next call; a missing folder raised `SFTPNoSuchFile` and left the
connection in place. The 10 GiB is read from the same cached files each time; a first read of cold
files was not measured.

## Consequences

- **A pod serves about four times what it did**: 223 to 237 MB/s per core where it served 52 to
  56, and the places per pod (three) bind before the CPU does. The sizing in ADR 0041 (a 10 GiB
  ZIP is about 180 CPU-seconds, a pod at 500m about 30 MB/s) is superseded by about 43
  CPU-seconds and about 230 MB/s at 1000m.
- A ZIP now runs a process on the login node for as long as it streams. RCAC stops front-end
  processes that use significant processor time
  ([front-end use](https://db.rcac.purdue.edu/policies/frontenduse)); what counts as significant
  is not stated, so the load was measured (below) and is bounded by the three places per pod.
- **The script needs a Python 3.6 or newer on the login node**, at `ANVIL_REMOTE_PYTHON`
  (default `/usr/bin/python3`, which is 3.6.8 on Anvil). The first ZIP after the connection is
  opened runs `<python> -I -c <version>` there and remembers a success; a missing interpreter
  (status 127), a failing one, an answer that is not a version or a version below 3.6 refuses the
  ZIP before any byte, as `503 anvil_unreachable` with a message that names no path (the detail,
  with the setting to change, is in the log). The script also refuses to run on an older
  interpreter itself.
- The backend holds **two** SSH connections to Anvil per process, not one (slurmly's and this
  one), and N pods hold 2N. What Anvil's login nodes tolerate was not measured past two pods
  with one connection each.
- The job sweep no longer waits behind a download's reads on the connection. It still shares
  the login node with them.
- `slurm.py` no longer reaches into slurmly's private transport for files. It still does for
  commands (`run_remote` uses slurmly's `_run`), which is the one place to change when the pin
  moves.
- Host keys are not verified, as before; moving to a pinned `known_hosts` is one change in
  `_connect_kwargs` here and one in slurmly's connect, and not part of this decision.
- The `nc` download's own read (`stream_file`) and its removal (`remove_file`) were run against
  Anvil from the dev pod (a 50 MiB file read whole, a read closed after its first chunk, a second
  removal of the same file, a missing file raising `SFTPNoSuchFile`); the toolkit step that
  writes the subset was not run on dev, where no run has toolkit output.

## Risks that were measured afterwards (2026-11-11, dev)

- **Load on the login node**: three ZIPs at once for 138 s (30 GiB): the three scripts used 7, 7
  and 6 CPU-seconds (5 to 6% of a core each) and the connection's `sshd` 31 (about 20% of a core),
  about 1.7 CPU-seconds per GiB in all and a little over a third of one core at 237 MB/s.
- **Files not in any cache**: 3.5 GB of files not read for a month were read at 1.6 GB/s the first
  time, 2.4 GB/s the second time and 1.4 GB/s from another login node, against the 223 to
  237 MB/s the gateway can carry, so the first read of cold output does not limit a ZIP.
- **The ingress and the Next.js proxy**: a 2.1 GB published ZIP (the public route, which reads
  S3, so it is not a run's ZIP) came through whole with `Content-Length` equal to the bytes. The
  backend alone gave 112 MB/s, the Next.js proxy without the ingress 118 MB/s (the proxy costs
  nothing; the frontend pod used 0.18 of a core and was not throttled), and the path through the
  ingress 70 to 77 MB/s for one download, from a login node and from inside the cluster, and
  47 MB/s each for three at once (141 in all). So the ingress limits one download to about
  70 MB/s; its configuration cannot be read from here. A person on a home line (about 37 MB/s)
  does not reach it. A run's ZIP through the ingress was not run, since that needs a signed-in
  session.

## Places per pod: six (2026-11-11)

Three places per process (`MAX_ARCHIVES`, now the setting `ARCHIVE_MAX_CONCURRENT`) was too few
for a workshop, and the limit that fixes the most is not CPU but the connection: **one SSH
connection to Anvil accepts 10 channels at once** (measured on dev: the 11th exec channel was
refused with `ChannelOpenError`, and an SFTP channel could not be opened while ten were held). A
run's ZIP holds one for as long as it streams, and a listing, a total, a pre-flight or the `nc`
download needs another for a moment, so the setting must stay at 8 or less. **Its default is 6**:
four channels remain for the short ones, and one core's roughly 220 MB/s gives each of six about
37 MB/s, an ordinary home line.

Measured on dev with six ZIPs of 10 GiB at once on one pod at 1000m: all six complete, each
10.00 GiB with `Content-Length` equal to the bytes, 163 to 171 s each (63 to 66 MB/s), **377 MB/s
in all**, the backend at 0.91 core and **2.6 CPU-s per GiB** (less than the 4.2 at one to three
streams, since fewer socket calls are made per byte as the buffers fill), no throttling. The
backend process peaked at **201 MB** (the credits bound each stream), listings took a median of
0.87 s and at most 1.7 s, and a request that does not touch Anvil a median of 31 ms and at most
60 ms. The published ZIPs, which read S3 and share the same places, hold 64 MiB of read-ahead
each, so six of them buffer at most 384 MiB, inside the pod's 1 GiB.

The Next.js proxy then needs about 2.5 CPU-seconds per GiB (measured: 5 CPU-s for the 2.1 GB
ZIP through the ingress, outside the pod), 0.9 of a core at 377 MB/s, and the frontend's limit
was 500m, which would have capped the pair near 200 MB/s. Its limit is now 1000m (Node uses one
core at most). That the proxy carries 377 MB/s was **not** measured: a run's ZIP through it needs
a signed-in session, and the public ZIP that can be fetched without one is limited to about
140 MB/s by the backend reading S3. The ingress, separately, held one download to about 70 MB/s
(Consequences above), so a person sees at most that, whatever the pod can carry.
