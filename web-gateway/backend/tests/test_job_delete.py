"""DELETE /jobs/{id} (ADR 0026, mission
2026-09-30-every-job-ends-with-a-verdict): a draft goes at once; a finished
snapshot draft takes both its directories on Anvil with it, and only those; an
active one is refused; and whatever goes wrong on Anvil, the document stays.

The route runs against the in-memory Mongo and slurmly's real client over a
fake transport, so the exact remote commands are asserted.
"""

from __future__ import annotations

import pytest
from slurmly.exceptions import SSHTransportError

from app.api.v1 import jobs as jobs_router
from app.services import slurm

from conftest import REMOTE_BASE
from route_helpers import OUTPUT_BASE, make_job, make_sent_job, make_user, token_for

OWNER = "owner"
HEADERS = token_for(OWNER)
DELETE = "/api/v1/jobs/job-1"
DIR = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d"
WORK = f"{OUTPUT_BASE}/sim-job-1"
# What the two removals are, as bash receives them (`shlex.quote` leaves a path
# of these characters bare).
RM_WORK = f"[ -L {WORK} ] && exit 3; rm -rf -- {WORK}"
RM_DIR = f"rm -rf -- {DIR}"


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


def _finished(db, status="COMPLETED", **extra):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, status, files="present", **extra)


# ---- what is removed ---------------------------------------------------------


def test_a_draft_is_deleted_without_touching_anvil(client, db, anvil):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert "job-1" not in db.jobs.docs
    assert anvil.commands == []


@pytest.mark.parametrize("status", ["COMPLETED", "FAILED", "CANCELLED"])
def test_a_finished_job_takes_both_directories_with_it(client, db, anvil, status):
    _finished(db, status)
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert anvil.commands == [RM_WORK, RM_DIR]
    assert "job-1" not in db.jobs.docs
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_deleted"]
    assert event["actor_id"] == OWNER and event["target_id"] == "job-1"
    assert event["detail"]["removed"] == [WORK, DIR]
    assert event["detail"]["status"] == status


def test_the_removals_are_retry_safe(client, db, anvil):
    _finished(db)
    client.delete(DELETE, headers=HEADERS)
    assert [call.retry_safe for call in anvil.transport.runs] == [True, True]


def test_a_purged_job_skips_anvil_and_is_deleted(client, db, anvil):
    _finished(db)
    db.jobs.docs["job-1"]["files"] = "purged"
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert anvil.commands == []
    assert "job-1" not in db.jobs.docs


def test_a_job_that_recorded_no_directories_is_deleted(client, db, anvil):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "FAILED")
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert anvil.commands == []


def test_only_the_slurmly_directory_when_that_is_all_there_is(client, db, anvil):
    _finished(db, work_dir=None)
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert anvil.commands == [RM_DIR]


# ---- what is never removed ---------------------------------------------------


def _refused(client, db):
    response = client.delete(DELETE, headers=HEADERS)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "refused_path"
    assert "job-1" in db.jobs.docs


@pytest.mark.parametrize(
    "work_dir",
    [
        "/anvil/scratch/x-openghm/cache",  # a shared cache
        "/anvil/scratch/x-openghm/simulations",  # the whole output base
        f"{OUTPUT_BASE}/sim-someone-else",  # another run's
        f"{OUTPUT_BASE}/sim-job-1/wbm_output",  # inside this one
        f"{OUTPUT_BASE}/../cache/sim-job-1",
        f"{OUTPUT_BASE}/sim-job-1/",
        "/home/x-openghm",
        "/",
        "sim-job-1",
    ],
)
def test_a_work_dir_that_is_not_exactly_this_runs_is_refused_and_nothing_is_removed(
    client, db, anvil, work_dir
):
    _finished(db, work_dir=work_dir)
    _refused(client, db)
    assert anvil.commands == []  # not even the slurmly directory, which was fine


@pytest.mark.parametrize("sim_id", ["../cache", "a b", "-rf", "sim-job-1; rm -rf ~", ""])
def test_a_sim_id_that_cannot_name_a_directory_is_refused(client, db, anvil, sim_id):
    _finished(db, sim_id=sim_id, work_dir=f"{OUTPUT_BASE}/{sim_id}")
    _refused(client, db)
    assert anvil.commands == []


@pytest.mark.parametrize(
    "remote_job_dir",
    [
        f"{REMOTE_BASE}/jobs",  # the jobs root
        f"{REMOTE_BASE}/jobs/",
        f"{REMOTE_BASE}/jobs/../cache/slurmly-1a2b3c4d",
        f"{REMOTE_BASE}/other/slurmly-1a2b3c4d",
        f"{REMOTE_BASE}/jobs/not-a-slurmly-dir",
        "/anvil/scratch/x-openghm/cache",
        "/",
    ],
)
def test_a_slurmly_directory_outside_the_jobs_root_is_refused(client, db, anvil, remote_job_dir):
    _finished(db, remote_job_dir=remote_job_dir)
    _refused(client, db)
    assert anvil.commands == []


def test_the_command_refuses_a_symlink_and_the_refusal_keeps_everything(client, db, anvil):
    _finished(db)
    assert RM_WORK.index("[ -L") < RM_WORK.index("rm -rf")  # the test comes first
    anvil.results.append((lambda c: "[ -L" in c, (3, "", "")))  # what the test finds
    _refused(client, db)
    assert anvil.commands == [RM_WORK]  # the slurmly directory is not reached


# ---- an active job -----------------------------------------------------------


@pytest.mark.parametrize("status", ["SUBMITTED", "PENDING", "RUNNING", "COMPLETING"])
def test_an_active_job_must_be_cancelled_first(client, db, anvil, status):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, status)
    response = client.delete(DELETE, headers=HEADERS)
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "job_active",
        "message": "Cancel the simulation before deleting this snapshot draft.",
    }
    assert "job-1" in db.jobs.docs
    assert anvil.commands == []


# ---- Anvil says no -----------------------------------------------------------


def test_an_unreachable_anvil_keeps_the_document(client, db, anvil):
    _finished(db)
    anvil.results.append((lambda c: True, SSHTransportError("connection reset by 149.165.1.1")))
    response = client.delete(DELETE, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "anvil_unreachable"
    assert "149.165" not in response.text
    assert "job-1" in db.jobs.docs
    assert "job_deleted" not in [e["action"] for e in db.audit_events.docs.values()]


def test_a_failed_work_dir_removal_is_502_and_keeps_the_document(client, db, anvil):
    _finished(db)
    anvil.results.append((lambda c: c == RM_WORK, (1, "", "rm: cannot remove: Permission denied")))
    response = client.delete(DELETE, headers=HEADERS)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "cleanup_failed"
    assert "job-1" in db.jobs.docs
    assert anvil.commands == [RM_WORK]


def test_a_failed_slurmly_directory_removal_is_502_and_keeps_the_document(client, db, anvil):
    _finished(db)
    anvil.results.append((lambda c: c == RM_DIR, (1, "", "rm: Permission denied")))
    response = client.delete(DELETE, headers=HEADERS)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "cleanup_failed"
    assert "job-1" in db.jobs.docs
    # The work directory is already gone; a retry removes it again, harmlessly.
    assert anvil.commands == [RM_WORK, RM_DIR]


def test_a_retry_after_a_failure_succeeds(client, db, anvil):
    _finished(db)
    anvil.results.append((lambda c: c == RM_DIR, (1, "", "busy")))
    assert client.delete(DELETE, headers=HEADERS).status_code == 502
    anvil.results.clear()
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert "job-1" not in db.jobs.docs


def test_someone_elses_job_is_a_404_and_nothing_is_removed(client, db, anvil):
    _finished(db)
    db.users.docs["other"] = make_user("other", can_run_simulations=True)
    assert client.delete(DELETE, headers=token_for("other")).status_code == 404
    assert anvil.commands == [] and "job-1" in db.jobs.docs


# ---- mission 2026-10-06: orphans, and a delete that deleted nothing ----------


def _draft_with_orphans(db, *names):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    db.jobs.docs["job-1"]["orphan_sim_ids"] = list(names)


def test_deleting_a_draft_scancels_its_orphans_by_name_first(client, db):
    _draft_with_orphans(db, "sim-20260930-aaaaaa", "sim-20260930-bbbbbb")
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert db.cleanup_calls == [
        ("scancel_by_name", "sim-20260930-aaaaaa"),
        ("scancel_by_name", "sim-20260930-bbbbbb"),
    ]
    assert "job-1" not in db.jobs.docs


def test_a_draft_whose_orphan_cannot_be_cancelled_is_not_deleted(client, db, monkeypatch):
    """The document is the only place the name is kept: deleting it would leave
    a job on Anvil that nothing will ever cancel."""
    _draft_with_orphans(db, "sim-20260930-aaaaaa", "sim-20260930-bbbbbb")

    async def scancel_by_name(sim_id):
        return sim_id != "sim-20260930-bbbbbb"

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    response = client.delete(DELETE, headers=HEADERS)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "orphan_cancel_failed"
    assert "nothing was deleted" in response.json()["detail"]["message"]
    # The one that worked is not asked again; the one that did not is kept.
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == ["sim-20260930-bbbbbb"]
    assert "job_deleted" not in [e["action"] for e in db.audit_events.docs.values()]


def test_a_scancel_that_raises_refuses_the_delete_too(client, db, monkeypatch):
    _draft_with_orphans(db, "sim-20260930-aaaaaa")

    async def scancel_by_name(sim_id):
        raise SSHTransportError("down")

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    assert client.delete(DELETE, headers=HEADERS).status_code == 409
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == ["sim-20260930-aaaaaa"]


def test_a_retry_once_anvil_answers_deletes(client, db, monkeypatch):
    _draft_with_orphans(db, "sim-20260930-aaaaaa")
    answers = iter([False, True])

    async def scancel_by_name(sim_id):
        return next(answers)

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    assert client.delete(DELETE, headers=HEADERS).status_code == 409
    assert client.delete(DELETE, headers=HEADERS).status_code == 204


def test_a_finished_job_with_an_orphan_cancels_it_before_its_files_are_removed(client, db, anvil):
    _finished(db, "CANCELLED", orphan_sim_ids=["sim-20260930-aaaaaa"])
    assert client.delete(DELETE, headers=HEADERS).status_code == 204
    assert db.cleanup_calls == [("scancel_by_name", "sim-20260930-aaaaaa")]
    assert anvil.commands == [RM_WORK, RM_DIR]


def test_a_finished_job_whose_orphan_cannot_be_cancelled_keeps_its_files_too(client, db, anvil, monkeypatch):
    _finished(db, "CANCELLED", orphan_sim_ids=["sim-20260930-aaaaaa"])

    async def scancel_by_name(sim_id):
        return False

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    assert client.delete(DELETE, headers=HEADERS).status_code == 409
    assert anvil.commands == []
    assert "job-1" in db.jobs.docs


def test_a_draft_claimed_by_a_submit_meanwhile_is_not_deleted_and_not_audited(client, db, monkeypatch):
    """The delete read a DRAFT; a submit claimed it before the conditional
    delete: nothing was deleted, so 204 and a `job_deleted` event would lie."""
    stale = make_job("job-1", OWNER, "DRAFT")
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "SUBMITTED")

    async def read_before_the_claim(job_id, user, escalated):
        return stale

    monkeypatch.setattr(jobs_router, "_get_job_for", read_before_the_claim)
    response = client.delete(DELETE, headers=HEADERS)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "job_changed"
    assert "job-1" in db.jobs.docs
    assert "job_deleted" not in [e["action"] for e in db.audit_events.docs.values()]
