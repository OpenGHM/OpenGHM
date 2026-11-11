# ADR 0041 — The ZIP limit is 10 GiB, with an exact length at any size and a question before a large one

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-11-09 |
| **Affects** | the limit of [ADR 0036](0036-a-folder-downloads-as-a-zip-up-to-500-mb.md) (published trees) and [ADR 0040](0040-a-runs-output-on-scratch-downloads-as-a-zip-up-to-500-mb.md) (a run's output on scratch); [`../architecture/gateway.md`](../architecture/gateway.md) (§5 and "Downloading a run's output") |

## Context

Both ZIP downloads stopped a selection at 500 MB (500 × 1024² bytes). A run's daily output is
larger than that, so a person with a finished run on scratch could download none of it from the
page. ADR 0036 and 0040 called raising the limit "a decision to revisit, not a setting to turn".
This is that decision, taken after measuring what could be measured.

What was measured (2026-11-05 to 2026-11-09, a synthetic run output of 40 files of 256 MiB,
10 GiB, on Anvil scratch):

- **Totalling the selection**, the step the page runs before Download is allowed (a walk over
  SFTP): 7.5 to 11 s for the whole 10 GiB of 40 files, 2.3 s for one folder of 10. It grows with
  the number of files, not their size.
- **Until the first byte of the ZIP**: 6 to 9 s, since the archive request totals again. After
  that bytes flow; there is no packing step to wait for, because the ZIP is stored and streamed.
- **Throughput to a person** was not measured. From the maintainer's machine to Anvil the link
  carries 1.1 MB/s (208 ms round trip), so a local download measures that link and not the
  gateway.
- **The gateway's own cost on a laptop**, measured 2026-11-09 with the real `run_files` and
  `tree_archive` over one SSH connection (as the backend holds one) to an OpenSSH `sshd` on
  loopback, reading the same 10 GiB and dropping the bytes at once, on one Apple-silicon core:
  1, 2 and 3 ZIPs at once took 26 s, 47 s and 70 s, 393 to 437 MB/s in all, 2.3 to 2.6
  CPU-seconds per GiB. **This is not what the cluster does** (next item): the same code costs
  about seven times as much CPU per GiB in the pod.
- **The gateway's own cost on dev**, measured 2026-11-10 on the dev backend pod (an AMD EPYC
  7763 core) reading the same 10 GiB from Anvil scratch over the real SSH connection, the
  client being a process in the dev frontend pod that called the backend service and dropped
  the bytes (so neither the ingress nor the Next.js proxy is in these figures). Every ZIP came
  out 10.00 GiB with `Content-Length` equal to the bytes sent, and the first byte came after
  1 to 3 s.

  | CPU limit | ZIPs at once | Time each | In all | CPU used |
  |---|---|---|---|---|
  | 500m (what dev and prod set) | 1 | 348 s | 31 MB/s | throttled in 3295 of 3509 periods |
  | 500m | 3 | 1159 s | 28 MB/s | 579 CPU-s, 0.50 core; throttled in 9261 of 11 608 periods |
  | 4000m (temporary) | 1 | 194 s | 56 MB/s | 172 CPU-s, 0.89 core: **17.2 CPU-s per GiB** |
  | 4000m (temporary) | 4 asked | 619 s (three ran) | 52 MB/s | 562 CPU-s, 0.91 core; the fourth refused in 0.06 s with `429` |

  The limit is the CPU of one process: with four cores allowed it still used 0.9 of one (the
  event loop and the GIL), so **a core is worth about 55 MB/s of ZIP, and raising the limit above
  1000m changes nothing**. The cost is 17 to 19 CPU-seconds per GiB, against 2.4 for the same
  code on the laptop. **Where they go** was profiled on the dev pod (2026-11-10, a sampling
  profiler on the event-loop thread, `daily/`, 2.5 GiB, one stream): 51% in the socket `send`
  of the SFTP read requests, 18% in the socket `recv`, 25% in ChaCha20, and 1.5% in the ZIP
  writer; copying and checksumming are not it (`zlib.crc32` 0.3 and a memory copy 0.9
  CPU-seconds per GiB). The cost is per packet, and a packet is small: asyncssh's limits for
  this server are `max_read_len=16384`, so it cuts every read into 16 KiB requests, 65 536 round
  trips per GiB (it is the value asyncssh falls back on when the server states none; that
  Anvil's `sftp-server` states none was not checked). Why a socket call costs several times
  more in the pod than on the laptop (2.4 CPU-seconds per GiB there) was not measured.
  Measured on the same 2.5 GiB, one stream, the pod at 1000m:

  | SFTP read size | Cipher | Speed | CPU per GiB |
  |---|---|---|---|
  | 16 KiB (what is run now) | `chacha20-poly1305` (what is negotiated) | 48 MB/s | 19.9 s |
  | 64 KiB | `chacha20-poly1305` | 116 MB/s | 8.5 s |
  | 64 KiB | `aes128-gcm` | 159 MB/s | 6.1 s |
  | 64 KiB | `aes256-gcm` | 172 MB/s | 5.5 s |
  | 16 KiB | `aes128-gcm` | 78 MB/s | 12.0 s |
  | 128 KiB | `aes128-gcm` | 150 MB/s | 6.5 s (no better than 64 KiB: the server answers 64 KiB per read at most, measured in ADR 0042) |

  So the read size alone gives 2.4 times the speed (`sftp.open(..., block_size=65536)`), and the
  cipher a further 1.4 times; the cipher cannot be chosen through slurmly's `connect` (it passes
  no `encryption_algs`), only on a connection of the gateway's own. **Both were then applied**
  ([ADR 0042](0042-the-gateway-reads-anvil-files-on-its-own-ssh-connection.md): a connection of
  the gateway's own, 64 KiB reads, AES-GCM) and measured again: a lone 10 GiB ZIP in 65 s, three
  in 207 s each. **Every other figure in this ADR was measured before that, at 16 KiB and
  ChaCha20**, on slurmly's shared connection, and is history; the current ones are in 0042.
  Meanwhile a `GET` of a folder's listing, which
  shares the one SSH connection, took a median of 0.5 to 0.6 s with one ZIP running, 0.8 s with
  three and 1.1 s with three at 500m, at most 1.5 s; a request that does not touch Anvil
  answered in a median of 18 to 97 ms and at most 291 ms. Memory was not recorded.

  **Two backend pods** (the deployment scaled to 2 at a 1000m limit, on two nodes), six ZIPs
  asked at once: all six completed in 584 to 617 s, 17 to 18 MB/s each, **104 MB/s in all**,
  every length right, no request refused (the Service happened to send three to each pod; with
  random balancing a pod can be given more than its three and answer `429` while the other is
  idle, which one run does not rule out), each pod using 0.85 to 0.90 of a core and never
  throttled; a listing took a median of 0.75 s, at most 1.2 s, and a request that does not
  touch Anvil a median of 41 ms. Twice the pods gave 1.9 times the throughput of one pod at
  1000m. Neither pod logged an error. No job was settling during the run, so what two pods'
  background sweeps do to one job at the same moment was **not exercised**: from the code, every
  sweep step writes with a compare-and-set on the state it read (`_move`, `_start_continuation`,
  the claim in `_reconcile_continuation`, `write_publish`), the audit event is written by the
  writer that won, a repeated registration is a duplicate key counted as done, and
  `scancel --name` and the purge check are the same however often they run; the cost is that
  each pod makes its own SSH reads for the same sweep.
  Not covered: the ingress and the Next.js proxy.
- **Publishing the same 10 GiB to S3** from an Anvil compute node (the toolkit's own `s3cmd put`
  flags): 9.4 s to hash, 87 s to upload one file at a time, 0.7 s to verify; 4 files at a time
  took 24.6 s. The upload from a login node: 256 MiB in 2.2 s, 1.4 s of CPU, no `ulimit`.
- **A private object with a signed URL** works on Anvil S3: 200 with the signature, 403 without,
  206 for a `Range`, 403 after the expiry.

How other systems set this (read 2026-11-09): Open OnDemand, the dashboard of many HPC
centres, ships a default maximum download of 10737418240 bytes (10 GiB) for a directory
(`OOD_DOWNLOAD_DIR_MAX`; <https://osc.github.io/ood-documentation/latest/customizations.html>).

## Decision

**What is checked in a published tree or in a run's output on scratch downloads as one ZIP of
at most 10 GiB (10 × 1024³ bytes) before compression.** One constant, `ARCHIVE_LIMIT_BYTES`,
sets it for both, as the 500 MB did. Nothing else about ADR 0036 and 0040 changes: the writer,
the confinement, who may download, the codes of every refusal, and at most three archives at
once per process (`MAX_ARCHIVES`), which stays: the cost of three 10 GiB streams at once was
measured on dev and is in Consequences.

- **The exact length is sent at any size.** `archive_length` used to give up above about
  2 GiB, where ZIP64 changes the records, and the browser lost its progress. It now counts the
  ZIP64 records too (a local header's extra field and a longer data descriptor for an entry over
  the margin `zipfile` uses, sizes and offsets in the central directory once they pass
  `ZIP64_LIMIT`, the ZIP64 end record and locator). The tests compare it with the bytes
  `zipfile` itself writes for entries around every threshold, and for 65 535 and 65 536 entries.
  The writer is unchanged.
- **A large ZIP is asked about first.** From 1 GiB, **Download ZIP** opens a dialog that gives
  the size, says the ZIP cannot be resumed (an interrupted download starts over), and says a
  few ZIPs are prepared at a time so it may be refused; for a published tree it names
  `aws s3 sync`, which can resume. A ZIP below 1 GiB goes as before.
- **No resume.** A stored ZIP has each entry's checksum in its directory at the end, so resuming
  at an offset means reading everything before it again, and a browser resumes only a GET while
  the form here is a POST of up to 1000 names. A resumable download is one file, or S3.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Stage the selection in S3 and hand out signed URLs | It works (measured above) and would take the bytes off the cluster, give resume and remove the three-at-once limit. But it needs an upload job (a SLURM job, or a bounded upload from a login node), a state to track, expiry and cleanup of objects on Anvil S3, a quota decision, and an exception to ADR 0023. For the use today it is more than the problem needs. Revisit if the cluster's cost under large downloads turns out to be a problem. |
| Keep 500 MB, and tell people to publish and use S3 | Publishing is the way to keep a result and it is fast (about 100 s for 10 GiB), but a person who only wants a run's daily file would have to publish it. |
| 2 GiB, where the old length code still worked | It would have needed no ZIP64 work, but cuts off the same daily output the change is for. |
| A resumable archive (a deterministic ZIP with precomputed checksums, Range, a GET link) | A checksum per file has to be known before the first byte, so every file is read twice or its checksum is stored somewhere; not worth it before anyone has asked. |

## Consequences

- *(Measured before [ADR 0042](0042-the-gateway-reads-anvil-files-on-its-own-ssh-connection.md);
  a pod now serves about three times what this says: about 6 CPU-seconds per GiB, 155 to 166 MB/s
  per core at 1000m.)* A request costs the cluster up to 10 GiB in and out, and three at once
  30 GiB. On dev the
  backend spent 17 to 19 CPU-seconds per GiB, so **a 10 GiB ZIP was about 180 CPU-seconds**, and
  one pod with a 500m limit serves about 30 MB/s of ZIP in all, however many people ask: one
  person on an ordinary home line (about 37 MB/s) already uses all of it, and a campus line
  takes it for a few minutes (a lone 10 GiB ZIP took 348 s at 500m, 194 s at 1000m or more).
  Several people at once each get a share (three took 1159 s each at 500m). This is slow, not
  wrong: every ZIP completed with the right length, the fourth request was refused, and the
  rest of the site stayed responsive (above). The two ways to more are a CPU limit of 1000m
  (about 55 MB/s; the backend's manifest sets it from this ADR) and more backend pods, each
  worth one core, three more places and one more SSH connection to Anvil: two pods measured
  104 MB/s. A core is the unit, so past a few pods the stage-in-S3 option in the table above is
  the answer. Replicas are not set in the manifest by this ADR; scaling is a decision of
  `ops/`, and what Anvil's login nodes tolerate in SSH connections beyond two is not known.
- Places are counted per pod, and the Service does not know which pod has a free one: with
  more than one pod a request can be refused (`429`) while another pod is idle. So the two
  Next.js proxies of a ZIP (`lib/archive-fetch.ts`) send it again after a `429 archive_busy`,
  twice at most, after 0.5 s and 1.5 s; the last refusal reaches the browser as it is. It helps
  when another pod has a place; with every pod full the person still sees the refusal.
- The limit of ZIPs at once per process stays, and is now six (the setting
  `ARCHIVE_MAX_CONCURRENT`; it was three when this was written). It is what keeps a handful of
  people from sharing one core into downloads that each take twenty minutes; the reasons for
  six, and the connection's limit of ten channels, are in
  [ADR 0042](0042-the-gateway-reads-anvil-files-on-its-own-ssh-connection.md).
- The ingress must not buffer the response to disk, or a response over `proxy_max_temp_file_size`
  (1 GiB by default) is cut short. The controller's configuration was not read (no access to its
  namespace), but a 2.1 GB ZIP (`Content-Length` 2 119 172 058) came through the dev ingress whole
  and equal to its length, from a login node and from inside the cluster, so it does not cut at
  1 GiB ([ADR 0042](0042-the-gateway-reads-anvil-files-on-its-own-ssh-connection.md)).
- The ZIP's `Content-Length` is now sent for every archive, so a failure after the response has
  begun is still a download that ends short of its length, which the browser reports as failed.
- Totalling a folder is bounded as before (20 000 files, 60 s); a folder past either is `413`.
