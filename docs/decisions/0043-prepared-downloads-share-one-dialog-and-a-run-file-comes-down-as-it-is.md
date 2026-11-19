# ADR 0043 — Downloads show one dialog with progress; one file comes down as it is, a published one straight from S3

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-11-20 |
| **Affects** | the "no CORS" premise of [ADR 0033](0033-wbm-output-is-read-on-anvil-by-the-toolkit.md) and [ADR 0036](0036-a-folder-downloads-as-a-zip-up-to-500-mb.md) (the bucket now allows this site's origins); [ADR 0040](0040-a-runs-output-on-scratch-downloads-as-a-zip-up-to-500-mb.md) (a run's file has a route of its own); [ADR 0036](0036-a-folder-downloads-as-a-zip-up-to-500-mb.md) and [ADR 0033](0033-wbm-output-is-read-on-anvil-by-the-toolkit.md) (how their downloads are shown); [`../architecture/gateway.md`](../architecture/gateway.md) |

## Context

Three downloads are prepared by the gateway before the first byte is sent: a ZIP of a selection
(published or on scratch), a file of a run's output read from Anvil, and a NetCDF cut from the
output. Each drew its own feedback. The ZIP was a hidden form in a hidden frame, so that the
browser could take any size to disk without the page holding it, and for the same reason the page
saw nothing: pressing the button changed nothing on screen until the file began, which for 10 GiB
is a long wait. The NetCDF buttons did show progress, but read the body into memory.

A run's single file had no route: ticking one file still gave a ZIP of one, because ADR 0040 knew
only the archive. A published file's download was its S3 URL, and a browser shows a text or JSON
file at such a URL instead of saving it. The bucket sent no CORS headers, so the page could not read
the bytes to save them itself, and the URL cannot ask for an attachment: an anonymous
`?response-content-disposition=` (any `response-*` parameter) is answered 502, and the bucket's
`Content-Type` is not reliable either (measured 2026-11-20: `SHA256SUMS` comes as
`application/json`, a `.txt` as `binary/octet-stream`).

## Decision

**Every download that is prepared first opens one dialog when its button is pressed.** It says the
download is being prepared (indeterminate), then shows bytes, percentage, speed and time left, with
Cancel, and ends with the saved name or the refusal's words and Try again. It is one component
mounted once in the providers (`DownloadProvider`, `useDownload().start(job)`), so every button
behaves alike and a download goes on while the page is navigated. One runs at a time.

**Where the bytes go depends on the browser and the size** (`lib/download/engine.ts`):

- from 512 MiB, in a browser with `showSaveFilePicker` (Chrome, Edge): `fetch` streamed into the
  chosen file. Any size, real progress, nothing in memory;
- below that, or when no other way is allowed: `fetch` into a Blob, with progress;
- from 512 MiB in a browser without the picker: handed to the browser as a hidden form with a
  `dl` token; the gateway answers with the cookie `ghm-dl=<token>`, which tells the dialog it
  started. The browser's own download list then shows progress, which the page cannot see.

**One file of a run comes down as it is**: `GET /jobs/{id}/files/download?path=`, streamed over
SFTP with its size as `Content-Length`, at most the ZIP limit, taking one of the same few places
as a ZIP (`429 archive_busy`). It is not compressed: the output is NetCDF, already deflated, and
a known length is what gives progress. A single ticked file and every file row's download button
use it.

**The bucket allows this site's origins by CORS, and a published file is saved from its S3 URL,
never through the gateway.** Set 2026-11-20 on bucket `openghm` with `s3cmd setcors`: `GET` and `HEAD` from
`openghm.org`, `www.openghm.org`, `openghm.anvilcloud.rcac.purdue.edu`, `dev.openghm.org`,
`openghm-dev.anvilcloud.rcac.purdue.edu`, `localhost:3000` and `localhost:3100`, exposing
`Content-Length`, `Content-Type`, `Content-Range` and `ETag`. It takes nothing away: the bucket stays
anonymously readable, and a link, `curl` or an S3 tool reads it as before; it only lets scripts of
these origins read the answers. So a single ticked published file and every published file row's
download button first ask the bucket for the object's `Content-Type` (`HEAD`). One a browser would
save (`binary/octet-stream`, NetCDF in practice) is handed to the browser at its S3 URL, in a hidden
frame: its own download, with its own progress, no dialog and no byte through the page or the
gateway. One a browser would show (text, JSON, XML, an image, a PDF) is read by the page and saved
as a Blob. A published file keeps Copy URL.

**"Download NetCDF" of a published snapshot hands over a file that is already published.** A
yearly variable's year is `wbm_output/<run>/yearly/<variable>/wbm_<year>.nc` and a monthly
variable's whole year `wbm_output/<run>/monthly/<variable>/wbm_<year>.nc`: for those periods the
card (told the tree's URL and its run by the snapshot's links) hands that file to the browser at
its S3 URL, as above, after a `HEAD` shows it is there. A month, daily data (one file of every
variable per year) and a run of years are cut on Anvil as before (ADR 0033), and so is all of a
run's output. The card says which, under the button.

**The dialog says why it is there**: while a download the gateway prepares is under way, it says
that the data has to be prepared before it can download.

**The dialog opens only when a download takes a while**: after 0.8 s, or 3 s for a published file
of at most 5 MiB read straight from S3 (a slow link takes a second to fetch even a small one), and
at once on a failure. A download the gateway prepares opens it at 0.8 s whatever its size. A
download that ends sooner is simply saved.

## Consequences

- A refused or failed download is shown where the person is looking, in the dialog, not as a
  frame's JSON or text under a button.
- In Safari and Firefox a download over 512 MiB shows no progress in the page.
- Chrome and Edge ask where to save a download over 512 MiB before it is prepared.
- The gateway passes published bytes only for ZIPs. A new origin for the gateway (a new host name)
  must be added to the bucket's CORS rule, or published downloads from it fail.
