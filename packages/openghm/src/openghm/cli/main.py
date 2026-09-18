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

from ..config import load_config
from ..errors import OpenghmError
from ..mounts import DataMountSpec
from ..network import build_network
from ..run import run_command
from ..runtime import RuntimeContext
from ..sim import (
    SubmitOptions, build_submit, build_run, record_exit_code,
    parse_slurm_job_id, record_slurm_job_id,
    list_simulations, find_simulation, resolve_job_id,
    build_sacct_argv, parse_sacct, sacct_primary,
    build_scancel_argv, slurm_log_path, tail_lines,
)
from ..spatial import SpatialOptions, build_spatial
from ..temporal import TemporalOptions, build_temporal
from ..network import NetworkOptions
from ..types import BuiltCommand
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
                     help="WBM SIF path override (default: derived from the snapshot version)"),
        click.option("--dry-run", "dry_run", is_flag=True,
                     help="print the generated init/sbatch script without submitting"),
        click.option("-v", "--verbose", is_flag=True,
                     help="verbose (passes -v into wbm.pl)"),
        click.option("--json", "as_json", is_flag=True, help="machine-readable JSON output"),
    ]
    for opt in reversed(options):
        f = opt(f)
    return f


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
@click.option("--walltime", default=None, metavar="HH:MM:SS", help="SLURM --time (default: metadata)")
@click.option("--account", default=None, help="SLURM account (default: config)")
@click.option("--partition", default=None, help="SLURM partition (default: config)")
@click.option("--output-base", "output_base", default=None, metavar="DIR",
              help="per-sim work/output root (default: config)")
@click.option("--run-start", "run_start", default=None, metavar="YYYY-MM-DD", help="init override: Run_Start")
@click.option("--run-end", "run_end", default=None, metavar="YYYY-MM-DD", help="init override: Run_End")
@click.option("--output-vars", "output_vars", default=None, help="init override: Output_vars")
@click.option("--spinup-start", "spinup_start", default=None, metavar="YYYY-MM-DD", help="init override: Spinup.Start")
@click.option("--spinup-end", "spinup_end", default=None, metavar="YYYY-MM-DD", help="init override: Spinup.End")
@click.option("--spinup-loops", "spinup_loops", type=int, default=None, help="init override: Spinup.Loops")
@click.option("--user-info", "user_info", default=None,
              help="submitter info recorded in simulation.json (provenance only)")
@output_options
def sim_submit_cmd(**p) -> None:
    """submit a snapshot folder (default: current directory) as a WBM SLURM job"""
    opts = SubmitOptions(
        snapshot_dir=p["path"], simulation_id=p["sim_id"],
        cores=p["cores"], walltime=p["walltime"], account=p["account"],
        partition=p["partition"], output_base=p["output_base"],
        run_start=p["run_start"], run_end=p["run_end"], output_vars=p["output_vars"],
        spinup_start=p["spinup_start"], spinup_end=p["spinup_end"], spinup_loops=p["spinup_loops"],
        user_info=p["user_info"], verbose=p["verbose"],
    )
    now = None if p["dry_run"] else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        cfg = load_config(path=p["config_path"]).config
        ctx, built = build_submit(opts, cfg, runtime=p.get("runtime"), sif=p.get("sif"), now=now)
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
@click.option("--run-start", "run_start", default=None, metavar="YYYY-MM-DD", help="init override: Run_Start")
@click.option("--run-end", "run_end", default=None, metavar="YYYY-MM-DD", help="init override: Run_End")
@click.option("--output-vars", "output_vars", default=None, help="init override: Output_vars")
@click.option("--spinup-start", "spinup_start", default=None, metavar="YYYY-MM-DD", help="init override: Spinup.Start")
@click.option("--spinup-end", "spinup_end", default=None, metavar="YYYY-MM-DD", help="init override: Spinup.End")
@click.option("--spinup-loops", "spinup_loops", type=int, default=None, help="init override: Spinup.Loops")
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
        run_start=p["run_start"], run_end=p["run_end"], output_vars=p["output_vars"],
        spinup_start=p["spinup_start"], spinup_end=p["spinup_end"], spinup_loops=p["spinup_loops"],
        user_info=p["user_info"], verbose=p["verbose"],
    )
    now = None if p["dry_run"] else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        cfg = load_config(path=p["config_path"]).config
        ctx, built = build_run(opts, cfg, runtime=p.get("runtime"), sif=p.get("sif"), now=now)
        result = run_command(built, dry_run=p["dry_run"], capture=p["as_json"])
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)
    if not result.dry_run:
        record_exit_code(built, result.exit_code or 0)
    present("sim run", ctx, built, result, as_json=p["as_json"])
    if not result.dry_run and result.exit_code:
        raise SystemExit(result.exit_code)


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
        if not result.ok:
            raise SystemExit(1)

    return cmd


@cli.group("snapshot")
def snapshot_group() -> None:
    """validate a snapshot folder against the published snapshot spec."""


snapshot_group.command("validate")(_validate_cmd("snapshot-spec"))


@cli.group("model-input")
def model_input_group() -> None:
    """validate a model input folder against the published model-input spec (ADR 0015)."""


model_input_group.command("validate")(_validate_cmd("model-input-spec"))


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
        click.echo(f" [{mark}] {key:<8} {spec.filename:<28} {spec.human_size():>10}")


@sif_group.command("pull")
@click.argument("name", metavar="<lite|VERSION>")
@click.option("--config", "config_path", default=None, metavar="PATH",
              help="config file (default: ~/.openghm/config.toml)")
@click.option("--force", is_flag=True, help="re-download even if already present")
def sif_pull_cmd(name: str, config_path: str, force: bool) -> None:
    """download a container image into the local cache (sif_dir)"""
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
        console.print(f"downloading {spec.filename} (~{spec.human_size()})…")
        download(spec, dest, console=console)
        click.echo(f"saved {dest}")
    except OpenghmError as e:
        click.echo(f"openghm: {e}", err=True)
        raise SystemExit(2)


def main() -> None:
    cli(prog_name="openghm")
