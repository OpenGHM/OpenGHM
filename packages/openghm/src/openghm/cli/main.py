"""openghm CLI — thin Click frontend over the UI-agnostic core.

Parse flags → call a core builder → run/dry-run → present. Click owns the flag
contract; the core owns command construction; ``render`` presents the result.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, List, Optional

import click

from .. import continuation, post_processing
from ..config import load_config
from ..errors import OpenghmError
from ..mounts import DataMountSpec
from ..network import build_network
from ..run import run_command, stage_files
from ..runtime import RuntimeContext
from ..sim import (
    SIDECAR_NAME, SubmitOptions, build_submit, build_run, post_processing_requested, record_exit_code, sidecar_path,
    parse_slurm_job_id, record_slurm_job_id,
    list_simulations, find_simulation, resolve_job_id,
    build_sacct_argv, parse_sacct, sacct_primary,
    build_scancel_argv, slurm_log_path, tail_lines,
)
from ..spatial import SpatialOptions, build_spatial
from ..spool import (
    describe_prune, describe_status, harvest, plan_from_sim_dir, prepare, prune, run_cached, status, variant,
)
from ..temporal import TemporalOptions, build_temporal
from ..network import NetworkOptions
from ..types import BuiltCommand
from ..wbm_init import Changes, load_changes
from .render import (
    present, present_sim_list, present_sim_status, present_sim_logs, present_sim_cancel,
)

VERSION = "0.2.0"


# ---- option parsers ---------------------------------------------------------


def _parse_mount(ctx, param, value) -> List[DataMountSpec]:
    out: List[DataMountSpec] = []
    for v in value:
        i = v.find("=")
        if i <= 0:
            raise click.BadParameter("--mount expects NAME=DIR")
        out.append(DataMountSpec(v[:i], v[i + 1 :]))
    return out


def _parse_ids(ctx, param, value) -> List[int]:
    out: List[int] = []
    for chunk in value:
        for s in chunk.split(","):
            s = s.strip()
            if not s:
                continue
            try:
                out.append(int(s))
            except ValueError:
                raise click.BadParameter(f"bad id: {s}")
    return out


# ---- shared option groups ---------------------------------------------------


def common_options(f):
    """Options common to every command (runtime, mounts, output mode)."""
    options = [
        click.option("--config", "config_path", default=None, metavar="PATH",
                     help="config file (default: ~/.openghm/config.toml)"),
        click.option("--runtime", type=click.Choice(["singularity", "apptainer", "docker"]),
                     default=None, help="container runtime"),
        click.option("--sif", default=None, metavar="PATH",
                     help="SIF path (or docker image) override"),
        click.option("--mount", "mounts", multiple=True, metavar="NAME=DIR",
                     callback=_parse_mount, help="bind DIR as /data/NAME (repeatable)"),
        click.option("--work", default=None, metavar="DIR",
                     help="bind DIR as /work (outputs + generated files)"),
        click.option("--dry-run", "dry_run", is_flag=True,
                     help="print the generated command without running it"),
        click.option("-v", "--verbose", is_flag=True,
                     help="verbose (passes -v into the wrapped script)"),
        click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output"),
    ]
    for opt in reversed(options):
        f = opt(f)
    return f


def output_options(f):
    """Runtime/output options shared by ``sim submit`` (no data mounts / --work)."""
    options = [
        click.option("--config", "config_path", default=None, metavar="PATH",
                     help="config file (default: ~/.openghm/config.toml)"),
        click.option("--runtime", type=click.Choice(["singularity", "apptainer", "docker"]),
                     default=None, help="container runtime"),
        click.option("--sif", default=None, metavar="PATH",
                     help="WBM SIF path override (default: the image the snapshot pins, from sif_dir)"),
        click.option("--spool", type=click.Choice(["cache", "fresh"]), default="cache",
                     show_default=True,
                     help="cache: a per-simulation spool linked to the shared spool cache and "
                          "harvested into it; fresh: an empty per-simulation spool, nothing shared"),
        click.option("--dry-run", "dry_run", is_flag=True,
                     help="print the generated init/sbatch script without submitting"),
        click.option("-v", "--verbose", is_flag=True,
                     help="verbose (passes -v into wbm.pl)"),
        click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output"),
    ]
    for opt in reversed(options):
        f = opt(f)
    return f


def changes_option(f):
    """``--changes PATH``, shared by ``sim submit``, ``sim run`` and ``spool variant``: the init edits."""
    return click.option(
        "--changes", "changes_path", default=None, metavar="PATH",
        help="JSON file of edits to the snapshot's init: {\"code_version\": \"<the snapshot's WBM version>\", "
             "\"set\": {\"Key.Path\": value}, \"unset\": [\"Key.Path\"], \"forks\": [{\"from\": \"/wbm/data_init/x.init\", "
             "\"to\": \"/wbm/wbm_init/datasets/x__1.init\", \"set\": {\"Var_Scale\": 1.1}}]}; a key path is names "
             "joined by dots, one per nested block (MT_Code_Name.Run_End); a fork is a copy of a data .init",
    )(f)


def _load_changes(path: Optional[str]) -> Optional[Changes]:
    """The ``--changes`` file, or ``None`` when the option was not given."""
    return load_changes(path) if path else None


def manage_options(f):
    """Options shared by the ``sim`` management commands (list/status/logs/cancel)."""
    options = [
        click.option("--config", "config_path", default=None, metavar="PATH",
                     help="config file (default: ~/.openghm/config.toml)"),
        click.option("--output-base", "output_base", default=None, metavar="DIR",
                     help="per-sim work/output root to search (default: config)"),
        click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output"),
    ]
    for opt in reversed(options):
        f = opt(f)
    return f


def _output_base(p: dict) -> str:
    """Resolve the per-sim root: ``--output-base`` overrides the config default."""
    return p["output_base"] or load_config(path=p["config_path"]).config.output_base


def network_init_options(f):
    options = [
        click.option("--net", default=None, metavar="FILE", help="input network file (Net_file)"),
        click.option("--basin-id", "basin_id", default=None, metavar="FILE",
                     help="basin ID file (basinID_file)"),
        click.option("--output", default=None, metavar="FILE", help="output file"),
        click.option("--lon-min", "lon_min", type=float, default=None, help="rectangle lonMin"),
        click.option("--lon-max", "lon_max", type=float, default=None, help="rectangle lonMax"),
        click.option("--lat-min", "lat_min", type=float, default=None, help="rectangle latMin"),
        click.option("--lat-max", "lat_max", type=float, default=None, help="rectangle latMax"),
        click.option("--trim-nodata", "trim_nodata", is_flag=True, help="trim nodata margins"),
        click.option("--init", default=None, metavar="FILE",
                     help="use an existing init file verbatim"),
    ]
    for opt in reversed(options):
        f = opt(f)
    return f


# ---- dispatch ---------------------------------------------------------------


def _dispatch(label: str, build_fn: Callable[[RuntimeContext], BuiltCommand], p: dict) -> None:
    try:
        ctx = RuntimeContext.from_config(
            load_config(path=p["config_path"]).config,
            runtime=p.get("runtime"),
            sif=p.get("sif"),
        )
        built = build_fn(ctx)
        result = run_command(built, dry_run=p["dry_run"], capture=p["as_json"])
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    present(label, ctx, built, result, as_json=p["as_json"])
    if not result.dry_run and result.exit_code:
        raise SystemExit(result.exit_code)


# ---- program ----------------------------------------------------------------


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(VERSION, "--version", message="%(version)s")
def cli() -> None:
    """WBM toolkit for Anvil HPC (wraps the WBM tools-lite container)."""


@cli.group("network")
def network_group() -> None:
    """clip / subset a flow-direction network (networkTools)."""


@network_group.command("preclip")
@network_init_options
@click.option("--no-truncation-check", "no_truncation_check", is_flag=True,
              help="skip the preclip truncation check")
@common_options
def preclip_cmd(**p) -> None:
    """rectangular clip (networkTools job #1)"""
    opts = NetworkOptions(
        net=p["net"], basin_id=p["basin_id"], output=p["output"],
        lon_min=p["lon_min"], lon_max=p["lon_max"], lat_min=p["lat_min"], lat_max=p["lat_max"],
        trim_nodata=p["trim_nodata"], init=p["init"],
        truncation_check=False if p["no_truncation_check"] else None,
        verbose=p["verbose"], work=p["work"], mounts=p["mounts"],
    )
    _dispatch("network preclip", lambda c: build_network("preclip", opts, c), p)


@network_group.command("subset")
@network_init_options
@click.option("--shapefile", default=None, metavar="FILE", help="shapefile for subsetting (polygon.file)")
@click.option("--id-field", "id_field", default=None, metavar="NAME",
              help="shapefile attribute for polygon IDs (polygon.shp_var)")
@click.option("--ids", "ids", multiple=True, metavar="ID,...", callback=_parse_ids,
              help="one or more polygon IDs")
@click.option("--proj", default=None, help="projection (default epsg:4326)")
@click.option("--inscribe", is_flag=True, help="inscribe polygon")
@click.option("--continuous", is_flag=True, help="continuous polygon")
@common_options
def subset_cmd(**p) -> None:
    """basin/polygon subset (networkTools job #2)"""
    opts = NetworkOptions(
        net=p["net"], basin_id=p["basin_id"], output=p["output"],
        lon_min=p["lon_min"], lon_max=p["lon_max"], lat_min=p["lat_min"], lat_max=p["lat_max"],
        shapefile=p["shapefile"], id_field=p["id_field"], ids=list(p["ids"]),
        proj=p["proj"], trim_nodata=p["trim_nodata"], inscribe=p["inscribe"],
        continuous=p["continuous"], init=p["init"],
        verbose=p["verbose"], work=p["work"], mounts=p["mounts"],
    )
    _dispatch("network subset", lambda c: build_network("subset", opts, c), p)


@cli.command("spatial")
@click.option("--mt", required=True, metavar="FILE", help="Magic Table CSV (required)")
@click.option("--data", "data_code", required=True, metavar="CODE", help="dataset code (DATA_CODE)")
@click.option("--mask", "mask_code", required=True, metavar="CODE", help="mask code(s) MASK[+MASK2+...]")
@click.option("--output", default=None, metavar="FILE", help="output NetCDF file")
@click.option("--key-file", "key_file", default=None, metavar="FILE",
              help="mask cache .msk (auto-defaults under /work)")
@click.option("--start", default=None, help="start date YYYY-MM-DD")
@click.option("--end", default=None, help="end date YYYY-MM-DD")
@click.option("--method", type=click.Choice(["mean", "sum"]), default="mean", help="aggregation")
@click.option("--weight", type=float, default=None, help="constant weight, no area weighting (-na)")
@click.option("--mask-res", "mask_res", type=float, default=None,
              help="pixel resolution for vector masks (-tr)")
@click.option("--out-type", "out_type", default=None, help="output data type (byte|short|long|float|double)")
@click.option("--scale", type=float, default=None, help="scale for unit conversion (-scl)")
@click.option("--offset", type=float, default=None, help="offset for unit conversion (-off)")
@click.option("--metadata", default=None, help="override MT metadata NAME:UNITS:FORMAT")
@click.option("--remove", is_flag=True, help="remove existing output before run (-rm)")
@click.option("--remove-mask", "remove_mask", is_flag=True, help="remove mask mapping file (-rmsk)")
@click.option("--remove-records", "remove_records", type=int, default=None,
              help="remove N trailing records (-rr)")
@click.option("--zero-id", "zero_id", is_flag=True, help="allow polygon ID = 0 (-z)")
@common_options
def spatial_cmd(**p) -> None:
    """area-weighted spatial aggregation over a mask"""
    opts = SpatialOptions(
        mt=p["mt"], data_code=p["data_code"], mask_code=p["mask_code"],
        output=p["output"], key_file=p["key_file"], start=p["start"], end=p["end"],
        method=p["method"], weight=p["weight"], mask_res=p["mask_res"],
        out_type=p["out_type"], scale=p["scale"], offset=p["offset"], metadata=p["metadata"],
        remove=p["remove"], remove_mask=p["remove_mask"], remove_records=p["remove_records"],
        zero_id=p["zero_id"], verbose=p["verbose"], work=p["work"], mounts=p["mounts"],
    )
    _dispatch("spatial", lambda c: build_spatial(opts, c), p)


@cli.command("temporal")
@click.option("--mt", required=True, metavar="FILE", help="Magic Table CSV (required)")
@click.option("--src", "src_code", required=True, metavar="CODE", help="source dataset code (SRC_DATA_CODE)")
@click.option("--dst", "dst_code", required=True, metavar="CODE", help="destination dataset code (DST_DATA_CODE)")
@click.option("--start", default=None, help="start date YYYY-MM-DD")
@click.option("--end", default=None, help="end date YYYY-MM-DD")
@click.option("--method", type=click.Choice(["mean", "sum", "category"]), default=None, help="aggregation")
@click.option("--scale", type=float, default=None, help="scale output data (-so SCALE _)")
@click.option("--offset", type=float, default=None, help="offset output data (-so _ OFFSET)")
@click.option("--out-type", "out_type", default=None, help="output data type (byte|short|long|float|double)")
@click.option("--patch", type=float, default=None, help="patch nodata with VALUE (-p)")
@click.option("--metadata", default=None, help="override MT metadata NAME:UNITS:FORMAT")
@click.option("--remove", is_flag=True, help="remove existing output before run (-rm)")
@click.option("--remove-records", "remove_records", type=int, default=None,
              help="remove N trailing records (-rr)")
@click.option("--trim", is_flag=True, help="discard incomplete start/end records (-trim)")
@click.option("--push-dates", "push_dates", is_flag=True, help="overwrite destination dates (-pd)")
@click.option("--no-datacube-check", "no_datacube_check", is_flag=True,
              help="skip DataCube field check in MT (-ndc)")
@click.option("--nc3", is_flag=True, help="output classic NetCDF v3 format")
@common_options
def temporal_cmd(**p) -> None:
    """temporal aggregation, monthly → yearly"""
    opts = TemporalOptions(
        mt=p["mt"], src_code=p["src_code"], dst_code=p["dst_code"],
        start=p["start"], end=p["end"], method=p["method"],
        scale=p["scale"], offset=p["offset"], out_type=p["out_type"], patch=p["patch"],
        metadata=p["metadata"], remove=p["remove"], remove_records=p["remove_records"],
        trim=p["trim"], push_dates=p["push_dates"], no_datacube_check=p["no_datacube_check"],
        nc3=p["nc3"], verbose=p["verbose"], work=p["work"], mounts=p["mounts"],
    )
    _dispatch("temporal", lambda c: build_temporal(opts, c), p)


@cli.group("sim")
def sim_group() -> None:
    """run WBM model simulations — locally (run) or on SLURM (submit)."""


@sim_group.command("submit")
@click.argument("path", default=".", metavar="[PATH]")
@click.option("--id", "sim_id", required=True, metavar="SIM_ID",
              help="unique simulation ID (per-sim work/output paths)")
@click.option("--cores", type=int, default=None, help="SLURM cpus-per-task (default: metadata)")
@click.option("--walltime", default=None, metavar="HH:MM:SS", help="SLURM --time (default: metadata, plus its post-processing time "
                   "when the run post-processes)")
@click.option("--account", default=None, help="SLURM account (default: config)")
@click.option("--partition", default=None, help="SLURM partition (default: config)")
@click.option("--output-base", "output_base", default=None, metavar="DIR",
              help="per-sim work/output root (default: config)")
@changes_option
@click.option("--user-info", "user_info", default=None,
              help="submitter info recorded in simulation.json (provenance only)")
@output_options
def sim_submit_cmd(**p) -> None:
    """submit a snapshot folder (default: current directory) as a WBM SLURM job"""
    opts = SubmitOptions(
        snapshot_dir=p["path"], simulation_id=p["sim_id"],
        cores=p["cores"], walltime=p["walltime"], account=p["account"],
        partition=p["partition"], output_base=p["output_base"], spool=p["spool"],
        user_info=p["user_info"], verbose=p["verbose"],
    )
    now = None if p["dry_run"] else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        opts.changes = _load_changes(p["changes_path"])
        cfg = load_config(path=p["config_path"]).config
        ctx, built = build_submit(opts, cfg, runtime=p.get("runtime"), sif=p.get("sif"), now=now,
                                  check_assets=not p["dry_run"])
        # Capture sbatch stdout on a real submit so we can record the SLURM job ID.
        result = run_command(built, dry_run=p["dry_run"], capture=p["as_json"] or not p["dry_run"])
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    if not result.dry_run and result.exit_code == 0:
        job_id = parse_slurm_job_id(result.stdout)
        if job_id:
            record_slurm_job_id(built, job_id)
    present("sim submit", ctx, built, result, as_json=p["as_json"])
    if not result.dry_run and result.exit_code:
        raise SystemExit(result.exit_code)


@sim_group.command("run")
@click.argument("path", default=".", metavar="[PATH]")
@click.option("--id", "sim_id", required=True, metavar="SIM_ID",
              help="unique simulation ID (per-sim work/output paths)")
@click.option("--output-base", "output_base", default=None, metavar="DIR",
              help="per-sim work/output root (default: config)")
@click.option("--walltime", default=None, metavar="TIME",
              help="how long this run may last, as SLURM writes it (MM:SS, HH:MM:SS, D-HH, D-HH:MM:SS); "
                   "recorded in simulation.json, where the spool lease takes its length "
                   "(default: the metadata's recommendedCompute.walltime, plus its postProcessingWalltime "
                   "when the run post-processes)")
@changes_option
@click.option("--user-info", "user_info", default=None,
              help="submitter info recorded in simulation.json (provenance only)")
@output_options
def sim_run_cmd(**p) -> None:
    """run a snapshot folder locally in the foreground (no SLURM)

    Same snapshot/metadata mechanism as `sim submit`, but the WBM model runs
    synchronously on this machine (best for small domains / testing).
    """
    opts = SubmitOptions(
        snapshot_dir=p["path"], simulation_id=p["sim_id"], output_base=p["output_base"],
        walltime=p["walltime"], spool=p["spool"], user_info=p["user_info"], verbose=p["verbose"],
    )
    now = None if p["dry_run"] else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    layout = None
    try:
        opts.changes = _load_changes(p["changes_path"])
        cfg = load_config(path=p["config_path"]).config
        ctx, built = build_run(opts, cfg, runtime=p.get("runtime"), sif=p.get("sif"), now=now,
                              check_assets=not p["dry_run"])
        if not p["dry_run"]:
            stage_files(built)
            layout = continuation.layout_for_run(built)
            _prepare_rerun(layout)
        if built.spool and not p["dry_run"]:
            # fill + link before WBM, harvest after it exits 0
            result = run_cached(built, capture=p["as_json"], log=lambda m: click.echo(m, err=True), stage=False)
        else:
            result = run_command(built, dry_run=p["dry_run"], capture=p["as_json"], stage=False)
    except continuation.RunStateInconsistent:
        click.echo(
            f"openghm: the run state in {layout.run_state_dir} was not all written by one save "
            "(a job was stopped while WBM was saving it); this simulation cannot be continued", err=True)
        _record_exit_code(built, continuation.EXIT_STATE_INCONSISTENT)
        raise SystemExit(continuation.EXIT_STATE_INCONSISTENT)
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    post = None
    exit_code = result.exit_code or 0
    if not result.dry_run:
        if exit_code == 0 and layout is not None:
            # WBM exits 0 on a resume with nothing to do, and on a run it ended early
            short = continuation.stopped_short(layout)
            if short:
                click.echo(f"openghm: {short}", err=True)
                exit_code = result.exit_code = continuation.EXIT_STOPPED_SHORT
        _record_exit_code(built, exit_code)
        post = _post_process(built, exit_code)
    present("sim run", ctx, built, result, as_json=p["as_json"])
    if not result.dry_run and exit_code:
        raise SystemExit(exit_code)
    if post is not None and post.get("ok") is False:
        raise SystemExit(1)


def _prepare_rerun(layout: Optional["continuation.RunLayout"]) -> None:
    """Before WBM in `sim run`, on a work directory that may already hold a run: refuse a state no
    one save wrote, and delete the output WBM will write again. Raises
    :class:`continuation.RunStateInconsistent`; says what it did on stderr."""
    if layout is None:
        return
    state = continuation.state_status(layout.run_state_dir, layout.wbm_id)
    if state.status == continuation.INCONSISTENT:
        raise continuation.RunStateInconsistent(layout.run_state_dir)
    if not os.path.isdir(layout.output_dir):
        return
    deleted = continuation.prepare_rerun(layout.output_dir, state)
    since = f"written after the state saved at {state.saved_at}" if state.saved_at else "there is no saved state"
    click.echo(f"openghm: rerun: deleted {len(deleted)} output file(s), {since}", err=True)


def _record_exit_code(built: BuiltCommand, exit_code: int) -> None:
    """Put the run's exit code in simulation.json. The run is over, so a bookkeeping failure must
    not make it look refused: it is only a warning."""
    try:
        record_exit_code(built, exit_code)
    except Exception as e:  # noqa: BLE001
        click.echo(f"openghm: warning: could not record the exit code in simulation.json: {e}", err=True)


def _say_post_processing(record: dict) -> None:
    """One report of a post-processing record on stderr: what it wrote, or what is wrong."""
    if record.get("ok"):
        click.echo(
            f"openghm: post-processing finished in {record['seconds']} s, "
            f"{record['found']['climatology']} climatology file(s), log {record['log']}", err=True)
    elif record.get("ok") is False:
        for problem in record.get("problems") or []:
            click.echo(f"openghm: post-processing failed: {problem}", err=True)
        click.echo(f"openghm: post-processing log: {record['log']}", err=True)


def _post_process(built: BuiltCommand, wbm_exit_code: int) -> Optional[dict]:
    """After WBM in `sim run`: run and check post-processing and put the init's Run value back
    (`post_processing.finish`). ``None`` when the run does not ask for it; otherwise its record.

    A step that could not be recorded is a failed one when WBM exited 0, since nobody knows what it
    wrote; after a failed WBM the run is failed already, and this only warns.
    """
    if not post_processing_requested(built):
        return None
    try:
        record = post_processing.finish(sidecar_path(built), wbm_exit_code, log=lambda m: click.echo(m, err=True))
    except Exception as e:  # noqa: BLE001
        click.echo(f"openghm: post-processing could not be completed: {e}", err=True)
        return {"ok": False if wbm_exit_code == 0 else None}
    if record is not None:
        _say_post_processing(record)
    return record


@sim_group.command("post-process")
@click.argument("sim_dir", metavar="SIM_DIR")
@click.option("--wbm-exit-code", "wbm_exit_code", type=int, default=0, show_default=True,
              help="the exit code WBM ended with: the step runs only when it is 0")
def sim_post_process_cmd(sim_dir: str, wbm_exit_code: int) -> None:
    """run a simulation's PostProcessing.pl after WBM, check it, and put the init's Run and Forks values back

    SIM_DIR is the simulation's work directory (<output_base>/<id>). `sim submit` puts this in
    its job script for an init that asks for post-processing (`PostProcessing => { Run => 1 }`),
    where `sim run` does it itself. It exits with --wbm-exit-code when that is not 0, with 1 when
    post-processing failed, and with 2 when it could not be done.
    """
    try:
        record = post_processing.finish(
            os.path.join(sim_dir, SIDECAR_NAME), wbm_exit_code, log=lambda m: click.echo(m, err=True))
    except Exception as e:  # noqa: BLE001
        click.echo(f"openghm: post-processing could not be completed: {e}", err=True)
        raise SystemExit(wbm_exit_code or 2)
    if record is not None:
        _say_post_processing(record)
    if wbm_exit_code:
        raise SystemExit(wbm_exit_code)
    if record is not None and record.get("ok") is False:
        raise SystemExit(1)


@sim_group.command("state")
@click.argument("work_dir", metavar="WORK_DIR")
@click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output")
def sim_state_cmd(work_dir: str, as_json: bool) -> None:
    """whether a simulation's work directory holds a resumable WBM run state, and when it was saved

    WORK_DIR is the simulation's work directory (<output_base>/<id>); its simulation.json names
    the init, whose ID names the state files in WORK_DIR/WBM_run_state. The state is `none` (no
    saved state), `resumable` (complete: a rerun of `sim run` continues from it) or `inconsistent`
    (a job was stopped while WBM was saving it). With --json, one object: state, saved_at (ISO-8601
    UTC, only when resumable, else null) and wbm_id (null when the init has none). Exits 0 whenever
    it could look and 2 when the work directory, its simulation.json or its init cannot be read.
    """
    try:
        layout = continuation.layout_from_work_dir(work_dir)
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    state = (continuation.state_status(layout.run_state_dir, layout.wbm_id) if layout.wbm_id
             else continuation.RunState(continuation.NONE))
    if as_json:
        click.echo(json.dumps({"state": state.status, "saved_at": state.saved_at, "wbm_id": layout.wbm_id or None}))
    elif state.status == continuation.RESUMABLE:
        click.echo(f"resumable: saved at {state.saved_at} (WBM run {layout.wbm_id})")
    else:
        click.echo(state.status)


@sim_group.command("list")
@manage_options
def sim_list_cmd(**p) -> None:
    """list simulations under output_base (reads simulation.json sidecars)"""
    try:
        base = _output_base(p)
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    present_sim_list(base, list_simulations(base), as_json=p["as_json"])


@sim_group.command("status")
@click.argument("key", metavar="<id|jobid>")
@manage_options
def sim_status_cmd(**p) -> None:
    """show SLURM state (sacct) for a simulation ID or job ID"""
    try:
        base = _output_base(p)
        job_id, sidecar = resolve_job_id(base, p["key"])
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    try:
        proc = subprocess.run(build_sacct_argv(job_id), capture_output=True, text=True)
    except FileNotFoundError:
        click.echo("openghm: sacct not found — run sim status on the Anvil login node", err=True)
        raise SystemExit(2)
    rows = parse_sacct(proc.stdout)
    present_sim_status(job_id, sidecar, rows, sacct_primary(rows, job_id),
                       exit_code=proc.returncode, stderr=proc.stderr, as_json=p["as_json"])
    if proc.returncode:
        raise SystemExit(proc.returncode)


@sim_group.command("logs")
@click.argument("key", metavar="<id|jobid>")
@click.option("--follow", "-f", is_flag=True, help="stream new output (tail -f)")
@click.option("--err", "as_err", is_flag=True, help="show the .err log instead of .out")
@click.option("-n", "--lines", "n_lines", type=int, default=200, metavar="N",
              help="show the last N lines (0 = all; default 200)")
@manage_options
def sim_logs_cmd(**p) -> None:
    """print or tail a simulation's SLURM log"""
    try:
        base = _output_base(p)
        rec = find_simulation(base, p["key"])
        if rec is None:
            raise OpenghmError(f"no simulation {p['key']!r} under {base}")
        job_id = rec.get("slurm_job_id")
        if not job_id:
            raise OpenghmError(
                f"simulation {rec.get('simulation_id', p['key'])!r} has no recorded "
                "SLURM job id (not submitted yet?)"
            )
        path = slurm_log_path(rec["_dir"], str(job_id), err=p["as_err"])
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    if not os.path.isfile(path):
        click.echo(f"openghm: log not found: {path} (job may not have started, or wrong stream)", err=True)
        raise SystemExit(2)
    if p["follow"]:
        try:
            raise SystemExit(subprocess.run(["tail", "-f", path]).returncode)
        except FileNotFoundError:
            click.echo(f"openghm: tail not found (cannot --follow); log at {path}", err=True)
            raise SystemExit(2)
    present_sim_logs(path, tail_lines(path, p["n_lines"]), as_json=p["as_json"])


@sim_group.command("cancel")
@click.argument("key", metavar="<id|jobid>")
@click.option("--yes", "-y", is_flag=True, help="skip the confirmation prompt")
@click.option("--dry-run", "dry_run", is_flag=True, help="print the scancel command without running it")
@manage_options
def sim_cancel_cmd(**p) -> None:
    """cancel a simulation's SLURM job (scancel)"""
    try:
        base = _output_base(p)
        job_id, sidecar = resolve_job_id(base, p["key"])
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    argv = build_scancel_argv(job_id)
    sim_id = sidecar.get("simulation_id") if sidecar else None
    if p["dry_run"]:
        present_sim_cancel(job_id, sim_id, dry_run=True, argv=argv, as_json=p["as_json"])
        return
    label = job_id if not sim_id else f"{job_id} (sim {sim_id})"
    if not p["yes"] and not click.confirm(f"Cancel SLURM job {label}?"):
        click.echo("aborted.")
        return
    try:
        proc = subprocess.run(argv, capture_output=True, text=True)
    except FileNotFoundError:
        click.echo("openghm: scancel not found — run sim cancel on the Anvil login node", err=True)
        raise SystemExit(2)
    present_sim_cancel(job_id, sim_id, dry_run=False, argv=argv,
                       exit_code=proc.returncode, stderr=proc.stderr, as_json=p["as_json"])
    if proc.returncode:
        raise SystemExit(proc.returncode)


@cli.group("spool")
def spool_group() -> None:
    """the spool cache that `sim --spool cache` runs share."""


@spool_group.command("variant")
@click.argument("path", default=".", metavar="[PATH]")
@click.option("--init", "init", default=None, metavar="NAME",
              help="init file in the snapshot's wbm_init/ (default: the metadata's)")
@changes_option
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
@click.option("--runtime", type=click.Choice(["singularity", "apptainer", "docker"]),
              default=None, help="container runtime")
@click.option("--sif", default=None, metavar="PATH",
              help="WBM SIF path override (default: the image the snapshot pins, from sif_dir)")
def spool_variant_cmd(**p) -> None:
    """print a snapshot's spool variant and what it is made of, as JSON

    Builds the run `sim run --spool cache` would (the same init, image and model
    input) and evaluates its init in the image, without running WBM; stripped of
    what only names or times the run, with the image digest, the model code and
    the network file, that is the variant. Needs the pinned image and the linked
    model input in their caches.
    """
    import tempfile

    from ..run import stage_files

    opts = SubmitOptions(
        snapshot_dir=p["path"], simulation_id="variant", spool="cache", init=p["init"],
    )
    try:
        opts.changes = _load_changes(p["changes_path"])
        cfg = load_config(path=p["config_path"]).config
        with tempfile.TemporaryDirectory(prefix="openghm-variant-") as scratch:
            opts.output_base = scratch      # the staged init and an empty spool, thrown away
            _ctx, built = build_run(opts, cfg, runtime=p["runtime"], sif=p["sif"])
            stage_files(built)
            result = variant(built.spool).to_dict()
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    click.echo(json.dumps(result, indent=2, sort_keys=True))


def _spool_step(step: Callable, sim_dir: str) -> None:
    try:
        step(plan_from_sim_dir(sim_dir), log=click.echo)
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)


@spool_group.command("prepare")
@click.argument("sim_dir", metavar="SIM_DIR")
def spool_prepare_cmd(sim_dir: str) -> None:
    """prune the cache if scratch is nearly full, fill it from S3 and link it into a simulation's spool (before WBM)

    SIM_DIR is the simulation's work directory (<output_base>/<id>). `sim submit`
    puts this in its job script, so it runs on the compute node.
    """
    _spool_step(prepare, sim_dir)


@spool_group.command("harvest")
@click.argument("sim_dir", metavar="SIM_DIR")
def spool_harvest_cmd(sim_dir: str) -> None:
    """move the spool files a simulation built into the cache (after WBM exited 0)"""
    _spool_step(harvest, sim_dir)


@spool_group.command("prune")
@click.option("--dry-run", is_flag=True, help="print what would be deleted; delete nothing")
@click.option("--high", type=float, default=None, metavar="FRACTION",
              help="prune at this fraction of the scratch file quota used (default: spool_prune_high)")
@click.option("--low", type=float, default=None, metavar="FRACTION",
              help="prune down to this fraction (default: spool_prune_low)")
@click.option("--all", "everything", is_flag=True,
              help="delete every unit no running simulation holds, whatever the quota says")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
@click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output")
def spool_prune_cmd(dry_run: bool, high: Optional[float], low: Optional[float], everything: bool,
                    config_path: Optional[str], as_json: bool) -> None:
    """delete the least recently used years of the spool cache when scratch is nearly full

    Reads the scratch file quota from `myquota`. At HIGH of the limit or more it deletes whole
    units (one variant's year, or its climatology) oldest last use first, until the projected
    use is at or below LOW, never a unit a running simulation holds. Below HIGH, or without
    `myquota`, it deletes nothing. `spool prepare` does the same before it fills the cache.
    With --all it deletes every unit no running simulation holds (a lease), whatever the quota
    says and even without `myquota`; HIGH and LOW are not used.
    """
    try:
        cfg = load_config(path=config_path).config
        result = prune(
            cfg.resolve_spool_cache(), dry_run=dry_run,
            high=cfg.spool_prune_high if high is None else high,
            low=cfg.spool_prune_low if low is None else low, everything=everything,
        )
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    if as_json:
        click.echo(json.dumps(result, indent=2, sort_keys=True))
    else:
        for line in describe_prune(result):
            click.echo(line)


@spool_group.command("status")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
@click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output")
def spool_status_cmd(config_path: Optional[str], as_json: bool) -> None:
    """print the scratch quota and what the spool cache holds; deletes nothing

    Reads the scratch row of `myquota` (without it, `quota` is null and `quota_error` says why),
    the index of every variant's units and the unexpired leases. With --json: quota, high, low,
    cache_root, variants (newest last use first), leases and totals.
    """
    try:
        cfg = load_config(path=config_path).config
        result = status(cfg.resolve_spool_cache(), high=cfg.spool_prune_high, low=cfg.spool_prune_low)
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    if as_json:
        click.echo(json.dumps(result, indent=2, sort_keys=True))
    else:
        for line in describe_status(result):
            click.echo(line)


@cli.group("output")
def output_group() -> None:
    """read a run's WBM output where it is: describe it, cut subsets of it (ADR 0033).

    SOURCE is a simulation's work directory (<output_base>/<sim id>; the output is at wbm_output/<run>/
    under it) or --snapshot <id>, a published snapshot's output read from the bucket. Needs the
    optional extra: pip install 'openghm[output]'. Each call is short and refuses what would read
    or write more than its limits.

    \b
    Exit codes:
      0  done
      1  failed: the extra is not installed, a file cannot be read, the network failed
      2  refused: the request is wrong or over a limit (the message says how)
      3  there is no output at the source (not written yet, purged, or never published)
    """


def _comma_floats(n: int, what: str):
    def parse(ctx, param, value):
        if value is None:
            return None
        try:
            parts = tuple(float(p) for p in value.split(","))
        except ValueError:
            parts = ()
        if len(parts) != n:
            raise click.BadParameter(f"expected {what}")
        return parts

    return parse


def _output_options(f):
    for opt in reversed([
        click.argument("source", required=False, metavar="[SOURCE]"),
        click.option("--snapshot", "snapshot", default=None, metavar="ID",
                     help="read a published snapshot's output instead (anonymous HTTPS from the bucket)"),
        click.option("--run", "run", default=None, metavar="NAME",
                     help="the run's directory under wbm_output/ (default: the only one)"),
        click.option("--config", "config_path", default=None, metavar="PATH",
                     help="config file (default: ~/.openghm/config.toml)"),
        click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output"),
    ]):
        f = opt(f)
    return f


def _run_output(config_path: Optional[str], source: Optional[str], snapshot: Optional[str], run: Optional[str],
                work: Callable, as_json: bool, describe: Callable) -> None:
    """Open the source, run ``work(source)``, print its answer; map failures to the exit codes."""
    from ..errors import OutputMissing
    from ..output import netcdf
    from ..output.source import open_source

    src = None
    try:
        netcdf.require()
        cfg = load_config(path=config_path).config
        src = open_source(source, snapshot, run, base_url=cfg.s3_base_url or None)
        result = work(src)
    except OutputMissing as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(3)
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    except RuntimeError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(1)
    except Exception as e:  # noqa: BLE001 - an unreadable file, a dropped connection: the caller's 502
        click.echo(f"openghm: cannot read the output: {type(e).__name__}: {e}", err=True)
        raise SystemExit(1)
    finally:
        if src is not None:
            src.close()
    if as_json:
        click.echo(json.dumps(result, indent=2))
    else:
        for line in describe(result):
            click.echo(line)


@output_group.command("inventory")
@_output_options
def output_inventory_cmd(source, snapshot, run, config_path, as_json) -> None:
    """list what a run's output holds: the files and years that exist, each variable with its units and display settings, the grid

    Built from the files that exist, not from the run's MT csv (which lists climatology records
    that were never written); the MT adds each variable's display units, scale, legend and rounding.
    Opens only a few files' headers. With --json: source, mt, grid, resolutions, variables, files, warnings.
    """
    from ..output import inventory as inv

    _run_output(config_path, source, snapshot, run, inv.inventory, as_json, inv.describe)


@output_group.command("subset")
@_output_options
@click.option("--var", "variable", required=True, metavar="NAME", help="the variable (a name `output inventory` lists)")
@click.option("--resolution", type=click.Choice(["daily", "monthly", "yearly"]), required=True)
@click.option("--format", "fmt", type=click.Choice(["nc", "png", "json"]), required=True,
              help="nc: a NetCDF-4 file (--out); png: a north-up map of one time step; json: a pixel's series (--point)")
@click.option("--start", default=None, metavar="DATE", help="YYYY, YYYY-MM or YYYY-MM-DD: the period's first day")
@click.option("--end", default=None, metavar="DATE",
              help="the period's last day (default: the end of --start's own period; with neither, everything)")
@click.option("--bbox", default=None, metavar="W,S,E,N", callback=_comma_floats(4, "W,S,E,N in degrees"),
              help="the area, in degrees (nc, png; default: the whole grid)")
@click.option("--point", default=None, metavar="LON,LAT", callback=_comma_floats(2, "LON,LAT in degrees"),
              help="the pixel, in degrees (json): its nearest cell")
@click.option("--width", type=int, default=None, metavar="N", help="png: pixels across (default: one per cell)")
@click.option("--height", type=int, default=None, metavar="N", help="png: pixels down")
@click.option("--out", "out", default=None, metavar="PATH",
              help="nc: where to write (required); png: write here instead of returning base64")
@click.option("--display", is_flag=True, help="json: values as the MT shows them (stored * scale + offset)")
def output_subset_cmd(source, snapshot, run, config_path, as_json, variable, resolution, fmt, start, end,
                      bbox, point, width, height, out, display) -> None:
    """cut one variable by period and area: a NetCDF file, a map, or a pixel's time series

    \b
    Dates are YYYY, YYYY-MM or YYYY-MM-DD; a start rounds down and an end up; a start alone means its own
    day, month or year. Every year in the period must have a file. The cells a call may read
    (whole chunks, however small the area) and an nc file's size are limited; a call over a
    limit is refused with a message before it reads anything.
    With --json: format, variable, resolution, source, period, read, and the format's own fields
    (nc: path, bytes, rows, cols, bbox; png: width, height, bbox, legend, valueRange, path or base64;
    json: point, units, times, values).
    """
    from ..output import subset as sub

    req = sub.Request(variable=variable, resolution=resolution, format=fmt, start=start, end=end, bbox=bbox,
                      point=point, width=width, height=height, out=out, display=display)
    _run_output(config_path, source, snapshot, run, lambda s: sub.subset(s, req), as_json, sub.describe)


@cli.command("wizard")
def wizard_cmd() -> None:
    """interactive, prompt-driven mode (asks for options step by step)"""
    from .wizard import run_wizard

    run_wizard()


# ---- spec validation ---------------------------------------------------------


def _validate_cmd(spec: str):
    """One implementation shared by ``snapshot validate`` and ``model-input
    validate`` — the two specs are checked identically, only the spec name and
    the folder's vocabulary (a snapshot vs. a model input) differ."""

    @click.argument("path", default=".", metavar="[PATH]")
    @click.option("--version", default=None, metavar="VERSION",
                  help=f"{spec} version to check against (default: current)")
    @click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output")
    def cmd(path: str, version: Optional[str], as_json: bool) -> None:
        from .. import spec as specmod

        folder = Path(path)
        try:
            result = specmod.validate_folder(folder, spec=spec, version=version)
        except OpenghmError as e:
            click.echo(f"openghm: {e}", err=True)
            raise SystemExit(2)
        if as_json:
            click.echo(json.dumps({
                "spec": result.spec,
                "version": result.version,
                "ok": result.ok,
                "document": {"ok": result.document.ok, "errors": result.document.errors},
                "layout": None if result.layout is None else
                    {"ok": result.layout.ok, "missing_required": result.layout.missing_required},
                "code": None if result.code is None else
                    {"ok": result.code.ok, "tree_hash": result.code.tree_hash, "pinned": result.code.pinned},
            }, indent=2))
        else:
            click.echo(f"{spec} {result.version} — {folder}")
            if result.document.ok:
                click.echo("  metadata.json: ok")
            else:
                click.echo("  metadata.json: FAILED")
                for e in result.document.errors:
                    click.echo(f"    {e}")
            if result.layout is not None:
                if result.layout.ok:
                    click.echo("  layout: ok")
                else:
                    click.echo("  layout: FAILED")
                    for p in result.layout.missing_required:
                        click.echo(f"    missing required path: {p}")
            if result.code is not None:
                if result.code.ok:
                    click.echo(f"  code: ok (tree hash {result.code.tree_hash[:16]}…)")
                else:
                    click.echo("  code: FAILED")
                    click.echo(f"    {result.code.message}")
        if not result.ok:
            raise SystemExit(1)

    return cmd


@cli.group("code")
def code_group() -> None:
    """the WBM code a snapshot pins (ADR 0032): print the tree hash of a folder."""


@code_group.command("hash")
@click.argument("path", default=".", metavar="[DIR]")
def code_hash_cmd(path: str) -> None:
    """print the tree hash of the WBM code in DIR (the folder holding model/ and utilities/)

    The value `uses.modelCode.treeHash` pins: the sha256 of the sorted
    `<sha256>  <path>` lines of every file under model/ and utilities/, skipping
    any _Inline directory (ADR 0032). Prints only the 64 hex digits.
    """
    from ..code import tree_hash

    try:
        click.echo(tree_hash(path))
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)


@cli.group("snapshot")
def snapshot_group() -> None:
    """fetch a published snapshot, publish a run as one, and validate a snapshot folder against the snapshot spec."""


snapshot_group.command("validate")(_validate_cmd("snapshot-spec"))


@snapshot_group.command("fetch")
@click.argument("snapshot_id", metavar="<id>")
@click.option("--dest", default=None, metavar="DIR", help="where to put the tree (default: ./<id>)")
@click.option("--no-image", "no_image", is_flag=True,
              help="do not download the container image the snapshot pins")
@click.option("--no-model-input", "no_model_input", is_flag=True,
              help="do not download the model input the snapshot links")
@click.option("--jobs", type=click.IntRange(min=1), default=8, show_default=True,
              help="parallel downloads")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
def snapshot_fetch_cmd(snapshot_id: str, dest: Optional[str], no_image: bool,
                       no_model_input: bool, jobs: int, config_path: Optional[str]) -> None:
    """download snapshots/<id>/ from the public bucket, ready for `sim`

    Everything except wbm_output/ (output is carried, not consumed),
    WBM_run_state/, data/ and data_init/ (the input is the model input), and
    spool/ (a spool belongs to the model input; runs share it through the spool
    cache). Each file is checked against SHA256SUMS and gets its mode from the
    object's metadata. The model input it links
    (uses.modelInput.id) goes into model_input_dir, and the pinned container
    image into sif_dir, each checked like the snapshot. Re-running resumes:
    files already valid are skipped, so a model input shared by several
    snapshots downloads once.

    The WBM code (model/ and utilities/) must hash to uses.modelCode.treeHash
    (ADR 0032; `openghm code hash` prints it). If it does not, that is a failure
    and the model input and the image are not downloaded.

    \b
    Exit codes:
      0  done
      1  a file failed its check, or the code is not the pinned code
      2  cannot start or go on: unknown id, unreadable metadata.json, or one that
         pins no code (uses.modelCode)
    """
    from rich.console import Console

    from ..fetch import FetchOptions, fetch_snapshot, format_failures, summary_line

    err = Console(stderr=True)
    tty = sys.stderr.isatty()

    def progress(done: int, total: int) -> None:
        click.echo(f"\r  {done}/{total} files", nl=False, err=True)

    try:
        cfg = load_config(path=config_path).config
        result = fetch_snapshot(
            FetchOptions(snapshot_id=snapshot_id, dest=dest, image=not no_image,
                         model_input=not no_model_input, jobs=jobs),
            cfg, console=err if tty else None,
            on_progress=progress if tty else None,  # no counter in a log file
        )
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    if tty:
        click.echo("", err=True)
    click.echo(f"snapshot: {result.dest}")
    if result.model_input_path:
        click.echo(f"model input: {result.model_input_path}")
    if result.image_path:
        click.echo(f"image: {result.image_path}")
    click.echo(summary_line(result))
    if result.failed:
        click.echo("failed:", err=True)
        for line in format_failures(result):
            click.echo(line, err=True)
        raise SystemExit(1)


@snapshot_group.command("publish")
@click.argument("run_dir", metavar="<run dir>")
@click.option("--metadata", "metadata_path", required=True, metavar="FILE",
              help="the new snapshot's metadata.json (its id is set to the snapshot's own)")
@click.option("--id", "snapshot_id", default=None, metavar="ID",
              help="publish under this id (64 lowercase hex); default: mint one. Pass it again to retry")
@click.option("--dry-run", "dry_run", is_flag=True,
              help="print every key with its action (copy, upload, skip) and write nothing")
@click.option("--s3cfg", default="~/.s3cfg", show_default=True, metavar="FILE",
              help="s3cmd credentials file (only checked to exist; never read or printed)")
@click.option("--s3cmd", default="s3cmd", show_default=True, metavar="EXE", help="the s3cmd executable")
@click.option("--base-url", default=None, metavar="URL",
              help="the bucket's public URL (default: Anvil S3); its last path segment is the bucket name")
@click.option("--jobs", type=click.IntRange(min=1), default=4, show_default=True,
              help="parallel copies and uploads")
def snapshot_publish_cmd(run_dir: str, metadata_path: str, snapshot_id: Optional[str], dry_run: bool,
                         s3cfg: str, s3cmd: str, base_url: Optional[str], jobs: int) -> None:
    """publish a finished run's work directory as snapshots/<id>/

    <run dir> is a simulation's work directory (simulation.json names the base
    snapshot). The new tree is the base's code and fixtures copied server-side,
    the run's wbm_init/, wbm_output/<sim id>/ and WBM_run_state/ uploaded, a new
    SHA256SUMS, and your metadata.json last. Everything is checked before the first
    write; a key that already holds other bytes stops it, and a retry with the same
    --id continues where it stopped. It prints `snapshot id: <id>` before writing,
    then re-reads the result anonymously.

    \b
    Exit codes:
      0  done
      2  bad input: unreadable run, base or metadata.json; metadata.json fails the
         spec or disagrees with the run (uses.modelCode.treeHash included: it must be
         the tree hash of the base's code that is copied); a bad --id
      3  output incomplete: the run failed, or lacks a year or variable the init
         asked for, or holds an empty file; the tree fails the layout
      4  a key already holds other bytes
      5  no credentials: --s3cfg missing or unreadable, or no s3cmd
      6  an s3cmd call failed
      7  verification failed: a key is missing, not public-read, or the wrong size
    """
    from ..publish import PublishError, publish

    try:
        result = publish(run_dir, metadata_path, snapshot_id=snapshot_id, base_url=base_url, s3cfg=s3cfg,
                         s3cmd=s3cmd, dry_run=dry_run, jobs=jobs, out=click.echo)
    except PublishError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(e.code)
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    c = result.counts
    if result.dry_run:
        click.echo(f"plan: {c.copy} copy, {c.upload} upload, {c.skip} skip ({c.bytes_uploaded} bytes to upload)")
    else:
        click.echo(f"done: {c.copy} copied, {c.upload} uploaded, {c.skip} skipped; "
                   f"{result.verified} keys verified anonymously")
        click.echo(f"published: snapshots/{result.snapshot_id}/")


@cli.group("model-input")
def model_input_group() -> None:
    """fetch a published model input, and validate a model input folder against the model-input spec (ADR 0015)."""


model_input_group.command("validate")(_validate_cmd("model-input-spec"))


@model_input_group.command("fetch")
@click.argument("model_input_id", metavar="<id>")
@click.option("--dest", default=None, metavar="DIR",
              help="where to put the tree (default: <model_input_dir>/<id>, where `sim` looks)")
@click.option("--jobs", type=click.IntRange(min=1), default=8, show_default=True,
              help="parallel downloads")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
def model_input_fetch_cmd(model_input_id: str, dest: Optional[str], jobs: int,
                          config_path: Optional[str]) -> None:
    """download model-inputs/<id>/ from the public bucket into the model-input cache

    Every file is checked against SHA256SUMS and gets its mode from the
    object's metadata. Re-running resumes: files already valid are skipped.
    `openghm snapshot fetch` does this for the model input a snapshot links.
    """
    from ..fetch import ModelInputOptions, fetch_model_input, format_failures, summary_line

    tty = sys.stderr.isatty()

    def progress(done: int, total: int) -> None:
        click.echo(f"\r  {done}/{total} files", nl=False, err=True)

    try:
        cfg = load_config(path=config_path).config
        result = fetch_model_input(
            ModelInputOptions(model_input_id=model_input_id, dest=dest, jobs=jobs),
            cfg, on_progress=progress if tty else None,  # no counter in a log file
        )
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    if tty:
        click.echo("", err=True)
    click.echo(f"model input: {result.dest}")
    click.echo(summary_line(result))
    if result.failed:
        click.echo("failed:", err=True)
        for line in format_failures(result):
            click.echo(line, err=True)
        raise SystemExit(1)


# ---- setup: init + image download -------------------------------------------


@cli.command("init")
@click.option("--non-interactive", "non_interactive", is_flag=True,
              help="write config from --preset without prompting (CI/provisioning)")
@click.option("--preset", type=click.Choice(["anvil", "local"]), default=None,
              help="preset config values (required with --non-interactive)")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file to write (default: ~/.openghm/config.toml)")
def init_cmd(non_interactive: bool, preset: str, config_path: str) -> None:
    """set up openghm on this machine (download image(s), configure SLURM)"""
    from .init import run_init

    run_init(non_interactive=non_interactive, preset=preset, config_path=config_path)


@cli.group("sif")
def sif_group() -> None:
    """download and inspect container images."""


@sif_group.command("list")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
def sif_list_cmd(config_path: str) -> None:
    """list available images and whether each is present locally"""
    from ..assets import cache_path, load_manifest

    cfg = load_config(path=config_path).config
    manifest = load_manifest()
    for key in sorted(manifest):
        spec = manifest[key]
        dest = cache_path(cfg, spec)
        mark = "✓" if os.path.exists(dest) else " "
        aliases = f"  ({', '.join(spec.aliases)})" if spec.aliases else ""
        click.echo(f" [{mark}] {key:<26} {spec.human_size():>10}{aliases}")


@sif_group.command("pull")
@click.argument("name", metavar="<IMAGE[:VERSION]>")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
@click.option("--force", is_flag=True, help="re-download even if already present")
def sif_pull_cmd(name: str, config_path: str, force: bool) -> None:
    """download a container image into the local cache (sif_dir)

    NAME is <image>:<version> (see `openghm sif list`), or <image> for its latest.
    The older names `lite`, `1.0.0` and `2.0.0` still work.
    """
    from rich.console import Console

    from ..assets import cache_path, download, resolve_spec

    console = Console()
    try:
        cfg = load_config(path=config_path).config
        spec = resolve_spec(name)
        dest = cache_path(cfg, spec)
        if os.path.exists(dest) and not force:
            click.echo(f"already present: {dest} (use --force to re-download)")
            return
        console.print(f"downloading {spec.key} (~{spec.human_size()})…")
        download(spec, dest, console=console)
        click.echo(f"saved {dest}")
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)


def main() -> None:
    cli(prog_name="openghm")


if __name__ == "__main__":   # `python -m openghm.cli.main`: what a `sim submit` job script runs
    main()
