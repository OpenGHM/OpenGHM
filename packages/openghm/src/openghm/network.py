"""``openghm network preclip|subset`` — wraps networkTools.

networkTools takes a single ``.init`` file (a Perl hash). The CLI owns that init:
the user passes host paths + a clip rectangle (or polygon), and we mount the
inputs/output and write the init with container paths. This is the headline
"no hand-authored init file" win.

Mode B: ``init=`` runs a user-authored init verbatim (container paths + explicit
mounts/work).
"""

from __future__ import annotations

import os
import posixpath
from dataclasses import dataclass, field
from typing import List, Optional

try:
    from typing import Literal
except ImportError:  # pragma: no cover
    from typing_extensions import Literal  # type: ignore

from ._fmt import js_num
from .build import assemble
from .errors import OpenghmError
from .mounts import MountSet, MountsArg, is_container_path, normalize_mounts
from .runtime import RuntimeContext
from .types import BuiltCommand, GeneratedFile

NetworkJob = Literal["preclip", "subset"]

SCRIPT = "/wbm/utilities/networkTools"


@dataclass
class NetworkOptions:
    # Mode A inputs (host or container paths)
    net: Optional[str] = None
    basin_id: Optional[str] = None
    output: Optional[str] = None
    # rectangle
    lon_min: Optional[float] = None
    lon_max: Optional[float] = None
    lat_min: Optional[float] = None
    lat_max: Optional[float] = None
    # polygon
    shapefile: Optional[str] = None
    id_field: Optional[str] = None
    ids: Optional[List[int]] = None
    proj: Optional[str] = None
    # flags
    trim_nodata: Optional[bool] = None
    inscribe: Optional[bool] = None
    continuous: Optional[bool] = None
    #: preclip-only; defaults true to match the golden init.
    truncation_check: Optional[bool] = None
    # Mode B
    init: Optional[str] = None
    # common
    verbose: Optional[bool] = None
    work: Optional[str] = None
    #: Explicit data mounts → /data/NAME (dict, [DataMountSpec], or [(name, dir)]).
    mounts: MountsArg = None


def _perl_str(p: str) -> str:
    return f"'{p}'"


def _render_clip(job: str, opts: NetworkOptions, ms: MountSet) -> str:
    """Render the rectangle / polygon clip block shared by preclip & subset."""
    has_rect = (
        opts.lon_min is not None
        or opts.lon_max is not None
        or opts.lat_min is not None
        or opts.lat_max is not None
    )

    if opts.shapefile:
        shp_c = ms.resolve_input(opts.shapefile, "shp")
        parts = [f"file => {_perl_str(shp_c)}"]
        if opts.id_field:
            parts.append(f"shp_var => {_perl_str(opts.id_field)}")
        if opts.ids:
            parts.append("polIDs => [" + ", ".join(str(i) for i in opts.ids) + "]")
        parts.append(f"proj => {_perl_str(opts.proj or 'epsg:4326')}")
        if job == "subset":
            if opts.inscribe:
                parts.append("inscribe => 1")
            if opts.continuous:
                parts.append("continuous => 1")
        return "    polygon => { " + ", ".join(parts) + " }"

    if not has_rect:
        raise OpenghmError(
            "network requires a clip region: pass --lon-min/--lon-max/--lat-min/--lat-max "
            "or --shapefile (or use --init for a hand-authored file)"
        )
    for flag, value in (
        ("--lon-min", opts.lon_min),
        ("--lon-max", opts.lon_max),
        ("--lat-min", opts.lat_min),
        ("--lat-max", opts.lat_max),
    ):
        if value is None:
            raise OpenghmError(f"rectangle clip is missing {flag}")
    r = (
        f"lonMin => {js_num(opts.lon_min)}, lonMax => {js_num(opts.lon_max)}, "
        f"latMin => {js_num(opts.lat_min)}, latMax => {js_num(opts.lat_max)}"
    )
    # subset's golden carries an explicit inscribe; preclip's does not.
    inscribe = f", inscribe => {1 if opts.inscribe else 0}" if job == "subset" else ""
    return "    rectangle => { " + r + inscribe + " }"


def _render_init(job: str, opts: NetworkOptions, ms: MountSet) -> str:
    if not opts.net:
        raise OpenghmError("--net is required")
    if not opts.output:
        raise OpenghmError("--output is required")
    net_c = ms.resolve_input(opts.net, "network")
    out_c = ms.resolve_work(opts.output)

    head = [f"  Net_file => {_perl_str(net_c)},"]
    if opts.basin_id:
        head.append(f"  basinID_file => {_perl_str(ms.resolve_input(opts.basin_id, 'basin'))},")

    inner = [f"    output_file => {_perl_str(out_c)},"]
    truncation_check = opts.truncation_check if opts.truncation_check is not None else True
    if job == "preclip" and truncation_check:
        inner.append("    truncation_check => 1,")
    inner.append(f"    trim_nodata => {1 if opts.trim_nodata else 0},")
    inner.append(_render_clip(job, opts, ms))

    return "{\n" + "\n".join(head) + "\n  " + job + " => {\n" + "\n".join(inner) + "\n  }\n}\n"


def build_network(job: NetworkJob, opts: NetworkOptions, ctx: RuntimeContext) -> BuiltCommand:
    ms = MountSet()
    for d in normalize_mounts(opts.mounts):
        ms.add_data_dir(d.name, d.dir)
    if opts.work:
        ms.set_work(opts.work)

    verbose_arg = ["-v"] if opts.verbose else []
    generated: List[GeneratedFile] = []

    if opts.init:
        # Mode B: run the user's init verbatim.
        init_container = opts.init if is_container_path(opts.init) else ms.resolve_work(opts.init)
    else:
        # Mode A: generate the init from flags.
        content = _render_init(job, opts, ms)
        work_host = ms.work_host_dir()
        if not work_host:
            raise OpenghmError(
                "cannot place the generated init: pass --work, or give --output as a host path"
            )
        host_path = os.path.join(work_host, f"{job}.init")
        init_container = posixpath.join("/work", f"{job}.init")
        generated.append(GeneratedFile(host_path=host_path, content=content))

    inner_cmd = [SCRIPT, *verbose_arg, init_container]
    return assemble(ctx, ms.to_mounts(), inner_cmd, generated)
