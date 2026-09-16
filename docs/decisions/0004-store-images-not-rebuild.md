# ADR 0004 — Container images are stored, never rebuilt to reproduce

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | `container/`, CI |

## Context

`apptainer build` is not bit-reproducible. squashfs embeds timestamps, and an
unpinned `apt-get` resolves to different package versions over time. So the
same recipe run twice produces two different digests.

A snapshot pins a container by digest. If reproducing that snapshot meant
rebuilding the image, the pin could never be satisfied.

## Decision

The SIF digest identifies **that build artifact**, and the artifact is stored,
not regenerated. Rebuilding from the same recipe is never treated as
reproducing an image.

Alongside it, pin what can be pinned so a revision is reconstructible as
closely as possible: base image by digest, every apt package by explicit
version, and a committed lock record holding the base digest, the apt pin list,
the CPAN versions the model actually loads, and the verification result.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Rebuild from the recipe on demand | Cannot satisfy a digest pin. Silently produces a different environment. |
| Make the build bit-reproducible | Would require reproducible squashfs and a frozen package archive — far more work than storing a ~370 MB file. |

## Consequences

Images must be retained for as long as any published snapshot pins them, and
old revisions must stay installed on Anvil. Storage grows monotonically; the
lock record is what makes an old image explainable rather than opaque.
