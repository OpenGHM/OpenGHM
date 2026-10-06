"""How a job's verdict is reached (ADR 0026, mission
2026-09-30-every-job-ends-with-a-verdict): one test per row of the mission's
verdict contract, fed SLURM's raw states the way slurmly reports them
(`JobInfo.raw_state`), the outcome record a job body writes
(`job_script.OUTCOME_PY`) and the stderr a job leaves behind. Pure: no Mongo,
no SSH.

The submit-time rows (`submit_unreachable`, `submit_rejected`) are HTTP answers
of the submit route, and are tested with it (tests/test_job_submit.py).
"""

from __future__ import annotations

import copy

import pytest

from app.services.job_verdict import classify

from route_helpers import SUCCESS_OUTCOME as SUCCESS


def stderr(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def record(**changes) -> dict:
    """SUCCESS with `changes` merged in one level deep (`steps={...}` replaces
    `steps`), so a case reads as what differs."""
    rec = copy.deepcopy(SUCCESS)
    rec.update(copy.deepcopy(changes))
    rec["ok"] = False
    return rec


def verdict(state="COMPLETED", *, outcome=SUCCESS, err="", cancel=False, missing=False, **more):
    return classify(
        slurm_state=state,
        cancel_requested=cancel,
        outcome=outcome,
        stderr_tail=err,
        missing=missing,
        **more,
    )


# ---- success ----------------------------------------------------------------


def test_completed_and_a_successful_record_is_completed():
    v = verdict()
    assert v.status == "COMPLETED"
    assert v.failure is None


# ---- rule 3: SLURM says the script exited, the record decides ---------------


@pytest.mark.parametrize("state", ["COMPLETED", "FAILED", "SPECIAL_EXIT"])
def test_fetch_failed_names_the_files_that_did_not_download(state):
    err = stderr(
        "openghm 0.4.0 commit abc1234",
        "fetching 12 files",
        "failed:",
        "  data/runoff_2000.nc: HTTP 500",
        "  data/runoff_2001.nc: connection reset",
    )
    rec = record(phase="fetch", steps={"fetch": {"exit_code": 1}}, staged=False)
    v = verdict(state, outcome=rec, err=err)
    assert v.status == "FAILED"
    assert v.failure.cause == "fetch_failed"
    assert v.failure.phase == "fetch"
    assert "could not be downloaded" in v.failure.message
    assert v.failure.excerpt.splitlines()[0] == "failed:"
    assert "runoff_2001.nc: connection reset" in v.failure.excerpt
    assert "fetching 12 files" not in v.failure.excerpt


def test_fetch_exit_2_is_a_fetch_failure_with_the_toolkits_message():
    err = stderr("openghm: snapshot id 'x' is not valid")
    rec = record(phase="fetch", steps={"fetch": {"exit_code": 2}}, staged=False)
    v = verdict("FAILED", outcome=rec, err=err)
    assert v.failure.cause == "fetch_failed"
    assert v.failure.excerpt == "openghm: snapshot id 'x' is not valid"


def test_run_refused_before_staging_carries_the_toolkits_reason():
    err = stderr("openghm: the snapshot has no wbm section.")
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}},
                 staged=False, wbm={"log": None, "all_done": False, "markers": [], "tail": []},
                 output={"nc_count": 0, "total_bytes": 0, "file_count": 0, "files": [], "truncated": False})
    v = verdict("FAILED", outcome=rec, err=err)
    assert v.status == "FAILED"
    assert v.failure.cause == "run_refused"
    assert v.failure.phase == "run"
    assert "the snapshot has no wbm section" in v.failure.message
    assert v.failure.excerpt == "openghm: the snapshot has no wbm section."


def test_the_same_exit_code_after_staging_is_a_wbm_error():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}},
                 staged=True,
                 wbm={"log": "wbm_output/x/wbm_test.log", "all_done": False, "markers": [],
                      "tail": ["reading forcing", "died at RIMS/WBM.pm line 771."]})
    v = verdict("FAILED", outcome=rec, err=stderr("container exited 2"))
    assert v.failure.cause == "wbm_error"
    assert v.failure.phase == "run"
    assert "exit code 2" in v.failure.message
    assert v.failure.message.endswith(": container exited 2")
    assert v.failure.excerpt == (
        "container exited 2\n--- last lines of WBM's log ---\n"
        "reading forcing\ndied at RIMS/WBM.pm line 771."
    )


def test_a_wbm_error_without_a_log_falls_back_to_stderr():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 125}},
                 staged=True, wbm={"log": None, "all_done": False, "markers": [], "tail": []})
    v = verdict("FAILED", outcome=rec, err=stderr("apptainer: image not found"))
    assert v.failure.cause == "wbm_error"
    assert v.failure.excerpt == "apptainer: image not found"


# What Anvil job 20976785 left on stderr: the reason WBM stopped is here, not
# in WBM's own log.
REAL_STDERR = (
    "  1000/1542 files\n"
    "dpkg-architecture: warning: cannot determine CC system type, falling back to default (native compilation)\n"
    "\n"
    "Requested file (in read_GDAL)-\n"
    "  /wbm/data/climate/airTemp/2002/MERRA2.T2M.2002-01-01.nc\n"
    "does not exist. Aborting...\n"
)


def test_a_wbm_error_shows_why_wbm_stopped_then_the_end_of_its_log():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}},
                 staged=True,
                 wbm={"log": "x.log", "all_done": False, "markers": [],
                      "tail": [f"File wbm_2001.nc day {i} Balance=0.0" for i in range(40)]})
    v = verdict("FAILED", outcome=rec, err=REAL_STDERR)
    assert v.failure.cause == "wbm_error"
    assert "MERRA2.T2M.2002-01-01.nc does not exist" in v.failure.message
    assert v.failure.message == (
        "WBM stopped with an error (exit code 2): Requested file (in read_GDAL)- "
        "/wbm/data/climate/airTemp/2002/MERRA2.T2M.2002-01-01.nc does not exist. Aborting..."
    )
    ex = v.failure.excerpt
    assert ex.startswith("Requested file")
    assert "--- last lines of WBM's log ---" in ex
    head, log = ex.split("--- last lines of WBM's log ---\n")
    assert "Balance=" in log and len(log.splitlines()) == 15
    assert log.splitlines()[-1] == "File wbm_2001.nc day 39 Balance=0.0"
    assert "1000/1542 files" not in ex
    assert "dpkg-architecture" not in ex


def test_a_silent_failure_gets_the_same_two_part_excerpt():
    rec = record(wbm={"log": "x.log", "all_done": False, "markers": [], "tail": ["a", "b"]})
    v = verdict("COMPLETED", outcome=rec, err=stderr("something on stderr"))
    assert v.failure.cause == "wbm_silent_failure"
    assert v.failure.excerpt == "something on stderr\n--- last lines of WBM's log ---\na\nb"


def test_a_wbm_error_with_nothing_on_stderr_shows_the_log_alone():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}},
                 staged=True, wbm={"log": "x.log", "all_done": False, "markers": [], "tail": ["a", "b"]})
    v = verdict("FAILED", outcome=rec, err=stderr())
    assert v.failure.excerpt == "a\nb"
    assert v.failure.message.startswith("WBM stopped with an error (exit code 2).")


def test_the_reason_in_a_wbm_error_message_is_cut_at_200_characters_keeping_its_end():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}},
                 staged=True, wbm={"log": None, "all_done": False, "markers": [], "tail": []})
    v = verdict("FAILED", outcome=rec, err=stderr("first paragraph", "", "w " * 300))
    reason = v.failure.message.split("): ", 1)[1]
    assert len(reason) <= 200 and reason.startswith("…")
    assert "first paragraph" not in reason


def test_a_wbm_log_does_not_push_the_excerpt_over_8_kb():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}},
                 staged=True, wbm={"log": "x.log", "all_done": False, "markers": [],
                                   "tail": ["z" * 1000 for _ in range(15)]})
    ex = verdict("FAILED", outcome=rec, err=stderr(*[("y" * 400) for _ in range(15)])).failure.excerpt
    assert len(ex.encode()) <= 8 * 1024
    assert ex.startswith("y" * 400)
    assert "--- last lines of WBM's log ---" in ex


def test_wbm_exiting_0_over_a_failure_marker_is_a_silent_failure():
    rec = record(wbm={"log": "x.log", "all_done": False, "markers": ["Failed to warp"],
                      "tail": ["Failed to warp runoff: out of memory"]})
    v = verdict("COMPLETED", outcome=rec)
    assert v.status == "FAILED"
    assert v.failure.cause == "wbm_silent_failure"
    assert v.failure.phase == "check"
    assert "Failed to warp" in v.failure.message
    assert v.failure.excerpt == "Failed to warp runoff: out of memory"


def test_nothing_to_do_is_a_silent_failure_too():
    rec = record(wbm={"log": "x.log", "all_done": False, "markers": ["Nothing to do"], "tail": ["Nothing to do"]})
    v = verdict(outcome=rec)
    assert v.failure.cause == "wbm_silent_failure"
    assert "Nothing to do" in v.failure.message


def test_wbm_exiting_0_without_all_done_is_a_silent_failure():
    rec = record(wbm={"log": "x.log", "all_done": False, "markers": [], "tail": ["step 40 of 366"]})
    v = verdict(outcome=rec)
    assert v.failure.cause == "wbm_silent_failure"
    assert "All Done!" in v.failure.message


def test_a_run_that_wrote_no_nc_files_is_a_silent_failure():
    rec = record(output={"nc_count": 0, "total_bytes": 0, "file_count": 0, "files": [], "truncated": False})
    v = verdict(outcome=rec)
    assert v.failure.cause == "wbm_silent_failure"
    assert ".nc" in v.failure.message


def test_a_marker_outranks_a_missing_all_done_in_the_message():
    rec = record(wbm={"log": "x.log", "all_done": False, "markers": ["Failed to warp"], "tail": []})
    assert "Failed to warp" in verdict(outcome=rec).failure.message


def test_completed_without_a_record_is_outcome_missing():
    v = verdict("COMPLETED", outcome=None, err=stderr("something odd"))
    assert v.status == "FAILED"
    assert v.failure.cause == "outcome_missing"
    assert "without reporting" in v.failure.message
    assert v.failure.excerpt == "something odd"


def test_slurm_failed_without_a_record_is_outcome_missing():
    v = verdict("FAILED", outcome=None)
    assert v.failure.cause == "outcome_missing"


def test_a_step_without_an_exit_code_is_outcome_missing():
    rec = record(phase="run", signal="TERM",
                 steps={"fetch": {"exit_code": 0}, "run": {"exit_code": None}}, staged=False)
    v = verdict("FAILED", outcome=rec)
    assert v.failure.cause == "outcome_missing"
    assert "stopped part-way" in v.failure.message


def test_a_script_that_never_reached_the_run_is_outcome_missing():
    rec = record(phase="fetch", steps={}, staged=False)
    v = verdict("FAILED", outcome=rec)
    assert v.failure.cause == "outcome_missing"
    assert "before it ran" in v.failure.message


def test_a_signal_over_otherwise_good_steps_is_outcome_missing():
    v = verdict("FAILED", outcome=record(signal="HUP"))
    assert v.failure.cause == "outcome_missing"


def test_slurm_failed_over_a_successful_record_is_outcome_missing():
    v = verdict("FAILED", outcome=SUCCESS)
    assert v.status == "FAILED"
    assert v.failure.cause == "outcome_missing"
    assert "FAILED" in v.failure.message and "succeeded" in v.failure.message


def test_a_failing_record_wins_over_a_completed_state():
    rec = record(steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 1}}, staged=True)
    assert verdict("COMPLETED", outcome=rec).failure.cause == "wbm_error"


# ---- rule 2: SLURM killed the job -------------------------------------------


def test_timeout_is_timeout_and_suggests_a_longer_walltime():
    v = verdict("TIMEOUT", outcome=None, err=stderr("slurmstepd: error: *** JOB 1 ON a000 CANCELLED AT 2026-09-30T14:15:00 DUE TO TIME LIMIT ***"))
    assert v.status == "FAILED"
    assert v.failure.cause == "timeout"
    assert "walltime" in v.failure.message and "longer" in v.failure.message
    assert "DUE TO TIME LIMIT" in v.failure.excerpt


def test_out_of_memory_is_out_of_memory():
    v = verdict("OUT_OF_MEMORY", outcome=None)
    assert v.status == "FAILED"
    assert v.failure.cause == "out_of_memory"
    assert "memory" in v.failure.message


@pytest.mark.parametrize("state", ["NODE_FAIL", "BOOT_FAIL", "PREEMPTED", "DEADLINE", "REVOKED"])
def test_a_node_class_failure_is_node_failure_and_not_the_users(state):
    v = verdict(state, outcome=None)
    assert v.status == "FAILED"
    assert v.failure.cause == "node_failure"
    assert state in v.failure.message
    assert "not a problem with your input" in v.failure.message


def test_slurms_kill_wins_over_whatever_the_record_says():
    # The record of a job that was killed is absent or cut short; if one
    # survived saying it failed some other way, SLURM's word still stands.
    rec = record(steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 137}}, staged=True)
    assert verdict("TIMEOUT", outcome=rec).failure.cause == "timeout"
    assert verdict("OUT_OF_MEMORY", outcome=SUCCESS).failure.cause == "out_of_memory"


def test_a_kill_keeps_the_phase_the_record_reached():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": None}})
    assert verdict("TIMEOUT", outcome=rec).failure.phase == "run"
    assert verdict("TIMEOUT", outcome=None).failure.phase is None


# ---- rule 1: cancelled ------------------------------------------------------


def test_cancelled_after_a_request_is_cancelled_by_user():
    v = verdict("CANCELLED", cancel=True, outcome=None)
    assert v.status == "CANCELLED"
    assert v.failure.cause == "cancelled_by_user"
    # It names nobody: the owner and an administrator read the same document.
    assert "cancelled from OpenGHM" in v.failure.message
    assert "You" not in v.failure.message


def test_the_verbose_sacct_form_is_read_as_cancelled():
    v = verdict("CANCELLED by 8013088", cancel=True, outcome=None)
    assert v.status == "CANCELLED" and v.failure.cause == "cancelled_by_user"
    v = verdict("CANCELLED by 0", cancel=False, outcome=None)
    assert v.status == "CANCELLED" and v.failure.cause == "cancelled_by_system"


def test_cancelled_without_a_request_is_cancelled_by_system():
    v = verdict("CANCELLED", cancel=False, outcome=None)
    assert v.status == "CANCELLED"
    assert v.failure.cause == "cancelled_by_system"
    assert "administrator" in v.failure.message


def test_cancelled_outranks_a_record_that_says_it_failed():
    rec = record(steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 143}}, staged=True, signal="TERM")
    assert verdict("CANCELLED", cancel=True, outcome=rec).failure.cause == "cancelled_by_user"


def test_a_cancel_that_came_too_late_leaves_the_real_verdict():
    assert verdict("COMPLETED", cancel=True).status == "COMPLETED"
    assert verdict("TIMEOUT", cancel=True, outcome=None).failure.cause == "timeout"
    rec = record(steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 1}}, staged=True)
    assert verdict("FAILED", cancel=True, outcome=rec).failure.cause == "wbm_error"


# ---- rule 4: SLURM has no record of the job ---------------------------------


def test_missing_without_a_record_is_lost():
    v = verdict(None, outcome=None, missing=True, err=stderr("started"))
    assert v.status == "FAILED"
    assert v.failure.cause == "lost"
    assert "no record" in v.failure.message
    assert v.failure.excerpt == "started"


def test_missing_with_a_successful_record_is_judged_by_it():
    v = verdict(None, outcome=SUCCESS, missing=True)
    assert v.status == "COMPLETED" and v.failure is None


def test_missing_with_a_failing_record_is_judged_by_it():
    rec = record(phase="fetch", steps={"fetch": {"exit_code": 1}}, staged=False)
    v = verdict(None, outcome=rec, missing=True, err=stderr("failed:", "  a.nc: 500"))
    assert v.failure.cause == "fetch_failed"


def test_missing_ignores_whatever_slurm_state_was_last_seen():
    v = verdict("RUNNING", outcome=None, missing=True)
    assert v.failure.cause == "lost"


# ---- excerpts and states ----------------------------------------------------


def test_the_excerpt_starts_after_the_bodys_marker():
    v = verdict("TIMEOUT", outcome=None, err=stderr("first", "second"))
    assert v.failure.excerpt == "first\nsecond"
    assert "Currently Loaded" not in v.failure.excerpt


def test_without_the_marker_the_whole_tail_is_the_excerpt():
    # The body never started (a module error, say): all of it is news.
    v = verdict("FAILED", outcome=None, err="Lmod has detected the following error: no such module\n")
    assert v.failure.excerpt == "Lmod has detected the following error: no such module"


def test_a_timeout_excerpt_leaves_out_the_noise_lines():
    v = verdict("TIMEOUT", outcome=None, err=stderr(
        "  1000/1542 files",
        "dpkg-architecture: warning: cannot determine CC system type, falling back to default",
        "slurmstepd: error: DUE TO TIME LIMIT",
    ))
    assert v.failure.excerpt == "slurmstepd: error: DUE TO TIME LIMIT"


def test_progress_fragments_joined_by_carriage_returns_are_noise_too():
    v = verdict("TIMEOUT", outcome=None,
                err=stderr("  10/1542 files\r  500/1542 files\r  1000/1542 files", "real news"))
    assert v.failure.excerpt == "real news"


def test_blank_runs_collapse_to_one_blank_line():
    v = verdict("TIMEOUT", outcome=None, err=stderr("a", "", "  100/200 files", "", "", "b"))
    assert v.failure.excerpt == "a\n\nb"


def test_the_excerpt_is_the_last_60_lines_and_8_kb():
    many = stderr(*[f"line {i}" for i in range(200)])
    lines = verdict("FAILED", outcome=None, err=many).failure.excerpt.splitlines()
    assert len(lines) == 60 and lines[-1] == "line 199"
    wide = stderr(*[("y" * 400) for _ in range(50)])
    assert len(verdict("FAILED", outcome=None, err=wide).failure.excerpt.encode()) <= 8 * 1024


def test_an_empty_stderr_leaves_no_excerpt():
    assert verdict("TIMEOUT", outcome=None, err="").failure.excerpt is None
    assert verdict("TIMEOUT", outcome=None, err="\n\n").failure.excerpt is None


@pytest.mark.parametrize("state", ["RUNNING", "PENDING", "", None, "WHATEVER"])
def test_a_job_that_is_not_over_has_no_verdict(state):
    with pytest.raises(ValueError):
        verdict(state, outcome=None)


def test_a_garbled_record_is_no_record():
    assert verdict("COMPLETED", outcome=["not", "a", "dict"]).failure.cause == "outcome_missing"


# ---- the markers WBM prints to stderr (mission 2026-10-06) --------------------


STDERR_WARP = (
    "\nFailed to warp /anvil/scratch/x-openghm/model_input/precip_2001.nc\n"
    "\tFork code   = 9\n\tErrors      = No errors reported. Most likely the system is out of memory...\n"
)


@pytest.mark.parametrize("state", ["COMPLETED", "FAILED"])
def test_failed_to_warp_on_stderr_is_a_silent_failure_though_the_log_has_no_marker(state):
    """WBM prints it to stderr (WBM.pm) and exits 0; the record's markers come from
    the log alone, and the log here is a clean run: the line is only in the tail."""
    assert SUCCESS["wbm"]["markers"] == [] and SUCCESS["wbm"]["all_done"] is True
    v = verdict(state, err=STDERR_WARP)
    assert v.status == "FAILED"
    assert v.failure.cause == "wbm_silent_failure"
    assert v.failure.phase == "check"
    assert 'says "Failed to warp"' in v.failure.message
    assert "precip_2001.nc" in v.failure.excerpt


def test_nothing_to_do_on_stderr_counts_too():
    v = verdict(err=stderr("Destination dataset is up to date! Nothing to do..."))
    assert v.failure.cause == "wbm_silent_failure"
    assert "Nothing to do" in v.failure.message


def test_a_clean_stderr_leaves_a_clean_record_completed():
    assert verdict(err=stderr("spool: downloaded 3 days, linked 0")).status == "COMPLETED"


def test_a_failing_exit_code_still_outranks_a_marker_on_stderr():
    rec = record(steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 1}}, staged=True)
    assert verdict("FAILED", outcome=rec, err=STDERR_WARP).failure.cause == "wbm_error"


# ---- the reason in a wbm_error ------------------------------------------------


def test_spool_lines_do_not_crowd_out_wbms_reason():
    spool = "\n".join(f"spool: variant {i} in /anvil/scratch/x-openghm/cache/spool/{i}" for i in range(6))
    err = spool + "\nRequested file (in read_GDAL)- /wbm/x.nc does not exist. Aborting...\n"
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}}, staged=True,
                 wbm={"log": None, "all_done": False, "markers": [], "tail": []})
    v = verdict("FAILED", outcome=rec, err=err)
    assert v.failure.message == (
        "WBM stopped with an error (exit code 2): Requested file (in read_GDAL)- "
        "/wbm/x.nc does not exist. Aborting..."
    )
    assert "spool: variant 0" in v.failure.excerpt  # the excerpt keeps everything


def test_the_toolkits_warnings_are_not_a_reason_either():
    err = stderr("container died", "openghm: warning: could not record the exit code in simulation.json: x")
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}}, staged=True,
                 wbm={"log": None, "all_done": False, "markers": [], "tail": []})
    assert verdict("FAILED", outcome=rec, err=err).failure.message.endswith(": container died")


def test_a_reason_longer_than_200_characters_keeps_its_end():
    reason = "start " + "middle " * 60 + "the real reason: disk full"
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}}, staged=True,
                 wbm={"log": None, "all_done": False, "markers": [], "tail": []})
    shown = verdict("FAILED", outcome=rec, err=stderr(reason)).failure.message.split("): ", 1)[1]
    assert shown.endswith("the real reason: disk full")
    assert shown.startswith("…") and len(shown) <= 200 and "start" not in shown


# ---- a record of the wrong shape is no record (classify is total) ---------------


@pytest.mark.parametrize(
    "changes",
    [
        {"steps": ["fetch", "run"]},
        {"steps": "none"},
        {"steps": {"fetch": [0], "run": {"exit_code": 0}}},
        {"steps": {"fetch": {"exit_code": "0"}, "run": {"exit_code": 0}}},
        {"steps": {"fetch": {"exit_code": True}, "run": {"exit_code": 0}}},
        {"wbm": ["All Done!"]},
        {"wbm": {"all_done": True, "markers": "Failed to warp", "tail": []}},
        {"wbm": {"all_done": True, "markers": [], "tail": "All Done!"}},
        {"output": [1, 2]},
        {"output": 7},
    ],
)
@pytest.mark.parametrize("state", ["COMPLETED", "FAILED"])
def test_a_record_of_the_wrong_shape_is_outcome_missing_not_an_exception(changes, state):
    rec = copy.deepcopy(SUCCESS)
    rec.update(copy.deepcopy(changes))
    v = verdict(state, outcome=rec, err=stderr("something"))
    assert v.status == "FAILED"
    assert v.failure.cause == "outcome_missing"
    assert "cannot read" in v.failure.message
    assert v.failure.excerpt == "something"


def test_a_malformed_record_of_a_job_slurm_forgot_is_outcome_missing_too():
    v = verdict(None, outcome={"steps": []}, missing=True)
    assert v.failure.cause == "outcome_missing"


# ---- messages that name the lever -------------------------------------------------


def test_out_of_memory_says_to_add_cores_or_shorten_the_run():
    msg = verdict("OUT_OF_MEMORY", outcome=None).failure.message
    assert "more cores" in msg and "1.9 GB" in msg and "shorter run period" in msg


def test_a_timeout_while_fetching_is_worded_for_the_fetch():
    rec = record(phase="fetch", signal="TERM", steps={"fetch": {"exit_code": None}}, staged=False)
    v = verdict("TIMEOUT", outcome=rec, walltime_seconds=4 * 3600)
    assert v.failure.cause == "timeout" and v.failure.phase == "fetch"
    assert "while it was still fetching the snapshot" in v.failure.message
    assert "before WBM finished" not in v.failure.message


def test_a_timeout_in_the_run_says_it_ended_before_wbm_finished():
    rec = record(phase="run", signal="TERM", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": None}})
    msg = verdict("TIMEOUT", outcome=rec, walltime_seconds=6 * 3600).failure.message
    assert "before WBM finished" in msg
    assert "longer walltime (up to 96 h)" in msg and "shorter run period" in msg


def test_a_timeout_at_the_96_hour_limit_says_to_shorten_the_period_not_to_ask_for_more():
    msg = verdict("TIMEOUT", outcome=None, walltime_seconds=96 * 3600).failure.message
    assert "already the 96 h maximum" in msg and "Shorten the run period" in msg
    assert "longer walltime" not in msg


def test_a_timeout_whose_walltime_is_unknown_offers_both_levers():
    msg = verdict("TIMEOUT", outcome=None).failure.message
    assert "longer walltime" in msg and "shorter run period" in msg


@pytest.mark.parametrize("code", [64, 66, 69, 78])
def test_a_fetch_exit_in_the_sysexits_range_is_the_gateways_anvil_setup(code):
    rec = record(phase="fetch", steps={"fetch": {"exit_code": code}}, staged=False)
    v = verdict("FAILED", outcome=rec, err=stderr("flock: cannot open lock file /home/x/locks/fetch.lock"))
    assert v.failure.cause == "fetch_failed"
    msg = v.failure.message
    assert "Anvil setup is broken" in msg and "administrator" in msg and f"exit code {code}" in msg
    assert "could not be downloaded" not in msg
    assert "flock: cannot open lock file" in v.failure.excerpt


@pytest.mark.parametrize("code", [1, 2, 63, 79, 137])
def test_other_fetch_exits_stay_a_download_failure(code):
    rec = record(phase="fetch", steps={"fetch": {"exit_code": code}}, staged=False)
    assert "could not be downloaded" in verdict("FAILED", outcome=rec).failure.message


def test_a_sim_run_failure_with_no_openghm_line_does_not_blame_the_settings():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 1}}, staged=False,
                 wbm={"log": None, "all_done": False, "markers": [], "tail": []})
    err = stderr("Traceback (most recent call last):", '  File "x.py", line 1, in <module>', "KeyError: 'a'")
    v = verdict("FAILED", outcome=rec, err=err)
    assert v.failure.cause == "run_refused"
    assert "settings" not in v.failure.message
    assert "stopped before the simulation started (exit code 1)" in v.failure.message
    assert "KeyError" in v.failure.excerpt


def test_a_sim_run_refusal_with_a_reason_still_points_at_the_settings():
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}}, staged=False)
    msg = verdict("FAILED", outcome=rec, err=stderr("openghm: no wbm section.")).failure.message
    assert "no wbm section" in msg and "Check the snapshot's settings" in msg


@pytest.mark.parametrize("code", [137, 247])
def test_a_killed_container_under_failed_says_killed_probably_out_of_memory(code):
    rec = record(phase="run", steps={"fetch": {"exit_code": 0}, "run": {"exit_code": code}}, staged=True,
                 wbm={"log": None, "all_done": False, "markers": [], "tail": []})
    v = verdict("FAILED", outcome=rec)
    assert v.failure.cause == "wbm_error"
    assert f"killed (exit code {code})" in v.failure.message
    assert "ran out of memory" in v.failure.message and "more cores" in v.failure.message


@pytest.mark.parametrize("code, killed", [("137:0", True), ("247:0", True), ("0:9", True), ("1:0", False), ("", False), (None, False)])
def test_a_failed_job_with_no_record_and_a_kill_exit_code_is_probably_out_of_memory(code, killed):
    v = verdict("FAILED", outcome=None, slurm_exit_code=code)
    assert v.failure.cause == "outcome_missing"
    assert ("ran out of memory" in v.failure.message and "more cores" in v.failure.message) is killed


def test_a_completed_job_is_not_called_killed_by_its_exit_code():
    assert "memory" not in verdict("COMPLETED", outcome=None, slurm_exit_code="0:9").failure.message
