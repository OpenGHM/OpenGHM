# ADR 0024 — Only a user an administrator has permitted runs a simulation

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-30 |
| **Affects** | [`../architecture/gateway.md`](../architecture/gateway.md), [open item 13](../reference/open-items.md) |

## Context

A submitted simulation runs on Anvil as the one shared service account
(`x-openghm`) and is charged to the one shared SLURM allocation. Each run
spends allocation that every other user of the gateway also depends on, and
nothing on Anvil tells one gateway user's job from another's.

Until now, anyone who registers gets `role: user`, which holds `job:submit`.
They get it at once, before their email is verified. And because
`get_current_user` trusts the JWT's claims, a user an administrator
deactivates can keep submitting until their access token expires, up to an
hour. That did not matter while every job ran `echo`. It matters as soon as a
job runs WBM.

Access to a job someone else owns was also answered two ways. The read and
cancel routes said 403, which confirms that the id exists. The edit and delete
routes said 404.

## Decision

**Running a simulation needs a permission an administrator grants, checked
against the database at submit time.**

- A submit is allowed only when the user's *database record*, read at that
  moment and not the token, is `is_active`, `email_verified`, and permitted to
  run simulations.
- **Permitted** means:
  - role `admin` or `staff`, or
  - role `user` with `can_run_simulations: true` on the user document.

  The flag defaults to `false`. Only an administrator can set it, and every
  change is audited.
- A `guest` is never permitted. A mock-auth identity is never permitted,
  whatever the environment.
- A user who is not permitted can still create and edit drafts. Only
  submitting needs the permission, and the UI says whom to ask.
- Each user may have a bounded number of active jobs
  (`JOB_MAX_ACTIVE_PER_USER`). Admin and staff are exempt.
- **A job you may not see is a 404, on every job route.** Staff and admin see
  and cancel through their existing `job:*:any` permissions.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Any verified user may run | Registration is open, so the shared allocation would be open to anyone with an inbox |
| An email-domain allow-list | It admits collaborators by where they work, not by whether someone agreed to their use, and it still admits everyone at the domain |
| A new role between `guest` and `user` | Roles are tiers of what one can *see and manage*. Being allowed to spend the allocation is a separate grant, and a flag keeps the two independent |

## Consequences

- An administrator has to act before a new user's first run. The admin user
  page gains the toggle.
- The submit and derive routes read the user document on every call. The
  polled routes do not.
- Open item 13 is closed: non-owners get 404.
