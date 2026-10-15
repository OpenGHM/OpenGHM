# ADR 0036 — What a visitor checks in a published tree downloads as one ZIP, up to 500 MB

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-15 |
| **Affects** | [`../architecture/gateway.md`](../architecture/gateway.md) (§5) |

## Context

The output dialog of a snapshot and the files page of a snapshot or model input
let a visitor browse a published tree. Until now a file came down one link at a
time, straight from Anvil S3, and a whole folder only through an S3 command. The
gateway serves links, not bytes ([`gateway.md`](../architecture/gateway.md) §5):
the browser downloads from Anvil S3 itself. The one exception is the output
subset of [ADR 0033](0033-wbm-output-is-read-on-anvil-by-the-toolkit.md), which
is cut on Anvil and streamed through the backend.

People asked to download several files, or a whole folder, in one click. The
browser cannot assemble that itself: Anvil S3 sends no CORS headers, so a page
cannot read objects from it and pack them. Several objects can only come down in
one piece if the gateway packs them.

## Decision

**Every row of the file browser has a checkbox. The backend packs what is
checked, files and whole folders, into one ZIP and streams it, for a selection of
at most 500 MB (500 × 1024² bytes) before compression.**

- A checked file counts with its listed size. A checked folder counts with
  its recursive total, which `GET …/files/folder?path=` reports along with its
  file count. The selection's total is shown as it is built, so a selection
  over the limit is marked before anyone presses Download. A folder too large
  to total within the listing's page cap counts as over.
- `POST …/files/archive` takes the folder being viewed and the names checked
  in it. It re-checks the total and refuses a selection over the limit with
  `413` before it sends a byte. Otherwise it streams a ZIP of the checked files
  and of every object under the checked folders. The ZIP is stored, not
  compressed, because NetCDF is compressed already. Each object is read
  anonymously from Anvil S3 and passed on as it arrives, never held whole. The
  frontend's route passes the body through the same way. The page submits a
  form to it, so the browser writes the ZIP to disk, whatever the number of
  names.
- A backend process packs at most a few ZIPs at once. More get `429`, not a
  queue.

This is the second exception to "links, not bytes", next to ADR 0033's subset.
Like that one, it is bounded: a request costs the cluster at most 500 MB of
traffic in and out.

## Consequences

- A handful of files, or a folder such as a time step's yearly output or a
  model input's small folders, comes down in one click. The large ones, daily
  output and raw model inputs, still need an S3 tool, and the page says so as
  soon as one is checked.
- Every byte of a ZIP crosses the cluster twice, once from Anvil S3 into the
  backend and once out through the ingress. The size limit and the concurrency
  limit are what keep that affordable. Raising either is a decision to revisit,
  not a setting to turn.
- A download that fails partway leaves a truncated file, as any interrupted
  download does. The browser shows it as failed.
