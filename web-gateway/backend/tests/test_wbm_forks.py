"""A draft edits a data `.init` as its own copy (mission 2026-10-24-data-init-forks, ADR 0039): the
name of the copy, what a save and a submit refuse, the changes file a submit writes (`forks` and the
field's key pointed at the copy), the checks before a submit seeing the copy's `Units`, and the
repaired candidates of a module being switched on.

The snapshots are the v2 tutorial (23.9.0, model input 52585562) and the Wyoming snapshot (22.1.1);
the model inputs are the recorded ones (`tests/s3_fake.py`).
"""

from __future__ import annotations

import asyncio
import re

import pytest

from app.models.job import DatasetFork, JobParameters
from app.services import job_script, model_parameters
from app.wbm_init import cross_rules, forks, model_input, tree, validate

from route_helpers import changes_in
from test_job_checks import (  # noqa: F401  (fixtures shared with the checks tests)
    HEADERS,
    JOB,
    SUBMIT,
    api,
    ask,
    bucket,
    make_draft,
    owner,
    sent,
    snapshots,
)
from test_wbm_cross_rules import snapshot_of
from test_wbm_switch_on import glacier_1980, one_grid  # noqa: F401  (autouse: Glaciers can be switched on)
from s3_fake import MODEL_INPUTS

PRECIP = "MT_Precip.Primary"
PRECIP_INIT = "/wbm/data/climate/precip/merra2_prectotcorr_d.init"
AIR_T = "MT_airT.Primary"
AIR_T_INIT = "/wbm/data/climate/airTemp/merra2_t2m_d.init"
IRR = "/wbm/data_init/irrigation/irrEfficiency.init"
AREA = "/wbm/data_init/glaciers/global_rgi6_glaciers_area_1km.init"
MELT = "/wbm/data_init/glaciers/glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m.init"
GLACIERS_ON = {"Glaciers.glMelt": MELT, "Glaciers.glArea": AREA}


def run(coro):
    return asyncio.run(coro)


def fork(set_=None, path=PRECIP, original=PRECIP_INIT) -> DatasetFork:
    return DatasetFork(path=path, original=original, set=set_ or {})


@pytest.fixture
def v2():
    _, _, loaded = snapshot_of("v2")
    return loaded


def check(v2, forks_, custom=None) -> dict[str, str]:
    return forks.validate(forks_, custom or {}, v2.resolved, v2.values)


# ---- the copy's name ---------------------------------------------------------------------------


def test_the_copy_is_named_for_the_original_and_a_hash_of_what_is_set():
    name = forks.copy_path(PRECIP_INIT, {"Var_Scale": "1.1"})
    assert re.fullmatch(r"/wbm/wbm_init/datasets/merra2_prectotcorr_d__[0-9a-f]{8}\.init", name)
    # the toolkit's own rule for a `to`
    assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.init", name.rsplit("/", 1)[1])


def test_the_same_edit_gives_the_same_name_and_another_value_another():
    one = forks.copy_path(PRECIP_INIT, {"Var_Scale": "1.1", "Units": "mm/day"})
    assert forks.copy_path(PRECIP_INIT, {"Units": "mm/day", "Var_Scale": "1.1"}) == one  # order does not matter
    assert forks.copy_path(PRECIP_INIT, {"Var_Scale": "1.10", "Units": "mm/day"}) == one  # 1.10 is 1.1
    assert forks.copy_path(PRECIP_INIT, {"Var_Scale": "1.2", "Units": "mm/day"}) != one
    assert forks.copy_path(PRECIP_INIT, {"Var_Scale": "1.1"}) != one  # fewer values
    assert forks.copy_path(AIR_T_INIT, {"Var_Scale": "1.1", "Units": "mm/day"}) != one  # another original
    assert forks.copy_path(PRECIP_INIT, {}) != forks.copy_path(PRECIP_INIT, {"Var_Offset": "0"})


def test_a_copy_of_the_same_thing_for_two_fields_is_one_entry_of_the_changes_file(v2):
    twice = [fork({"Var_Scale": "1.1"}), fork({"Var_Scale": "1.1"}, path="MT_Precip.Secondary")]
    entries, repoint = forks.plan(twice, v2.resolved, v2.values)
    assert len(entries) == 1
    (entry,) = entries
    assert entry == {"from": PRECIP_INIT, "to": forks.copy_path(PRECIP_INIT, {"Var_Scale": "1.1"}), "set": {"Var_Scale": 1.1}}
    assert repoint == {PRECIP: entry["to"], "MT_Precip.Secondary": entry["to"]}


def test_the_values_are_typed_numbers_for_the_scale_and_the_offset_and_text_for_the_units():
    assert forks.typed_set({"Units": "mm/day", "Var_Offset": "-2", "Var_Scale": "1e-5"}) == {
        "Units": "mm/day", "Var_Offset": -2.0, "Var_Scale": 1e-05,
    }


# ---- what a save refuses -------------------------------------------------------------------------


def test_a_fork_of_the_precipitation_dataset_is_accepted(v2):
    assert check(v2, [fork({"Var_Scale": "1.1", "Var_Offset": "0.5", "Units": "mm/day"}), fork(path=AIR_T, original=AIR_T_INIT)]) == {}
    assert check(v2, []) == {}


def test_only_the_scale_the_offset_and_the_units_can_be_set_and_the_message_is_at_the_field(v2):
    for key in ("Code_Name", "Start_Date", "End_Date", "File_Path", "Time_Series"):
        errors = check(v2, [fork({key: "x"})])
        assert list(errors) == [PRECIP], key
        assert f"{key} cannot be edited here" in errors[PRECIP]
    # several keys: the first that is not allowed is said at the field, once
    assert list(check(v2, [fork({"Var_Scale": "2", "Name": "x", "Round": "%.3f"})])) == [PRECIP]


@pytest.mark.parametrize("value", [".5", "abc", "1,5", "1e", "", "  ", "1e999", "nan", "inf"])
def test_a_scale_and_an_offset_are_numbers_in_wbms_form(v2, value):
    for key in ("Var_Scale", "Var_Offset"):
        assert list(check(v2, [fork({key: value})])) == [PRECIP], (key, value)


def test_a_scale_of_zero_is_refused_because_wbm_reads_it_as_one(v2):
    assert "reads a Var_Scale of 0 as 1" in check(v2, [fork({"Var_Scale": "0"})])[PRECIP]
    assert check(v2, [fork({"Var_Offset": "0"})]) == {}


def test_the_units_are_one_ascii_line(v2):
    assert check(v2, [fork({"Units": "mm/day"})]) == {}
    assert "ASCII" in check(v2, [fork({"Units": "mm/jouré"})])[PRECIP]
    assert "single line" in check(v2, [fork({"Units": "mm\nday"})])[PRECIP]
    assert "needs a value" in check(v2, [fork({"Units": ""})])[PRECIP]
    assert "too long" in check(v2, [fork({"Units": "m" * 300})])[PRECIP]


def test_the_original_is_the_dataset_the_field_reads(v2):
    errors = check(v2, [fork(original=AIR_T_INIT)])
    assert errors == {PRECIP: f"The original must be the dataset this field reads: {PRECIP_INIT}."}
    # a data init under /wbm/data_init/ is as good as one under /wbm/data/, once the field reads it


def test_a_field_that_holds_a_constant_is_not_forked(v2):
    # `Impervious` takes a constant: chosen as one, there is no dataset to copy
    assert "constant number" in check(v2, [fork(path="Impervious", original=AREA)], {"Impervious": "0.2"})["Impervious"]
    # a field the init has no value for has none either
    assert "no dataset to copy" in check(v2, [fork(path="MT_Precip.Secondary")])["MT_Precip.Secondary"]


def test_a_field_that_does_not_take_a_data_init_or_is_not_a_field_is_refused(v2):
    assert "not a field" in check(v2, [fork(path="Nowhere.Primary")])["Nowhere.Primary"]
    assert "does not read a data .init" in check(v2, [fork(path="MT_Precip.Scale", original=PRECIP_INIT)])["MT_Precip.Scale"]


def test_a_field_has_at_most_one_copy(v2):
    errors = check(v2, [fork({"Var_Scale": "1.1"}), fork({"Var_Scale": "1.2"})])
    assert errors == {PRECIP: "A field has at most one copy of its dataset."}


def test_the_original_must_be_a_name_a_copy_can_be_made_from(v2):
    # the field reads something else than a data init directly
    raster = "/wbm/data/climate/precip/x.tif"
    assert "does not name a data .init" in check(v2, [fork(original=raster)], {PRECIP: raster})[PRECIP]


def test_a_module_that_is_off_has_no_dataset_to_copy_until_the_draft_chooses_one(v2):
    glaciers = fork(path="Glaciers.glArea", original=AREA)
    assert "module is off" in check(v2, [glaciers])["Glaciers.glArea"]
    assert check(v2, [glaciers], GLACIERS_ON) == {}
    # chosen, but the fork is of another dataset than the one chosen
    assert "must be the dataset this field reads" in check(v2, [fork(path="Glaciers.glArea", original=MELT)], GLACIERS_ON)["Glaciers.glArea"]


def test_a_module_switched_off_in_the_same_save_has_no_copy(v2):
    # `openWaterEvap` is on in v2, and is itself a dataset
    assert "being switched off" in check(v2, [fork(path="openWaterEvap", original=PRECIP_INIT)], {"openWaterEvap": ""})["openWaterEvap"]


# ---- repaired candidates -------------------------------------------------------------------------


def test_a_repaired_candidate_is_chosen_as_a_copy_with_nothing_to_set(v2, bucket):
    _, doc, loaded = snapshot_of("v2")
    loaded = run(model_parameters.with_choices(doc, doc["id"], loaded))
    irr = loaded.choices.get(IRR)
    assert irr.reason is None and "Code_Name (fao_irrEfficiency)" in irr.repair
    custom = {**GLACIERS_ON, "Glaciers.glArea": IRR}
    copy = fork(path="Glaciers.glArea", original=IRR)
    assert forks.validate([copy], custom, loaded.resolved, loaded.values) == {}
    assert validate.validate(custom, loaded.resolved, loaded.values, (), loaded.choices, [copy]) == {}
    # without the copy, the choice is refused at the field
    assert "only be used as a copy" in validate.validate(custom, loaded.resolved, loaded.values, (), loaded.choices)["Glaciers.glArea"]
    # the copy is an entry of the changes file that repairs and sets nothing
    entries, repoint = forks.plan([copy], loaded.resolved, loaded.values)
    assert entries == [{"from": IRR, "to": forks.copy_path(IRR, {}), "set": {}}]
    assert repoint == {"Glaciers.glArea": entries[0]["to"]}


def test_a_candidate_that_wbm_22_1_1_reads_needs_no_copy(bucket):
    _, doc, loaded = snapshot_of("wyoming")
    loaded = run(model_parameters.with_choices(doc, doc["id"], loaded))
    assert all(c.repair is None and c.reason is None for c in loaded.choices.candidates)


# ---- the originals --------------------------------------------------------------------------------


def test_the_original_must_be_a_descriptor_of_the_model_input(bucket):
    snapshot_id, doc, _ = snapshot_of("v2")
    source = model_input.source_of(snapshot_id, doc)
    assert run(forks.check_originals(source, [fork()])) == {}
    gone = fork(original="/wbm/data/climate/precip/nowhere.init")
    assert "not in the model input" in run(forks.check_originals(source, [gone]))[PRECIP]
    bucket.fail = OSError("down")
    model_input.reset()
    # a model input that cannot be read refuses nothing: the toolkit checks again
    assert run(forks.check_originals(source, [gone])) == {}


# ---- the changes file ----------------------------------------------------------------------------


def test_the_changes_file_carries_the_forks_beside_the_set():
    entry = {"from": PRECIP_INIT, "to": forks.copy_path(PRECIP_INIT, {"Var_Scale": "1.1"}), "set": {"Var_Scale": 1.1}}
    text = job_script.render_changes_file({PRECIP: entry["to"]}, "23.9.0", [entry])
    import json

    assert json.loads(text) == {"code_version": "23.9.0", "forks": [entry], "set": {PRECIP: entry["to"]}}
    assert '"Var_Scale": 1.1' in text
    # no fork, no key: a changes file of ADR 0038 is as it was
    assert "forks" not in json.loads(job_script.render_changes_file({PRECIP: "x"}, "23.9.0"))
    assert "forks" not in json.loads(job_script.render_changes_file({PRECIP: "x"}, "23.9.0", []))


@pytest.mark.parametrize(
    "bad",
    [{"from": 1, "to": "/wbm/wbm_init/x.init", "set": {}}, {"from": "/a.init", "to": "/b.init", "set": []},
     {"from": "/a.init", "to": "/b.init", "set": {"Var_Scale": float("nan")}},
     {"from": "/a.init", "to": "/b.init", "set": {"Var Scale": 1}}],
)
def test_a_fork_that_cannot_be_written_is_refused(bad):
    with pytest.raises(job_script.SubmitInputError):
        job_script.render_changes_file({}, "23.9.0", [bad])


# ---- through the API ------------------------------------------------------------------------------


def patch(client, db, forks_, custom=None, **parameters):
    stored = db.jobs.docs["job-1"]["parameters"]
    body = {**stored, **parameters, "forks": forks_}
    if custom is not None:
        body["custom_params"] = custom
    return client.patch(JOB, headers=HEADERS, json={"parameters": body})


def wire(*items: DatasetFork) -> list[dict]:
    return [f.model_dump() for f in items]


def test_a_draft_that_forks_the_precipitation_dataset_saves_and_its_changes_file_has_the_copy(client, db, snapshots, sent):
    make_draft(db, snapshots, "v2")
    response = patch(client, db, wire(fork({"Var_Scale": "95040"})))
    assert response.status_code == 200, response.text
    assert response.json()["parameters"]["forks"] == [{"path": PRECIP, "original": PRECIP_INIT, "set": {"Var_Scale": "95040"}}]
    assert db.jobs.docs["job-1"]["parameters"]["forks"] == wire(fork({"Var_Scale": "95040"}))

    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202, response.text
    changes = changes_in(sent[0][2])
    to = forks.copy_path(PRECIP_INIT, {"Var_Scale": "95040"})
    assert changes == {
        "code_version": "23.9.0",
        "forks": [{"from": PRECIP_INIT, "to": to, "set": {"Var_Scale": 95040.0}}],
        "set": {PRECIP: to},
    }


def test_a_draft_without_forks_has_the_changes_file_it_had(client, db, snapshots, sent):
    make_draft(db, snapshots, "v2", custom_params={"wbmParam.alpha": "3"})
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    assert "forks" not in changes_in(sent[0][2])


def test_a_save_refuses_a_key_a_malformed_number_and_a_constant_each_at_its_field(client, db, snapshots):
    make_draft(db, snapshots, "v2")
    for bad, message in (
        (fork({"Code_Name": "x"}), "Code_Name cannot be edited here"),
        (fork({"Var_Scale": ".5"}), "Var_Scale must be a number"),
    ):
        response = patch(client, db, wire(bad))
        assert response.status_code == 422, bad
        detail = response.json()["detail"]
        assert detail["code"] == "invalid_custom_params" and list(detail["errors"]) == [PRECIP]
        assert message in detail["errors"][PRECIP]
    assert not db.jobs.docs["job-1"]["parameters"].get("forks")
    # a field the draft sets to a constant
    response = patch(client, db, wire(fork(path="Impervious", original=AREA)), custom={"Impervious": "0.2"})
    assert response.status_code == 422
    assert "constant number" in response.json()["detail"]["errors"]["Impervious"]


def test_a_save_refuses_an_original_that_the_model_input_does_not_have(client, db, snapshots, bucket):
    make_draft(db, snapshots, "v2")
    del bucket.objects[f"model-inputs/{MODEL_INPUTS['52585562']}/climate/precip/merra2_prectotcorr_d.init"]
    model_input.reset()
    response = patch(client, db, wire(fork({"Var_Scale": "2"})))
    assert response.status_code == 422
    assert f"{PRECIP_INIT} is not in the model input" in response.json()["detail"]["errors"][PRECIP]


def test_a_stored_draft_with_a_bad_fork_is_refused_on_submit(client, db, snapshots, sent):
    make_draft(db, snapshots, "v2", forks=wire(fork({"Var_Scale": "x"})))
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422 and sent == []
    assert list(response.json()["detail"]["errors"]) == [PRECIP]


def test_removing_the_last_fork_saves(client, db, snapshots):
    make_draft(db, snapshots, "v2", forks=wire(fork({"Var_Scale": "2"})))
    stored = db.jobs.docs["job-1"]["parameters"]
    response = client.patch(JOB, headers=HEADERS, json={"parameters": {k: v for k, v in stored.items() if k != "forks"}})
    assert response.status_code == 200, response.text
    assert not db.jobs.docs["job-1"]["parameters"].get("forks")


def test_a_repaired_dataset_is_switched_on_with_its_copy_and_the_changes_file_has_it(client, db, snapshots, sent, bucket):
    # the recorded model input lacks the file this descriptor reads, which coverage judges from the original
    bucket.put(f"model-inputs/{MODEL_INPUTS['52585562']}/irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc")
    make_draft(db, snapshots, "v2", variables=["discharge", "glMelt"])
    repaired = IRR
    custom = {**GLACIERS_ON, "Glaciers.glArea": repaired}
    # without the copy the choice is refused at the field, with it the draft saves
    response = patch(client, db, [], custom)
    assert response.status_code == 422 and "only be used as a copy" in response.json()["detail"]["errors"]["Glaciers.glArea"]
    response = patch(client, db, wire(fork(path="Glaciers.glArea", original=repaired)), custom)
    assert response.status_code == 200, response.text
    submitted = client.post(SUBMIT, headers=HEADERS)
    assert submitted.status_code == 202, submitted.text
    changes = changes_in(sent[0][2])
    to = forks.copy_path(repaired, {})
    assert changes["forks"] == [{"from": repaired, "to": to, "set": {}}]
    assert changes["set"]["Glaciers.glArea"] == to and changes["set"]["Glaciers.glMelt"] == MELT


def test_a_module_that_is_itself_a_dataset_is_switched_on_with_the_copy_of_a_repaired_one(client, db, snapshots, sent, bucket):
    bucket.put(f"model-inputs/{MODEL_INPUTS['52585562']}/irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc")
    make_draft(db, snapshots, "v2")
    custom = {"Impervious": IRR}
    response = patch(client, db, [], custom)
    assert response.status_code == 422 and "only be used as a copy" in response.json()["detail"]["errors"]["Impervious"]
    response = patch(client, db, wire(fork(path="Impervious", original=IRR)), custom)
    assert response.status_code == 200, response.text
    submitted = client.post(SUBMIT, headers=HEADERS)
    assert submitted.status_code == 202, submitted.text
    changes = changes_in(sent[0][2])
    to = forks.copy_path(IRR, {})
    assert changes["forks"] == [{"from": IRR, "to": to, "set": {}}]
    assert changes["set"]["Impervious"] == to


# ---- the checks before a submit -------------------------------------------------------------------


def test_the_run_the_rules_judge_still_reads_the_original_and_the_copys_units_are_the_forks(bucket):
    snapshot_id, doc, loaded = snapshot_of("v2")
    parameters = JobParameters(**{**job_script.snapshot_defaults(doc).model_dump(), "forks": [fork({"Units": "mm/year"})]})
    run_ = cross_rules.effective_run(doc, loaded, parameters)
    assert run_.values["MT_Precip"]["Primary"] == PRECIP_INIT  # dates and files come from the original
    assert PRECIP in run_.changed and run_.forks == {PRECIP: {"Units": "mm/year"}}
    ctx = run(cross_rules.gather_files(model_input.source_of(snapshot_id, doc), run_))
    assert ctx.dataset(PRECIP).get("Units") == "mm/year"
    assert ctx.inits[PRECIP_INIT].get("Units") == "mm/day"  # the original is not changed
    assert ctx.dataset(AIR_T).get("Units") == ctx.inits[AIR_T_INIT].get("Units")  # a field without a fork is read as it is


def test_the_copys_units_are_what_the_unit_rules_judge(api, db, snapshots):
    ok = ask(api, db, snapshots, "v2", forks=wire(fork({"Var_Scale": "95040"}))).json()
    assert ok == {"errors": [], "warnings": [], "files_checked": True}
    bad = ask(api, db, snapshots, "v2", forks=wire(fork({"Units": "kg/m2/s"}))).json()
    (error,) = bad["errors"]
    assert error["rule"] == "precip_units" and "kg/m2/s" in error["message"] and error["paths"] == [PRECIP]


def test_the_copy_does_not_change_the_dates_and_files_the_run_needs(api, db, snapshots):
    body = ask(api, db, snapshots, "v2", forks=wire(fork({"Var_Scale": "2"})), temporal_range_end="2002-06-30").json()
    (error,) = body["errors"]
    assert error["rule"] == "dataset_file_coverage" and "has no file for 2002-01-01" in error["message"]


# ---- the Edit dataset panel's endpoint -------------------------------------------------------------


def test_the_original_values_are_served_for_the_panel(api, snapshots):
    response = api.get(
        f"/api/v1/repository/datasets/{snapshots['v2']}/dataset-init", params={"path": PRECIP_INIT}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "path": PRECIP_INIT, "name": "merra2_prectotcorr_d.init", "Code_Name": "merra2_prectotcorr_d",
        "Units": "mm/day", "Var_Scale": "86400", "Var_Offset": "0", "Time_Series": "daily",
        "Start_Date": "2000-01-01", "End_Date": "2015-12-31",
    }


def test_the_endpoint_refuses_what_is_not_a_data_init_and_says_when_it_is_not_there(api, snapshots):
    url = f"/api/v1/repository/datasets/{snapshots['v2']}/dataset-init"
    assert api.get(url, params={"path": "/wbm/wbm_init/x.init"}).status_code == 422
    assert api.get(url, params={"path": "/wbm/data/climate/precip/x.tif"}).status_code == 422
    assert api.get(url, params={"path": "/wbm/data/climate/precip/nowhere.init"}).status_code == 404
    assert api.get("/api/v1/repository/datasets/nope/dataset-init", params={"path": PRECIP_INIT}).status_code == 404


def test_the_endpoint_says_when_the_model_input_cannot_be_read(api, snapshots, bucket):
    bucket.fail = OSError("down")
    model_input.reset()
    response = api.get(
        f"/api/v1/repository/datasets/{snapshots['v2']}/dataset-init", params={"path": PRECIP_INIT}
    )
    assert response.status_code == 503 and response.json()["detail"]["code"] == "model_input_unavailable"


def test_the_tree_says_which_fields_can_be_forked(api, snapshots):
    body = api.get(f"/api/v1/repository/datasets/{snapshots['v2']}/model-parameters").json()
    nodes = {}

    def walk(items):
        for n in items:
            if "path" in n:
                nodes[n["path"]] = n
            walk(n.get("children", []))

    walk(body["groups"])
    assert nodes[PRECIP]["forkable"] is True and nodes[AIR_T]["forkable"] is True
    assert nodes["MT_Precip.Scale"]["forkable"] is False  # a number
    assert nodes["Irrigation.CropAreaFrac"]["forkable"] is False  # its module is off and cannot be switched on
    assert nodes["Glaciers.glArea"]["forkable"] is True  # off in v2, but the draft can switch the module on
