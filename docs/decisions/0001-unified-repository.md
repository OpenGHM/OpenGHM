# ADR 0001 — One repository holds the application, the toolkit and the spec

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | repository layout, CI |

Superseded in part by [0016](0016-split-public-and-ops-repositories.md): the
product is still one repository, but this instance's deployment was split out
of it when the project was opened to outside contributors.

## Context

The work was split across two checkouts: `OpenGHM` (backend, frontend, k8s) and
a separate `toolkits` (the `openghm` library and CLI, container recipes, docs).

They were not actually independent. `export_snapshot_metadata.py` in the
toolkit located the backend's seed data by walking up three directories to a
sibling checkout — an undeclared coupling that only worked if both repositories
were cloned side by side under the same parent with exact names.

The artifact-versioning design makes this worse rather than better. Publishing
a new snapshot-spec version writes into three trees at once: the schema file
itself, a generated Pydantic model for the backend, generated TypeScript types
for the frontend, and a copy bundled as package data in the `openghm` wheel so
validation works offline. Split across repositories that is several pull
requests that must land together, and the CI gate that matters most —
"regenerating from the schema produces no diff" — cannot run at all.

Both repositories are small: ~138 and ~194 tracked files, ~3 MB each. The
toolkit had no git remote of its own.

## Decision

`OpenGHM` is the single repository. The toolkit's contents are copied in
alongside the application. How they sit next to each other is
[ADR 0010](0010-repository-layout.md)'s; this decides only that there is one
repository.
OpenGHM/
  schemas/           # the snapshot spec — one source, generated outward
  backend/ frontend/ # generated models and types live here
  packages/openghm/  # the library + CLI, built as a wheel
  container/         # image recipes and lock records
  k8s/ infra/        # cluster manifests
  devdocs/           # this knowledge base
```

`backend/` and `frontend/` stay where they are: `justfile`, `docker-compose.yml`
and five k8s manifests reference those paths, and moving them would break
deployment for no benefit.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Keep two repositories, formalise the coupling | The coupling is a spec change spanning three consumers. Formalising it means cross-repository CI and synchronised merges to buy back what one repository gives for free. |
| Merge with `git subtree` to preserve history | Considered and prepared, but the toolkit's history is 17 commits of early exploration. Copying is simpler and the old checkout is kept as the archive. |
| Move everything under a new third repository | All the deployment tooling and the only working remote are already in `OpenGHM`. |

## Consequences

Spec changes become one atomic commit, and the codegen CI gate becomes
possible. The toolkit's 17 commits of history stay behind in the old checkout,
which remains readable but is no longer developed.

If the `openghm` wheel is ever published to PyPI from a public source
repository, `packages/openghm/` is the piece to split back out — it has a clean
interface (a wheel) and is the only part with an external audience.
