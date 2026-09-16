"""``openghm spatial`` — wraps spatial_aggregation.pl.

Faithful flag→arg mapping (Model 1). The Magic Table (``mt``) is required and
already carries container paths; the CLI does not rewrite it in v1.

Enforced v2 workarounds:
 - ``mt`` is required (DataID_DB.csv missing → no global dataset lookup).
 - ``key_file`` (-f) defaults to ``/work/<mask>.msk`` when omitted, because
   RIMS.conf lacks ``pol_key_dir`` and the script crashes without it.
"""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass
from typing import List, Optional

try:
    from typing import Literal
except ImportError:  # pragma: no cover
    from typing_extensions import Literal  # type: ignore

from ._fmt import js_num
from .build import assemble
from .errors import OpenghmError
from .mounts import MountSet, MountsArg, normalize_mounts
from .runtime import RuntimeContext
from .types import BuiltCommand

SCRIPT = "/wbm/utilities/spatial_aggregation.pl"


@dataclass
class SpatialOptions:
    mt: str = ""  # required
    data_code: str = ""  # DATA_CODE positional
    mask_code: str = ""  # MASK_CODE[+MASK2+...]
    output: Optional[str] = None  # NetCDF_OUT positional (optional; else from MT)
    key_file: Optional[str] = None  # -f ; auto-defaulted
    start: Optional[str] = None  # -sd
    end: Optional[str] = None  # -ed
    method: Optional[Literal["mean", "sum"]] = None  # sum -> -c (default mean)
    weight: Optional[float] = None  # -na
    mask_res: Optional[float] = None  # -tr
    out_type: Optional[str] = None  # -ot
    scale: Optional[float] = None  # -scl
    offset: Optional[float] = None  # -off
    metadata: Optional[str] = None  # -mdt
    remove: Optional[bool] = None  # -rm
    remove_mask: Optional[bool] = None  # -rmsk
    remove_records: Optional[int] = None  # -rr
    zero_id: Optional[bool] = None  # -z
    verbose: Optional[bool] = None  # -v
    work: Optional[str] = None
    mounts: MountsArg = None


def _sanitize_mask(mask: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", mask)


def build_spatial(opts: SpatialOptions, ctx: RuntimeContext) -> BuiltCommand:
    if not opts.mt:
        raise OpenghmError("--mt (Magic Table CSV) is required")
    if not opts.data_code:
        raise OpenghmError("--data (DATA_CODE) is required")
    if not opts.mask_code:
        raise OpenghmError("--mask (MASK_CODE) is required")

    ms = MountSet()
    for d in normalize_mounts(opts.mounts):
        ms.add_data_dir(d.name, d.dir)
    if opts.work:
        ms.set_work(opts.work)

    mt_c = ms.resolve_work(opts.mt)
    # -f defaults under /work so the script's mask cache has somewhere to go.
    key_c = (
        ms.resolve_work(opts.key_file)
        if opts.key_file
        else posixpath.join("/work", f"{_sanitize_mask(opts.mask_code)}.msk")
    )
    out_c = ms.resolve_work(opts.output) if opts.output else None

    if not ms.has_work():
        raise OpenghmError(
            "no /work mount: pass --work DIR (or give --output/--mt as host paths)"
        )

    args: List[str] = []
    if opts.verbose:
        args.append("-v")
    if opts.remove:
        args.append("-rm")
    if opts.remove_mask:
        args.append("-rmsk")
    if opts.zero_id:
        args.append("-z")
    if opts.remove_records is not None:
        args += ["-rr", js_num(opts.remove_records)]
    if opts.method == "sum":
        args.append("-c")
    if opts.weight is not None:
        args += ["-na", js_num(opts.weight)]
    if opts.mask_res is not None:
        args += ["-tr", js_num(opts.mask_res)]
    if opts.out_type:
        args += ["-ot", opts.out_type]
    if opts.scale is not None:
        args += ["-scl", js_num(opts.scale)]
    if opts.offset is not None:
        args += ["-off", js_num(opts.offset)]
    if opts.start:
        args += ["-sd", opts.start]
    if opts.end:
        args += ["-ed", opts.end]
    if opts.metadata:
        args += ["-mdt", opts.metadata]
    args += ["-f", key_c]
    args += ["-mt", mt_c]
    args += [opts.data_code, opts.mask_code]
    if out_c:
        args.append(out_c)

    return assemble(ctx, ms.to_mounts(), [SCRIPT, *args])
