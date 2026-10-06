# ADR 0031 — A snapshot draft is published by a job on Anvil, under an id the gateway minted first

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-07 |
| **Affects** | [ADR 0009](0009-output-is-carried-not-reproducible.md), [ADR 0014](0014-identity-is-a-minted-id.md), [ADR 0023](0023-simulation-output-stays-on-scratch.md), [`../architecture/gateway.md`](../architecture/gateway.md), [`../reference/s3-layout.md`](../reference/s3-layout.md), [open items](../reference/open-items.md) 1, 10 and 14 |

## Context

A snapshot draft that ran to success leaves its output on Anvil scratch, in
the run's work directory, and nothing uploads it
([ADR 0023](0023-simulation-output-stays-on-scratch.md)). Publishing it as a
snapshot is the one step that does. Several things around that step were
open or only implied:

- who uploads, and with which credentials (open item 10, decided 2026-10-07:
  a shared service account);
- where the snapshot's id comes from and when (open item 14, decided the
  same day: wherever it is needed, once per publish, stored before the first
  upload);
- which bytes the new tree is made of, and which output tier it ships
  (open item 1);
- what a publish that dies halfway leaves behind;
- how the catalogue learns of the result, given that the backend holds no S3
  credentials and cannot see the bucket.

Facts this rests on, checked 2026-10-07: `x-openghm` on Anvil has an
`~/.s3cfg`, whose identity is `EES260008`
(`ops/docs/reference/anvil-environment.md`, private). That identity owns every
object under the three published `snapshots/<id>/` trees (`s3cmd info` on
`snapshots/245430de…/model/wbm.pl`: `EES260008: FULL_CONTROL`, `*anon*:
READ`, `mode:33261` in `x-amz-meta-s3cmd-attrs`), and it can `CopyObject`
an object it owns.

## Decision

**Publishing is a SLURM job on Anvil, submitted by the gateway, that runs
`openghm snapshot publish`. The gateway mints the snapshot's id and stores it
before it submits. The job uploads with `x-openghm`'s own S3 identity, and the
gateway registers the snapshot in its catalogue only after the job has
proven the upload.**

- **Credentials.** The shared service account is `x-openghm`'s `~/.s3cfg`,
  the identity every gateway job already runs as. No key leaves Anvil, the
  backend still holds none, and nothing new is distributed. The price is that
  every job running as `x-openghm`, a simulation included, can reach the
  same keys. A simulation runs only the pinned toolkit and WBM under
  parameters the gateway checks, so this is accepted rather than designed
  away.
- **The id.** The gateway mints 256 random bits per publish, writes them to
  the draft, then submits. A retried publish reuses the stored id.
  `openghm snapshot publish --id <id>` takes it, and mints its own when
  run alone without `--id`.
- **The tree.** The new `snapshots/<id>/` holds:
  - everything of the base snapshot's except `metadata.json`, `SHA256SUMS`,
    `wbm_init/`, `wbm_output/` and `WBM_run_state/`. That is the code and
    the GDAL fixtures, **copied server-side** from `snapshots/<base id>/`:
    the same bytes, the same `x-amz-meta-*` and so the same file modes
    ([ADR 0022](0022-file-modes-are-object-metadata.md)), and nothing
    rebuilt (rule 3);
  - the run's own `wbm_init/` (the base's, with the init the run used),
    `wbm_output/<sim id>/` and `WBM_run_state/`, uploaded from scratch;
  - a new `SHA256SUMS` by the recipe in
    [`../reference/snapshot-layout.md`](../reference/snapshot-layout.md). A
    copied file's line is taken from the base's own `SHA256SUMS`, since its
    bytes are the base's; every uploaded file is hashed;
  - a new `metadata.json`.
- **Output tier.** A run produces only what its draft asked for, so the whole
  run is published (`full`). There is no tier choice in the gateway. Open
  item 1 stays open for snapshots published by other means.
- **Checked before upload.** The output holds every year and variable the
  run asked for and no empty file; the tree passes the layout spec; and
  `metadata.json` passes the metadata spec. A failure uploads nothing.
- **Resumable, never overwriting.** Before writing a key, the job reads it
  back. If it is absent, the job writes it. If it is present with the same
  bytes, the job skips it. If it is present with other bytes, the job stops.
  A retry with the same id therefore continues where the last attempt
  stopped, and never replaces a published object (option 3 of
  [Upload and lock](../reference/s3-layout.md#upload-and-lock)).
- **`metadata.json` goes last.** A `snapshots/<id>/` without one is an
  unfinished publish, not a snapshot, and nothing cites it. The job then
  re-reads `SHA256SUMS` and every key anonymously over HTTPS, so a key that
  did not land or is not public-read
  ([open item 17](../reference/open-items.md)) fails the job. The exit code
  of every `s3cmd` call is checked: SLURM's 0 does not mean a copy landed.
- **Provenance.** The new `metadata.json` names the snapshot it was derived
  from in an optional `about.isBasedOn`, by id. `about` is shared with the
  model-input spec, where the field means the same thing.
- **Public only.** The bucket is public-read, so a published snapshot is
  public. A private snapshot needs a store that is not public-read, and is
  not offered.
- **Who and how often.** The draft's owner, or an admin, publishes a draft
  whose simulation succeeded. A draft is published at most once. A draft
  that was not run because a published snapshot already answers it
  ([ADR 0029](0029-a-run-computes-only-what-is-not-published.md)) has
  nothing new to publish.
- **Registration.** The gateway adds the snapshot to its catalogue, owned by
  the draft's owner, when the job's verdict is a proven upload. Nothing else
  registers a snapshot for a user. The catalogue's write route requires the
  repository-manage permission.
- **Development writes the real prefix.** Until the project is in operation
  (rule 1), a publish tested from a local stack writes `snapshots/<id>/` in
  the real bucket, so that `openghm snapshot fetch` can verify it, and the
  tree is deleted after the check. The local catalogue is a local database,
  so nothing else lists it.

## Alternatives considered

| Option | Why it lost |
|---|---|
| The backend uploads | It holds no S3 credentials by design ([`../architecture/gateway.md`](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster)). It also cannot read scratch. |
| Each user's own S3 keys | Most users have none, and the gateway would have to hold or forward them (open item 10, decided against). |
| Upload from the login node over the SSH session | A large output takes hours, and nothing long-lived runs on a login node (rule 7). |
| Upload the code from the run's fetched copy on scratch | It rebuilds a published object from a copy, and `s3cmd put` from a stream loses the file mode. A server-side copy is the stored object. |
| A `dev/` prefix or a separate bucket for development | `snapshot fetch` reads only `snapshots/<id>/`, so it could not verify what development published. |
| The toolkit alone mints the id | The gateway needs the id stored before the job starts, or a retry would start a second tree under a new id. |

## Consequences

- `openghm snapshot publish` exists, and runs on Anvil by hand or from a
  gateway job.
- The snapshot spec gains an optional `about.isBasedOn`, and the backend
  models and frontend types gain it in the same commit (rule 4).
- A `snapshots/<id>/` prefix can exist without a `metadata.json` while a
  publish is in progress or after one failed. Listing `snapshots/` does not
  give only published snapshots. The catalogue does.
- A failed publish leaves objects that a retry resumes. A draft that is
  deleted after a failed publish leaves them behind, and cleaning them up is
  manual.
- Anyone who reads `x-openghm`'s files on Anvil can write to the bucket.
  Object Lock ([open item 4](../reference/open-items.md)) would remove the
  overwrite risk. Nothing else here does.
