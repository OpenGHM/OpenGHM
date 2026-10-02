# ADR 0028 — A new simulation is a saved draft from its first step, and its edits auto-save

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-02 |
| **Affects** | [`../architecture/gateway.md`](../architecture/gateway.md), [ADR 0024](0024-who-may-run-a-simulation.md) |

## Context

Today a simulation is born at the end of a wizard. `/workspace/new` keeps the
choices of steps 2 to 4 (model input, run settings, name and description) in
the browser's memory, and nothing is saved until the Review step, which
derives the draft from the snapshot and then patches it. "Nothing is real until
Review."

A saved draft is then edited in a second screen, a separate editor with one
Save button. So two screens edit one thing, each with its own copy of the
same rules, and a refresh or a closed tab in the wizard loses everything the
user typed.

## Decision

**A simulation is a saved `DRAFT` from the end of step 1, and the steps after
it (Run settings, then Review & submit) edit that draft and save it as they
go.**

- **Two ways to start.** Step 1 either derives a draft from a published
  snapshot (`POST /jobs/derive/{dataset_id}`, as now), or duplicates one of
  the caller's own simulations, in any status (`POST /jobs/{id}/duplicate`).
  Either answer is a new `DRAFT`, and the user lands on Run settings.
- **The steps after Start from edit the draft.** Run settings (what it is
  based on, the run period, the output variables, cores and walltime), then
  Review & submit (one summary, name and description, and the submit area). There
  was a "Model & input" step between them; nothing on it could be changed, because
  the toolkit has no option for a different model input, so it was dropped, and
  `?step=model` opens Run settings. The draft saves itself after a pause, when the user
  changes step, and when the page is hidden or left. Opening a draft from the
  list opens the same wizard, at Review.
- **The starting point cannot change.** A draft keeps the snapshot it was
  derived from. To start from another, start another draft.
- **Only a `DRAFT` can be edited, and the write itself says so.** `PATCH` is
  refused with `409` once the status is past `DRAFT`, and the check is part of
  the database write (`status: "DRAFT"` in its filter), not a read before it.
  A submit that lands between the check and the write cannot then be
  overwritten.
- **Edits are not audited.** Creation (`simulation_derived`,
  `simulation_duplicated`), submit and delete are. A save fires every few
  seconds while someone types, and a draft is private to its owner, so its
  history is not an operational fact.
- **`about` merges key by key.** A save sends only the keys it owns (`name`
  and `description`); the stored keys it does not mention (creators, license,
  keywords, tags) are kept. A `null` key removes that key, and `about: null`
  clears all of it. A partial save never deletes a stored field.
- **Two tabs on one draft: the last write wins.** A draft is private to its
  owner, so the second tab is the same person.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Keep local state until Review | A refresh or a closed tab loses the input, and the wizard stays a second editor of the same record |
| A separate "wizard draft" collection | A second place to keep a simulation, with its own conversion into the first. `jobs` already has a `DRAFT` status |
| Save on every keystroke | It floods the backend, and Next runs server actions one at a time, so a Next click would queue behind a backlog of saves |

## Consequences

- Derive is no longer the only creation path: duplicate is the second, and
  it must copy only what a draft is made of. A copy never carries the source's
  `sim_id`, SLURM ids, verdict, files or `orphan_sim_ids`.
- The snapshot picker's Select now creates a draft, not a choice held in the
  page. A user who goes Back from Run settings and picks again leaves the first
  draft behind. It is a draft like any other, shown in My Simulations and
  deletable there.
- A save changes `updated_at`, which re-sorts My Simulations. That is
  intended.
- The gateway architecture document changes with it. The draft editor
  and the wizard's local state go away; the status page of a submitted job is
  unchanged.
- A save that fails is shown to the user, never dropped silently.
