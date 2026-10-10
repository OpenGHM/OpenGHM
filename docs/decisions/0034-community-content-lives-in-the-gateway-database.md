# ADR 0034 — Community-page content lives in the gateway's database, and its files in GridFS

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-10 |
| **Affects** | [`../architecture/gateway.md`](../architecture/gateway.md) (§4, §7), [`../architecture/authentication.md`](../architecture/authentication.md), rules 1, 3 and 6 of [`../../AGENTS.md`](../../AGENTS.md) |

## Context

The Community page (`/community`) lists workshops, tutorials and publications,
and links each workshop and tutorial to a page of its own. The people who run
the project write that content, and they should not need a deployment to change
a date or add a slide deck. Admins write it in `/admin/community`; everyone,
signed in or not, reads it.

Three things had to be placed: the structured items, the rich text inside them,
and the files they carry (cover photos, slides, notebooks).

- The backend holds **no S3 credentials, by decision** (the architecture's
  "links, not bytes", [`../architecture/gateway.md`](../architecture/gateway.md) §5).
  Anvil S3 is served to the public as plain HTTPS, and only SLURM job scripts
  write to it. Uploading a photo through the gateway would need exactly the
  credential the design keeps out of it.
- The gateway already keeps its state in one MongoDB database
  (`gateway.md` §4), so a new store, a new PVC or a sidecar would be new
  infrastructure for a few megabytes.
- Rich text is HTML in most editors, and HTML an admin typed is HTML every
  visitor's browser runs.

## Decision

**Content is in MongoDB, files are in a GridFS bucket in the same database, and
rich text is whitelisted ProseMirror JSON that is rendered without raw HTML.**

- **Items.** Five collections: `community_workshops`, `community_tutorials`,
  `community_publications`, `community_settings` (one document) and
  `community_group_interest`. Each item has a `state` of `draft` or
  `published`; the public routes return published items only.
- **Files.** A GridFS bucket named `community_files`, through motor's
  `AsyncIOMotorGridFSBucket`. Not Anvil S3, for the reason above, and not
  `snapshots/`, `raw_data/` or any other published prefix: these are editable
  site content, not published artifacts. A page's text and photos change, a file
  is replaced by uploading another and deleting the old, and nothing outside the
  Community page cites one by hash. **Rules 1 and 3 do not apply to them** —
  they are about published snapshots, `raw_data`, images and code versions,
  which are immutable and stored byte for byte; a Community item is edited in
  place, and a file's identity is its GridFS id, not a digest.
- **Rule 6** (state in object storage, not in the cluster) is not broken: it
  governs what the snapshot pipeline deploys, and the gateway's database is
  already the one place cluster state exists (`gateway.md` §4). This adds no
  second place; it does mean the files are in the database and are backed up
  with it.
- **Size.** An upload is at most **25 MiB**, enforced while the body is read, so
  a larger one is refused (`413`) without being buffered or stored. Everything
  in the bucket is stored in MongoDB's chunks and served by the backend; that is
  right for photos, slides and notebooks and wrong for a lecture recording or a
  dataset. Large media is **linked** instead: a video on YouTube or a similar
  host, a dataset in the Data Repository. The rich text and the workshop's
  materials list take any `https://` address for that reason.
- **Types.** An extension allowlist (images `jpg jpeg png webp gif`; files `pdf
  ppt pptx key doc docx xls xlsx csv zip gz tar ipynb mp4 mov webm txt md`),
  checked against the type the browser declared and against the file's first
  bytes. **SVG is not accepted**: it is a document that can carry script, and
  from our origin it would run. The type the file is served with is the
  extension's own, never the client's, with `X-Content-Type-Options: nosniff`;
  only images and PDFs are shown in place, everything else downloads.
- **Rich text** is stored as a Tiptap / ProseMirror JSON document, at most 512
  KiB. The backend rebuilds it from a whitelist on every write: the nodes
  `doc`, `paragraph`, `text`, `heading` (levels 2 and 3), `bulletList`,
  `orderedList`, `listItem`, `blockquote`, `codeBlock`, `horizontalRule`,
  `hardBreak` and `image`; the marks `bold`, `italic`, `underline`, `strike`,
  `code` and `link`. Anything else is `422`, a link must be `http(s)://`,
  `mailto:` or a path starting with a single `/`, and an image must be `https://`
  or an uploaded file. The frontend renders the JSON with its own React
  components; no `dangerouslySetInnerHTML`, no HTML string ever stored.
  Attributes the editor adds that we do not use are dropped, so what is stored is
  a function of the whitelist, not of the editor.
- **Who.** A new permission, `content:manage`, held by the `admin` role only.
  Every admin write is an audit event in a new `content` category.

## Consequences

- Changing the page needs no deployment and no SLURM job, and a draft can be
  prepared before it is shown.
- The backend's image gains one dependency, `python-multipart`, to read the
  upload; it still has no S3 client and no credential for one.
- The database grows with the files, to at most 25 MiB each. If the uploads
  ever outgrow that, moving the bucket to Anvil S3 means giving the backend a
  credential, which is a decision of its own.
- A file deleted while a page still shows it leaves a broken image; the admin
  page lists the files so one can be found before it is removed. Nothing checks
  references.
- Files are served by the backend through the frontend's proxy route, so a view
  costs the backend a read; the immutable, year-long `Cache-Control` keeps that
  to the first.
