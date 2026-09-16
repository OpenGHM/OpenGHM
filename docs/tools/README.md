# Tools

Scripts `docs/` needs to keep itself honest.

| Script | What it does |
|---|---|
| [check_devdocs.py](check_devdocs.py) | Verifies links and their anchors, repository paths, `just` recipes and the shelf indices. No dependencies; run it before merging a documentation change. |

```bash
python3 docs/tools/check_devdocs.py
```

## The five checks

`links` resolves every relative markdown link. `crosslinks` is the one it
cannot do: it proves a link resolves *somewhere else*. A document that links to
itself is a valid link and tells the reader nothing. It also catches an
`#anchor` naming a heading that is not there.

`paths` requires every backticked repository path to exist. A path these
documents name before it exists is legitimate — we describe work not yet done —
so add it to `FUTURE` with the mission number that creates it, and a path a
mission has already deleted goes in `REMOVED` the same way. Neither is a
permanent exception: both carry the mission that closes them.

`REMOVED` applies to records only — `decisions/` and
here. `README.md` and the two shelves hold current truth, so naming a deleted
directory there is a defect and stays one. Exempting them once blinded the
check to the four `temp_datacatalogs/` lines in the root README, which is the
opposite of what the map is for.

`recipes` requires every `just <recipe>` to name a real recipe — and, on a line
that enumerates recipes, every bare backticked name on it too. A line becomes
an enumeration once two of its names are real recipes. Prose about the
`justfile` named `restart` and `scale-up`; neither is a recipe.

`indices` requires every document to be listed in its shelf's README, every ADR
and mission in an index to exist, and each ADR's status in the index to match
the status in the ADR itself.

## What is not checked, and why

This script was once twice this size. It also verified every quantity a mission
asserted about the repository — "thirteen recipes", "six manifests" — against a
probe that derived the number from the tree; the names beside those numbers;
each mission's task ids and commit headings; the moved paths left on the two
shelves; and the greps a plan handed to an acceptance criterion, by running
them.

All of it worked. None of it was worth the upkeep: a mission is a few weeks of
moving files, and a checker that asserts a count of them has to be edited every
time the count is right for a new reason. Mission 0000 ended with sixty-four
failures against a repository that was correct, because the documents described
the layout before the move and the probes read the one after.

So the rule now is that a check may describe the **shape** of a document — its
links resolve, its paths exist, its names are real — and may not describe the
**contents of a mission**. If a mission needs a number verified, it verifies it
in its own `spec.md` verification block, where it is read by whoever runs the
mission and retires with it.
