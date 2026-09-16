# OpenGHM

The gateway (web app), the `openghm` toolkit, the container images, and the
snapshot spec that ties them together.

## The rules

Non-negotiable. A change that breaks one needs an ADR that changes this list
first. They override everything else in this repository, including the rest of
this file.

1. **Published means immutable.** A published artifact is never edited in
   place. A fix is a new version under a new key — snapshots, `raw_data`,
   container images, code versions and schema versions alike.
2. **Pin by identity, not by name.** Tags, slugs and `latest` are conveniences
   for humans. Anything recorded in `metadata.json` or used to reproduce a run
   cites a digest, a hash or an immutable serial.
3. **Store artifacts, do not rebuild them.** A rebuild from the same recipe is
   not the same artifact. Images and snapshots are stored and retrieved
   byte-for-byte.
4. **One source of truth.** The snapshot spec lives in `schemas/`. Backend
   models and frontend types are meant to be **generated** from it; that
   generator does not exist yet, so today they are hand-maintained and must be
   updated by hand, in the same commit, every time the spec changes (see
   [open items](docs/reference/open-items.md)). The `openghm` wheel bundles no
   copy at all. If two places state the same fact and neither is generated,
   one of them is wrong.
5. **Verify what you claim.** Every statement of fact about the environment — a
   path, an endpoint, a version, a capability — is checkable, and was checked.
   Write what is true now. If something is unverified, mark it open rather than
   asserting it.
6. **State goes in object storage, not in the cluster.** What we deploy is
   stateless: no PVC, no ConfigMap-as-database, no git-sync sidecar. If a pod
   needs bytes it reads them from Anvil S3.
7. **Compute runs through SLURM.** Anvil's HPC side runs batch jobs only.
   Standing services live on the Composable Subsystem. Nothing long-lived runs
   on a login or compute node.
8. **Docs earn their place.** Architecture describes shape, decisions record
   reasoning, missions hold changing work, reference holds current values. No
   document repeats another. Prose that is neither actionable nor load-bearing
   gets deleted.

## Read `docs/` first

[`docs/`](docs/) is the knowledge base, written for you as much as for a
person. Read in this order and stop when you have enough:

1. **The mission** you were given, if you were given one. Missions are the
   maintainers' planning format and live in the private `openghm-ops`
   repository at `ops/missions/<date>-<slug>/prompt.md`. They are not a
   requirement for contributing: an outside change is an ordinary pull request
   and needs no mission.
2. **[`docs/architecture/`](docs/architecture/)** — the shape of whatever
   you are touching. **Check the `Status:` line first.** *Built* means it
   describes what runs now, and a disagreement with the code is a defect in the
   document. *Target* means it describes what we are building toward, and
   nothing in it exists unless the text says so. Missions come from the gap
   between the two, and closing one moves the description across.
3. **[`docs/reference/`](docs/reference/)** — exact paths, formats and version
   rules for the snapshot spec, the snapshot tree, `metadata.json` and the S3
   layout.
4. **[`docs/decisions/`](docs/decisions/)** — only when you are about to
   contradict one, or the mission asks you to revisit it.

**Never guess a path, a hostname, a bucket or an endpoint.** Look it up in
[`docs/reference/`](docs/reference/) or verify it in the repository. If a
document contradicts the code, **the code is the truth** — say so, and fix the
document rather than working around it.

## This repository is the product, not the deployment

What is here is everything needed to build and run OpenGHM. How *this* instance
is deployed — cluster manifests, encrypted secrets, the Anvil environment, the
operator runbooks — lives in a separate private repository, `openghm-ops`,
cloned into `ops/` and ignored by this one
([ADR 0016](docs/decisions/0016-split-public-and-ops-repositories.md)).

That means two things for you. A path under `ops/` may not exist in your
checkout, and that is normal rather than a broken clone. And a verification
step that needs the cluster, the registry or the secrets is **not yours to
run** — say which commands have to run, in what order, and what a passing
result looks like, then hand it over.

**Do not create commits unless asked.**
