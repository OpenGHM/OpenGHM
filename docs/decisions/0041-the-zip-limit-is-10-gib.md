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
- **The gateway's own cost**, measured 2026-11-09 with the real `run_files` and `tree_archive`
  over one SSH connection (as the backend holds one) to an OpenSSH `sshd` on loopback, reading
  the same 10 GiB and dropping the bytes at once (no client to slow it), on one Apple-silicon
  core: 1, 2 and 3 ZIPs at once took 26 s, 47 s and 70 s, 10.00 GiB each with `Content-Length`
  equal to the bytes sent, so 393 to 437 MB/s in all however many ran; a fourth request while
  three ran was refused (`ArchiveBusy`, `429`). The Python process used 2.3 to 2.6 CPU-seconds
  per GiB, which is one whole core, so the limit is the CPU of one process and not the
  connection; its peak memory was 229, 281 and 325 MB (about 100 MB of it the interpreter and the
  app); the event loop was never held up for more than 7 ms. Not covered: Anvil's latency and
  sshd, the Next.js proxy, the ingress, and the pod's CPU limit and core speed.
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
once per process (`MAX_ARCHIVES`), which stays because the cluster's cost at three 10 GiB
streams is not measured.

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

- A request costs the cluster up to 10 GiB in and out, and three at once 30 GiB. The backend
  spends about 2.4 CPU-seconds per GiB, so a 10 GiB ZIP is about 24 CPU-seconds, spread over
  however long the person's connection takes: at 10 MB/s that is under 3% of a core, and the
  backend pod's 500m CPU limit is reached only when downloads together run faster than roughly
  100 to 200 MB/s (the measured 400 MB/s scaled by that limit and a slower core: an estimate,
  not a measurement). Memory is well inside the pod's 1 GiB. **Still to measure on dev**: one
  10 GiB download and three at once through the real ingress, the pod's CPU throttling, and the
  time of a `GET /api/v1/jobs/{id}` meanwhile, since a run's reads share the one SSH connection
  the backend holds for jobs (ADR 0040).
- The ingress must not buffer the response to disk. ingress-nginx's default is
  `proxy-buffering: off`, but this cluster's controller configuration was **not checked**; with
  buffering on, a response over `proxy_max_temp_file_size` (1 GiB by default) is cut short.
- The ZIP's `Content-Length` is now sent for every archive, so a failure after the response has
  begun is still a download that ends short of its length, which the browser reports as failed.
- Totalling a folder is bounded as before (20 000 files, 60 s); a folder past either is `413`.
