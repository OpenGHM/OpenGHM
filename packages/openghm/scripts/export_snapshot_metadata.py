#!/usr/bin/env python3
"""Export the OpenGHM snapshot metadata (MongoDB seed) to on-disk ``metadata.json``.

The three snapshot documents are defined in the backend seed
(``web-gateway/backend/app/db/seed_repository.py``) — the current source of truth.
This one-off converter copies each document **verbatim** (only the MongoDB
``_id`` is dropped) and appends a ``jobSubmission`` block carrying what
``openghm sim submit`` needs to actually run the snapshot (chiefly the
representative init filename).

The output files are written under ``snapshots_metadata/`` and are meant to be
placed at each snapshot's **root** on Anvil as ``<snapshot_folder>/metadata.json``.

Run::

    python scripts/export_snapshot_metadata.py

The seed module imports ``app.core.database.get_db`` at the top but only uses it
inside ``seed_datasets()``. To avoid pulling in the whole backend (motor/mongo),
we exec the seed source with that symbol stubbed, then read the three dicts.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

# ── locate the backend seed inside this repository ────────────────────────────
# scripts/ -> openghm/ -> packages/ -> <repo root>/web-gateway/backend/app/db/...
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SEED_PATH = _REPO_ROOT / "web-gateway" / "backend" / "app" / "db" / "seed_repository.py"

_OUT_DIR = _REPO_ROOT / "schemas" / "snapshot-spec" / "examples"

# ── per-snapshot job-submission facts, keyed by the seed doc's slug ───────────
# init: the representative .init to run (full filename, lives at <snap>/wbm_init/).
# folder: the on-disk snapshot folder name (differs from the Mongo slug).
# dataSubdir: the single subdirectory under <snap>/data/.
# cores/walltime are taken from recommendedComputeSetting, so they are not
# duplicated here.
_JOB_INFO = {
    "wbm_storage_v2.0.0": {
        "folder": "wbm_storage_v2.0.0",
        "init": "wbm_test.init",
        "wbmVersion": "2.0.0",
        "dataSubdir": "wbm_ancillary_data_v2.0.0",
    },
    "wbm_global_v1.0.0": {
        "folder": "wbm_storage_v1.0.0_Global",
        "init": "Global_tracking.init",
        "wbmVersion": "1.0.0",
        "dataSubdir": "Global_tracking",
    },
    "wbm_wyoming_v1.0.0": {
        "folder": "wbm_storage_v1.0.0_Wyoming",
        "init": "Wyoming_tracking.init",
        "wbmVersion": "1.0.0",
        "dataSubdir": "Wyoming_tracking",
    },
}


def _load_seed_dicts() -> list:
    """Exec the seed module with ``get_db`` stubbed and return its snapshot dicts."""
    if not _SEED_PATH.is_file():
        raise SystemExit(f"seed file not found: {_SEED_PATH}")

    # Pre-register a stub so `from app.core.database import get_db` resolves without
    # importing the real (mongo-backed) backend module.
    for name in ("app", "app.core"):
        sys.modules.setdefault(name, types.ModuleType(name))
    stub_db = types.ModuleType("app.core.database")
    stub_db.get_db = lambda: None  # type: ignore[attr-defined]
    sys.modules["app.core.database"] = stub_db

    ns: dict = {}
    exec(compile(_SEED_PATH.read_text(), str(_SEED_PATH), "exec"), ns)
    return ns["_SEEDS"]


def _to_metadata(doc: dict) -> dict:
    """Copy the whole seed doc (minus ``_id``) and append ``jobSubmission``."""
    slug = doc.get("slug")
    if slug not in _JOB_INFO:
        raise SystemExit(f"no jobSubmission mapping for snapshot slug {slug!r}")
    info = _JOB_INFO[slug]

    out = {k: v for k, v in doc.items() if k != "_id"}

    rcs = doc.get("recommendedComputeSetting") or []
    cores = int(rcs[0]) if len(rcs) >= 1 else None
    walltime = rcs[1] if len(rcs) >= 2 else None

    out["jobSubmission"] = {
        "init": info["init"],
        "wbmVersion": info["wbmVersion"],
        "dataSubdir": info["dataSubdir"],
        "cores": cores,
        "walltime": walltime,
    }
    return out


def main() -> None:
    seeds = _load_seed_dicts()
    _OUT_DIR.mkdir(parents=True, exist_ok=True)

    for doc in seeds:
        meta = _to_metadata(doc)
        folder = _JOB_INFO[doc["slug"]]["folder"]
        out_path = _OUT_DIR / f"{folder}.json"
        out_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {out_path.relative_to(_OUT_DIR.parent)}  "
              f"(init={meta['jobSubmission']['init']}, "
              f"cores={meta['jobSubmission']['cores']}, "
              f"walltime={meta['jobSubmission']['walltime']})")

    print(f"\n{len(seeds)} metadata.json files written to {_OUT_DIR}")
    print("Deploy: copy each <folder>.json to <snapshot_root>/<folder>/metadata.json on Anvil.")


if __name__ == "__main__":
    main()
