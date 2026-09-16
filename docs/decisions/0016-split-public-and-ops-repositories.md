# ADR 0016 — The product is public; this instance's deployment is a separate private repository

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-16 |
| **Affects** | repository layout, `justfile`, `docs/`, deployment, anyone who deploys |

Supersedes in part [0001](0001-unified-repository.md) and amends
[0010](0010-repository-layout.md)'s description of `deploy/`.

## Context

OpenGHM is being opened to outside contributors. The repository was built for a
team that both develops and deploys it, and roughly half of what it holds
describes *our* deployment rather than the product: twelve Kubernetes
manifests, two encrypted Secrets, the recipient list that can decrypt them, four
reference documents naming the Anvil environment and who holds which
credential, and about half the root `README.md`.

None of that is reusable. The gateway is bolted to one place — Anvil, SLURM,
one S3 bucket, the NSF allocation `x-ees260008`, Purdue RCAC's Composable
Subsystem. Nobody outside Purdue will deploy it. Published, those files are not
a dangerous leak so much as noise that describes a live system's operational
surface to an audience that can do nothing with it.

The opposite is true of `deploy/local/`. The compose file and the mongo seed are
the only way anyone runs this project at all, and without them there is no
contribution.

So the line does not fall around `deploy/`. It runs through it.

## Decision

**Two repositories, asymmetric.**

`OpenGHM` — public, and the main one. The gateway, the toolkit, the spec, the
image recipes, `deploy/local/`, and the knowledge base minus its operator half.
`devdocs/` is renamed `docs/`.

`openghm-ops` — private, and small. `ops/k8s/`, `ops/secrets/`,
`ops/.sops.yaml`, the four operator reference documents, the Anvil verification
scripts, the missions, and the deployment half of the `justfile` and
`README.md`.

**They are joined in the working tree, not in git.** `openghm-ops` is cloned
into `ops/`, which the public repository gitignores. It is deliberately *not* a
submodule: a submodule would publish the private repository's URL in
`.gitmodules` and break `git clone --recurse-submodules` for every contributor
who cannot authenticate to it.

**The `justfile` rejoins itself.** The public one carries `import? 'ops/justfile'`
— optional, so it is silent when `ops/` is absent. With it, `just k8s-apply`
exists; without it, the recipe simply is not there.

**`namespace` is defined once, in the public justfile.** `just` rejects a second
definition in an imported file outright, which removes the split-brain risk this
design would otherwise have had.

**The public repository must be complete on its own.** A clone with no `ops/`
must build, run, test and pass `check_devdocs.py`. That is the acceptance
criterion for the split, and it is why `images/` stayed whole: `deploy_to_anvil.sh`
is stage one of the documented container build, not a deployment script.

**The two meet at a digest.** The public repository produces an image; the
private one records which digest is running. Nothing else crosses.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Publish everything | The operator half is noise to a contributor, and it describes a live system's posture. |
| A git submodule for `ops/` | Publishes the private URL in `.gitmodules`, and fails `--recurse-submodules` for everyone outside the team. |
| Private repository as primary, public as a filtered mirror | Needs bespoke sync tooling, gives outside pull requests no way back in, and the histories diverge. |
| Keep one repository, scrub it instead | Does not address the noise, and leaves the deployment surface published anyway. |

## Consequences

Deploying now takes two commits, and their order is forced: the public one
first, because a digest cannot be pinned before it exists.

`docs/` no longer holds anything about the Anvil environment, the endpoints or
the credentials. A document that needs such a fact names the private repository
instead of linking to it — the `links` check would fail on a target that is
absent from a public clone, and that is correct.

Missions move to the private repository and are renamed by start date rather
than number (`2026-09-16-<slug>`), since numbering collides when two people
start work in parallel. Their **Next** list goes with them, which means the
project's own roadmap is not visible to contributors. That is a real cost and
not yet paid for; see [open-items.md](../reference/open-items.md).

`check_devdocs.py` gains one exemption: `decisions/` is skipped by the `recipes`
check. An ADR is append-only, so ADR 0013 — which correctly named
`just k8s-apply` when it was accepted — cannot be rewritten now that the recipe
lives elsewhere.
