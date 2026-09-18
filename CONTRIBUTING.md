# Contributing to OpenGHM

Thanks for looking at this. A few things that will save you a round-trip.

## Read this first

[`AGENTS.md`](AGENTS.md) has the project's non-negotiable rules and where to
read next — it is written for an agent and a person equally, and it is short.
[`README.md`](README.md) gets the stack running locally.

**Missions are not required.** `AGENTS.md` mentions a `mission` format the
maintainers use to plan their own work; it lives in a private repository and
has nothing to do with contributing here. An ordinary pull request, with an
issue or a short description of what and why, is all that's expected.

## Setting up

```bash
git clone <this repository>
cd OpenGHM
just install dev
just run dev
```

That starts MongoDB, Redis, and the backend in Docker, and the frontend
locally at `http://localhost:3100` with hot reload. `just --list` shows every
other recipe. You do not need — and cannot get — access to `ops/`; nothing
in local development requires it.

## Making a change

- **Application code** (`web-gateway/`): there is no automated test suite yet
  for the frontend or backend. Verify by running the app and exercising the
  path you changed — say how you tested it in the pull request.
- **The `openghm` toolkit** (`packages/openghm/`): has a real test suite.
  ```bash
  cd packages/openghm && pip install -e ".[dev]" && pytest
  ```
- **Documentation** (`docs/`): run the checker before opening a pull request.
  ```bash
  python3 docs/tools/check_devdocs.py
  ```
  It catches broken links, anchors that don't resolve, backticked paths that
  don't exist, and `just` recipes that aren't real. It does not check whether
  what you wrote is *true* — that part is still on you (`AGENTS.md` rule 5).
- **A design decision that will outlive this pull request** belongs in a new
  ADR under `docs/decisions/`, not just in the PR description. See the ADR
  index in [`docs/README.md`](docs/README.md#decisions) for the format and the
  next free number.

## Snapshot spec changes

`schemas/` is the one source of truth for the snapshot spec
([ADR 0001](docs/decisions/0001-unified-repository.md)). The backend model
and frontend types are **generated** from it — never hand-edit
`web-gateway/backend/app/models/generated/snapshot.py` or
`web-gateway/frontend/lib/repository/generated.ts`, each says so in its own
header. After editing `schemas/snapshot-spec/metadata/1.0.0.json`:

```bash
just codegen
```

Regenerates both files. Commit the diff they produce alongside the schema
change — CI runs the same command and fails if it produces one you didn't
commit. The `openghm` wheel's bundled copy (`packages/openghm/src/openghm/schemas`)
needs no separate step: it is a symlink to the same `schemas/` tree, not a copy.

## Pull requests

- Keep it to one coherent change. A pull request that needs "and" in its
  title is usually two pull requests.
- `AGENTS.md`, `CLAUDE.md`, and `docs/decisions/` are protected by
  [`CODEOWNERS`](.github/CODEOWNERS) — they are read and followed by AI coding
  agents, so a change to them gets reviewed like a permissions change, not
  like prose.
- Match the tone already in the docs you're editing: state what is true, cite
  a path or a line rather than describing it, and mark anything unverified as
  open rather than asserting it.

## Reporting a security issue

Not here — see [`SECURITY.md`](SECURITY.md).
