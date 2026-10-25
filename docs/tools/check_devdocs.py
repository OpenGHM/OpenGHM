#!/usr/bin/env python3
"""Check `docs/` for the mistakes that reading misses.

    python3 docs/tools/check_devdocs.py

Exits non-zero if anything fails. Four checks:

  links       every relative markdown link resolves
  crosslinks  every `#anchor` names a real heading, no document links to
              itself, and no line carries the same link twice
  paths       every backticked repo path exists, is a documented future path,
              or is a placeholder
  recipes     every `just <recipe>` names a recipe in the justfile

Each check exists because the one before it cannot see the mistake. `links`
proves a target resolves; `crosslinks` proves it resolves *somewhere else* — a
`[doc.md](doc.md)` inside `doc.md` is a valid link and tells the reader
nothing. `recipes` proves the name after `` `just `` exists in the justfile —
it does not check a bare backticked recipe name with no `just` in front of it.

These documents were once checked far harder than this — every quantity a
mission asserted about the repository, every name in every list, and the greps
its acceptance criteria delegated to. That machinery cost more to keep in step
with the repository than the mistakes it caught were worth, and it is gone.
Checks here describe the shape of a document, not the contents of a mission.

A path that does not exist yet is legitimate — these documents describes work not
yet done — so add it to FUTURE with the mission that creates it.
"""
import pathlib, re, sys, urllib.parse, collections

ROOT = pathlib.Path(__file__).resolve().parents[2]
HB = ROOT / "docs"
# Every document is checked. `devdocs/inbox/` used to be exempt — it held the
# repository's previous knowledge base, moved there unedited by mission 0000 —
# and the exemption died with it: the material was verified against the code
# and filed onto the shelves, so there is nothing here that is nobody's.
#
# `ops/` is deliberately NOT checked: it is a separate repository that may not
# be present at all (ADR 0016), and a check that passes or fails depending on
# whether someone happens to have cloned it is worse than no check.
DOCS = sorted(list(HB.rglob("*.md"))
              + [ROOT / "AGENTS.md", ROOT / "CLAUDE.md", ROOT / "README.md"])

# Paths in the private openghm-ops repository. They are legitimate to name and
# cannot be existence-checked, because `ops/` is absent from a public clone.
EXTERNAL = {
    "ops": "the private openghm-ops repository — see ADR 0016",
}

# paths a mission has yet to create — value is the mission that creates it
FUTURE = {
    # `web-gateway`, `deploy` and `images` were here for mission 0000 and all
    # three exist now. They were removed in 0016 because a blanket `deploy`
    # prefix silently allowed `deploy/k8s/...` long after it had moved to
    # `ops/k8s/`, which is exactly the kind of stale path this check is for.
    "packages/openghm/src/openghm/spec.py": "2026-09-18-complete-the-spec-tree",
    "packages/openghm/tests/test_spec.py": "2026-09-18-complete-the-spec-tree",
    "deploy/services": "0004 — third-party config, an empty placeholder until then",
    "container/v2/lock/2.0.0-r3.lock.json": "0005",
}
# paths a mission has already removed — value is the mission that removed it.
# The counterpart of FUTURE, and missing until mission 0000's first commit ran:
# a mission document has to be able to name the thing it deleted, and every
# reference to `temp_datacatalogs/` or `dev/` in these documents is a record of
# a removal rather than a stale path. Nothing here may be *linked* to — `links`
# is a separate check and still requires the target to exist.
#
# It applies to records only. `README.md` and the two shelves hold *current*
# truth, so naming a directory this mission deleted is a defect there and stays
# one: exempting them blinded `paths` to the four `temp_datacatalogs/` lines
# that T20 exists to rewrite, which is the opposite of what this map is for.
REMOVED_IS_FINE_IN = ("decisions", "tools")
# ...and in the one shelf document that has to name a removed path to do its
# job: `architecture/repository-layout.md` explains that `container/` was
# dropped in favour of `images/`, and rewriting that sentence to `images/`
# makes it say nothing. It is already the declared exception for `shelves`;
# this is the same exception, for the same reason.
REMOVED_IS_FINE_IN_FILE = ("repository-layout.md",)
REMOVED = {
    "temp_datacatalogs": "0000",                      # deleted
    "dev": "0000",                                    # -> devdocs/inbox/, then filed
    "devdocs": "0016",                                # -> docs/, ops half to openghm-ops
    "packages/openghm/snapshots_metadata": "0000",    # -> schemas/…/examples/
    "container": "0000",                              # -> images/
    "k8s": "0000",                                    # -> deploy/k8s/, then ops/k8s/
    "deploy/k8s": "0016",                             # -> ops/k8s/
    "deploy/secrets": "0016",                         # -> ops/secrets/
    "infra/mongo": "0000",                            # -> deploy/local/mongo/
    # Never existed: a layout ADR 0010 considered and rejected. An ADR is
    # append-only, so the alternatives it weighed stay named in it forever.
    "images/wbm-v1-lite/s3": "0010 — rejected alternative, never created",
    "schemas/snapshot-spec/docs": "2026-09-18-complete-the-spec-tree — ADR 0018, empty since 0006, never generated into",
}
# not repository paths: URI schemes, absolute host paths, S3 keys, snapshot
# internals, Lmod module names (`python/3.9.5`), the archived pre-merge
# checkout, and gitignore/dockerignore globs
NOT_A_REPO_PATH = re.compile(
    r"^(s3|oras|docker|library|shub|https?|http\(s\)|mongodb|redis|file)://"
    r"|^[~/]"
    r"|^@"                 # an npm scoped package, `@tiptap/react`
    r"|^\^"                # a token that starts with an anchor is a regex
    r"|^toolkits/"
    r"|^(snapshots|containers|model-inputs|raw-data|raw_data|old|wbm-code|wbmAncillaryData|spool|wbm_output"
    r"|data_init|gdal_test_files|WBM_run_state|meta_data|masks|python"
    r"|model|utilities|crops|soil|data|registry|apps|base|overlays|gateway|linux"
    r"|metadata|layout|examples|docs|snapshot-spec|wbm_init|tests|test|node_modules"
    r"|backend|frontend|infra|sub|done|openghm)/")
PLACEHOLDER = re.compile(r"[<>…*{}|\[\]]|\.\.\.|CHANGE_ME|path/to|00NN")

def _anchors(md):
    """Heading slugs the way GitHub derives them: lowercase, links reduced to
    their label, punctuation dropped, spaces hyphenated."""
    out = set()
    for line in md.split("\n"):
        m = re.match(r"^#{1,6} +(.*?)\s*$", line)
        if not m: continue
        s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", m.group(1).lower())
        out.add(re.sub(r"\s+", "-", re.sub(r"[^\w\s-]", "", s).strip()))
    return out

fail = collections.defaultdict(list)
def bad(kind, doc, msg): fail[kind].append(f"{doc.relative_to(ROOT)}: {msg}")

recipes = set(re.findall(r"^([a-z][a-z0-9-]*)(?: [a-z]+=\"[^\"]*\")*:",
                         (ROOT / "justfile").read_text(), re.M))

for doc in DOCS:
    raw = doc.read_text()
    body = re.sub(r"```.*?```", "", raw, flags=re.S)

    for m in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", body):
        t = m.group(1)
        if t.startswith(("http", "mailto:")): continue
        path, _, frag = t.partition("#")
        tgt = doc if path == "" else doc.parent / urllib.parse.unquote(path)
        if not tgt.exists():
            bad("links", doc, t)
            continue
        if tgt.resolve() == doc.resolve() and not frag:
            bad("crosslinks", doc, f"{t} — links to itself")
        elif frag and frag not in _anchors(tgt.read_text()):
            bad("crosslinks", doc, f"{t} — no such heading")

    for line in body.split("\n"):
        for tgt, n in collections.Counter(
                re.findall(r"\[[^\]]*\]\(([^)]+)\)", line)).items():
            if n > 1 and not tgt.startswith(("http", "mailto:")):
                bad("crosslinks", doc, f"{tgt} — same link {n}x on one line")

    for tok in sorted(set(re.findall(r"`([^`\s]+)`", body))):
        if "/" not in tok or PLACEHOLDER.search(tok) or NOT_A_REPO_PATH.match(tok):
            continue
        p = tok.rstrip("/")
        if p.startswith("./"): p = p[2:]
        if any((base / p).exists() for base in (ROOT, doc.parent, HB)): continue
        rels = {p, str((doc.parent / p).resolve()).replace(str(ROOT) + "/", "")}
        allowed = (*EXTERNAL, *FUTURE, *REMOVED) if (
            any(k in doc.parts for k in REMOVED_IS_FINE_IN)
            or doc.name in REMOVED_IS_FINE_IN_FILE) else (*EXTERNAL, *FUTURE)
        if any(r == f or r.startswith(f + "/") for r in rels for f in allowed):
            continue
        bad("paths", doc, f"`{tok}`")

    # `decisions/` is exempt: an ADR is append-only, so one that named a recipe
    # correctly when it was accepted cannot be rewritten when that recipe moves
    # to the private ops repository. ADR 0013 names `just k8s-apply`.
    if "decisions" not in doc.parts:
        for m in re.finditer(r"`just ([a-z][a-z0-9-]+)", raw):
            if m.group(1) not in recipes: bad("recipes", doc, f"just {m.group(1)}")


for kind in ("links", "crosslinks", "paths", "recipes"):
    if fail.get(kind):
        print(f"\n{kind}  ({len(fail[kind])})")
        for line in fail[kind]: print(f"   {line}")
total = sum(len(v) for v in fail.values())
print(f"\n{len(DOCS)} documents checked — "
      + ("all clear" if not total else f"{total} problems"))
sys.exit(1 if total else 0)
