# Open items

Decisions not yet made and facts not yet confirmed. Each one should become a
mission, an ADR, or a line in a reference doc — not stay here.

The **Before the repository is published** section at the bottom is separate:
those are not open questions but known work that has to land before this
repository is made public.


| # | Item | Blocks | Needs |
|---|---|---|---|
| 1 | Default output tier, and the `subset` year boundary | [ADR 0009](../decisions/0009-output-is-carried-not-reproducible.md), spec [snapshot-spec.md](snapshot-spec.md) | a decision |
| 2 | Whether `spool/` is uploaded to S3 at all — a spool with no recorded reuse envelope is not safe to reuse | [Anvil S3 bucket](s3-layout.md#anvil-s3-bucket), [Upload and lock](s3-layout.md#upload-and-lock) | a decision |
| 3 | How upstream WBM/RIMS changes reach us — git, tarball, or otherwise. [Publish a code version](s3-layout.md#publish-a-code-version) only covers where a version lives once we have it | [s3-layout.md](s3-layout.md) | upstream contact |
| 4 | Object Lock availability: needs bucket versioning and admin enablement | [Upload and lock](s3-layout.md#upload-and-lock) option 1 | RCAC confirmation |
| 5 | S3 conditional-write (`If-None-Match: *`) support on this endpoint | [Upload and lock](s3-layout.md#upload-and-lock) option 3 | a test against the endpoint |
| 6 | zot storage-driver key names for the version we deploy | [ADR 0003](../decisions/0003-zot-as-sif-registry.md) | check against that release's docs |
| 7 | The toolkit's history is still only in the separate `toolkits` checkout. `packages/openghm/` exists here already, as a copy with no commits of its own — committing it as-is loses that history, and `git subtree add` keeps it but needs the copy removed first | mission 0003, [snapshot-spec.md](snapshot-spec.md#spec-repository) | a decision |
| 8 | [`architecture/diagrams/deployment_topology.svg`](../architecture/diagrams/deployment_topology.svg) labels the publish step `copies the files (MinIO client)`. No CI workflow or publish script exists yet to confirm it, and nothing in `packages/` or an ADR names a client tool — the label predates a decision rather than recording one. Fix once mission 0003 picks the actual publish tooling | mission 0003 (CI gates) | a decision on publish tooling |
| 9 | How a gateway job becomes a real WBM run. `ANVIL_CONTAINER_IMAGE` is unset in both environments, and setting it is **not** the fix: `_build_command_template()` emits `apptainer run <sif> --temporal-start … --temporal-end …`, but the deployed SIFs' runscript is `/bin/bash`, and a real run binds a staged snapshot's `data/<subdir>`, `data_init/`, `wbm_init/` and `gdal_test_files/` plus a per-run write root, then executes `wbm.pl` against an init file (`images/wbm-v2-lite/run/wbm-run`). The job model has no field naming a snapshot or an init. Placeholder submissions now say so in `status_reason`, so nothing is silently wrong meanwhile | real simulations from the gateway | a job-to-snapshot/init mapping — a mission, not a value |
| 10 | Where a SLURM job script's own S3 credentials come from — the Anvil user's personal keys, or a shared service account injected into the sbatch environment. The backend's config has nothing to do with this by design; it holds no S3 credentials ([`../architecture/gateway.md`](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster)) | Next list in `ops/missions/README.md` (private), *job output reaches S3* | a decision, then provisioning |
| 11 | How WBM code (axis 5) is pinned in `metadata.json`. [ADR 0014](../decisions/0014-identity-is-a-minted-id.md) moved our own checksums out of the file, so `modelCode.sha256` is gone and nothing replaced it — `uses` only names the container and the model input. The container's `wbm-code/<name>/<version>` address is the obvious replacement, but whether the container fully determines the code (so no separate field is needed) or the two can drift is undecided | [`architecture/artifact-versioning.md`](../architecture/artifact-versioning.md), `schemas/snapshot-spec/metadata/1.0.0.json` | a decision |
| 12 | Not every file under a model input's `data_init/` is an MT time-series record. `data_init/dams/HydConDams_Global_v2.0.init`, in the ancillary data staged on Anvil, has no `Code_Name` at all — it is a point-feature reference table (dam location, capacity, catchment area, sourced from a CSV) with its own `DOI`, `Author` and `Citation` fields, a shape `model-input-spec`'s `datasets[]` does not cover. Excluded from the 1.0.0 example rather than forced in with fabricated fields; nothing today reads this file at all, so nothing breaks by 1.0.0 not describing it | `schemas/model-input-spec/metadata/1.0.0.json` | a decision: a second array for reference/tabular datasets, or leave this file undescribed |

## Before the repository is published

[ADR 0016](../decisions/0016-split-public-and-ops-repositories.md) split the
deployment out, which is the structural half of going public. These are the
rest. None is a secret in this repository — they were all found by reading it —
but each is a decision worth making deliberately rather than by publishing.

| # | Item | Where | Needs |
|---|---|---|---|
| P1 | Harbor's `openghm` project allows anonymous pull, and old image digests still carry a private key baked in before the `.dockerignore` fix | `ops/docs/reference/secrets.md`, "Known, accepted exposure" | close the registry; then the paragraph is a record, not a live exposure |
| P5 | The WBM model source is a plain copy. It should be a submodule of its own repository, which needs a remote to exist first | `images/wbm-tools-lite/wbm/` — 16 files, copied into the image by one `COPY` | a remote, then a mission |
| P10 | Seven of the sixteen WBM source files under `images/wbm-tools-lite/wbm/` carry an explicit UNH copyright notice ("for viewing only... reproduction, redistribution or modification... strictly prohibited"); the other nine carry none at all, which defaults to the same all-rights-reserved position. This directly conflicts with licensing this repository MIT | `images/wbm-tools-lite/wbm/model/RIMS.pm` and others (`grep -rl "strictly prohibited" images/wbm-tools-lite/wbm/`) | permission from UNH to redistribute under the chosen license, or exclude this code from what gets published (see P5) |

**Done:** P2 (the personal-email exposure — the seed that carried real names/emails was deleted rather than scrubbed, since it was the `datasets` collection's only writer — and the three spec examples now use fictional creators), P3 (`Config.account` and `_ANVIL_APPS_WBM` have no baked-in value any more — the real ones now live in `ops/docs/reference/anvil-environment.md` for this team to set locally; the `--preset anvil` init preset, the interactive prompt's example text, and all six golden fixtures were also cleaned), P4 (dev logins no longer reach the client bundle, moved server-side), P6 (LICENSE, CONTRIBUTING.md, SECURITY.md, .github/CODEOWNERS added), P7 (rule 4 corrected to say codegen is the target and hand-maintenance is the current reality — codegen itself now exists, see below), P8 (`docs/tools/README.md` corrected to the four checks that exist).

**Also done, formerly items 12–14** (mission `2026-09-18-gateway-on-the-spec`,
private): the gateway now stores and serves the spec's own shape, generated
rather than hand-written — [ADR 0017](../decisions/0017-the-spec-is-the-source-of-truth.md)'s
rewrite. The schema.org/Dataset JSON-LD projection is generated at render
time (`web-gateway/frontend/components/repository/dataset-json-ld.tsx`), including `identifier`
(one of the two fields item 12 left undecided); `distribution` (the other)
is still undecided — it needs a real S3 URL convention for a whole snapshot
tree, not just `metadata.json`, and that isn't settled yet. The `datasets`
collection has a write path (`POST /api/v1/repository/datasets`). `about`'s
field-by-field reconciliation (`temporalResolution`, `spatialResolutionDegrees`,
`fileSize`/`format`, and seven more) is recorded in
[metadata-format.md](metadata-format.md#the-gateways-catalogue).

**New from removing the seed:** the toolkit's one script that turned those three seed documents into on-disk `metadata.json` (for manual deployment to Anvil) had no other data source — it `exec`'d the seed file to read the dicts — so it went with it. Open item 13 above is the resulting gap: nothing populates `datasets` any more, for anyone.

**Was recorded here as a stale path, and was not:** `test_sim.py::test_exported_metadata_files_valid` failed on a clean checkout, described above as reading a `snapshots_metadata` directory that had moved. The files are in fact present under their original names in `schemas/snapshot-spec/examples/`; what the test asserted was a `metadata.json` shape the spec no longer defines (`jobSubmission`, `datasetType`, `variablesMeasured`). `sim.py` read that same shape, so the toolkit could not submit a run from a spec-compliant snapshot at all — [ADR 0017](../decisions/0017-the-spec-is-the-source-of-truth.md) applied to the gateway and never to the toolkit. Fixed by mission `2026-09-19-toolkit-on-the-spec` (private).

**Deferred to just before publication:** P9 (the private **Next** list means contributors can't see the roadmap), P10 (WBM licensing — newly found, and the more serious version of what P2 used to flag) — each reviewed again once the publication date is actually set, so the decision is made against real timing rather than in the abstract.

P1 (Harbor) and P5 (WBM submodule, blocked on a remote existing) are unchanged.
