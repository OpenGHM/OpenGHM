# ADR 0040 — What a person checks in a run's output on scratch downloads as one ZIP, up to 500 MB

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-25 |
| **Affects** | [ADR 0023](0023-simulation-output-stays-on-scratch.md) (its last sentence: no download route exists); [`../architecture/gateway.md`](../architecture/gateway.md) (§5) |

## Context

A run writes its output to its own directory on Anvil scratch and leaves it there
([ADR 0023](0023-simulation-output-stays-on-scratch.md)). The job page lists what the run
wrote and gives the path, and a person who wants the files has to log in to Anvil and copy
them. For the learning workshop that is the wrong step: a participant launches a run and
wants the parts of its output they care about on their own machine.

The published case is solved ([ADR 0036](0036-a-folder-downloads-as-a-zip-up-to-500-mb.md)):
tick files and folders, get one stored ZIP of at most 500 MB, streamed by the backend. That
route reads public S3 objects. A run's output is not in S3 and, by ADR 0023, must not be
put there to be downloaded: it would fill a public bucket with output nobody chose to
publish, and it would need write credentials for every run. The backend already holds one
SSH connection to Anvil and reads files over SFTP on it (logs, and the NetCDF subset of
[ADR 0033](0033-wbm-output-is-read-on-anvil-by-the-toolkit.md)).

## Decision

**What is checked in a run's output on scratch is packed by the backend into one stored
ZIP and streamed to the browser, read over SFTP, for a selection of at most 500 MB
(500 × 1024² bytes) before compression.** Nothing is copied to S3 and no SLURM job zips
anything. It is the third exception to "links, not bytes", next to ADR 0033's subset and
ADR 0036's archive, and it is bounded the same way.

- **Same writer, same limits.** It is ADR 0036's ZIP writer with another source of bytes:
  entries stored and not compressed, a data descriptor after each entry, the exact length
  sent as `Content-Length`, entries read ahead (small ones buffered), a failed read ending
  the response without a clean finish. The 500 MB limit and the few-at-once limit
  (`MAX_ARCHIVES`, three per process) are the same constants, and the count is shared:
  a process packs three ZIPs in all, whatever their source. Another is `429
  archive_busy`, not queued. A selection over the limit, or a folder too large to total
  within 20 000 files, is `413 selection_too_large` before a byte is sent. The page marks
  it before anyone presses Download, as the published browser does, and says the limit; it
  offers no other route for a larger one (no `rsync`, no Globus: the page states the limit
  and nothing more).
- **The routes** are under the job, next to its logs and its output: `GET
  /jobs/{job_id}/files?path=` (one folder, files and folders with sizes and times),
  `GET /jobs/{job_id}/files/folder?path=` (what a folder holds at any depth, and whether it
  fits) and `POST /jobs/{job_id}/files/archive` (the folder being viewed and the names
  checked in it, as in ADR 0036). The listing comes from Anvil and not from the job's
  recorded manifest, which is capped at 5000 files and absent for a run that finished before
  it existed. `archive` re-checks everything: the job, the path, the names and the total.
- **Who.** The run's owner and holders of `JOB_VIEW_ANY` (staff and admins): the people who
  may already read the run's logs and stream its output subset (ADR 0024, ADR 0033).
  Anyone else gets the 404 a missing job gets. This is the job routes' own rule, not a new
  one. A published snapshot has no job: its files are the published tree and ADR 0036.
- **Which run.** One that has stopped (`COMPLETED`, `FAILED` or `CANCELLED`) and whose files
  are on scratch. A run still queued or running is `409 run_not_finished`, since its
  files are changing; one whose scratch Anvil purged is `410 output_purged`; one that never
  ran, `404 output_missing` (the codes of ADR 0033's output routes). Having been published
  does not matter: while the files are there they can be downloaded.
- **Confinement.** The root is the run's output directory,
  `ANVIL_OUTPUT_BASE/<sim_id>/wbm_output/<sim_id>`, built from the job's `sim_id` and never
  from the request. Paths and names follow ADR 0036's rules (relative, no empty, `.` or
  `..` segment, no backslash or control character). On Anvil the viewed folder's real path
  must be inside the root's, and only regular files and folders are listed, so a symbolic
  link is never followed and never put in a ZIP.
- **Failures** each get a plain message and leave nothing behind (nothing is written on
  Anvil or in the backend). Anvil not answering is `503 anvil_unreachable`; a path that is
  not there is `404 path_not_found`. A read that fails once the response has begun
  (a file purged or replaced meanwhile, the connection lost) ends the connection without a
  clean finish, so the browser shows a failed download and never a short valid ZIP.

## Alternatives considered

| Option | Why it lost |
|---|---|
| A SLURM job zips the selection and the browser fetches the file | The queue is not interactive, a zip needs scratch space of its own, and it adds a state to track and clean up. The backend already has the SFTP channel. |
| Upload the output to S3 so ADR 0036's route can serve it | Contradicts ADR 0023: unpublished output in a public bucket, and write credentials for every run. |
| One link per file | The same objection as in ADR 0036: a few files in one click is the need. |
| List from the job's recorded manifest | Capped at 5000 files, absent for older runs, and it can disagree with what is on scratch. |

## Consequences

- ADR 0023 still holds for everything but its last sentence: nothing unpublished goes to
  S3, publishing is how a result is kept, and scratch is purged (30 days untouched). A
  download is a copy to the person's machine and keeps nothing on the gateway.
- Every byte crosses the cluster edge twice, from Anvil into the backend and out through
  the ingress. The 500 MB and three-at-once limits keep that affordable; raising either is a
  decision to revisit, not a setting to turn.
- Listing and totalling a folder walk it over SFTP on a login node, for a signed-in person
  who has a run. The walk is bounded in files (20 000) and in time (60 s).
- A download that fails partway leaves a truncated file, as any interrupted download does.
- A run's page lists files only through the browser: the manifest list is gone, and the
  counts in the results card still come from the recorded manifest.
