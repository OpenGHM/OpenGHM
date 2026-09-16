"""``openghm init`` — one-time setup wizard for a fresh install.

``pip install openghm`` deliberately downloads nothing. This wizard is where a
user actually gets set up on a non-Anvil machine:

1. detect the environment (which runtimes / SLURM tools are on PATH),
2. ask what they want to run (processing tools only, or WBM model runs too),
3. pick a container runtime,
4. **download the container image(s)** — always announcing the size and asking
   first (they are hundreds of MB to ~2 GB),
5. if they want model runs, ask whether to submit to SLURM and, if so, collect
   account / partition / output_base step by step (each with an example),
6. write ``~/.openghm/config.toml`` and print a smoke-test command.

The decision logic is split into pure functions (``detect_environment``,
``apply_answers``, ``PRESETS``) so it can be unit-tested without a TTY; the
interactive parts live in ``run_init``.
"""

from __future__ import annotations

import dataclasses
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Optional

from ..config import Config, _render_default_toml, default_config_path

# ── pure, testable core ───────────────────────────────────────────────────────

#: Binaries the wizard probes for on PATH.
PROBE_TOOLS = ("sbatch", "sacct", "scancel", "singularity", "apptainer", "docker")

#: Non-interactive presets (``openghm init --non-interactive --preset <name>``).
PRESETS: Dict[str, dict] = {
    "anvil": {
        "runtime": "singularity",
        "account": "ees260008",
        "partition": "shared",
        "output_base": "/anvil/scratch/x-openghm/simulations",
    },
    "local": {
        "runtime": "docker",
        "output_base": "~/.openghm/runs",
    },
}


def detect_environment() -> Dict[str, bool]:
    """Which of :data:`PROBE_TOOLS` are on PATH (pure w.r.t. the current PATH)."""
    return {t: shutil.which(t) is not None for t in PROBE_TOOLS}


def suggested_runtime(env: Dict[str, bool]) -> Optional[str]:
    """First available container runtime, preferring singularity (HPC standard)."""
    for rt in ("singularity", "apptainer", "docker"):
        if env.get(rt):
            return rt
    return None


def apply_answers(answers: dict, base: Optional[Config] = None) -> Config:
    """Overlay wizard answers onto a base config (only known Config fields apply)."""
    base = base or Config()
    valid = {f.name for f in dataclasses.fields(Config)}
    kwargs = {k: v for k, v in answers.items() if k in valid and v is not None}
    return dataclasses.replace(base, **kwargs)


# ── interactive frontend ────────────────────────────────────────────────────────


def _write_config(config: Config, path: Optional[str]) -> str:
    p = Path(path) if path else default_config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_render_default_toml(config), encoding="utf-8")
    return str(p)


def run_init(*, non_interactive: bool = False, preset: Optional[str] = None,
             config_path: Optional[str] = None) -> None:
    """Entry point for the ``openghm init`` command."""
    if non_interactive:
        _run_non_interactive(preset=preset, config_path=config_path)
        return
    _run_interactive(config_path=config_path)


def _run_non_interactive(*, preset: Optional[str], config_path: Optional[str]) -> None:
    if not preset or preset not in PRESETS:
        sys.stderr.write(
            f"openghm init --non-interactive requires --preset "
            f"({', '.join(PRESETS)})\n"
        )
        raise SystemExit(2)
    config = apply_answers(PRESETS[preset])
    path = _write_config(config, config_path)
    sys.stdout.write(
        f"wrote {path} (preset: {preset}).\n"
        "No images were downloaded — run `openghm sif pull <lite|VERSION>` when ready.\n"
    )


def _run_interactive(*, config_path: Optional[str]) -> None:
    import questionary
    from rich.console import Console

    from .. import assets

    console = Console()
    if not sys.stdout.isatty() or not sys.stdin.isatty():
        sys.stderr.write(
            "openghm init needs an interactive terminal (or use "
            "--non-interactive --preset <name>).\n"
        )
        raise SystemExit(2)

    def hint(text: str) -> None:
        console.print(text, style="dim", markup=False, highlight=False)

    def ask(q):
        v = q.ask()
        if v is None:
            console.print("[yellow]Cancelled — nothing was written.[/yellow]")
            raise SystemExit(1)
        return v

    console.rule("[bold cyan]openghm — setup[/bold cyan]")

    # 1. environment detection
    env = detect_environment()
    present = ", ".join(t for t in PROBE_TOOLS if env[t]) or "none"
    hint(f"Detected on PATH: {present}")
    if env["sbatch"]:
        hint("→ SLURM tools found: this looks like an HPC login node.")
    elif env["docker"] or env["singularity"] or env["apptainer"]:
        hint("→ No SLURM here: this machine is suited to local runs.")

    # 2. purpose
    hint(
        "\nWhat will you use openghm for?\n"
        "  • processing tools = network / spatial / temporal (small, laptop-friendly)\n"
        "  • WBM model runs   = full simulations (large image; local or SLURM)"
    )
    purpose = ask(questionary.select(
        "Intended use?",
        choices=[
            questionary.Choice("Processing tools only", "tools"),
            questionary.Choice("WBM model runs too (sim)", "sim"),
        ],
    ))
    want_sim = purpose == "sim"

    # 3. runtime
    hint("\nPick the container runtime. singularity/apptainer = HPC standard; docker = common on laptops.")
    rt_choices = [c for c in ("singularity", "apptainer", "docker")]
    runtime = ask(questionary.select(
        "Container runtime?",
        choices=[
            questionary.Choice(f"{c}  ({'detected' if env[c] else 'not detected'})", c)
            for c in rt_choices
        ],
        default=suggested_runtime(env) or "singularity",
    ))

    answers: dict = {"runtime": runtime}

    # 4. container download
    console.print("\n[bold]실행을 위해선 컨테이너 이미지가 필요합니다.[/bold] "
                  "(A container image is required to run anything.)")
    manifest = assets.load_manifest()

    def offer_download(key: str, *, default_yes: bool) -> None:
        try:
            spec = assets.resolve_spec(key, manifest)
        except Exception as e:  # unknown key in manifest
            console.print(f"[red]{e}[/red]")
            return
        config_stub = apply_answers(answers)
        if assets.is_present(config_stub, spec):
            console.print(f"[green]✓[/green] {spec.filename} already present — skipping.")
            return
        hint(f"{spec.filename} — about {spec.human_size()}.")
        if not ask(questionary.confirm(f"Download {spec.filename} now?", default=default_yes)):
            console.print(f"[dim]Skipped. Get it later with:[/dim] openghm sif pull {key}")
            return
        try:
            dest = assets.download(spec, assets.cache_path(config_stub, spec), console=console)
            console.print(f"[green]✓[/green] saved {dest}")
        except Exception as e:
            console.print(f"[red]download failed:[/red] {e}")
            console.print(f"[dim]You can retry later with:[/dim] openghm sif pull {key}")

    # lite image (needed for processing tools; small)
    offer_download("lite", default_yes=True)

    # WBM model image (only if running sims; large → default No)
    if want_sim:
        wbm_keys = [k for k, s in manifest.items() if s.kind == "wbm"]
        if wbm_keys:
            hint("\nWhich WBM version do you need? (large download — pick the one you run)")
            version = ask(questionary.select(
                "WBM version?",
                choices=[
                    questionary.Choice(f"{k}  ({manifest[k].human_size()})", k)
                    for k in sorted(wbm_keys)
                ],
            ))
            offer_download(version, default_yes=False)

    # 5 & 6. SLURM vs local output
    if want_sim:
        hint("\nSubmit runs to a SLURM cluster, or run them locally on this machine?")
        use_slurm = ask(questionary.confirm(
            "Submit to SLURM? (No = local `openghm sim run`)",
            default=bool(env["sbatch"]),
        ))
        if use_slurm:
            answers.update(_ask_slurm(console, questionary, ask, hint, env))
        else:
            hint("Local runs write per-sim output under this folder:")
            answers["output_base"] = ask(questionary.text(
                "Local output base (e.g. ~/.openghm/runs)",
                default="~/.openghm/runs",
            )).strip() or "~/.openghm/runs"

    # 7. write + summary
    config = apply_answers(answers)
    path = _write_config(config, config_path)
    console.print(f"\n[green]✓ wrote[/green] {path}")
    _print_summary(console, config, want_sim)


def _ask_slurm(console, questionary, ask, hint, env: Dict[str, bool]) -> dict:
    """Collect account / partition / output_base with per-field examples + validation."""
    out: dict = {}

    hint("\nSLURM account — the allocation you are billed against.")
    account = ask(questionary.text("Account (e.g. ees260008)", default="")).strip()
    if account:
        out["account"] = account
        if env["sacct"]:
            try:
                r = subprocess.run(["sacct", "-A", account, "-n", "-X", "-S", "now-1days"],
                                   capture_output=True, text=True, timeout=15)
                if r.returncode != 0:
                    console.print(f"[yellow]warning:[/yellow] sacct could not confirm account {account!r}.")
            except (FileNotFoundError, subprocess.SubprocessError):
                pass

    hint("\nSLURM partition — the queue jobs go to.")
    partition = ask(questionary.text("Partition (e.g. shared)", default="shared")).strip()
    if partition:
        out["partition"] = partition
        if env["sacct"] and shutil.which("sinfo"):
            try:
                r = subprocess.run(["sinfo", "-h", "-o", "%P"], capture_output=True, text=True, timeout=15)
                parts = {p.rstrip("*") for p in r.stdout.split()}
                if parts and partition not in parts:
                    console.print(
                        f"[yellow]warning:[/yellow] {partition!r} not in sinfo partitions "
                        f"({', '.join(sorted(parts))})."
                    )
            except (FileNotFoundError, subprocess.SubprocessError):
                pass

    hint("\noutput_base — shared scratch where per-sim output/spool/state accumulate.")
    output_base = ask(questionary.text(
        "Output base (e.g. /anvil/scratch/$USER/simulations)", default="")).strip()
    if output_base:
        out["output_base"] = output_base

    return out


def _print_summary(console, config: Config, want_sim: bool) -> None:
    console.print("\n[bold]Configuration[/bold]")
    console.print(f"  runtime      {config.runtime}")
    console.print(f"  sif_dir      {config.sif_dir}")
    if want_sim:
        console.print(f"  output_base  {config.output_base}")
        console.print(f"  account      {config.account}")
        console.print(f"  partition    {config.partition}")
    console.print("\n[bold]Try it:[/bold]")
    console.print("  [cyan]openghm network preclip --help[/cyan]")
    if want_sim:
        console.print("  [cyan]openghm sim run <snapshot> --id smoke --dry-run[/cyan]")
