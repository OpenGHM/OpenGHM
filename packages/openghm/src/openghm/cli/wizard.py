"""Interactive, prompt-driven mode (``openghm wizard``).

Sequential questions fill in options; the preview shows the equivalent
``openghm`` command; on confirm it runs through the same core builders as the
flag-based commands. TTY only.

Built on questionary (prompts) + rich (the dimmed per-step hints, which stand in
for clack's ``log.info`` gutter lines).
"""

from __future__ import annotations

import os
import sys
from typing import List, Optional

import questionary
from rich.console import Console
from rich.panel import Panel

from .._fmt import js_num
from ..config import load_config
from ..errors import OpenghmError
from ..mounts import DataMountSpec, is_container_path
from ..network import NetworkOptions, build_network
from ..run import run_command
from ..runtime import RuntimeContext
from ..spatial import SpatialOptions, build_spatial
from ..temporal import TemporalOptions, build_temporal
from .fields import (
    Field,
    PRECLIP_ADVANCED, PRECLIP_REQUIRED,
    SPATIAL_ADVANCED, SPATIAL_REQUIRED,
    SUBSET_RECT_ADVANCED, SUBSET_RECT_REQUIRED,
    SUBSET_SHP_ADVANCED, SUBSET_SHP_REQUIRED,
    TEMPORAL_ADVANCED, TEMPORAL_REQUIRED,
)
from .format import FlagToken, format_openghm_command

console = Console()


class _Cancelled(Exception):
    """Raised when the user aborts a prompt (Ctrl-C / EOF)."""


def _hint(text: str) -> None:
    """A short, dimmed explanation shown above a step's prompt(s)."""
    console.print(text, style="dim", markup=False, highlight=False)


def _ask(question):
    """Run a questionary prompt; treat a cancelled prompt (None) as abort."""
    value = question.ask()
    if value is None:
        raise _Cancelled()
    return value


def _is_int(s: str) -> bool:
    try:
        int(s)
        return True
    except ValueError:
        return False


def _validator(f: Field):
    def validate(val: str):
        s = (val or "").strip()
        if not s:
            return "Required." if f.required else True
        if f.kind == "number":
            try:
                float(s)
            except ValueError:
                return "Must be a number."
        if f.kind == "ids":
            for t in s.split(","):
                t = t.strip()
                if t and not _is_int(t):
                    return "Comma-separated integers."
        if f.exists_check and not is_container_path(s) and not os.path.exists(s):
            return "Path not found."
        return True

    return validate


def _ask_field(f: Field):
    if f.desc:
        _hint(f.desc)
    if f.kind == "select":
        choices = [
            questionary.Choice(
                title=o["label"] + (f"  ({o['hint']})" if o.get("hint") else ""),
                value=o["value"],
            )
            for o in (f.options or [])
        ]
        return _ask(questionary.select(f.message, choices=choices, default=f.initial))
    if f.kind == "confirm":
        return _ask(questionary.confirm(f.message, default=False))

    message = f.message + (f"  (e.g. {f.placeholder})" if f.placeholder else "")
    raw = _ask(questionary.text(message, validate=_validator(f)))
    s = raw.strip()
    if not s:
        return None
    if f.kind == "number":
        return float(s)
    if f.kind == "ids":
        return [int(x.strip()) for x in s.split(",") if x.strip()]
    return s


def _validate_mounts(val: str):
    for t in [x.strip() for x in (val or "").split(",") if x.strip()]:
        i = t.find("=")
        if i <= 0:
            return f'Use NAME=DIR (got "{t}")'
        d = t[i + 1 :]
        if not os.path.exists(d):
            return f"Dir not found: {d}"
    return True


def _parse_mounts(s: str) -> List[DataMountSpec]:
    out: List[DataMountSpec] = []
    for t in [x.strip() for x in (s or "").split(",") if x.strip()]:
        i = t.find("=")
        out.append(DataMountSpec(t[:i], t[i + 1 :]))
    return out


def run_wizard() -> None:
    if not sys.stdout.isatty() or not sys.stdin.isatty():
        sys.stderr.write("openghm wizard requires an interactive terminal (TTY).\n")
        sys.exit(2)

    try:
        console.rule("[bold cyan]openghm — interactive[/bold cyan]")

        _hint(
            "Pick a WBM utility. Each command wraps one script inside the container; "
            "answer the prompts and the wizard builds the run for you."
        )
        command = _ask(
            questionary.select(
                "What do you want to run?",
                choices=[
                    questionary.Choice("network preclip  (rectangular clip)", "network preclip"),
                    questionary.Choice("network subset  (basin/polygon subset)", "network subset"),
                    questionary.Choice("spatial  (area-weighted aggregation)", "spatial"),
                    questionary.Choice("temporal  (e.g. monthly → yearly)", "temporal"),
                ],
            )
        )

        required: List[Field]
        advanced: List[Field]
        if command == "network preclip":
            required, advanced = PRECLIP_REQUIRED, PRECLIP_ADVANCED
        elif command == "network subset":
            _hint(
                "Rectangle keeps everything inside a lon/lat box; shapefile keeps the "
                "basins under chosen polygon IDs."
            )
            mode = _ask(
                questionary.select(
                    "Subset by?",
                    choices=[
                        questionary.Choice("rectangle  (lon/lat box)", "rect"),
                        questionary.Choice("shapefile  (polygon IDs)", "shp"),
                    ],
                )
            )
            if mode == "rect":
                required, advanced = SUBSET_RECT_REQUIRED, SUBSET_RECT_ADVANCED
            else:
                required, advanced = SUBSET_SHP_REQUIRED, SUBSET_SHP_ADVANCED
        elif command == "spatial":
            required, advanced = SPATIAL_REQUIRED, SPATIAL_ADVANCED
        else:
            required, advanced = TEMPORAL_REQUIRED, TEMPORAL_ADVANCED

        # Mounts (mirrors --work / --mount NAME=DIR).
        _hint("Next, map host folders into the container so the tool can read inputs and write outputs.")
        work = _ask_field(
            Field(
                kind="text", flag="--work", key="work",
                message="Work dir (--work → /work)",
                desc="Host folder bound to /work — holds outputs and any generated init/Magic-Table files.",
                required=True, exists_check=True,
            )
        )
        _hint("Expose input folders: each NAME=DIR becomes /data/NAME inside the container.")
        mount_str = _ask(
            questionary.text(
                "Data mounts NAME=DIR, comma-separated (→ /data/NAME); empty for none",
                validate=_validate_mounts,
            )
        )
        mounts = _parse_mounts(mount_str)

        # Collect required, then a chosen subset of advanced.
        opts: dict = {}
        tokens: List[FlagToken] = []

        def record(f: Field, val) -> None:
            if val is None:
                return
            if f.kind == "confirm":
                if val is True:
                    opts[f.key] = True
                    tokens.append(FlagToken(f.flag))
                return
            opts[f.key] = val
            if f.kind == "ids":
                sval = ",".join(str(x) for x in val)
            elif f.kind == "number":
                sval = js_num(val)
            else:
                sval = str(val)
            tokens.append(FlagToken(f.flag, sval))

        _hint(f'Required inputs for "{command}" — paths are checked as you type.')
        for f in required:
            record(f, _ask_field(f))

        _hint(
            "Optional flags. Toggle the ones you need (space), then press enter — "
            "leave all unticked to use defaults."
        )
        chosen = set(
            _ask(
                questionary.checkbox(
                    "Advanced options to set (space to toggle, enter to continue)",
                    choices=[questionary.Choice(f"{f.flag}  ({f.message})", f.key) for f in advanced],
                )
            )
        )
        for f in advanced:
            if f.key in chosen:
                record(f, _ask_field(f))

        # Build via the same core path the non-interactive CLI uses.
        ctx = RuntimeContext.from_config(load_config().config)
        try:
            if command == "network preclip":
                built = build_network("preclip", NetworkOptions(work=work, mounts=mounts, **opts), ctx)
            elif command == "network subset":
                built = build_network("subset", NetworkOptions(work=work, mounts=mounts, **opts), ctx)
            elif command == "spatial":
                built = build_spatial(SpatialOptions(work=work, mounts=mounts, **opts), ctx)
            else:
                built = build_temporal(TemporalOptions(work=work, mounts=mounts, **opts), ctx)
        except OpenghmError as e:
            console.print(f"[red]Cannot build command: {e}[/red]")
            return

        _hint("The equivalent non-interactive command — copy it to re-run or script this later without the wizard.")
        console.print(
            Panel(format_openghm_command(command, mounts, work, tokens), title="Equivalent command", title_align="left")
        )

        if not _ask(questionary.confirm("Run it now?", default=True)):
            console.print("[dim]Not run — copy the command above to run it later.[/dim]")
            return

        console.print("[cyan]Running…[/cyan]")
        res = run_command(built)  # streams the script output
        if res.exit_code:
            console.print(f"Exited with code {res.exit_code}.")
            sys.exit(res.exit_code)
        console.print("[green]Done.[/green]")
    except _Cancelled:
        console.print("[yellow]Cancelled.[/yellow]")
        return
