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

- **Derive on the start screen, duplicate on the simulation's page.** The start screen
  (`/workspace/new`, step 1, "Choose a model snapshot") derives a draft from a
  published snapshot (`POST /jobs/derive/{dataset_id}`) and offers nothing else:
  no copy of a simulation. Copying happens where the simulation is, on its own
  page, once it has ended: "Duplicate" for a completed one, and "Try again with
  these settings" in the status summary of a failed or cancelled one (a page
  never shows the action twice), both `POST /jobs/{id}/duplicate`, which copies
  one of the caller's own simulations in any status. Either answer is a new
  `DRAFT`, and the user lands on Run settings.
- **The start screen is the repository's search over snapshots.** It always
  shows a search box and a Filters panel (tag, temporal coverage, spatial
  resolution), the count, the cards and pages, and an empty state: the same
  `GET /repository/catalogue` the Data Repository reads, with the type fixed to
  `snapshot`, so the search, the filters, the facet counts and the order are
  the repository's, and a short list and a long one are used the same way.
  Snapshots the caller has used are marked, and listed first only when nothing
  else orders the list (no search, one page).
- **A snapshot is named by its title.** Wherever the workspace names one (a
  card, "Based on" on Run settings, Review and the simulation page, a
  simulation's row in the list, the Snapshots & Inputs list) it shows the
  snapshot's own title (`about.name`, or the title the simulation was derived
  under), cut to one or two lines by CSS and whole on hover. The model and
  version, the years, the resolution and the publication date appear beside it as
  plain facts, never joined into a name of their own: the spec has no short
  name, and one made up from its fields would read as if it were.
- **The steps after Start from edit the draft.** Run settings (what it is
  based on, then one card: name and description, the run period, the output
  variables, cores and walltime), then Review & submit (one summary and the
  submit area; nothing is edited there). There
  was a "Model & input" step between them; nothing on it could be changed, because
  the toolkit has no option for a different model input, so it was dropped, and
  `?step=model` opens Run settings. The draft saves itself after a pause, when the user
  changes step, and when the page is hidden or left. Opening a draft from the
  list opens the same wizard, at Review.
- **The name is asked for first, and is optional.** Name and description are the
  first part of Run settings, the first screen of a new draft, and the Name takes
  focus there while the draft has none. The input is empty until the user names
  the draft, with an example as its placeholder. "Untitled (<id8>)" is only what
  the header, breadcrumb and list call an unnamed draft (`displayName`); it is
  never stored as `about.name` and never put in the input. Review lists the name
  and description as rows (an unnamed draft reads "Not named yet") whose Edit
  returns to the input. An empty name does not block a submit: the simulation
  keeps the generated display name, and the backend does not require one.
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
- Choosing a snapshot on the Start screen (a click on its card, or Select in
  its Details sheet) now creates a draft, not a choice held in the page. A user
  who goes Back from Run settings and picks again leaves the first draft
  behind. It is a draft like any other, shown in My Simulations and
  deletable there.
- A save changes `updated_at`, which re-sorts My Simulations. That is
  intended.
- The gateway architecture document changes with it. The draft editor
  and the wizard's local state go away; the status page of a submitted job is
  unchanged.
- A save that fails is shown to the user, never dropped silently.
