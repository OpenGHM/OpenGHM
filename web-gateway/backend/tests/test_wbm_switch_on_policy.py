"""What the tree withholds from switching a module on (mission 2026-10-23-module-switch-on), on the
tree as published:

* `same_grid` (Glaciers, 23.9.0): the version stops unless the module's datasets share one grid, which
  the gateway cannot read, so the module is not offered on it;
* `fit`: a dataset is offered to a field only where the tree says what fits (`fit: unit`); where it
  does not, as for `openWaterEvap`, the module says the tree does not say which dataset fits.

The machinery itself, with Glaciers switched on, is tests/test_wbm_switch_on.py.
"""

from __future__ import annotations

import asyncio

import pytest

from app.wbm_init import tree, validate

from test_job_checks import api, bucket, owner, snapshots  # noqa: F401  (fixtures shared with the checks tests)
from test_wbm_cross_rules import snapshot_of
from app.services import model_parameters

MELT = "/wbm/data_init/glaciers/glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m.init"
AREA = "/wbm/data_init/glaciers/global_rgi6_glaciers_area_1km.init"

GRID_REASON = (
    "WBM 23.9.0 needs the datasets of Glacier melt discharge, Glacier area fraction and Glacier water volume "
    "on one grid, which the gateway cannot check yet."
)


def loaded(bucket, name):  # noqa: F811
    snapshot_id, doc, found = snapshot_of(name)
    return asyncio.run(model_parameters.with_choices(doc, snapshot_id, found))


def decisions(bucket, name):  # noqa: F811
    found = loaded(bucket, name)
    return tree.switch_on_decisions(found.resolved, found.values, found.choices)


def walk(nodes):
    for n in nodes:
        yield n
        yield from walk(n.get("children", []))


def test_glaciers_is_withheld_on_23_9_0_until_the_grids_can_be_checked(bucket):
    assert decisions(bucket, "v2")["Glaciers"] == tree.SwitchOn(False, GRID_REASON)
    assert tree.resolve("23.9.0").fields["Glaciers"].same_grid == ("Glaciers.glMelt", "Glaciers.glArea", "Glaciers.glVolume")


def test_the_attribute_is_the_trees_and_belongs_to_one_version():
    assert tree.resolve("22.1.1").fields["Glaciers"].same_grid == ()  # 22.1.1 has no such check


def test_glaciers_is_offered_on_22_1_1_where_the_snapshot_has_it_off(bucket):
    found = loaded(bucket, "wyoming")
    values = {**found.values, "Glaciers": ""}
    assert tree.switch_on_decisions(found.resolved, values, found.choices)["Glaciers"] == tree.SwitchOn(True)


def test_the_endpoint_says_why_glaciers_is_not_offered_and_offers_no_datasets(api, snapshots):  # noqa: F811
    body = api.get(f"/api/v1/repository/datasets/{snapshots['v2']}/model-parameters").json()
    by_path = {n["path"]: n for n in walk(body["groups"]) if "path" in n}
    assert by_path["Glaciers"]["switch_on"] is False and by_path["Glaciers"]["switch_on_reason"] == GRID_REASON
    assert by_path["Glaciers.glMelt"]["candidates"] is None and by_path["Glaciers.glMelt"]["editable"] is False


def test_a_save_that_switches_glaciers_on_for_23_9_0_is_refused_with_the_reason(bucket):
    found = loaded(bucket, "v2")
    errors = validate.validate({"Glaciers.glMelt": MELT, "Glaciers.glArea": AREA}, found.resolved, found.values, (), found.choices)
    assert set(errors) == {"Glaciers.glMelt", "Glaciers.glArea"}
    assert all(m.startswith("Its module is off in this snapshot and cannot be switched on here. WBM 23.9.0 needs") for m in errors.values())


@pytest.mark.parametrize("name", ["wyoming", "global"])
def test_openwaterevap_is_not_offered_because_the_tree_does_not_say_which_dataset_fits(bucket, name):
    found = decisions(bucket, name)["openWaterEvap"]
    assert found == tree.SwitchOn(False, "The tree does not say which dataset fits Evaporation from Open Water (openWaterEvap).")
    resolved = tree.resolve("22.1.1")
    assert resolved.fields["openWaterEvap"].fit is None and resolved.fields["openWaterEvap"].unit == "mm/day"


def test_a_save_that_gives_openwaterevap_a_dataset_is_refused(bucket):
    found = loaded(bucket, "wyoming")
    precip = "/wbm/data_init/climate/merra2_prectotcorr_d.init"  # mm/day, which is no evaporation
    errors = validate.validate({"openWaterEvap": precip}, found.resolved, found.values, (), found.choices)
    assert errors["openWaterEvap"].endswith("The tree does not say which dataset fits Evaporation from Open Water (openWaterEvap).")


@pytest.mark.parametrize(
    "name, offered",
    [("v2", ["DIN", "Impervious"]), ("wyoming", ["DIN", "Impervious"]), ("global", ["DIN", "Impervious"])],
)
def test_the_modules_offered_on_each_snapshot_on_the_published_tree(bucket, name, offered):
    assert sorted(p for p, d in decisions(bucket, name).items() if d.offered) == offered


def test_what_fits_is_stated_only_where_a_unit_says_it():
    for version in tree.code_versions():
        stated = {p: n for p, n in tree.resolve(version).fields.items() if n.fit}
        assert all(n.fit == "unit" and n.unit for n in stated.values()), version
    assert set(p for p, n in tree.resolve("23.9.0").fields.items() if n.fit) == {
        "Glaciers.glMelt", "Glaciers.glArea", "Glaciers.glVolume", "Impervious",
    }


def test_the_fields_whose_first_file_wbm_opens_are_datasets_and_a_condition_is_a_module_of_the_tree():
    for version in tree.code_versions():
        resolved = tree.resolve(version)
        for path, node in resolved.fields.items():
            if node.reads_first_file:
                assert node.type == "dataset", path
                if isinstance(node.reads_first_file, str):
                    assert resolved.fields[node.reads_first_file].kind == "module", path
    assert {p for p, n in tree.resolve("23.9.0").fields.items() if n.reads_first_file} == {
        "Glaciers.glMelt", "Glaciers.glArea", "Glaciers.glVolume", "MT_airT.Primary",
        "lapseDownscale.climElevation", "lapseDownscale.netElevation",
    }
    assert "Glaciers.glArea" not in {p for p, n in tree.resolve("22.1.1").fields.items() if n.reads_first_file}
