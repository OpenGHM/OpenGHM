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
| 12 | The schema.org/Dataset JSON-LD projection is designed (`about`'s field names are chosen for it, and [metadata-format.md](metadata-format.md#notes) documents the `category`/`relatedLink`/`spatialCoverage`/`temporalCoverage`/`variableMeasured` remapping) but no generator exists anywhere in the codebase. Also undecided: whether the projection adds `identifier` (the snapshot's own id) and `distribution` (a download link), both flagged as missing during design but never resolved | metadata-format.md | a generator, and two field decisions |

## Before the repository is published

[ADR 0016](../decisions/0016-split-public-and-ops-repositories.md) split the
deployment out, which is the structural half of going public. These are the
rest. None is a secret in this repository — they were all found by reading it —
but each is a decision worth making deliberately rather than by publishing.

| # | Item | Where | Needs |
|---|---|---|---|
| P1 | Harbor's `openghm` project allows anonymous pull, and old image digests still carry a private key baked in before the `.dockerignore` fix | `ops/docs/reference/secrets.md`, "Known, accepted exposure" | close the registry; then the paragraph is a record, not a live exposure |
| P2 | Real personal email addresses of UNH researchers | `web-gateway/backend/app/db/seed_repository.py`, `schemas/snapshot-spec/examples/*.json`, and the WBM Perl headers under `images/wbm-tools-lite/wbm/` | a decision. Author headers in scientific source are normal attribution; seed data is not the same case |
| P3 | Purdue identifiers `x-openghm` and `x-ees260008` are compiled into the toolkit, its tests and six golden files | `packages/openghm/src/openghm/config.py`, `packages/openghm/src/openghm/cli/init.py`, `packages/openghm/tests/goldens/` | a decision. Neither is a credential, but the goldens make a scrub non-trivial |
| P5 | The WBM model source is a plain copy. It should be a submodule of its own repository, which needs a remote to exist first | `images/wbm-tools-lite/wbm/` — 16 files, copied into the image by one `COPY` | a remote, then a mission |
| P7 | Rule 4 says backend models, frontend types and the wheel's bundled copy are **generated** from `schemas/`. No generator exists — all are hand-maintained, and the wheel carries no copy at all. Rule 5 makes this a defect | `AGENTS.md` rule 4 | either the generator (Next item 3) or an ADR correcting the rule |
| P9 | The **Next** list — the project's roadmap — moved to the private repository with the missions, so contributors cannot see what is planned | `ops/missions/README.md` | a decision on whether a public roadmap is worth keeping in step |

**Done:** P4 (dev logins no longer reach the client bundle, moved server-side), P6 (LICENSE, CONTRIBUTING.md, SECURITY.md, .github/CODEOWNERS added), P8 (`docs/tools/README.md` corrected to the four checks that exist).
