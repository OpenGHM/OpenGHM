# ADR 0009 — Published output is carried in the snapshot, not a reproduction target

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | snapshot layout, `SHA256SUMS` |

## Context

Snapshots already ship the model output they produced, under
`wbm_output/<runId>/`. On the Global snapshot that is ~470 GB — about 47 % of
the total, with a regenerable spool cache accounting for another 49 %.

Shipping output next to inputs implies the two are consistent. In at least one
case they are not: the v2 snapshot's output was produced in 2021 by WBM
v21.2.0, while the snapshot now ships model v23.9.0 with renamed and
reformatted inputs. That output cannot be reproduced from the snapshot
containing it.

## Decision

Output is **carried, not consumed**. It gets no identifier of its own, is
excluded from `SHA256SUMS`, and is never bind-mounted — runs write to
per-simulation scratch instead. It is a record of what was published, useful
for inspection and citation.

Verifying a rerun against published output is a separate, manual exercise with
the comparison harness, not a property the snapshot format asserts.

Which tier a snapshot ships (`none`, `subset`, `full`) is recorded.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Make output a sixth versioned axis | Implies a reproducibility guarantee the artifacts do not support. |
| Include output in the identity manifest | A rerun that legitimately leaves output untouched would still be comparing against a result, not an input. |
| Drop output from snapshots entirely | It is existing practice and the stored-golden comparison test depends on it. |

## Consequences

95 % of a published snapshot is not input data, so distribution cost is
dominated by artifacts that do not define identity — which is what makes
tiering worth deciding. Because identity covers inputs only, the same inputs
published at two output tiers collide on one key (see
[ADR 0005](0005-namespace-decides-the-key.md)).
