"""Presentation: JSON, Rich (TTY), or plain text.

``build_payload`` is the JSON contract (keys match the original Node ``--json``
output, so captured goldens compare directly). ``present`` dispatches to JSON /
Rich based on ``--json`` and TTY.
"""

from __future__ import annotations

import json
import signal
import sys
from typing import Optional

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from ..runtime import RuntimeContext
from ..types import BuiltCommand, Mount, RunResult


def _mount_json(m: Mount) -> dict:
    d = {"host": m.host, "container": m.container}
    if m.readonly:  # Node omits the key when false/undefined
        d["readonly"] = True
    return d


def build_payload(
    command: str,
    runtime: str,
    image: str,
    built: BuiltCommand,
    result: Optional[RunResult] = None,
) -> dict:
    """Flatten to a JSON-friendly dict (key set/order matches the Node CLI)."""
    dry_run = result.dry_run if result is not None else True
    payload = {
        "command": command,
        "runtime": runtime,
        "image": image,
        "dryRun": dry_run,
        "exec": built.display,
        "argv": list(built.argv),
        "mounts": [_mount_json(m) for m in built.mounts],
        "innerCmd": list(built.inner_cmd),
        "generatedFiles": [
            {"hostPath": f.host_path, "content": f.content} for f in built.generated_files
        ],
    }
    # Only surfaced by `sim` (split-mount jobs); omitted when empty so the existing
    # processing-tool goldens stay byte-identical.
    if built.staged_dirs:
        payload["stagedDirs"] = list(built.staged_dirs)
    if built.staged_copies:
        payload["stagedCopies"] = [{"src": c.src, "dst": c.dst} for c in built.staged_copies]
    if result is not None and not result.dry_run:
        payload["exitCode"] = result.exit_code if result.exit_code is not None else None
        if result.stdout is not None:
            payload["stdout"] = result.stdout
        if result.stderr is not None:
            payload["stderr"] = result.stderr
    return payload


def _render_dry_run(console: Console, command: str, ctx: RuntimeContext, built: BuiltCommand) -> None:
    body = Text()
    body.append("runtime: ", style="dim")
    body.append(ctx.runtime)
    body.append("   image: ", style="dim")
    body.append(ctx.image)
    body.append("\n")

    if built.mounts:
        body.append("\nmounts:\n", style="dim")
        for m in built.mounts:
            body.append("  " + m.host)
            body.append(" → ", style="dim")
            body.append(m.container, style="yellow")
            body.append("  (ro)\n" if m.readonly else "\n", style="dim")

    if built.staged_copies:
        body.append("\ncopy:\n", style="dim")
        for c in built.staged_copies:
            body.append("  " + c.src)
            body.append(" ⇒ ", style="dim")
            body.append(c.dst + "\n", style="yellow")

    if built.staged_dirs:
        body.append("\nmkdir:\n", style="dim")
        for d in built.staged_dirs:
            body.append("  " + d + "\n")

    for f in built.generated_files:
        body.append(f"\ngenerated {f.host_path}:\n", style="dim")
        for line in f.content.rstrip("\n").split("\n"):
            body.append("  │ ", style="dim")
            body.append(line + "\n")

    body.append("\nexec:\n", style="dim")
    body.append("  " + built.display)

    console.print(
        Panel(body, title=Text(f"openghm {command} ", style="bold cyan").append("(dry run)", style="dim"),
              title_align="left", border_style="cyan")
    )


def _killed_by_signal(command: str, code: int) -> Optional[str]:
    """Why a run that exited ``code`` < 0 has nothing to show: ``subprocess`` reports
    a child killed by signal N as ``-N``, and a killed process prints nothing."""
    if code >= 0:
        return None
    try:
        name = signal.Signals(-code).name
    except ValueError:
        name = None
    who = "WBM" if command == "sim run" else "The process"
    head = f"{who} was killed by signal {-code}" + (f" ({name})." if name else ".")
    if code == -signal.SIGKILL:
        return head + " On a cluster this is usually the out-of-memory killer."
    return head


def _render_result(console: Console, command: str, built: BuiltCommand, result: RunResult) -> None:
    code = result.exit_code or 0
    ok = code == 0
    tag = Text("✓ done", style="green") if ok else Text(f"✗ exit {code}", style="red")
    title = Text(f"openghm {command} ", style="bold cyan").append_text(tag)
    body = Text()
    if result.stdout:
        body.append(result.stdout.rstrip("\n"))
    if not ok and result.stderr:
        if body:
            body.append("\n")
        body.append(result.stderr.rstrip("\n"), style="red")
    killed = _killed_by_signal(command, code)
    if killed:
        if body:
            body.append("\n")
        body.append(killed, style="red")
    console.print(Panel(body if body else Text(""), title=title, title_align="left",
                        border_style="green" if ok else "red"))


def present(
    command: str,
    ctx: RuntimeContext,
    built: BuiltCommand,
    result: Optional[RunResult],
    *,
    as_json: bool = False,
) -> None:
    if as_json:
        sys.stdout.write(json.dumps(build_payload(command, ctx.runtime, ctx.image, built, result), indent=2) + "\n")
        return
    console = Console()
    if result is not None and not result.dry_run:
        _render_result(console, command, built, result)
    else:
        _render_dry_run(console, command, ctx, built)


# ── sim management: list / status / logs / cancel ─────────────────────────────


def _sim_public(rec: Optional[dict]) -> Optional[dict]:
    """Sidecar record for JSON: drop the internal ``_dir`` key, expose it as ``dir``."""
    if rec is None:
        return None
    out = {k: v for k, v in rec.items() if k != "_dir"}
    if rec.get("_dir"):
        out["dir"] = rec["_dir"]
    return out


def present_sim_list(output_base: str, records: list, *, as_json: bool = False) -> None:
    if as_json:
        sys.stdout.write(json.dumps(
            {"command": "sim list", "outputBase": output_base,
             "simulations": [_sim_public(r) for r in records]}, indent=2) + "\n")
        return
    console = Console()
    if not records:
        console.print(f"[dim]no simulations under[/dim] {output_base}")
        return
    table = Table(box=None, pad_edge=False, header_style="bold cyan")
    for col in ("ID", "JOB ID", "VER", "CORES", "WALLTIME", "SUBMITTED"):
        table.add_column(col, overflow="fold")
    for r in records:
        table.add_row(
            str(r.get("simulation_id", "")),
            str(r.get("slurm_job_id") or "-"),
            str(r.get("wbm_version") or ""),
            str(r.get("cores") or ""),
            str(r.get("walltime") or ""),
            str(r.get("submitted_at") or "-"),
        )
    console.print(table)


def present_sim_status(job_id: str, sidecar: Optional[dict], rows: list, primary: Optional[dict],
                       *, exit_code: int = 0, stderr: str = "", as_json: bool = False) -> None:
    if as_json:
        payload = {"command": "sim status", "jobId": job_id,
                   "sidecar": _sim_public(sidecar), "sacct": rows, "exitCode": exit_code}
        if stderr:
            payload["stderr"] = stderr
        sys.stdout.write(json.dumps(payload, indent=2) + "\n")
        return
    console = Console()
    body = Text()
    body.append("job id: ", style="dim")
    body.append(str(job_id))
    if sidecar and sidecar.get("simulation_id"):
        body.append("   sim: ", style="dim")
        body.append(str(sidecar["simulation_id"]))
    body.append("\n")
    if primary is None:
        body.append("\nno accounting record", style="yellow")
        body.append(" (job too old and purged, or not started yet)", style="dim")
        if stderr:
            body.append("\n" + stderr.rstrip("\n"), style="red")
    else:
        body.append("\n")
        for label, key in (("state", "State"), ("exit", "ExitCode"), ("elapsed", "Elapsed"),
                           ("start", "Start"), ("end", "End"), ("partition", "Partition")):
            val = primary.get(key)
            if val:
                body.append(f"{label} ", style="dim")
                body.append(val + "   ")
    state = (primary or {}).get("State", "")
    ok = any(state.startswith(s) for s in ("COMPLETED", "RUNNING", "PENDING"))
    console.print(Panel(body, title=Text("openghm sim status", style="bold cyan"),
                        title_align="left", border_style="cyan" if ok or primary is None else "red"))


def present_sim_logs(path: str, lines: list, *, as_json: bool = False) -> None:
    if as_json:
        sys.stdout.write(json.dumps({"command": "sim logs", "path": path, "lines": lines}, indent=2) + "\n")
        return
    # tail-like plain text on stdout (pipes cleanly); no panel/prefix.
    sys.stdout.write("\n".join(lines) + ("\n" if lines else ""))


def present_sim_cancel(job_id: str, sim_id: Optional[str], *, dry_run: bool, argv: list,
                       exit_code: Optional[int] = None, stderr: str = "", as_json: bool = False) -> None:
    if as_json:
        payload = {"command": "sim cancel", "jobId": job_id, "simId": sim_id,
                   "dryRun": dry_run, "argv": list(argv)}
        if not dry_run:
            payload["exitCode"] = exit_code
            if stderr:
                payload["stderr"] = stderr
        sys.stdout.write(json.dumps(payload, indent=2) + "\n")
        return
    console = Console()
    if dry_run:
        console.print(Panel(Text(" ".join(argv)),
                            title=Text("openghm sim cancel ", style="bold cyan").append("(dry run)", style="dim"),
                            title_align="left", border_style="cyan"))
        return
    label = job_id if not sim_id else f"{job_id} (sim {sim_id})"
    if not exit_code:
        console.print(Panel(Text(f"cancelled job {label}", style="green"),
                            title=Text("openghm sim cancel ✓", style="bold green"),
                            title_align="left", border_style="green"))
    else:
        body = Text(f"scancel exited {exit_code}", style="red")
        if stderr:
            body.append("\n" + stderr.rstrip("\n"), style="red")
        console.print(Panel(body, title=Text("openghm sim cancel ✗", style="bold red"),
                            title_align="left", border_style="red"))
