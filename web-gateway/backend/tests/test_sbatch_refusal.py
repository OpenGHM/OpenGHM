"""`sbatch_refusal.explain`: SLURM's refusal reasons in plain English, with
SLURM's own words after them."""

from __future__ import annotations

import pytest

from app.services.sbatch_refusal import _REASONS, explain, sentence

# What a user was shown on 2026-10-02 for a 167:15:00 request.
REAL = (
    "QOSMaxWallDurationPerJobLimit sbatch: error: Batch job submission failed: "
    "Job violates accounting/QOS policy (job submit limit, user's size and/or time limits)"
)


def test_the_real_run_time_refusal_is_explained_and_kept():
    message = explain(REAL)
    assert message == (
        "Anvil refused the requested run time: it is over the limit for one job (96 h). "
        "Shorten the run period or set a shorter walltime. SLURM said: "
        "QOSMaxWallDurationPerJobLimit sbatch: error: Batch job submission failed: "
        "Job violates accounting/QOS policy (job submit limit, user's size and/or time limits)."
    )


@pytest.mark.parametrize(
    "code, starts",
    [
        ("QOSMaxWallDurationPerJobLimit", "Anvil refused the requested run time"),
        ("QOSMaxCpuPerJobLimit", "Anvil refused the requested number of cores"),
        ("QOSMaxCPUsPerUserLimit", "Anvil refused the requested number of cores"),
        ("QOSMaxSubmitJobPerUserLimit", "Anvil refused the job because too many jobs"),
        ("QOSMaxJobsPerUserLimit", "Anvil refused the job because too many jobs"),
        ("AssocGrpCPUMinutesLimit", "The allocation's compute-time budget is used up"),
        ("AssocGrpBillingMinutes", "The allocation's compute-time budget is used up"),
        ("AssocGrpCPURunMinutesLimit", "The allocation's compute-time budget is used up"),
    ],
)
def test_each_known_reason_is_explained(code, starts):
    message = explain(f"sbatch: error: Batch job submission failed: Job violates policy\n{code}")
    assert message.startswith(starts)
    assert f"SLURM said: sbatch: error: Batch job submission failed: Job violates policy {code}" in message


def test_the_reason_may_be_in_text_that_is_not_shown():
    message = explain("sbatch: error: Batch job submission failed", also="x\nQOSMaxCpuPerJobLimit")
    assert message.startswith("Anvil refused the requested number of cores")
    assert "QOSMaxCpuPerJobLimit" not in message


def test_a_code_inside_a_longer_word_is_not_a_reason():
    text = "sbatch: error: MyQOSMaxWallDurationPerJobLimitX"
    assert explain(text) == f"SLURM refused the job: {text}."


def test_an_unknown_refusal_is_shown_as_slurm_wrote_it_and_ends_in_a_full_stop():
    text = "sbatch: error: Batch job submission failed: Invalid account"
    assert explain(text) == f"SLURM refused the job: {text}."
    assert explain(text + ".") == f"SLURM refused the job: {text}."
    # cut at 500 characters, and the cut is marked
    assert explain("x" * 900) == "SLURM refused the job: " + "x" * 499 + "…"


def test_every_message_ends_in_a_full_stop_so_another_sentence_can_follow():
    for text in (
        "sbatch: error: Batch job submission failed: Requested node configuration is not available",
        "sbatch: error: Invalid account",
        "sbatch: error: Batch job submission failed: Job violates policy QOSMaxWallDurationPerJobLimit",
        "x" * 900,
        "",
    ):
        assert explain(text).endswith((".", "…")), text
    assert explain("") == "SLURM refused the job."
    assert sentence("no stop") == "no stop."
    assert sentence("stop.") == "stop."
    assert sentence("really?") == "really?"


def test_only_the_first_lines_are_quoted_and_paths_are_left_out():
    detail = (
        "QOSMaxWallDurationPerJobLimit\n"
        "sbatch: error: could not write /anvil/scratch/x-openghm/openghm/slurmly-1/run.sh\n"
        "second\nthird line is not quoted"
    )
    message = explain(detail)
    assert "<path>" in message and "/anvil" not in message
    assert "second" in message and "third line" not in message


def test_a_long_text_is_cut():
    message = explain("QOSMaxWallDurationPerJobLimit " + "word " * 200)
    assert len(message) < 600 and "…" in message


def test_nothing_to_quote_is_just_the_explanation():
    assert explain("", also="QOSMaxWallDurationPerJobLimit").endswith("shorter walltime.")


# ---- without advice (a page that gives its own instruction) --------------------


@pytest.mark.parametrize("codes, what, advice", _REASONS, ids=[codes[0] for codes, _, _ in _REASONS])
def test_without_advice_a_known_refusal_says_what_was_refused_and_no_instruction(codes, what, advice):
    detail = f"sbatch: error: Batch job submission failed: Job violates policy\n{codes[0]}"
    message = explain(detail, advice=False)
    assert message.startswith(what)
    assert advice not in message
    assert message == f"{what} SLURM said: sbatch: error: Batch job submission failed: Job violates policy {codes[0]}."
    # the default still carries it, after what was refused
    assert explain(detail).startswith(f"{what} {advice} SLURM said: ")


def test_without_advice_no_known_refusal_names_a_thing_to_change():
    for codes, _, _ in _REASONS:
        message = explain(f"sbatch: error: {codes[0]}", advice=False)
        for word in ("Shorten", "walltime", "Set fewer", "Wait for", "submit again", "Contact"):
            assert word not in message, (codes[0], word)


def test_without_advice_the_run_time_refusal_is_the_first_sentence_alone():
    assert explain(REAL, advice=False) == (
        "Anvil refused the requested run time: it is over the limit for one job (96 h). SLURM said: "
        "QOSMaxWallDurationPerJobLimit sbatch: error: Batch job submission failed: "
        "Job violates accounting/QOS policy (job submit limit, user's size and/or time limits)."
    )
    assert explain("", also="QOSMaxWallDurationPerJobLimit", advice=False).endswith("(96 h).")


def test_advice_does_not_change_an_unknown_refusal():
    text = "sbatch: error: Batch job submission failed: Invalid account"
    assert explain(text, advice=False) == explain(text) == f"SLURM refused the job: {text}."
