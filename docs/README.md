# docs

The project's knowledge base. Markdown, versioned with the code, written to be
read by **an agent and a person**. The rules and the read order live in
[`../AGENTS.md`](../AGENTS.md) — this is the index.

**This is the only index.** Adding a document means adding a line here. There
are no per-folder READMEs to fall out of step with, and no templates.

## Four kinds of document

| | Answers | Changes |
|---|---|---|
| [`architecture/`](architecture/) | what shape the system has, **and separately** what shape it is meant to have | rarely — a change here is a real design change |
| [`decisions/`](decisions/) | why it has that shape | never; append-only, supersede rather than edit |
| [`reference/`](reference/) | what the current values are | continuously |
| `ops/missions/` | what we are doing about it, and what we have done | constantly |

The fourth shelf is not in this repository. Missions are the maintainers'
planning format and live in the private `openghm-ops` repository, together with
the reference documents describing the Anvil environment, the endpoints and the
credentials ([ADR 0016](decisions/0016-split-public-and-ops-repositories.md)).
Contributing needs neither.

**Each fact lives on exactly one shelf.** If you write the same sentence twice,
one of the two is wrong. [`glossary.md`](glossary.md) is the deliberate
exception — a definition restates by nature, which is why entries there are one
sentence and never grow into explanations.

## Architecture

**Every document here is either built or target, and says which on its first
line.** That one word is the most load-bearing thing in this knowledge base:

> **Status: built.** What runs today. If the code disagrees, the code is right
> and the document is a defect to fix now.
>
> **Status: target.** What we are building toward. Nothing in it exists unless
> the text says so, and an undecided detail is an
> [open item](reference/open-items.md), not a bug.

Mixing the two in one document is how a knowledge base starts lying, so a
document does not describe both. Reference and decisions need no such marker:
[`reference/`](reference/) is current values by definition, and an ADR records
a choice, which is true the moment it is made.

**The gap between the two is the work.** Missions are written from it — a
mission takes one piece of the target and makes it built, and then it moves the
description across. That is the whole loop, and it is why the target documents
are worth keeping accurate even though none of them describes anything you can
run.

| | State | |
|---|---|---|
| [gateway.md](architecture/gateway.md) | built | the portal as it actually is: request path, stack, state, jobs, and what is deliberately absent |
| [authentication.md](architecture/authentication.md) | built | roles and permissions, the three ways to become a request identity, sessions, CILogon's scaffolding |
| [repository-layout.md](architecture/repository-layout.md) | built | the top-level directories, what generates what, naming |
| [local-development.md](architecture/local-development.md) | built | what runs on a laptop, what only in the cluster, and the traps in between |
| [artifact-versioning.md](architecture/artifact-versioning.md) | **target** | the snapshot as a unit, the five versioned axes, storage shape, what runs where |

Diagram sources are SVG in [`architecture/diagrams/`](architecture/diagrams/),
rendered to PNG alongside them:

```bash
rsvg-convert -z 2 -b white -o diagrams/img/<name>.png diagrams/<name>.svg
```

## Reference

A fact here is checkable and was checked. Do not write "verified on \<date\>" —
write what is true, and mark what is not yet confirmed as open. A source
written `toolkits/…` is the archived pre-merge checkout, not a path in this
repository.

| | |
|---|---|
| [s3-layout.md](reference/s3-layout.md) | the `openghm` bucket: prefixes, keys, immutability, publishing |
| [snapshot-layout.md](reference/snapshot-layout.md) | the on-disk snapshot tree, component sizes, `SHA256SUMS`, the snapshot id |
| [snapshot-spec.md](reference/snapshot-spec.md) | where the spec lives, what a version consists of, version rules |
| [metadata-format.md](reference/metadata-format.md) | `metadata.json`, the container lock record, `containers/manifest.json` |
| [open-items.md](reference/open-items.md) | what is still undecided |

Four more live in the private `openghm-ops` repository, because they describe
this deployment rather than the product: `anvil-environment.md` (Anvil HPC, S3,
the Composable Subsystem), `environments.md` (which endpoint each environment
uses, and who holds credentials), `secrets.md` (where each secret lives, how to
add a deployer) and `external-services.md` (CILogon, reCAPTCHA, Resend).

## Decisions

One file per decision, numbered, append-only. To change a decision, write a new
one that supersedes it and mark the old `Superseded by 00NN`. **Never edit an
accepted ADR** except to add that marker — not even to correct a path that
moved. The record of what we believed, and when, is the whole value.

Write one when a choice will outlive the mission making it. A decision buried
in a mission file is invisible six months later. Numbers are never reused: 0011
and 0012 were folded into 0010.

| # | Decision | Status |
|---|---|---|
| [0001](decisions/0001-unified-repository.md) | One repository holds the application, the toolkit and the spec | accepted — superseded in part by 0016 |
| [0002](decisions/0002-five-versioned-axes.md) | Five artifacts are versioned independently, pinned from `metadata.json` | accepted |
| [0003](decisions/0003-zot-as-sif-registry.md) | zot is the SIF registry, with a plain-S3 mirror alongside | accepted |
| [0004](decisions/0004-store-images-not-rebuild.md) | Container images are stored, never rebuilt to reproduce | accepted |
| [0005](decisions/0005-namespace-decides-the-key.md) | Open namespaces are content-addressed; curated ones are name + version | accepted |
| [0006](decisions/0006-spec-is-two-files.md) | The snapshot spec is a JSON Schema plus a separate path list | accepted |
| [0007](decisions/0007-schemas-on-s3-behind-a-proxy.md) | Schemas are stored in S3 and served by a stateless nginx proxy | accepted |
| [0008](decisions/0008-exclude-inline-from-code-hash.md) | `_Inline` is excluded from the code tree hash | accepted |
| [0009](decisions/0009-output-is-carried-not-reproducible.md) | Published output is carried in the snapshot, not a reproduction target | accepted |
| [0010](decisions/0010-repository-layout.md) | Top-level directories grouped by what a thing *is*, and what `images/` holds | accepted |
| [0013](decisions/0013-sops-for-secrets.md) | Kubernetes secrets are SOPS-encrypted in the repository, keyed by SSH keys | accepted |
| [0014](decisions/0014-identity-is-a-minted-id.md) | A published artifact's id is minted, not derived from its content | accepted |
| [0015](decisions/0015-model-input-is-a-published-artifact.md) | Model input is published on its own; snapshots link to it | accepted |
| [0016](decisions/0016-split-public-and-ops-repositories.md) | The product is public; this instance's deployment is a separate private repository | accepted |
| [0017](decisions/0017-the-spec-is-the-source-of-truth.md) | The snapshot spec is the source of truth; the gateway stores its shape | accepted |
| [0018](decisions/0018-shared-definitions-and-no-renderings.md) | Specs share definitions from `schemas/common/`, and ship no generated renderings | accepted — amends 0006 |
| [0019](decisions/0019-publishing-infrastructure-is-a-single-instance.md) | Publishing infrastructure is a single instance, in prod | accepted |
| [0020](decisions/0020-a-live-schema-viewer-is-not-a-generated-rendering.md) | A live schema viewer is not a generated rendering | superseded by 0021 |
| [0021](decisions/0021-generate-schema-docs-with-json-schema-for-humans.md) | Schema docs are generated with json-schema-for-humans | accepted |
| [0022](decisions/0022-file-modes-are-object-metadata.md) | A published file's mode is recorded on its own object | accepted |
| [0023](decisions/0023-simulation-output-stays-on-scratch.md) | A simulation's output stays on Anvil scratch until it is published | accepted |
| [0024](decisions/0024-who-may-run-a-simulation.md) | Only a user an administrator has permitted runs a simulation | accepted |
| [0025](decisions/0025-a-gateway-job-runs-the-pinned-toolkit.md) | A gateway job is a slurmly batch job whose body runs the pinned toolkit | accepted |
| [0026](decisions/0026-how-a-job-verdict-is-reached.md) | How a job's verdict is reached, and how long its files live | accepted |
| [0027](decisions/0027-live-updates-are-polled.md) | A job's live state is polled and shared, and its logs are read by byte offset | accepted |
| [0028](decisions/0028-a-new-simulation-is-stored-when-the-user-saves-it.md) | A new simulation is stored when the user saves it, and a stored draft saves its own edits | accepted |

## Missions

Missions are the maintainers' planning format and live in the private
`openghm-ops` repository, at `ops/missions/<date>-<slug>/`. A mission is a
folder of five documents — the structured request you hand an agent — and when
it closes it collapses into one file under `ops/missions/archive/`.

An outside contribution does not need one. A pull request is a pull request.

## Keeping this honest

```bash
python3 docs/tools/check_devdocs.py            # links, anchors, paths, just recipes
python3 docs/tools/archive_mission.py <date>-<slug>   # a finished mission -> archive/
```

The checker finds broken links, unresolvable anchors, and backticked repository
paths that do not exist. It checks the **shape** of a document, never the contents of a mission —
see [`tools/README.md`](tools/README.md) for why that line is drawn where it is.
It reads this repository only: `ops/` is a separate repository that may be
absent, and a check whose result depends on whether someone cloned it would be
worse than no check.
