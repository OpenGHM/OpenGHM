# ADR 0028 — A new simulation is stored when the user saves it, and a stored draft saves its own edits

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

A first version of this decision stored a draft the moment a snapshot was
picked and auto-saved every edit after it. That left an empty draft in My
Simulations for every snapshot someone only looked at, and saved settings the
person had not asked to keep. So nothing is saved until the person says so,
for a new simulation and for a stored draft alike. Refresh and a closed tab
lose what was typed since the last save, and the wizard asks before it lets
that happen.

## Decision

**Saving is always the user's button. A new simulation lives in the browser
until the user saves it, with "Save as draft" or by submitting it. From then
on it is a stored `DRAFT`, and the steps (Run settings, then Review & submit)
edit that draft; its "Save draft" button writes the edits, and nothing writes
them by itself.**

- **Choose on the start screen, store on save, duplicate on the simulation's
  page.** The start screen (`/workspace/new`, step 1, "Choose a model snapshot")
  only chooses: picking a published snapshot opens
  `/workspace/new/<snapshot id>?step=run` and creates nothing. That screen is
  the same wizard over a draft that is not stored yet. It is filled from
  `GET /jobs/derive/{dataset_id}`, which answers with what the derive would
  store, so the defaults are the backend's. **Save as draft** (header, and
  bottom of Run settings) derives the draft (`POST /jobs/derive/{dataset_id}`),
  sends the edits as one `PATCH`, and opens the stored draft with the same
  step showing. **Submit** from Review does the same save first, then submits.
  A save is never done twice for one click: the first one creates the draft,
  and a retry after a failed submit reuses it. Copying happens where the
  simulation is, on its own page, once it has ended: "Duplicate" for a
  completed one, and "Try again with these settings" in the status summary of a
  failed or cancelled one (a page never shows the action twice), both
  `POST /jobs/{id}/duplicate`, which copies one of the caller's own simulations
  in any status. A copy is stored at once (it starts from settings that exist),
  and the user lands on Run settings. "New from this model snapshot" on an ended
  simulation and on a snapshot's page open the unsaved wizard like the start
  screen does.
- **Leaving an unsaved simulation asks first.** While the wizard differs from
  the preview (a space typed and deleted is not a difference), `beforeunload`
  is armed, and a click on a link out of the wizard, or a Back or Forward that
  would leave it, opens "Leave without saving?" with Save as draft, Discard
  changes and Keep editing. A stored draft asks the same while it has unsaved
  changes (Save draft instead of Save as draft). Moving between the wizard's own
  steps never asks. Back and Forward are held back by cancelling the
  traversal itself: the Navigation API's `navigate` event (`navigationType`
  "traverse") fires before `popstate`. Next's `popstate` listener cannot be
  stopped from the wizard (listeners on `window` run in the order they were
  added, and Next's was added first). A cancelled traversal changes nothing: the address stays, Next and the page never hear of it, no history
  entry is added or rewritten, and nothing flashes in the address bar. Discard
  and Save then traverse to the entry that was asked for. That needs the
  Navigation API (Chrome and Edge have it; support in Safari and Firefox is
  open, not checked here); without it Back and Forward are not held back. A
  browser may also decline to let a traversal be cancelled (Chrome does for a
  Back without fresh user activation on the page since the last one it
  cancelled); that move goes through and is not fought. Leaving to another
  document (a reload, another site) is the browser's own `beforeunload` prompt
  only.
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
  `?step=model` opens Run settings. **Nothing saves by itself**, new or stored: not
  after a pause, not on a change of step, not when the page is hidden or left, and
  a failed save is not retried. The header says where the draft stands ("Unsaved
  changes", "Saving…", "Saved · time", "Couldn't save" with a Retry) next to a
  "Save draft" button (Ctrl or Cmd + S does the same), and the button is off when
  there is nothing to save. A stored draft asks before a link out of the wizard
  loses unsaved changes, with Save draft, Discard changes and Keep editing, and
  the browser's own prompt covers a reload; changing step inside the wizard never
  asks. Submit saves first, then submits. Opening a draft from the list opens the
  same wizard, at Review.
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
  `simulation_duplicated`), submit and delete are. A draft is private to its
  owner and saved as often as they press the button, so its history is not an
  operational fact.
- **`about` merges key by key.** A save sends only the keys it owns (`name`
  and `description`); the stored keys it does not mention (creators, license,
  keywords, tags) are kept. A `null` key removes that key, and `about: null`
  clears all of it. A partial save never deletes a stored field.
- **Two tabs on one draft: the last write wins.** A draft is private to its
  owner, so the second tab is the same person.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Keep local state until Review | A refresh or a closed tab loses the input, and the wizard stays a second editor of the same record. (Today's design keeps local state too, but in the same wizard that edits a stored draft, and the person chooses when it is stored.) |
| Auto-save a stored draft after a pause (kept for stored drafts for a while after new simulations stopped doing it) | It saved settings the person had not asked to keep, and made "did I save?" a question about timers instead of a button. One rule is easier to explain: nothing is saved until Save |
| Store a draft when a snapshot is picked, and auto-save it | Every snapshot someone only looked at became a draft in My Simulations, and settings were saved the person had not asked to keep (the first version of this decision) |
| A separate "wizard draft" collection | A second place to keep a simulation, with its own conversion into the first. `jobs` already has a `DRAFT` status |
| Save on every keystroke | It floods the backend, and Next runs server actions one at a time, so a Next click would queue behind a backlog of saves |

## Consequences

- Derive is no longer the only creation path: duplicate is the second, and
  it must copy only what a draft is made of. A copy never carries the source's
  `sim_id`, SLURM ids, verdict, files or `orphan_sim_ids`.
- Choosing a snapshot on the Start screen (a click on its card, or Select in
  its Details sheet) creates nothing. Going Back and picking another snapshot
  leaves no draft behind, and a draft appears in My Simulations only when
  someone saved it.
- Input typed into a new simulation is lost on a refresh, a closed tab or the
  browser's Back, unless it was saved. The leave prompt covers all three, the
  last only in a browser with the Navigation API, and not when the browser
  declines to let a Back be cancelled.
- A simulation saved with "Save as draft" takes two requests (derive, then
  patch). If the patch fails or leaves a field out, the draft exists with what
  the server took, and the wizard says which settings were not saved.
- A save changes `updated_at`, which re-sorts My Simulations. That is
  intended.
- The gateway architecture document changes with it. The draft editor
  and the wizard's local state go away; the status page of a submitted job is
  unchanged.
- A save that fails is shown to the user, never dropped silently.
