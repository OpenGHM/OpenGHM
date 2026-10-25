"""Switching a module on (mission 2026-10-23-module-switch-on): which modules the wizard offers on
a snapshot and the datasets it offers for them, the validation of a save that switches one on, the
changes file of a draft that did, and the checks before a submit seeing its datasets.

The snapshots are the v2 tutorial (23.9.0, model input 52585562, Glaciers off) and the Wyoming and
Global snapshots (22.1.1, Glaciers on); the model inputs are the recorded ones (`tests/s3_fake.py`).
"""

from __future__ import annotations

import asyncio
import copy
import json

import pytest

from app.models.job import DatasetFork, JobParameters
from app.services import job_script, model_parameters
from app.wbm_init import choices as ch
from app.wbm_init import cross_rules, model_input, tree, validate

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
from s3_fake import MODEL_INPUTS
from test_wbm_cross_rules import snapshot_of

MELT = "/wbm/data_init/glaciers/glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m.init"
VOLUME = "/wbm/data_init/glaciers/glacier_RDI40_6min_ERA-Interim_hindcast_Volume_y.init"
AREA = "/wbm/data_init/glaciers/global_rgi6_glaciers_area_1km.init"
#: the 52585562 file whose Code_Name is `global_rgi6_glaciers_area_1km`, not its own name
AREA_RENAMED = "/wbm/data_init/glaciers/glacier_RDI6_6min_ERA-Interim_hindcast_Area_yc.init"
ROOTING = "/wbm/data_init/soil/Effective_Rooting_Depth_mod.init"  # Code_Name root_depth
GLACIERS_ON = {"Glaciers.glMelt": MELT, "Glaciers.glArea": AREA}


def run(coro):
    return asyncio.run(coro)


GLACIER_1980 = ("glaciers/glacier_RDI40_6min_1980_m.nc", "glaciers/glacier_RDI40_6min_1980_y.nc")


@pytest.fixture(autouse=True)
def glacier_1980(bucket):
    """The two glacier files of 1980 that 52585562 lacks (it holds 2000-2009) and WBM opens first, to read
    the grid, since the glacier datasets start in 1980 (tests/test_wbm_cross_rules.py): added, so that a
    draft that switches Glaciers on passes the checks here. The test that says what they are for removes them."""
    for key in GLACIER_1980:
        bucket.put(f"model-inputs/{MODEL_INPUTS['52585562']}/{key}")


#: The data files of the two repaired datasets 52585562 holds the descriptors of and not the data
#: (docs/reference/wbm-init.md section 2): `mirca_cropAreaFraction.init` and `irrEfficiency.init`.
CROP_FILES = ("crops/mirca_cropAreaFraction.nc", "irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc")


@pytest.fixture(autouse=True)
def crop_files(bucket):
    """The two files above, added, so that the repaired datasets are usable as copies in the tests of
    copies and switch-on. The tests of the candidates' data take them away."""
    for key in CROP_FILES:
        bucket.put(f"model-inputs/{MODEL_INPUTS['52585562']}/{key}")


@pytest.fixture(autouse=True)
def one_grid(monkeypatch):
    """The tree without `same_grid`, so the Glaciers module can be switched on on 23.9.0 and the
    machinery of switching a module on is tested with it. What `same_grid` withholds, and why, is
    tests/test_wbm_switch_on_policy.py, which runs on the tree as published."""
    doc = copy.deepcopy(tree._doc())

    def strip(nodes):
        for n in nodes:
            n.pop("same_grid", None)
            strip(n.get("children") or [])

    strip(doc["tree"])
    with monkeypatch.context() as m:
        m.setattr(tree, "_doc", lambda: doc)
        tree.resolve.cache_clear()
        yield
    tree.resolve.cache_clear()


def loaded_with_choices(bucket, name: str) -> tuple[str, dict, model_parameters.Loaded]:
    snapshot_id, doc, loaded = snapshot_of(name)
    return snapshot_id, doc, run(model_parameters.with_choices(doc, snapshot_id, loaded))


def walk(nodes):
    for n in nodes:
        yield n
        yield from walk(n.get("children", []))


# ---- the model input's datasets ---------------------------------------------------------------


def test_the_v2_model_inputs_datasets_are_candidates_and_23_9_0_refuses_the_ones_it_cannot_read(bucket):
    _, _, loaded = loaded_with_choices(bucket, "v2")
    found = {c.path: c for c in loaded.choices.candidates}
    assert len(found) == 26  # the model input's `datasets[]`
    melt = found[MELT]
    assert (melt.code, melt.time_series, melt.unit, melt.reason) == (
        "glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m", "monthly", "m3/sec", None,
    )
    assert found[VOLUME].unit == "m3" and found[VOLUME].reason is None
    assert found[AREA].unit == "fraction" and found[AREA].time_series == "yearly_clim" and found[AREA].reason is None
    # what WBM 23.9.0 dies on, a `Code_Name` that is not the file name or a non-ASCII byte, a copy repairs
    # (ADR 0039): the candidate is usable, as a copy, and says what the copy repairs
    assert found[ROOTING].reason is None
    assert "Code_Name (root_depth) differs from its file name" in found[ROOTING].repair
    mirca = found["/wbm/data_init/crops/mirca_cropAreaFraction.init"]
    assert mirca.reason is None and "not ASCII" in mirca.repair
    assert found[MELT].repair is None
    # an init the model input does not list is no candidate
    assert AREA_RENAMED not in found


def test_a_dataset_whose_data_file_is_not_in_the_model_input_is_disabled_with_the_file_named(bucket):
    """As the model input is recorded: it holds the descriptors of `mirca_cropAreaFraction` and
    `irrEfficiency` and neither's data (SLURM 21609705); the others it lists have their files."""
    for key in CROP_FILES:
        del bucket.objects[f"model-inputs/{MODEL_INPUTS['52585562']}/{key}"]
    _, _, loaded = loaded_with_choices(bucket, "v2")
    found = {c.path: c for c in loaded.choices.candidates}
    irr = found["/wbm/data_init/irrigation/irrEfficiency.init"]
    assert irr.reason == (
        "Its data file is not in the model input: "
        "/wbm/data/irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc."
    )
    assert "Code_Name (fao_irrEfficiency)" in irr.repair  # still said: the copy would repair it, not bring the data
    mirca = found["/wbm/data_init/crops/mirca_cropAreaFraction.init"]
    assert mirca.reason == "Its data file is not in the model input: /wbm/data/crops/mirca_cropAreaFraction.nc."
    # a static dataset, a monthly one and a dataset that is only repaired keep their files
    assert found[AREA].reason is None and found[MELT].reason is None and found[ROOTING].reason is None
    # the datasets that have no dates and no file: the two above, the soil and the two CDF climatologies
    assert sorted(p.rsplit("/", 1)[1] for p, c in found.items() if c.reason) == [
        "MC_nonrice_irr_CDF_av.init", "MC_rice_irr_CDF_av.init", "harmonized_AWC_5min.init",
        "irrEfficiency.init", "mirca_cropAreaFraction.init",
    ]
    # a dated dataset is not disabled for the file of its own first date: a run reads the files of its own dates
    assert found["/wbm/data_init/climate/merra2_prectotcorr_d.init"].reason is None
    assert found["/wbm/data_init/climate/merra2_prectotcorr_d.init"].first_missing == (
        "/wbm/data/climate/precip/1980/MERRA2.PRECTOTCORR.1980-01-01.nc",
    )


def test_a_dated_datasets_first_file_stops_only_a_field_that_wbm_opens_it_for(bucket):
    """The glacier melt starts in January 1980 (a monthly file named for 1980) and the model input
    holds 2000-2009: WBM opens the first file to read the grid, so a glacier field refuses it; a run
    reads the files of its own dates, so a field that does not open the first file does not."""
    for key in GLACIER_1980:
        del bucket.objects[f"model-inputs/{MODEL_INPUTS['52585562']}/{key}"]
    _, _, loaded = loaded_with_choices(bucket, "v2")
    melt = loaded.choices.get(MELT)
    assert melt.reason is None and melt.first_missing == ("/wbm/data/glaciers/glacier_RDI40_6min_1980_m.nc",)
    assert loaded.choices.get(VOLUME).first_missing == ("/wbm/data/glaciers/glacier_RDI40_6min_1980_y.nc",)
    assert loaded.choices.get(AREA).first_missing == ()  # a climatology: its one file is there
    field = loaded.resolved.fields["Glaciers.glMelt"]
    assert field.reads_first_file is True
    assert tree.candidate_reason(melt, field) == (
        "WBM opens the first data file when it starts, to read the grid, and it is not in the model input: "
        "/wbm/data/glaciers/glacier_RDI40_6min_1980_m.nc."
    )
    # the same dataset where the field does not open the first file
    assert ch.field_reason(melt, None) is None
    assert ch.field_reason(melt, None, True) is not None


def test_a_folder_of_data_that_cannot_be_listed_leaves_the_datasets_unread(bucket, monkeypatch):
    """The descriptors are read but one data folder cannot be listed: whether its file is there is not
    known, so no dataset is offered rather than one that may be missing its data."""
    snapshot_id, doc, _ = snapshot_of("v2")
    real = model_input.list_names

    async def down(location):
        if location.path.startswith("irrigation/"):
            raise model_input.Unavailable("down")
        return await real(location)

    monkeypatch.setattr(model_input, "list_names", down)
    assert run(model_parameters.read_choices(doc, snapshot_id, "23.9.0")) is None


def test_wbm_22_1_1_reads_what_23_9_0_refuses(bucket):
    _, _, loaded = loaded_with_choices(bucket, "wyoming")
    assert loaded.code_version == "22.1.1"
    assert next(c for c in loaded.choices.candidates if c.path == ROOTING).reason is None  # Code_Name root_depth
    assert [c.path for c in loaded.choices.candidates if c.reason] == []


def test_a_datasets_entry_whose_init_is_not_in_the_model_input_is_listed_with_the_reason(bucket):
    snapshot_id, doc, loaded = snapshot_of("v2")
    metadata_key = f"model-inputs/{doc['uses']['modelInput']['id']}/metadata.json"
    metadata = json.loads(bucket.objects[metadata_key])
    metadata["datasets"].append(
        {"code": "gone", "init": "data_init/glaciers/gone.init", "name": "Gone", "unit": "m"}
    )
    bucket.put(metadata_key, json.dumps(metadata))
    found = run(model_parameters.read_choices(doc, snapshot_id, "23.9.0"))
    gone = found.get("/wbm/data_init/glaciers/gone.init")
    assert gone.reason == "Its init file is not in the model input." and gone.name == "Gone"


def test_a_model_input_that_cannot_be_read_gives_none_and_a_snapshot_with_none_gives_no_datasets(bucket):
    snapshot_id, doc, loaded = snapshot_of("v2")
    bucket.fail = OSError("down")
    assert run(model_parameters.read_choices(doc, snapshot_id, "23.9.0")) is None
    bucket.fail = None
    del doc["uses"]["modelInput"]
    assert run(model_parameters.read_choices(doc, snapshot_id, "23.9.0")) == ch.Choices()


def test_the_choices_are_read_once_per_loaded(bucket):
    snapshot_id, doc, loaded = snapshot_of("v2")
    again = run(model_parameters.with_choices(doc, snapshot_id, run(model_parameters.with_choices(doc, snapshot_id, loaded))))
    calls = len(bucket.calls)
    assert run(model_parameters.with_choices(doc, snapshot_id, again)) is again
    assert len(bucket.calls) == calls


# ---- which modules are offered ----------------------------------------------------------------


def decisions(bucket, name: str) -> dict[str, tree.SwitchOn]:
    _, _, loaded = loaded_with_choices(bucket, name)
    return tree.switch_on_decisions(loaded.resolved, loaded.values, loaded.choices)


def test_glaciers_can_be_switched_on_on_the_v2_snapshot(bucket):
    found = decisions(bucket, "v2")["Glaciers"]
    assert found == tree.SwitchOn(True, None)


@pytest.mark.parametrize("name", ["wyoming", "global"])
def test_a_module_that_is_on_is_not_offered(bucket, name):
    assert "Glaciers" not in decisions(bucket, name)


@pytest.mark.parametrize("name", ["v2", "wyoming", "global"])
def test_a_module_that_requires_a_file_is_offered_on_no_snapshot(bucket, name):
    found = decisions(bucket, name)
    for module in ("Irrigation", "Reservoirs", "ConnectivityNetwork", "LandCover", "Springs", "snowBands", "Runoff_mask", "WaterDemand"):
        if module in found:
            assert found[module].offered is False, module
            assert found[module].reason, module
    # a module the tree does not let the wizard switch has no decision at all
    assert "USGS" not in found and "WaterRights" not in found


def test_the_reason_says_what_cannot_be_given(bucket):
    found = decisions(bucket, "v2")
    assert found["Irrigation"].reason == (
        "It needs a file, which cannot be chosen here yet: Crop parameter file (Irrigation.CropParFile)."
    )
    assert "files beside the network file" in found["snowBands"].reason
    assert "Aquifer type (Aquifers.Type)" in found["Aquifers"].reason  # WBM has no default for it
    # a field is offered datasets only where the tree states what fits (`fit: unit`); where it does
    # not, the module says so, whatever units the model input has
    assert found["lapseDownscale"].reason == (
        "The tree does not say which dataset fits Climate-driver elevation (lapseDownscale.climElevation), "
        "Network elevation (lapseDownscale.netElevation)."
    )
    assert found["MT_LAI"].reason == "The tree does not say which dataset fits Canopy Interception of Precipitation (MT_LAI)."
    # a field with no unit is offered no dataset: the tree does not say which data fits
    assert found["openWater"].reason == "The tree does not say which dataset fits Land-cover index data (openWater.MaskDataset)."


def test_without_the_model_input_a_module_that_needs_a_dataset_is_not_offered(bucket):
    _, _, loaded = snapshot_of("v2")
    found = tree.switch_on_decisions(loaded.resolved, loaded.values, None)
    assert found["Glaciers"] == tree.SwitchOn(False, "The model input could not be read right now, so its datasets cannot be offered.")
    # a constant needs no model input, so a field that takes a number can still be given
    assert found["Impervious"].offered is True and found["DIN"].offered is True
    assert found["MT_LAI"].offered is False and found["openWater"].offered is False


def test_a_snapshot_with_a_model_input_that_has_no_datasets_is_not_offered_glaciers(bucket):
    _, _, loaded = snapshot_of("v2")
    found = tree.switch_on_decisions(loaded.resolved, loaded.values, ch.Choices())
    assert found["Glaciers"].offered is False and "dataset the model input does not have" in found["Glaciers"].reason


def test_a_required_scalar_needs_a_default_and_a_number_dataset_takes_a_constant():
    resolved = tree.resolve("23.9.0")
    needs = tree.module_requirements("23.9.0")
    assert needs["Aquifers"] == ("Aquifers.Type",) and resolved.fields["Aquifers.Type"].default is None
    # DIN's two datasets have no unit, so no dataset fits them, and each takes a number
    assert needs["DIN"] == ("DIN.luSub", "DIN.luAgr")
    assert all(resolved.fields[p].unit is None and "number" in resolved.fields[p].accepts for p in needs["DIN"])


def offered_names(bucket, name: str) -> list[str]:
    return sorted(path for path, d in decisions(bucket, name).items() if d.offered)


def test_the_modules_offered_on_each_snapshot(bucket):
    # with the tree's `same_grid` removed (the fixture), Glaciers is offered on 23.9.0 with one dataset of
    # each of its three units; Impervious (`fit: unit`, fraction) has the fraction ones and a constant, DIN
    # takes constants alone; openWater, MT_LAI, lapseDownscale and openWaterEvap are given no dataset
    # because the tree states no fit for them
    assert offered_names(bucket, "v2") == ["DIN", "Glaciers", "Impervious"]
    assert offered_names(bucket, "wyoming") == ["DIN", "Impervious"]
    assert offered_names(bucket, "global") == ["DIN", "Impervious"]


# ---- what the endpoint serves ------------------------------------------------------------------


def served(api, snapshots, name: str) -> dict:
    return api.get(f"/api/v1/repository/datasets/{snapshots[name]}/model-parameters").json()


def test_the_v2_tree_marks_glaciers_able_to_switch_on_with_candidates_for_its_three_datasets(api, snapshots):
    body = served(api, snapshots, "v2")
    by_path = {n["path"]: n for n in walk(body["groups"]) if "path" in n}
    glaciers = by_path["Glaciers"]
    assert glaciers["state"] == "off" and glaciers["switch_on"] is True and glaciers["switch_on_reason"] is None
    for path in ("Glaciers.glMelt", "Glaciers.glArea", "Glaciers.glVolume"):
        field = by_path[path]
        assert field["editable"] is True and field["candidates"], path
        assert set(field["candidates"][0]) == {"value", "name", "code", "time_series", "unit", "disabled", "repair"}
    assert by_path["Glaciers.glMelt"]["required"] and by_path["Glaciers.glArea"]["required"]
    assert not by_path["Glaciers.glVolume"]["required"]
    # a field is offered the datasets of its unit and no others: the discharge (m3/s), the volume (m3 per
    # pixel is m3), and the datasets in fractions
    melt = by_path["Glaciers.glMelt"]["candidates"]
    assert [c["value"] for c in melt] == [MELT]
    assert melt[0]["name"] == "Glacier Discharge, model (v.2; 6min) ERA-Interim hindcast, monthly"
    assert melt[0]["unit"] == "m3/sec" and melt[0]["time_series"] == "monthly" and melt[0]["disabled"] is None
    assert [c["value"] for c in by_path["Glaciers.glVolume"]["candidates"]] == [VOLUME]
    area = {c["value"]: c for c in by_path["Glaciers.glArea"]["candidates"]}
    assert MELT not in area and VOLUME not in area and ROOTING not in area
    assert {c["unit"] for c in area.values()} == {"fraction"}


def test_a_dataset_of_the_right_unit_that_wbm_cannot_read_is_listed_disabled(api, snapshots):
    by_path = {n["path"]: n for n in walk(served(api, snapshots, "v2")["groups"]) if "path" in n}
    area = {c["value"]: c for c in by_path["Glaciers.glArea"]["candidates"]}
    assert area[AREA]["disabled"] is None
    # a file WBM 23.9.0 refuses for its `Code_Name` or a non-ASCII byte is not disabled: it is usable as a copy
    mirca = area["/wbm/data_init/crops/mirca_cropAreaFraction.init"]
    assert mirca["disabled"] is None and "not ASCII" in mirca["repair"]
    irr = area["/wbm/data_init/irrigation/irrEfficiency.init"]
    assert irr["disabled"] is None and "Code_Name (fao_irrEfficiency) differs" in irr["repair"]
    assert area[AREA]["repair"] is None


def test_a_dataset_without_its_data_is_listed_disabled_and_the_others_are_unchanged(api, snapshots, bucket):
    """The v2 model input as recorded: the repaired `irrEfficiency.init` is a candidate of `Impervious`
    and its data is not in the model input."""
    for key in CROP_FILES:
        del bucket.objects[f"model-inputs/{MODEL_INPUTS['52585562']}/{key}"]
    by_path = {n["path"]: n for n in walk(served(api, snapshots, "v2")["groups"]) if "path" in n}
    impervious = {c["value"]: c for c in by_path["Impervious"]["candidates"]}
    irr = impervious["/wbm/data_init/irrigation/irrEfficiency.init"]
    assert irr["disabled"] == (
        "Its data file is not in the model input: /wbm/data/irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc."
    )
    mirca = impervious["/wbm/data_init/crops/mirca_cropAreaFraction.init"]
    assert "mirca_cropAreaFraction.nc" in mirca["disabled"]
    others = [c for p, c in impervious.items() if c is not irr and c is not mirca]
    assert others and all(c["disabled"] is None for c in others)
    assert impervious[AREA]["disabled"] is None


def test_the_units_rule_of_glarea_is_the_trees_and_a_dataset_that_breaks_it_is_disabled():
    resolved = tree.resolve("23.9.0")
    assert resolved.fields["Glaciers.glArea"].unit_contains == "frac"
    assert tree.resolve("22.1.1").fields["Glaciers.glArea"].unit_contains is None  # 22.1.1 does not check
    metres = ch.Candidate("/wbm/data_init/x.init", "x", "X", "monthly", "m3/sec")
    assert "Its Units (m3/sec) must contain 'frac'" in ch.field_reason(metres, "frac")
    assert ch.field_reason(ch.Candidate("/wbm/data_init/y.init", "y", "Y", "yearly_clim", "fraction"), "frac") is None
    assert ch.field_reason(metres, None) is None


def test_a_module_that_cannot_be_switched_on_says_why_and_offers_no_datasets(api, snapshots):
    by_path = {n["path"]: n for n in walk(served(api, snapshots, "v2")["groups"]) if "path" in n}
    irrigation = by_path["Irrigation"]
    assert irrigation["switch_on"] is False and "CropParFile" in irrigation["switch_on_reason"]
    assert by_path["Irrigation.CropAreaFrac"]["candidates"] is None
    assert by_path["Irrigation.CropAreaFrac"]["editable"] is False
    assert by_path["Irrigation.ReturnCoeff"]["editable"] is False


def test_a_module_that_is_itself_a_dataset_carries_the_candidates_on_the_module(api, snapshots):
    by_path = {n["path"]: n for n in walk(served(api, snapshots, "v2")["groups"]) if "path" in n}
    impervious = by_path["Impervious"]
    assert impervious["switch_on"] is True and impervious["edit_as"] == "number"
    # the datasets in its unit (fraction), and the constant a number is
    assert {c["unit"] for c in impervious["candidates"]} == {"fraction"} and len(impervious["candidates"]) == 7
    assert AREA in {c["value"] for c in impervious["candidates"]}
    # no dataset in m2/m2: not offered and nothing to choose; openWaterEvap is on in v2
    assert by_path["MT_LAI"]["switch_on"] is False and by_path["MT_LAI"]["candidates"] is None
    assert by_path["openWaterEvap"]["switch_on"] is False and by_path["openWaterEvap"]["candidates"] is None
    assert by_path["Glaciers"]["edit_as"] is None


def test_a_module_that_is_on_serves_no_switch_on(api, snapshots):
    by_path = {n["path"]: n for n in walk(served(api, snapshots, "wyoming")["groups"]) if "path" in n}
    glaciers = by_path["Glaciers"]
    assert glaciers["state"] == "on" and glaciers["switch_on"] is False and glaciers["switch_on_reason"] is None
    assert by_path["Glaciers.glMelt"]["candidates"] is None and by_path["Glaciers.glMelt"]["editable"] is False


def test_a_model_input_that_cannot_be_read_is_no_failure_but_nothing_is_offered(api, snapshots, bucket):
    bucket.fail = OSError("down")
    response = api.get(f"/api/v1/repository/datasets/{snapshots['v2']}/model-parameters")
    assert response.status_code == 200
    by_path = {n["path"]: n for n in walk(response.json()["groups"]) if "path" in n}
    assert by_path["Glaciers"]["switch_on"] is False and "could not be read" in by_path["Glaciers"]["switch_on_reason"]
    assert by_path["Glaciers.glMelt"]["candidates"] is None


# ---- validation -----------------------------------------------------------------------------------


@pytest.fixture
def v2(bucket):
    _, _, loaded = loaded_with_choices(bucket, "v2")
    return loaded


def check(v2, custom, variables=()):
    return validate.validate(custom, v2.resolved, v2.values, variables, v2.choices)


def test_glaciers_is_switched_on_by_its_datasets(v2):
    assert check(v2, GLACIERS_ON) == {}
    assert check(v2, {**GLACIERS_ON, "Glaciers.glVolume": VOLUME}) == {}


def test_a_save_that_switches_glaciers_on_without_glarea_is_refused_at_the_module(v2):
    errors = check(v2, {"Glaciers.glMelt": MELT})
    assert errors == {
        "Glaciers": "Runoff from Glaciated Areas is being switched on but does not set Glacier area fraction (Glaciers.glArea)."
    }
    assert set(check(v2, {"Glaciers.glVolume": VOLUME})) == {"Glaciers"}
    both = check(v2, {"Glaciers.glVolume": VOLUME})["Glaciers"]
    assert "Glaciers.glMelt" in both and "Glaciers.glArea" in both


def test_a_dataset_outside_the_model_input_is_refused_at_its_field(v2):
    errors = check(v2, {**GLACIERS_ON, "Glaciers.glVolume": "/wbm/data_init/glaciers/nowhere.init"})
    assert errors == {"Glaciers.glVolume": "This is not a dataset of the snapshot's model input."}
    # a path the model input has but `datasets[]` does not list is no candidate either
    errors = check(v2, {**GLACIERS_ON, "Glaciers.glMelt": AREA_RENAMED})
    assert errors == {"Glaciers.glMelt": "This is not a dataset of the snapshot's model input."}


def test_a_dataset_that_wbm_23_9_0_refuses_is_refused_unless_the_draft_copies_it(v2):
    mirca = "/wbm/data_init/crops/mirca_cropAreaFraction.init"  # fraction, but a non-ASCII byte
    errors = check(v2, {**GLACIERS_ON, "Glaciers.glArea": mirca})
    assert set(errors) == {"Glaciers.glArea"}
    assert errors["Glaciers.glArea"].startswith(
        "MIRCA2000 crop area as fraction of cell area can only be used as a copy. It holds a character that is not ASCII"
    )
    irr = "/wbm/data_init/irrigation/irrEfficiency.init"
    assert "Its Code_Name (fao_irrEfficiency) differs from its file name" in check(v2, {**GLACIERS_ON, "Glaciers.glArea": irr})["Glaciers.glArea"]
    # with the copy (an empty fork at the field, of that dataset) it is chosen as any other
    copy = [DatasetFork(path="Glaciers.glArea", original=irr)]
    assert validate.validate({**GLACIERS_ON, "Glaciers.glArea": irr}, v2.resolved, v2.values, (), v2.choices, copy) == {}
    # a copy of another dataset does not cover it
    other = [DatasetFork(path="Glaciers.glArea", original=AREA)]
    assert "only be used as a copy" in validate.validate({**GLACIERS_ON, "Glaciers.glArea": irr}, v2.resolved, v2.values, (), v2.choices, other)["Glaciers.glArea"]


def test_a_dataset_in_another_unit_is_refused_at_its_field(v2):
    errors = check(v2, {**GLACIERS_ON, "Glaciers.glArea": MELT})
    assert errors == {
        "Glaciers.glArea": "Glacier Discharge, model (v.2; 6min) ERA-Interim hindcast, monthly is in m3/sec, and this field takes fraction."
    }
    assert "is in mm, and this field takes m3/pixel" in check(v2, {**GLACIERS_ON, "Glaciers.glVolume": ROOTING})["Glaciers.glVolume"]
    assert "is in fraction, and this field takes m3/s" in check(v2, {**GLACIERS_ON, "Glaciers.glMelt": AREA})["Glaciers.glMelt"]


def test_a_chosen_dataset_must_be_text_a_path_and_not_empty(v2):
    assert check(v2, {"Glaciers.glMelt": MELT, "Glaciers.glArea": AREA, "Glaciers.glVolume": ""}) == {
        "Glaciers.glVolume": "Choose a dataset, or leave this one unset."
    }
    assert "must be text" in check(v2, {**GLACIERS_ON, "Glaciers.glVolume": 5})["Glaciers.glVolume"]


def test_a_module_is_not_switched_on_by_a_value_of_its_own_unless_it_is_a_dataset(v2):
    assert "by setting its parameters" in check(v2, {"Glaciers": "1"})["Glaciers"]
    assert check(v2, {"Glaciers": ""}) == {"Glaciers": "This module is already off."}


def test_a_save_that_chooses_a_dataset_without_its_data_is_refused_with_the_reason(bucket):
    irr = "/wbm/data_init/irrigation/irrEfficiency.init"
    copy = [DatasetFork(path="Impervious", original=irr)]
    for key in CROP_FILES:
        del bucket.objects[f"model-inputs/{MODEL_INPUTS['52585562']}/{key}"]
    _, _, v2 = loaded_with_choices(bucket, "v2")
    # a copy does not help: the data is what is missing (the copy of a repaired dataset is tested in
    # tests/test_wbm_forks.py, with the data there)
    for forks_ in (None, copy):
        errors = validate.validate({"Impervious": irr}, v2.resolved, v2.values, (), v2.choices, forks_)
        assert errors == {
            "Impervious": "Irrigation efficiency cannot be used here. Its data file is not in the model input: "
            "/wbm/data/irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc."
        }
    # a dataset whose data is there is chosen as before
    assert validate.validate({"Impervious": AREA}, v2.resolved, v2.values, (), v2.choices) == {}


def test_a_module_that_is_a_dataset_is_switched_on_by_a_dataset_of_its_unit_or_a_constant(v2):
    mirca = "/wbm/data_init/crops/mirca_cropAreaFraction.init"
    fallow = "/wbm/data_init/crops/LandFracTS/MC_fallow_fr.init"
    assert check(v2, {"Impervious": fallow}) == {}
    assert check(v2, {"Impervious": AREA}) == {}
    assert check(v2, {"Impervious": "0.2"}) == {}  # a constant, which a number field takes
    assert "only be used as a copy" in check(v2, {"Impervious": mirca})["Impervious"]
    assert check(v2, {"Impervious": MELT})["Impervious"].endswith("is in m3/sec, and this field takes fraction.")
    assert check(v2, {"Impervious": "/wbm/data_init/nowhere.init"}) == {"Impervious": "This is not a dataset of the snapshot's model input."}
    assert check(v2, {"Impervious": ""}) == {"Impervious": "This module is already off."}
    assert validate.typed_changes({"Impervious": "0.2"}, v2.resolved, v2.values) == {"Impervious": 0.2}
    assert validate.typed_changes({"Impervious": fallow}, v2.resolved, v2.values) == {"Impervious": fallow}


def test_a_module_the_tree_gives_no_dataset_for_is_not_switched_on_by_one(v2):
    # the tree states no fit for MT_LAI, though it has a unit; nor for openWater's field
    assert "The tree does not say which dataset fits Canopy Interception" in check(v2, {"MT_LAI": AREA})["MT_LAI"]
    message = check(v2, {"openWater.MaskDataset": AREA})["openWater.MaskDataset"]
    assert message.startswith("Its module is off in this snapshot and cannot be switched on here. The tree does not say which dataset fits Land-cover index data")


def test_a_field_with_no_unit_takes_a_constant_and_no_dataset(v2):
    errors = check(v2, {"DIN.luSub": AREA, "DIN.luAgr": "0.5"})
    assert errors == {"DIN.luSub": "The tree does not say which dataset fits this field, so none can be chosen: enter a number."}


def test_a_field_of_a_module_that_cannot_be_switched_on_is_refused_with_the_reason(v2):
    message = check(v2, {"Irrigation.ReturnCoeff": "0.5"})["Irrigation.ReturnCoeff"]
    assert message.startswith("Its module is off in this snapshot and cannot be switched on here. It needs a file")
    message = check(v2, {"Irrigation": "x"})["Irrigation"]
    assert message.startswith("This module is off in this snapshot and cannot be switched on here.")


def test_the_scalars_of_a_module_switched_on_are_checked_as_before(v2):
    assert check(v2, {**GLACIERS_ON}) == {}
    resolved = v2.resolved
    # a number field of an offered module: `DIN.scale` is checked against its range or form
    assert "Use a number" in check(v2, {"DIN.luSub": "0.1", "DIN.luAgr": "0.2", "DIN.scale": "x"})["DIN.scale"]
    assert check(v2, {"DIN.luSub": "0.1", "DIN.luAgr": "0.2", "DIN.scale": "2"}) == {}
    assert resolved.fields["DIN.scale"].editable


def test_a_dataset_field_that_takes_a_number_takes_a_constant_in_a_module_switched_on(v2):
    assert check(v2, {"DIN.luSub": "0.5", "DIN.luAgr": "0.25"}) == {}
    # typed for the changes file: the constants numbers
    typed = validate.typed_changes({"DIN.luSub": "0.5", "DIN.luAgr": "0.25"}, v2.resolved, v2.values)
    assert typed == {"DIN.luSub": 0.5, "DIN.luAgr": 0.25}
    # DIN is switched on by both: one alone leaves the module without what it requires
    assert set(check(v2, {"DIN.luSub": "0.5"})) == {"DIN"}


def test_without_the_model_inputs_datasets_a_module_cannot_be_switched_on(v2):
    errors = validate.validate(GLACIERS_ON, v2.resolved, v2.values, (), None)
    assert set(errors) == {"Glaciers.glMelt", "Glaciers.glArea"}
    assert all("could not be read right now" in message for message in errors.values())


def test_a_module_that_is_on_keeps_its_own_checks(bucket):
    _, _, wyoming = loaded_with_choices(bucket, "wyoming")
    errors = validate.validate(
        {"Glaciers.glMelt": MELT}, wyoming.resolved, wyoming.values, (), wyoming.choices
    )
    assert errors == {"Glaciers.glMelt": "This parameter cannot be changed here."}
    assert validate.validate({"Glaciers": ""}, wyoming.resolved, wyoming.values, ["discharge"], wyoming.choices) == {}


def test_a_module_switched_on_is_not_switched_off_in_the_same_save_and_off_modules_do_not_mix(v2):
    # `Glaciers: ""` on a module the snapshot has off is "already off", whatever else is saved
    errors = check(v2, {"Glaciers": "", **GLACIERS_ON})
    assert errors == {"Glaciers": "This module is already off."}


def test_needs_choices_only_when_a_module_the_snapshot_has_off_is_named(v2):
    needs = lambda custom: tree.needs_choices(custom, v2.resolved, v2.values)  # noqa: E731
    assert needs(GLACIERS_ON) and needs({"Impervious": MELT})
    assert not needs({"wbmParam.alpha": "3"}) and not needs({"openWaterEvap": ""}) and not needs({})
    assert not needs({"nope": "1"})


# ---- the changes file, and the checks before a submit --------------------------------------------


def patch(client, db, custom, **parameters):
    stored = db.jobs.docs["job-1"]["parameters"]
    return client.patch(JOB, headers=HEADERS, json={"parameters": {**stored, **parameters, "custom_params": custom}})


def test_a_draft_with_glaciers_switched_on_saves_and_its_changes_file_sets_the_datasets(client, db, snapshots, sent):
    make_draft(db, snapshots, "v2")
    custom = {**GLACIERS_ON, "Glaciers.glVolume": VOLUME}
    response = patch(client, db, custom, variables=["discharge", "glMelt"])
    assert response.status_code == 200, response.text
    assert response.json()["parameters"]["custom_params"] == custom
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202, response.text
    changes = changes_in(sent[0][2])
    assert changes["code_version"] == "23.9.0"
    assert changes["set"] == {
        "Output_vars": "discharge glMelt",
        "Glaciers.glMelt": MELT,
        "Glaciers.glArea": AREA,
        "Glaciers.glVolume": VOLUME,
    }


def test_a_save_without_glarea_is_a_422_at_the_module_and_nothing_is_stored(client, db, snapshots):
    make_draft(db, snapshots, "v2")
    response = patch(client, db, {"Glaciers.glMelt": MELT})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_custom_params" and list(detail["errors"]) == ["Glaciers"]
    assert db.jobs.docs["job-1"]["parameters"].get("custom_params") is None


def test_a_save_with_a_dataset_outside_the_model_input_is_a_422_at_that_field(client, db, snapshots):
    make_draft(db, snapshots, "v2")
    response = patch(client, db, {**GLACIERS_ON, "Glaciers.glVolume": "/wbm/data_init/x.init"})
    assert response.status_code == 422
    assert list(response.json()["detail"]["errors"]) == ["Glaciers.glVolume"]


def test_a_save_of_a_draft_when_the_model_input_cannot_be_read_is_refused_for_the_module_only(client, db, snapshots, bucket):
    make_draft(db, snapshots, "v2")
    bucket.fail = OSError("down")
    response = patch(client, db, GLACIERS_ON)
    assert response.status_code == 422
    assert set(response.json()["detail"]["errors"]) == {"Glaciers.glMelt", "Glaciers.glArea"}
    # a draft that names no module of that kind needs no model input
    assert patch(client, db, {"wbmParam.alpha": "3"}).status_code == 200


def test_a_stored_draft_that_lost_glarea_is_refused_on_submit(client, db, snapshots, sent):
    make_draft(db, snapshots, "v2")
    db.jobs.docs["job-1"]["parameters"]["custom_params"] = {"Glaciers.glMelt": MELT}
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422 and sent == []
    assert list(response.json()["detail"]["errors"]) == ["Glaciers"]


def test_glaciers_is_not_switched_off_while_an_output_it_unlocks_is_listed(client, db, snapshots):
    # Wyoming has Glaciers on: glMelt, glArea and glVolume exist only while it is
    make_draft(db, snapshots, "wyoming", variables=["discharge", "glMelt", "glArea"])
    response = patch(client, db, {"Glaciers": ""})
    assert response.status_code == 422
    assert "remove glMelt, glArea first" in response.json()["detail"]["errors"]["Glaciers"]
    assert patch(client, db, {"Glaciers": ""}, variables=["discharge"]).status_code == 200


def test_the_checks_pass_the_datasets_of_a_module_switched_on_that_the_model_input_holds(api, db, snapshots):
    body = ask(api, db, snapshots, "v2", custom_params={**GLACIERS_ON, "Glaciers.glVolume": VOLUME}).json()
    assert body == {"errors": [], "warnings": [], "files_checked": True}


def test_coverage_judges_the_chosen_glacier_datasets_by_their_files(api, db, snapshots, bucket):
    for key in [k for k in bucket.objects if "/glaciers/glacier_RDI40_6min_2001_m.nc" in k]:
        del bucket.objects[key]
    body = ask(api, db, snapshots, "v2", custom_params=GLACIERS_ON).json()
    (error,) = body["errors"]
    assert error["rule"] == "dataset_file_coverage"
    assert "Glaciers.glMelt" in error["message"] and "Glaciers.glMelt" in error["paths"]


def test_a_chosen_dataset_whose_file_is_not_in_the_model_input_is_a_coverage_error_at_its_field(api, db, snapshots, bucket):
    for key in [k for k in bucket.objects if k.endswith("/glaciers/global_rgi6_glaciers_1km.tif")]:
        del bucket.objects[key]
    body = ask(api, db, snapshots, "v2", custom_params=GLACIERS_ON).json()
    (error,) = body["errors"]
    assert "Glaciers.glArea" in error["paths"]


def test_the_run_the_rules_judge_has_the_glaciers_block(bucket):
    snapshot_id, doc, loaded = loaded_with_choices(bucket, "v2")
    parameters = JobParameters(**{**job_script.snapshot_defaults(doc).model_dump(), "custom_params": GLACIERS_ON})
    run_ = cross_rules.effective_run(doc, loaded, parameters)
    assert run_.values["Glaciers"] == {"glMelt": MELT, "glArea": AREA}
    assert "Glaciers.glMelt" in run_.changed
    # without the datasets read, the keys of a module the snapshot has off are not applied
    _, _, bare = snapshot_of("v2")
    assert cross_rules.effective_run(doc, bare, parameters).values["Glaciers"] == ""


def test_glaciers_cannot_be_switched_on_when_no_melt_dataset_has_its_first_file(bucket):
    """WBM opens the first file of the glacier melt to read the grid (the checks' rule,
    tests/test_wbm_cross_rules.py): with the 1980 files absent every melt dataset is disabled for
    `Glaciers.glMelt`, so the module is not offered and a save is refused at each of its fields."""
    for key in GLACIER_1980:
        del bucket.objects[f"model-inputs/{MODEL_INPUTS['52585562']}/{key}"]
    _, _, v2 = loaded_with_choices(bucket, "v2")
    decision = tree.switch_on_decisions(v2.resolved, v2.values, v2.choices)["Glaciers"]
    assert decision.offered is False
    assert "a dataset the model input does not have, or has without its data: Glacier melt discharge" in decision.reason
    errors = check(v2, {**GLACIERS_ON, "Glaciers.glVolume": VOLUME})
    assert set(errors) == {"Glaciers.glMelt", "Glaciers.glArea", "Glaciers.glVolume"}
