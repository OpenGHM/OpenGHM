"""openghm — WBM toolkit for Anvil HPC (library + CLI).

Wraps the three WBM tools-lite scripts (``networkTools``,
``spatial_aggregation.pl``, ``temporal_aggregation.pl``) inside the Singularity
container behind one entry point::

    import openghm

    res = openghm.spatial(
        mt="/work/test.MT.csv", data_code="RUNOFF_Y",
        mask_code="US_states_6min", work="/scratch/work",
        mounts={"gt_output": "/.../gtout"}, dry_run=True,
    )
    print(res.display)

…or via the ``openghm`` command line (see ``openghm --help`` / ``openghm wizard``).
"""

from __future__ import annotations

from .api import preclip, subset, spatial, temporal, submit, run
from .config import Config, load_config
from .errors import OpenghmError, ValidationError
from .types import BuiltCommand, DirCopy, GeneratedFile, Mount, RunResult

__version__ = "0.2.0"

__all__ = [
    # primary surface
    "preclip",
    "subset",
    "spatial",
    "temporal",
    "submit",
    "run",
    # return type
    "RunResult",
    # useful types
    "Mount",
    "BuiltCommand",
    "GeneratedFile",
    "DirCopy",
    # config
    "Config",
    "load_config",
    # errors
    "OpenghmError",
    "ValidationError",
    "__version__",
]
