"""``openghm temporal`` — wraps temporal_aggregation.pl.

Faithful flag→arg mapping (Model 1). ``mt`` is required (DataID_DB.csv missing).
Outputs are written by the script to the DST File_Path in the MT (under /work),
so a /work mount is required.
"""

from __future__ import annotations

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

SCRIPT = "/wbm/utilities/temporal_aggregation.pl"

_METHOD_CODE = {"mean": "0", "sum": "1", "category": "2"}


@dataclass
class TemporalOptions:
    mt: str = ""  # required
    src_code: str = ""  # SRC_DATA_CODE positional
    dst_code: str = ""  # DST_DATA_CODE positional
    start: Optional[str] = None  # -sd
    end: Optional[str] = None  # -ed
    method: Optional[Literal["mean", "sum", "category"]] = None  # -a 0|1|2
    scale: Optional[float] = None  # -so SCALE _
    offset: Optional[float] = None  # -so _ OFFSET
    out_type: Optional[str] = None  # -ot
    patch: Optional[float] = None  # -p
    metadata: Optional[str] = None  # -mdt
    remove: Optional[bool] = None  # -rm
    remove_records: Optional[int] = None  # -rr
    trim: Optional[bool] = None  # -trim
    push_dates: Optional[bool] = None  # -pd
    no_datacube_check: Optional[bool] = None  # -ndc
    nc3: Optional[bool] = None  # -nc3
    verbose: Optional[bool] = None  # -v
    work: Optional[str] = None
    mounts: MountsArg = None


def build_temporal(opts: TemporalOptions, ctx: RuntimeContext) -> BuiltCommand:
    if not opts.mt:
        raise OpenghmError("--mt (Magic Table CSV) is required")
    if not opts.src_code:
        raise OpenghmError("--src (SRC_DATA_CODE) is required")
    if not opts.dst_code:
        raise OpenghmError("--dst (DST_DATA_CODE) is required")

    ms = MountSet()
    for d in normalize_mounts(opts.mounts):
        ms.add_data_dir(d.name, d.dir)
    if opts.work:
        ms.set_work(opts.work)

    mt_c = ms.resolve_work(opts.mt)
    if not ms.has_work():
        raise OpenghmError("no /work mount: pass --work DIR (or give --mt as a host path)")

    args: List[str] = []
    if opts.verbose:
        args.append("-v")
    if opts.remove:
        args.append("-rm")
    if opts.remove_records is not None:
        args += ["-rr", js_num(opts.remove_records)]
    if opts.method:
        args += ["-a", _METHOD_CODE[opts.method]]
    if opts.scale is not None or opts.offset is not None:
        args += [
            "-so",
            js_num(opts.scale if opts.scale is not None else 1),
            js_num(opts.offset if opts.offset is not None else 0),
        ]
    if opts.out_type:
        args += ["-ot", opts.out_type]
    if opts.patch is not None:
        args += ["-p", js_num(opts.patch)]
    if opts.trim:
        args.append("-trim")
    if opts.push_dates:
        args.append("-pd")
    if opts.no_datacube_check:
        args.append("-ndc")
    if opts.nc3:
        args.append("-nc3")
    if opts.start:
        args += ["-sd", opts.start]
    if opts.end:
        args += ["-ed", opts.end]
    if opts.metadata:
        args += ["-mdt", opts.metadata]
    args += ["-mt", mt_c]
    args += [opts.src_code, opts.dst_code]

    return assemble(ctx, ms.to_mounts(), [SCRIPT, *args])
