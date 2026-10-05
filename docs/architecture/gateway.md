# The gateway — architecture

**Status: built.** This describes what runs today, in `web-gateway/`. Where it
and the code disagree, the code is right and this file is a defect. The shape
we are building *toward* is
[artifact-versioning.md](artifact-versioning.md); nothing on this page is a
plan.

Authentication is large enough to have its own page:
[authentication.md](authentication.md). Registration values — CILogon,
reCAPTCHA, email — are in
`ops/docs/reference/external-services.md` (private).

---

## 1. Two halves, one product

| | |
|---|---|
| `web-gateway/frontend/` | Next.js 16 (App Router), React 19 |
| `web-gateway/backend/` | FastAPI, Python 3.11+, async throughout |

They deploy together, from one commit, into one namespace
([repository-layout.md](repository-layout.md)). There is no third service.

## 2. The request path

```
browser  ──▶  Next.js server  ──▶  FastAPI  ──▶  MongoDB
                    │                  │
                    │                  └──▶  Anvil (SSH) ──▶ SLURM
                    └──▶  CILogon / Google reCAPTCHA
```

**The browser never calls FastAPI.** It is enforced by deployment, not
convention: FastAPI has no Ingress. The Ingress routes `/` to the frontend
Service and nothing else, and `BACKEND_URL` is `http://openghm-backend:8100` —
a ClusterIP name that does not resolve outside the namespace. A fetch moved
from the server into a client component does not merely change where it runs;
it has nowhere to go.

Authenticated pages fetch on the server through
`web-gateway/frontend/lib/api-client.ts`, which attaches the backend JWT from
the NextAuth session.

Five pages cannot do that, because they run before there is a session:
`register`, `verify-email`, `forgot-password`, `reset-password` and
`confirm-link`. They post to **`/api/public-auth/<action>`**, a Route Handler
on the frontend's own origin that forwards to the backend with the server-side
`BACKEND_URL`. Its allowlist is those five actions and nothing else — it must
never become a general proxy into an API whose other routes expect an
`Authorization` header the browser does not have.

That handler exists to keep a `NEXT_PUBLIC_` variable out of the request path.
Next.js inlines those at `next build`, and this project promotes **one built
image** from dev to prod (the `promote-frontend` recipe in the private ops
repository), so a build-time URL can be
correct in at most one environment. It had been correct in neither: the five
pages used `NEXT_PUBLIC_BACKEND_URL`, which was set nowhere, so the deployed
bundle carried its `http://localhost:8100` default and registration, password
reset and email verification reached nothing at all.

The same rule governs the reCAPTCHA site key. It is public, but it is
`RECAPTCHA_SITE_KEY` rather than `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`:
`web-gateway/frontend/app/auth/register/page.tsx` is a `force-dynamic` server
component that reads it per request and hands it to the client form.
**A `NEXT_PUBLIC_` variable in this codebase is a bug** — there is no
build-arg plumbing for one, and adding it would tie an image to an
environment.

`proxy.ts` at the frontend root is the NextAuth middleware — Next.js 16 renamed
`middleware.ts` to `proxy.ts`. It redirects unauthenticated requests for
`/dashboard`, `/workspace` and `/admin` to the sign-in page, with the path
and query as `callbackUrl`. It is a
redirect, not the authorization check; that happens in FastAPI
([authentication.md](authentication.md)).

## 3. The stack, as built

Read this table as an inventory, not as an intent. Several things a reader
expects are deliberately absent, and §6 says which.

| Layer | What is actually there |
|---|---|
| Frontend | Next.js 16.1.6, React 19.2.3, App Router |
| UI | Tailwind CSS 4, shadcn/ui on radix-ui, `sonner` toasts, `next-themes` |
| Client state | Zustand |
| Maps and charts | Leaflet + react-leaflet for bounding boxes. **No chart library** — `web-gateway/frontend/components/charts/` holds two hand-written components that render on the server with zero client JS |
| Frontend auth | NextAuth v5 (Auth.js) |
| Frontend → backend | axios, server-side only |
| Backend | FastAPI 0.115, uvicorn, pydantic 2 / pydantic-settings |
| Database driver | motor (async pymongo) |
| Tokens | `python-jose` for JWTs, `bcrypt` for passwords |
| Email | `resend` — password reset and verification only |
| HPC | `slurmly`, pinned to a git commit; not on PyPI |

## 4. Where state lives

One MongoDB database, `openghm`. Seven collections, and every index on them is
created at startup in `web-gateway/backend/main.py` — that file is the
schema, in the sense
that nothing else declares one.

| Collection | Holds |
|---|---|
| `users` | accounts; `email` is unique |
| `jobs` | one document per **simulation** — draft or submitted, including the SLURM ids once it runs |
| `refresh_tokens` | one document per signed-in device, TTL-reaped |
| `pending_sso_signups` | half-finished SSO sign-ups, 30-minute TTL |
| `audit_events` | append-only, `auth` and `job` categories |
| `datasets` | the browsable catalogue of published snapshots |
| `model_inputs` | the same, for published model inputs ([ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)) |

Each `datasets` document is an **envelope**
(mission `2026-09-23-catalogue-envelope`):

```
{ _id, document: {…the spec's own metadata.json, verbatim, no _id inside it…},
  owner_user_id, visibility, registered_at }
```

`document` is a snapshot's `metadata.json`
([ADR 0017](../decisions/0017-the-spec-is-the-source-of-truth.md)), and
nothing else — `_id` mirrors `document["id"]`, same as before; `owner_user_id`,
`visibility` and `registered_at` are the gateway's own record of *this*
registration, not properties of the artifact (the same snapshot mirrored to a
second gateway would have a different uploader). Both specs set
`additionalProperties: false` at their root, so a gateway-side field folded
into the document rather than kept beside it would make that document fail
its own spec — which is what happened before this mission, tolerated only
because nobody wrote it down. `app.models.repository.build_envelope()` is
the one place that assembles this shape; `from_metadata_json()` is the one
place that reads it back out. `GET /api/v1/repository/mine` reads
`owner_user_id`: it returns the snapshots and model inputs whose owner is the
signed-in user, newest `registered_at` first, and it feeds the Workspace's
Snapshots & Inputs section. Each item carries its envelope's `visibility`
(`"public"` or `"private"`) and `registeredAt` beside the catalogue fields.
Freezing and visibility are separate: a snapshot is immutable once published
whichever it is. Nothing filters on `visibility` and nothing can change it
yet; every envelope is `"public"`. Every write path — the
`POST` routes and `resync_published.py` — still writes `owner_user_id: null`
(`resync_published.py` keeps an existing one), so nothing sets an owner
except by hand until the publish path exists.

`POST /api/v1/repository/datasets` is the write path; Mongo's unique `_id`
rejects a repeat of the same snapshot with `409` rather than silently
overwriting it, which would break rule 1. Before the write path existed at
all, a seed function reset the collection to three hard-coded documents on
every startup, carrying real researchers' names and emails as demo data —
not appropriate for a public instance — and was the collection's *only*
writer, so removing it rather than scrubbing it left nothing behind until
this write path replaced it.

A `jobs` document is a **simulation**: mutable while its `status` is `DRAFT`,
read-only from the moment it is submitted (mission `2026-09-20-simulations`,
private). Two routes create one, both as a draft, both for an active account
that is not a guest (`require_active_user`): `POST /api/v1/jobs/derive/{dataset_id}`
pre-fills it from a published snapshot's parameters, and
`POST /api/v1/jobs/{id}/duplicate` copies the settings of one of the caller's
own simulations, whatever its status (`422 snapshot_not_found` when its snapshot
has left the repository). Neither starts one from nothing, which would need a
model-input catalogue the gateway does not have yet. `GET /api/v1/jobs/derive/{dataset_id}`
previews the draft the POST would create: it answers with the same fields,
built by the same code, with an empty `id`, and stores nothing and writes no
audit event. The new-simulation screen shows it until the user saves, so the
defaults stay defined in the backend. A copy takes the snapshot,
slug, `about` (a name it has gets " (copy)"; one it lacks stays absent), model
input, parameters and compute, and nothing of the run. A new draft has no name:
"Untitled (<first 8 of the id>)" is what the header and the list show for one,
computed in the frontend and never stored, and the wizard asks for the name at
the top of Run settings.

`PATCH /api/v1/jobs/{id}` writes only while `status` is `DRAFT`: the update's
own filter carries the status, so once it has moved past `DRAFT`, or a submit
lands between the read and the write, the answer is `409 not_a_draft` and a
finished run's own record cannot be rewritten. `about` is merged key by key (a
key sent as `null` is removed, `about: null` clears the block), `parameters`
replaces the stored object and cannot be `null`, and `slurm_config` changes the
fields sent. A start date is checked (below) only when it differs from the
stored one. An edit writes no audit event.

`DELETE` removes a draft, or a finished job together with its files on Anvil
(§5); an active job gets `409 job_active`. A simulation and a snapshot are
deliberately not the same document: the spec's `runtime.execution` requires `startedAt`, `finishedAt`
and `slurmJobId`, none of which a draft can honestly carry, and a
finished simulation is not itself in `datasets` until someone publishes it —
a step that does not exist yet ([open items
9](../reference/open-items.md) and [10](../reference/open-items.md); **Next**
list *publish a simulation as a snapshot*).

A draft's start date is checked against where its snapshot's model may start a
run. WBM writes a run's first step into band 1 of an output file, so a run can
only start on the first day of one: with `File_Size 'year'` in the init, on
January 1, with `'month'`, on the first of a month. An init that sets neither
`File_Size` nor `Time_Series` is `'year'` too, WBM's default
(`images/wbm-tools-lite/wbm/model/RIMS/WBM.pm` line 495; read from the model
code, no v1 run was taken to the end). `web-gateway/backend/app/services/run_start.py`
reads `File_Size` and `Time_Series` from the init that `simulation.init` names,
over the public HTTPS read of §5, once per snapshot id, with the same patterns
`openghm sim run` uses. `GET /api/v1/repository/datasets/{id}` carries the
result as `runStartAlignment` (`year`, `month`, `none` for `File_Size 'day'`,
another value, or no `File_Size` beside a `Time_Series` key, or `null` when the
init could not be read). The browser holds the same rule in
`web-gateway/frontend/lib/jobs/run-start.ts` (`checkRunStartFor`). The draft
wizard's Run settings step says it once, in one line under the two dates
("Start on January 1 · End on 2001-12-31 · Coverage 2000-01-01 → 2001-12-31",
`web-gateway/frontend/lib/jobs/run-period.ts`); a start that breaks it is flagged in red under the
Start field with the nearest valid one as a one-click "Use …"; Save does
not send such a start, and the submit area on Review lists it with a link to the
field, which keeps Submit off.
`PATCH /jobs/{id}` (when the start changes) and the submit (every start) answer
`422 run_start_not_aligned` for the same start. A rule that cannot be read
blocks nothing, and the toolkit's own check stays as the last line.

The same init also limits the run's *end*. With `TA_multi_year_start` and
`TA_multi_year_timestep` both set in its `PostProcessing` block, WBM stops at
start-up unless that year lies inside the run: `post_processing` in
`images/wbm-tools-lite/wbm/model/RIMS/WBM.pm` (line 4279) dies with "Aggregation
multi-year start is outside of the run dates..." when the year is before the
run's first year or after its last complete year, whatever the block's `Run`
flag (Anvil job 21016198, `Run => 0`, ran the v2.0.0 snapshot from 2000-01-01 to
2000-12-31 and died of it; the snapshot's aggregation starts in 2001). So a run
must start in or before that year and end on or after its December 31. Snapshot
metadata does not hold `PostProcessing`, so the gateway reads the year from the
same init read, once per snapshot id, and sends it as `aggregationStartYear` on
`GET /api/v1/repository/datasets/{id}` (`null` when none is set or the init
could not be read). The browser mirrors the rule in
`web-gateway/frontend/lib/jobs/aggregation-window.ts`, flags it in red under
the Start or End field (a short form: "End on or after 2001-12-31."), and the
submit area on Review lists it in full. The full sentence names the allowed
range, and says "must end on 2001-12-31" rather than "(allowed: X to X)" when the
coverage leaves one date; the gateway words it the same way
(`aggregation_messages`). The save is not refused:
an edit stores whatever the person is part-way through typing. A date equal to
the snapshot's own is not held to it (the published run passed), and December 30
is let through, as a 360-day calendar's last day that the init does not
announce. `openghm sim run` and `sim submit` check the same rule on a
`--run-start` or `--run-end` override (`_check_run_dates_vs_aggregation`) and
stop before staging.

A draft's `model_input_id` is optional and, while `DRAFT`, editable —
mission `2026-09-21-choose-a-model-input`. Absent means the simulation
inherits whichever model input its base snapshot's own `uses.modelInput.id`
names; set, it overrides that. `_resolve_effective_model_input()` in
`web-gateway/backend/app/api/v1/jobs.py` produces one of three states — `chosen`, `inherited`,
or `inherited-missing` (the base snapshot cites an id the `model_inputs`
catalogue does not hold, which is the common case among the shipped
examples, not an edge case) — and the draft wizard's Run settings summary shows the
inherited model input by name (a link to its catalogue page when the catalogue
holds it, its short id when not). An override can be set only through the API,
and Run settings shows one as a warning with a Revert button, so it never looks
identical to an inheritance. The wizard has no step for choosing a model input:
nothing there could be changed until the toolkit has an option for it. The override changes nothing about how a
run would be invoked: nothing mints a real `apptainer` command yet ([open
item 9](../reference/open-items.md)), so this is recorded and displayed, not
yet consumed.

`model_inputs` holds the same envelope shape for the other published
artifact: a model input's own `metadata.json` under `document`, written by
`POST /api/v1/repository/model-inputs`, which is **admin-only** — the same
boundary as uploading the bytes themselves. Both write paths build
`document` with `exclude_none=True`, and that is not a detail: dumping the
model without it materialises every declared-but-absent optional field as
`null`, and an absent field and a `null` are different things to JSON
Schema. Both collections held documents that failed validation against
their own spec until this was fixed — `about.creator[].orcid` and
`about.relatedLink` were the visible cases — so `document`'s "verbatim" is a
property the write path has to actively preserve, not one it gets for free.

**Registering an artifact does not prove it exists.** The backend has no S3
client and no credentials by design (§5), so it cannot discover what has
been published, nor verify that the bytes behind a document are really in
the bucket. Registration is always "someone tells the gateway", never "the
gateway finds out", and the catalogue and the bucket can drift. Nothing
today produces what gets registered either: no code mints an artifact id,
and `openghm model-input publish` does not exist — only `validate`. The
write paths are the receiving end of a chain whose earlier links are still
to be built.

MongoDB runs as a StatefulSet with a PersistentVolumeClaim
(`ops/k8s/base/mongo.yml`). That is the one place cluster state exists, and
it predates the rule against it in [`../../AGENTS.md`](../../AGENTS.md) — which
governs what the *snapshot* pipeline deploys, not the gateway's database.

### The Data Repository

`/repository` is **one mixed list** of snapshots and model inputs, filtered by
facets and sorted and paged by the server. It reads
`GET /api/v1/repository/catalogue`
(`web-gateway/backend/app/api/v1/repository.py`; the logic is pure and lives in
`web-gateway/backend/app/services/catalogue.py`). Both collections are read whole and filtered in
memory, as the older list routes do; there is no text index.

Each item is the response of its kind (`DatasetResponse` or
`ModelInputResponse`, [metadata-format.md](../reference/metadata-format.md#the-gateways-catalogue))
plus a computed `kind`, `"snapshot"` or `"model-input"`. The response is
`{ items, totalCount, totalPages, page, facets }`.

**Query parameters**, all optional: `q`; `type` (`snapshot` or `model-input`,
anything else is `422`); the facet parameters below; `year_start`, `year_end`;
`spatial_res_min`, `spatial_res_max` (degrees); `sort`
(`relevance` default, `newest`, `title-az`, `title-za`, `coverage-start`); `page` (>= 1);
`page_size` (default 10, 1 to 100). Facet and `type` parameters **repeat**
(`?tag=a&tag=b`); they are not comma lists, because a value can
contain a comma.

| Facet parameter | Spec field | Label | Applies to |
|---|---|---|---|
| `type` | the item's kind | "Model Snapshot", "Model Input" (fixed order, always both) | both |
| `tag` | `about.tags[]` (an item with three tags counts in three options; vocabulary in [metadata-format.md](../reference/metadata-format.md#abouttags)) | the value | both |
| `keyword` | `about.keywords[]` (exact string match, case-sensitive) | the value | both |
| `creator` | `about.creator[].name` | the value | both |
| `license` | `about.license` | the value | both |
| `output` | `simulation.outputVariables[].name` | `fullName` | snapshots |
| `forcing` | `simulation.inputVariables[].role` | the raw role (the UI humanises it) | snapshots |
| `process` | `simulation.activeProcesses[]` | the value | snapshots |
| `wbm` | `uses.container.version` | the value | snapshots |

**Semantics.** Values within one facet are OR, different facets are AND. A
filter a kind cannot satisfy excludes that kind: a model input has no output
variables, forcing, processes or container, so any selection in those four
facets leaves only snapshots.

- `q` is a case-insensitive substring over `about.name`, `about.description`,
  `about.keywords` and `about.tags`.
- `year_start`/`year_end` select by overlap with the temporal coverage
  (`simulation.temporalCoverage`; a model input's `coverage.temporalCoverage`).
  An artifact with no temporal coverage, which a climatological model input
  may not have, never matches an active year filter.
- `spatial_res_min`/`spatial_res_max` compare a snapshot's
  `spatialResolutionDegrees`. A model input matches when **any** of its
  `networks[].resolution` is in range; networks without one are ignored, and
  a model input with none never matches an active resolution filter.

**Facet counts** are disjunctive. For each group, the count is the items that
match `q`, the ranges and every *other* group's selection, ignoring the group's
own, so choosing one option leaves its siblings' counts visible. A selected
value with no match is still listed, with count 0; other zero-count options
are not. Groups sort by count descending, then label case-insensitively;
`type` keeps its fixed order. `facets.yearBounds` is `{min, max}` over the
whole unfiltered catalogue (earliest start year, latest end year), or `null`
when nothing has a temporal coverage.

**Order** is deterministic and ends in the id. `newest` is
`about.datePublished` descending, then name, then id. `title-az` and `title-za`
sort by `about.name` case-insensitively. `relevance` with a `q` scores a name
hit 3, a keyword or tag hit 2 and a description hit 1, summed, highest first, and
breaks ties as `newest`; with no `q` it is `newest`.
`coverage-start` puts the earliest temporal coverage start first
(`simulation.temporalCoverage.start`; a model input's
`coverage.temporalCoverage.start`), items with no coverage last, and breaks
ties by name, then id. The single-kind `/datasets` and `/model-inputs` routes
do not take it.

`GET /repository/datasets` and `GET /repository/model-inputs` stay as the
separate, single-kind lists. The Start screen's snapshot picker
(`/workspace/new`) does not read them: it asks this route for `type=snapshot`
twelve to a page, with the search, every filter the Data Repository has but the
type it fixes, and its facet counts. The filters come from one definition in the
frontend (`CATALOGUE_FILTER_GROUPS` in
`web-gateway/frontend/lib/repository/catalogue.ts`), which also says, per group,
whether the picker's compact panel shows it (`picker`: tags, years, resolution);
a "More filters" button there opens a dialog with all of them, so a filter added
to the definition is in the picker without a second edit
([ADR 0028](../decisions/0028-a-new-simulation-is-stored-when-the-user-saves-it.md)).

`GET /repository/mine` (signed in) is the one catalogue read that needs a
session: the same two item shapes, with `kind`, for what the caller owns, plus
each item's `visibility` and `registeredAt`. No paging, no facets.

## 5. The two paths that leave the cluster

### Data — links, not bytes

The backend holds no S3 credentials and makes no S3 API calls. It concatenates
`S3_PUBLIC_BASE_URL`, a bucket and a key into a public HTTPS string and returns
that; the browser downloads from Anvil S3 directly, bypassing the API. The
config file states this in a comment, and there is no S3 client in
`requirements.txt` to contradict it. The one object it reads itself is a
snapshot's init, with a plain `httpx` GET of the public URL
(`web-gateway/backend/app/services/run_start.py`), to learn what the init asks of
a run's dates.

Two read routes return those strings for a published artifact:
`GET /api/v1/repository/datasets/{id}/links` and
`GET /api/v1/repository/model-inputs/{id}/links`. They are open like the other
`GET` routes, and an unknown id is `404`. A tree is thousands of files, so a
response is the prefix (`snapshots/<id>/`, `model-inputs/<id>/`) plus its
`metadata.json` and `SHA256SUMS`. A snapshot's also carries the fetch command
(`openghm snapshot fetch <id>`), the container's `uses.container.https` and the
`model-inputs/<uses.modelInput.id>/` prefix. The strings are built from the
stored document and the two settings on each request, so nothing is stored and
nothing checks that the objects exist. The detail pages render them in a
Download card.

The bucket is `S3_BUCKET`, set to `openghm` — the one bucket this project
has, with every artifact under a prefix
([`../reference/s3-layout.md`](../reference/s3-layout.md)). There is
deliberately no output-bucket setting. A run's output stays on Anvil
scratch and reaches S3 only when it is published as a snapshot
([ADR 0023](../decisions/0023-simulation-output-stays-on-scratch.md)), so there is
no job-output link to return.

### Jobs — SSH, and no queue

A simulation is created as a DRAFT (`POST /jobs/derive/{dataset_id}` or
`POST /jobs/{id}/duplicate`) and edited with PATCH, including its `slurm_config`
(cores, walltime).
`POST /jobs/{id}/submit` then **awaits the SLURM submission in the request**.
There is no worker and no broker.
`web-gateway/backend/app/services/slurm.py` holds one lazily created
`slurmly.SlurmSSHClient` behind an asyncio lock. It runs `sbatch`, `squeue`,
`sacct`, `scancel` and the SFTP log tail over that one SSH connection, as
`x-openghm`, with the key from `ANVIL_SSH_KEY_CONTENT`
(`ops/docs/reference/secrets.md`, private).

**What a job runs** ([ADR 0025](../decisions/0025-a-gateway-job-runs-the-pinned-toolkit.md)).
slurmly writes the `#SBATCH` lines and its module preamble.
`web-gateway/backend/app/services/job_script.py` renders the body. The body runs the `openghm`
toolkit installed on Anvil at `ANVIL_OPENGHM_HOME`, whose directory is named
for the public commit it was built from:

1. `openghm snapshot fetch <id>` into `ANVIL_CACHE_DIR/snapshots/<id>`,
   held under `flock ANVIL_FETCH_LOCK`. The lock lives on `/home`, because
   `flock` on the GPFS scratch filesystem only locks within one node. The
   fetch verifies the tree, the linked model input and the pinned image, and
   downloads what is missing.
2. `openghm sim run` on that tree, with `--id <sim_id>` and `--spool cache`:
   the run links the days the shared spool cache holds and hands it the days
   it built after exiting 0 ([simulation-reuse.md](simulation-reuse.md) §4).
   `--run-start`, `--run-end` and `--output-vars` are passed only when the
   draft differs from the snapshot's own values.

Each step runs through a `step` wrapper that records its exit code, and an
`EXIT` trap (with `TERM`, `INT` and `HUP` trapped too) writes `outcome.json`
into slurmly's job directory with the toolkit venv's Python
([ADR 0026](../decisions/0026-how-a-job-verdict-is-reached.md)). The record
holds the phase reached, each step's exit code, whether the run was staged,
the WBM markers (`All Done!`, `Failed to warp`, `Nothing to do`) and log tail,
and the output manifest. The script exits non-zero when those facts are not a
success, so SLURM's state agrees. The body's schema is the docstring of
`job_script.py`.

SLURM is asked for `--cpus-per-task` and `--time`:
- cores come from the draft's `slurm_config`, or else the snapshot's
  `simulation.recommendedCompute.cores`;
- walltime comes from the draft's `slurm_config` (a PATCH holds it to at most
  96:00:00, `MAX_WALLTIME_SECONDS`), or else the snapshot's recommended
  walltime × 1.5, **never more than 96:00:00** (`with_headroom`; SLURM rounds a
  value with seconds up to the minute);
- the account (`ANVIL_ACCOUNT`) and partition come from settings.

Memory on the `shared` partition comes with the cores, at most 1896 MB per core
(`MaxMemPerCPU`, read from Anvil on 2026-10-02), and WBM takes at most 8 threads
(the toolkit passes one per core, so a run holding more cores than that leaves the
rest idle): the snapshot's recommended core count is there for the memory. A run given
fewer cores than that may be killed for running out of memory. The wizard shows a one-line warning for that
(`describeCoresBelowRecommendedShort`, with the arithmetic behind "Why?"), not an
error: Submit stays on and the backend does not check it.

The job records `sim_id`, `slurm_job_id`, `toolkit` (home and commit),
`work_dir` (`ANVIL_OUTPUT_BASE/<sim_id>`) and slurmly's `remote_job_dir`
(`ANVIL_REMOTE_BASE_DIR/jobs/…`).

**A draft the snapshot already answers is not queued**
([ADR 0029](../decisions/0029-a-run-computes-only-what-is-not-published.md)).
`POST /repository/datasets/{id}/published-answer` takes a draft's parameters and
model input and says whether the snapshot's published output answers it: no
model input, spatial domain or custom parameters of its own, the period inside
`simulation.temporalCoverage` (a later start included), and every variable
among `simulation.outputVariables`. Otherwise it gives one reason code per
difference. When it is answered it lists the public files that hold the
answer: `<run>/daily/wbm_<year>.nc` for each asked year and
`<run>/{monthly,yearly}/<variable>/wbm_<year>.nc` for each asked variable,
read from an anonymous listing of `snapshots/<id>/wbm_output/`, which the
process keeps once per snapshot (`web-gateway/backend/app/services/published_answer.py`). A year
with no daily file makes the draft not answered (`published_output_missing`).
The Review step asks it for the draft on screen, unsaved or stored, and shows
those files with sizes and links in place of the submit card; "Run anyway"
submits with `{"rerun": true}` after a confirmation that says it uses compute
time. A failed check (502 `published_listing_unavailable`) never blocks
submitting.

**What submit refuses.**
- A draft the snapshot answers, unless the body says `{"rerun": true}`: 409
  `answered_by_published`, before the Anvil checks. A rerun is audited with
  `rerun: true`. A listing that fails lets the submit through.
- A draft that overrides its model input, subsets the snapshot's spatial
  domain, or sets custom parameters: 422 `unsupported_fields`. The toolkit
  has no option for these yet (open item 9).
- A start date the snapshot's model cannot start a run on: 422
  `run_start_not_aligned`, with `suggested_start` when a valid start lies inside
  the snapshot's period.
- Run dates outside the snapshot's multi-year aggregation window (above): 422
  `run_dates_outside_aggregation`, with `fields` (`start`, `end` or both),
  `aggregation_start_year`, `latest_start` and `earliest_end`, and a message that
  names the allowed range. A window that cannot be read blocks nothing.
- A draft with no walltime of its own whose snapshot's recommended walltime is
  by itself over 96 h, which no single job can run: 422 `walltime_over_limit`,
  before any SSH or SLURM call. Its message gives the reference run's time and
  says to shorten the run period or set a walltime. A walltime the draft set is
  sent as given and is not refused here. The frontend mirrors both rules
  (`withHeadroom`, `submitProblems`): Run settings shows a one-line warning with a
  "Why?", and the submit area on Review lists the problem and keeps Submit off.
- An Anvil that cannot be reached: 503 `anvil_unreachable`. When sbatch may
  already have run (the connection dropped, or its answer did not parse), the
  route runs `scancel --name=<sim_id>` at once; if that fails too, the name
  stays in the draft's `orphan_sim_ids` and the sweep retries it.
- An sbatch that says no: 502 `sbatch_rejected`. slurmly's leftover job
  directory, found by the attempt's `sim_id` in its `metadata.json`, is removed.
  The message names the cause in plain English when SLURM's reason code is one
  of a few known ones (`web-gateway/backend/app/services/sbatch_refusal.py`: a run time or core
  count over the limit, too many jobs, the allocation's compute budget used
  up), followed by the first lines of SLURM's own text with paths left out.
  Any other refusal is shown as SLURM wrote it. The code stays
  `sbatch_rejected` either way.

After a refusal the draft goes **back to DRAFT**, with `last_submit_error`.
The DRAFT→SUBMITTED claim is one conditional update, so a double click or a
concurrent PATCH cannot submit twice. Who may submit at all is
[ADR 0024](../decisions/0024-who-may-run-a-simulation.md).

Status is pulled, never pushed
([ADR 0027](../decisions/0027-live-updates-are-polled.md)). A background
asyncio task started in the lifespan handler runs a sweep every
`JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL` seconds (10) while a job is active, and
every `JOB_BACKGROUND_SYNC_INTERVAL` (60) when none is: one batched
`get_jobs` for every non-terminal job, then the end-time backfill (below),
then the orphan `scancel` retries, then the daily purge check. A lookup that
fails skips the tick, and a job it did not report is only counted absent after a
`sacct` of the gateway's own shows it gone (`confirm_absent`). The status route settles one job the same way (`update_job_status()`).

**Watching a job.** `web-gateway/backend/app/services/job_live.py` shares SLURM's answers
in process for `JOB_LIVE_TTL_SECONDS` (5): the sweep and every viewer's
status poll use one lookup per job per window, and a job is settled by one
caller at a time. The status answer carries `live`: SLURM's queue reason,
time limit and start estimate, and, for a running job, the progress read
from the WBM log's last per-day line (`Spinup k/N (date)` or
`File <name> (date)`). `GET /jobs/{id}/logs?stream=stdout|stderr|wbm` reads
one chunk by byte offset (base64 over one SSH command), and
`GET /jobs/{id}/logs/{stream}/download` streams the whole file up to
`JOB_LOG_DOWNLOAD_MAX_BYTES` (50 MiB). The browser polls every 5 s through
server actions, and not at all while its tab is hidden; the download goes
through the one Next route handler for jobs,
`web-gateway/frontend/app/api/jobs/[id]/logs/[stream]/route.ts`. The three
streams are three files: `wbm` is the model's own log, `stdout` is the job
script's output, and `stderr` is everything the script wrote to stderr, not
only errors. Nothing rewrites them for the screen: the job is what keeps its
logs clean. The module preamble is quiet (`gateway_execution_profiles` in
`slurm.py`: `module -q` on every module command, no `module list`; an unknown
module still prints its error and fails the job), the script writes no banner
of its own, and `openghm snapshot fetch` prints its `N/M files` counter only
when stderr is a terminal, so a batch job's stderr holds real messages only.
The Logs panel is one box that lays the three files end to end in the order
they happen (they share no timestamps): the job output, the WBM log, the
messages, each block opened by a `──── Job output ────` separator line, each
file's lines exactly as written and numbered as in the file. The only things
the box adds are its own separator, note and Retry lines, and colour: lines
that look like errors are red and warnings amber (`log-severity.ts`, a word
list, colour only), plus a failed job's reason as the failure card quotes it.
A job that ran before the toolkit went quiet shows its module notices and
counter lines as they were written. The three streams are polled one after another,
never at once.

**The job page** (`/workspace/{id}` past DRAFT, `web-gateway/frontend/components/workspace/job-detail.tsx`)
reads top to bottom in the order a person asks: the header (breadcrumb, the
simulation's own name with its status, the title of the snapshot it is based on
in one line, and once the job has ended the buttons "Duplicate" (a completed
job only), "New from this model snapshot" and "Delete simulation"; a light
header like the Data Repository's), one full-width status summary
(`job-status-summary.tsx`) that changes with the live status, the Logs, and a
compact Details section. The summary is the only place with a state's main
action: Cancel while it is queued or running, "Try again with these settings"
after a failure or a cancel. That button and "Duplicate" are the one copy action
(`POST /jobs/{id}/duplicate`), shown once: the header has it only where the
summary does not. A completed job's results (scratch path, file counts, when
Anvil may delete them) sit in it, a failed job's cause and log excerpt, and
the times are short (`Submitted 3:33 AM · Waited 3 min · Ran 14 min`, the full
date and zone on hover). Details shows the cores and walltime the job asked
for: its own choice, else the base snapshot's `recommendedCompute` worked out
as the submit does it (`effectiveCompute`, marked as recommended), and while
SLURM has the job the limit it enforces. The job document stores no resolved
cores or walltime, so the page reads the snapshot for them; with no snapshot it
shows a dash. The page is as wide as the Workspace list and the draft wizard.

**How a job ends** ([ADR 0026](../decisions/0026-how-a-job-verdict-is-reached.md)).
The first time the sweep sees a terminal SLURM state it reads `outcome.json`
and the stderr tail once, and `web-gateway/backend/app/services/job_verdict.py`'s `classify`
names one cause: SLURM's `CANCELLED` first, then SLURM's kills (`TIMEOUT`,
`OUT_OF_MEMORY`, the node-failure family), then the record. The job stores
`status`, `failure {cause, phase, message, excerpt}`, the record, the raw
`slurm_state` and `slurm_exit_code`, and SLURM's own `slurm_start` and
`slurm_end`. A job absent from every lookup for `JOB_LOST_AFTER_SECONDS`
(600), each time confirmed by that `sacct`, is judged from its record, or is
`lost`. Every status write is
conditional on the status it read.

A squeue row carries no start time, end time or exit code (slurmly's squeue
parsing reads none), so a job whose verdict came from one has `completed_at`
but no `slurm_end`. The sweep fills those from sacct: for a job with a verdict
from SLURM's state, no `slurm_end`, and `completed_at` within
`JOB_END_BACKFILL_WINDOW_SECONDS` (24 h), it asks in one batched `get_jobs`,
once the job has been over for `JOB_END_BACKFILL_RETRY_SECONDS` (300) and again
that long after each try, at most `JOB_END_BACKFILL_MAX_TRIES` (5) times. Only
a sacct row counts; it sets `slurm_end`, and `slurm_start` and
`slurm_exit_code` if they are empty, and nothing else: the verdict and
`completed_at` stay as they were. A lookup that fails costs no try.

**Cancel** records `cancel_requested_at` and runs `scancel`; the status stays
until SLURM reports `CANCELLED`, and the UI shows *Cancelling*. A job with no
SLURM id yet is cancelled at once.

**Files.** A job owns two directories on scratch: slurmly's job directory and
`work_dir`. The shared caches are never removed by a job. `DELETE` removes
both directories, the work directory only if it is exactly
`ANVIL_OUTPUT_BASE/<sim_id>` and not a symlink, and then the document; if a
removal fails the document stays. The gateway deletes nothing on its own:
Anvil purges scratch files untouched for 30 days, and a daily check sets
`files: purged` on a job whose work directory is gone.

Nothing uploads output, by decision
([ADR 0023](../decisions/0023-simulation-output-stays-on-scratch.md)). The job
writes to Anvil scratch, and the output stays there. Publishing a simulation
as a snapshot is the step that uploads it, and that step is not written yet.

## 6. What is absent, and not by oversight

Each row below was described as present in the v1.1 gateway overview that this
document replaces, or is what a reader of a typical FastAPI project would
assume. None of them is here:

| Expected | Reality |
|---|---|
| Celery workers | none. Submission is inline, status is polled (§5) |
| A Redis broker | `deploy/local/` starts one and `REDIS_URL` has a default, but **no code reads it**, and there is no Redis in either cluster manifest. It is a leftover |
| An S3 client in the backend | none, deliberately (§5) |
| MinIO | removed; see `ops/docs/reference/anvil-environment.md` (private) |
| MongoDB Atlas | self-hosted, in-cluster |
| Deck.gl / Plotly | not installed; Leaflet and two SVG components (§3) |
| A `/catalog/search` endpoint | the routes are `/repository/catalogue`, `/repository/mine` and, per kind, `/repository/datasets`, `/repository/model-inputs` |

## 7. Audit log

`web-gateway/backend/app/core/audit.py` appends to `audit_events`; admins and
staff read it at `GET /admin/audit-log`. Every event carries a category,
because the two streams
have nothing in common: `auth` is low-volume and security-relevant (sign-in
success and failure, registration, password reset, role and status changes, SSO
account creation and linking), `job` is operational (a draft created as
`simulation_derived` or `simulation_duplicated`, submission, cancellation, SLURM
transitions, deletion).

Job-status events are written **only at genuine transitions**. The sweep runs
on every background tick and every status-page load, so the audit call lives
in `slurm._move`, after a conditional write that changed the status. A poll
that finds nothing changed never reaches it. That placement is the only thing
keeping the log from filling with polling noise — preserve it if that code is
ever restructured. A delete writes `job_deleted` with the paths it removed. Editing a draft
writes nothing.
