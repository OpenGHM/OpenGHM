#!/usr/bin/env python3
"""Collapse a finished mission's folder into one file under `archive/`.

    python3 docs/tools/archive_mission.py 2026-09-16-publish-the-snapshot-spec

Missions live in the private `openghm-ops` repository, cloned into `ops/`, and
are named by start date and slug rather than numbered (ADR 0016). The argument
is a prefix of that name; anything unambiguous will do.

A mission is a folder while it is being worked: five documents, each edited by
a different part of the job. Once it is finished nobody edits any of them
again, and five files with a `prompt.md` that is the same in every mission is
not how you want to read a record a year later. So the folder becomes one
file: `ops/missions/archive/<date>-<slug>.md`.

`prompt.md` is dropped — it is identical in every mission and carries no
record. The other four become sections, in the order they were written.

Links *between* the mission's own documents become anchors within the merged
file. Depth is otherwise unchanged: a folder and `archive/` sit side by side.

Refuses to run while `spec.md` says anything but `Status: done` or
`Status: abandoned`. A mission whose verification is still waiting on someone
else's cluster is not done, and this is the last point at which that is easy
to notice. An abandoned mission is finished too, and collapses the same way.
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
# openghm-ops is a separate repository cloned into ops/. Every git call below
# runs inside it, not in the public repository, which does not track any of it.
OPS = ROOT / "ops"
MISSIONS = OPS / "missions"
PARTS = [("spec.md", None), ("plan.md", "Plan"),
         ("tasks.md", "Tasks"), ("review.md", "Review")]


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    if not MISSIONS.is_dir():
        sys.exit(f"{MISSIONS.relative_to(ROOT)} not found — missions live in the private "
                 "openghm-ops repository, cloned into ops/. See ADR 0016.")
    name = argv[1]
    folders = [p for p in MISSIONS.glob(f"{name}*")
               if p.is_dir() and p.name != "archive"]
    if len(folders) != 1:
        found = ", ".join(sorted(p.name for p in folders)) or "none"
        sys.exit(f"expected exactly one mission folder matching {name!r}, "
                 f"found {len(folders)}: {found}")
    src = folders[0]

    spec = (src / "spec.md").read_text()
    status = re.search(r"^\| \*\*Status\*\* \| (\S+)", spec, re.M)
    if not status or status.group(1) not in ("done", "abandoned"):
        sys.exit(f"{src.name}: Status is {status.group(1) if status else 'unset'!r}, not 'done' or 'abandoned'. "
                 "Finish the verification — including anything an operator has to run — first.")

    out, missing = [], []

    def _demote_headings(text: str) -> str:
        lines, in_fence = text.split("\n"), False
        for i, line in enumerate(lines):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
            elif not in_fence and line.startswith("#"):
                lines[i] = "#" + line
        return "\n".join(lines)

    for name, heading in PARTS:
        f = src / name
        if not f.exists():
            missing.append(name)
            continue
        text = f.read_text().strip()
        if heading:
            # Demote every heading one level so the merged file has one h1 —
            # but not inside fenced code, where `# …` is a shell comment and
            # `##` is a silent corruption of a command someone will paste.
            text = _demote_headings(text)
            text = re.sub(r"^## Mission [^\n]*\n+", "", text)
            text = f"## {heading}\n\n{text}"
        out.append(text)

    merged = "\n\n---\n\n".join(out) + "\n"
    # Depth is unchanged: `missions/<slug>/spec.md` and `missions/archive/
    # <slug>.md` are both two levels under `ops/`, so `../../x` still
    # resolves. Rewriting it to `../x` broke every shelf link in the first
    # mission archived.
    # links between the mission's own documents are now anchors in this file
    merged = re.sub(r"\]\((?:\./)?(spec|plan|tasks|review)\.md(#[\w-]*)?\)",
                    lambda m: f"](#{m.group(1)})" if m.group(1) != "spec" else "](#goal)",
                    merged)

    dest_dir = MISSIONS / "archive"
    dest_dir.mkdir(exist_ok=True)
    dest = dest_dir / f"{src.name}.md"
    if dest.exists():
        sys.exit(f"{dest} already exists")
    dest.write_text(merged)

    rel = str(src.relative_to(OPS))
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", rel],
                             cwd=OPS, capture_output=True).returncode == 0
    # -f because the folder is normally archived in the same breath as the last
    # edits to it, and `git rm` refuses a file with uncommitted changes. Safe
    # here and only here: every byte was just merged into `dest`.
    subprocess.run(["git", "rm", "-rqf", rel] if tracked else ["rm", "-rf", str(src)],
                   cwd=OPS, check=True)

    print(f"{src.relative_to(ROOT)}/  ->  {dest.relative_to(ROOT)}")
    if missing:
        print(f"  (no {', '.join(missing)} — nothing to merge from it)")
    print("  prompt.md dropped: identical in every mission")
    print(f"\nNow add it to the Done list in {(MISSIONS / 'README.md').relative_to(ROOT)}.")


if __name__ == "__main__":
    main(sys.argv)
