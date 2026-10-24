"""The parameter tree resolved for a WBM version and rendered with an init's values
(app/wbm_init/tree.py; mission 2026-10-21-wizard-model-parameters, spec criterion 1).

Two real inits stand for the two versions: the v2 CONUS tutorial `wbm_test.init` (WBM
23.9.0) and `Wyoming_tracking.init` (WBM 22.1.1), the inits of two published snapshots. The
structure of the tree file itself is tests/test_wbm_init_tree.py.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.wbm_init import reader, tree

FIXTURES = Path(__file__).parent / "fixtures"
V2 = reader.read((FIXTURES / "post_processing" / "fc66a2cd_wbm_test.init").read_text())
WYOMING = reader.read((FIXTURES / "wbm_init" / "Wyoming_tracking.init").read_text())

NODE_KEYS = {
    "group": {"kind", "key", "label", "doc", "tier", "children"},
    "module": {
        "kind", "key", "name", "doc", "tier", "path", "state", "switch_off", "switch_on",
        "switch_on_reason", "edit_as", "forkable", "candidates", "children",
    },
    "field": {
        "kind", "key", "label", "doc", "tier", "path", "type", "editable", "edit_as", "forkable", "required",
        "candidates", "current", "default", "unit", "options", "min", "max", "calibration", "show_if",
    },
}
FIELD_TYPES = {
    "number", "int", "enum", "bool01", "string", "date", "dataset", "file", "list", "column",
    "block", "flag",
}


def walk(nodes):
    for n in nodes:
        yield n
        yield from walk(n.get("children", []))


def rendered(version: str, values: dict) -> list[dict]:
    return tree.render(tree.resolve(version), values)


def by_path(version: str, values: dict) -> dict[str, dict]:
    return {n["path"]: n for n in walk(rendered(version, values)) if "path" in n}


# ---- the contract's shape ------------------------------------------------------


@pytest.mark.parametrize("version, values", [("23.9.0", V2), ("22.1.1", WYOMING)])
def test_every_node_has_exactly_the_contracts_keys(version, values):
    nodes = list(walk(rendered(version, values)))
    assert nodes
    for n in nodes:
        assert set(n) == NODE_KEYS[n["kind"]], n.get("key")
        assert n["tier"] in ("basic", "advanced")
        assert n["label" if n["kind"] != "module" else "name"]
        if n["kind"] == "field":
            assert n["type"] in FIELD_TYPES
            assert isinstance(n["editable"], bool)
            assert n["default"] is None or isinstance(n["default"], (str, int, float))
            assert not isinstance(n["default"], bool)
            assert n["current"] is None or isinstance(n["current"], str)
        if n["kind"] == "group":
            assert n["children"], f"empty group {n['key']} is not dropped"
    # `module` is a tier of the tree file; the API has two.
    assert {n["tier"] for n in nodes} == {"basic", "advanced"}


@pytest.mark.parametrize("version", ["23.9.0", "22.1.1"])
def test_the_tree_leaves_out_what_a_custom_parameter_may_not_name(version):
    resolved = tree.resolve(version)
    shown = {n["path"] for n in walk(rendered(version, {})) if "path" in n}
    assert shown == set(resolved.fields)
    # Owned by a draft field, locked, inert, write: never: not shown, and refused with a reason.
    for path, reason in {
        "MT_Code_Name.Run_Start": "draft_field",
        "MT_Code_Name.Run_End": "draft_field",
        "Output_vars": "draft_field",
        "PostProcessing": "draft_field",
        "PostProcessing.Run": "draft_field",
        "Projection": "locked",
        "MT_Code_Name.spool_dir": "locked",
        "MT_Code_Name.Output_dir": "locked",
        "Spinup.State_ID": "locked",
        "DIN.BFI": "inert",
        "WaterRights.domExThd": "inert",
    }.items():
        assert path not in shown, path
        assert resolved.refused[path] == reason, path
    # Not an init key: nothing to show or refuse by path.
    assert not any(n["key"] in ("input_form", "mask_type", "verbose", "test") for n in walk(rendered(version, {})))


def test_unknown_version_is_refused():
    with pytest.raises(ValueError):
        tree.resolve("24.1.0")


def test_every_resolved_path_is_an_init_key_path():
    for version in tree.code_versions():
        for path in tree.resolve(version).fields:
            assert re.fullmatch(r"[A-Za-z_]\w*(\.[A-Za-z_]\w*)*", path), path


# ---- spec criterion 1: resolved for the version ---------------------------------


def test_on_22_1_1_there_is_no_save_vars_pet_scale_or_aquifers_and_rhrt2_defaults_to_0_56():
    resolved = tree.resolve("22.1.1")
    fields = by_path("22.1.1", WYOMING)
    for path in ("Spinup.Save_Vars", "PET.Scale", "Aquifers", "Springs", "USGS", "wbmParam.ncDouble"):
        assert path not in fields, path
        assert resolved.refused[path] == "version", path
    assert not any(p.startswith("Aquifers.") for p in fields)
    assert fields["wbmParam.RhRt2"]["default"] == 0.56
    # The 22.1.1 name of the aquifer withdrawal factor stands in for the 23.9.0 one.
    assert "Irrigation.AqfCoeff" in fields and "Irrigation.ExtraAqfCoeff" not in fields


def test_on_23_9_0_those_are_there_and_rhrt2_defaults_to_0_2():
    fields = by_path("23.9.0", V2)
    for path in ("Spinup.Save_Vars", "PET.Scale", "Aquifers", "Springs", "USGS", "wbmParam.ncDouble"):
        assert path in fields, path
    assert fields["wbmParam.RhRt2"]["default"] == 0.2
    assert "Irrigation.ExtraAqfCoeff" in fields and "Irrigation.AqfCoeff" not in fields


def test_a_version_keyed_pattern_takes_the_versions_side():
    assert "daily\\[" in tree.resolve("23.9.0").fields["MT_Code_Name.Time_Series"].pattern
    assert "daily\\[" not in tree.resolve("22.1.1").fields["MT_Code_Name.Time_Series"].pattern


# ---- every field shows its current value from the init ---------------------------


def _independent_current(values: dict, node: dict, aliases: tuple[str, ...]) -> str | None:
    for path in (*aliases, node["path"]):
        value = reader.lookup(values, path)
        if value is not None:
            return tree.BLOCK_TEXT if isinstance(value, dict) else value
    if node["path"] == "Routing.method":  # `Routing => 'LRR'` is the method alone
        return values.get("Routing") or None
    return None


@pytest.mark.parametrize("version, values", [("23.9.0", V2), ("22.1.1", WYOMING)])
def test_every_fields_current_is_the_inits_value(version, values):
    resolved = tree.resolve(version)
    fields = [n for n in walk(rendered(version, values)) if n["kind"] == "field"]
    assert len(fields) > 100
    for n in fields:
        assert n["current"] == _independent_current(values, n, resolved.fields[n["path"]].aliases), n["path"]


def test_wyomings_current_values():
    f = by_path("22.1.1", WYOMING)
    assert f["Comment"]["current"] == "WBM Open Source paper: tracking demonstration"
    assert f["Project"]["current"] is None  # the init has no Project: WBM uses its default
    assert f["Spinup.Loops"]["current"] == "2"
    assert f["Spinup.Start"]["current"] == "2000-01-01"
    assert f["Routing.method"]["current"] == "LRR"  # `Routing => 'LRR'`, the plain-string form
    assert f["Routing.method"]["editable"] is False  # the toolkit cannot add keys under a string
    assert f["wbmParam.outputScale"]["current"] == "Cell"
    assert f["wbmParam.compBalance"]["current"] == "0"
    assert f["wbmParam.alpha"]["current"] is None and f["wbmParam.alpha"]["default"] == 5
    assert f["Irrigation.ReturnCoeff"]["current"] == "0.5"
    assert f["Irrigation.Order"]["current"] == "1"
    assert f["Irrigation.useVIS"]["current"] == "0"
    # a dataset field's current is the path the init names
    assert f["Irrigation.IrrEfficiency"]["current"] == "/wbm/data_init/irrigation/irrEfficiency.init"
    assert f["rootingDepth"]["current"].endswith("Effective_Rooting_Depth_mod.init")


def test_the_alias_the_init_uses_is_where_current_comes_from():
    f = by_path("22.1.1", WYOMING)
    assert f["Irrigation.IrrSearchDist"]["current"] == "100"  # the init writes SearchDist
    assert "Irrigation.SearchDist" not in f


def test_v2s_current_values_and_empty_keys():
    f = by_path("23.9.0", V2)
    assert f["Spinup.Loops"]["current"] == "1"
    assert f["Spinup.End"]["current"] == "2000-12-31"
    assert f["Project"]["current"] == "WBM_test"
    assert f["MT_Code_Name.File_Size"]["current"] == "year"
    assert f["MT_Code_Name.Calendar"]["current"] is None
    assert f["PET"]["current"] == ""  # present and empty is not absent
    assert f["landCollapse"]["current"] == ""
    assert f["Routing.method"]["current"] == "LRR"


def test_default_from_resolves_to_the_value_it_names():
    f = by_path("22.1.1", WYOMING)
    assert f["WaterDemand.DomSearchDist"]["default"] == "100"  # Irrigation's search distance in the init
    f = by_path("23.9.0", V2)
    assert f["WaterDemand.DomSearchDist"]["default"] == 100  # absent there: its default


# ---- modules ---------------------------------------------------------------------


def modules(version: str, values: dict) -> dict[str, dict]:
    return {n["path"]: n for n in walk(rendered(version, values)) if n["kind"] == "module"}


def test_wyomings_module_states():
    m = modules("22.1.1", WYOMING)
    for path in ("Glaciers", "Reservoirs", "Irrigation", "Runoff_mask"):
        assert m[path]["state"] == "on" and m[path]["switch_off"] is True, path
    for path in ("DIN", "WaterDemand", "ConnectivityNetwork", "Impervious", "openWaterEvap"):
        assert m[path]["state"] == "off" and m[path]["switch_off"] is False, path
    assert "Aquifers" not in m


def test_v2s_module_states():
    m = modules("23.9.0", V2)
    assert m["openWaterEvap"]["state"] == "on" and m["openWaterEvap"]["switch_off"] is True
    for path in ("Glaciers", "Irrigation", "Reservoirs", "Aquifers", "DIN"):
        assert m[path]["state"] == "off" and m[path]["switch_off"] is False, path


def test_a_module_that_cannot_be_switched_off_has_no_switch():
    # USGS is a file reference the wizard only shows
    m = modules("23.9.0", {"USGS": "/wbm/data/usgs.csv"})
    assert m["USGS"]["state"] == "on" and m["USGS"]["switch_off"] is False


@pytest.mark.parametrize("value, state", [("", "off"), ("0", "off"), ({}, "off"), ("x", "on"), ({"a": "1"}, "on")])
def test_a_modules_state_is_whether_its_key_holds_a_value(value, state):
    assert modules("22.1.1", {"Glaciers": value})["Glaciers"]["state"] == state


def test_a_field_is_editable_only_where_its_change_can_be_written():
    f = by_path("22.1.1", WYOMING)
    assert f["wbmParam.alpha"]["editable"] is True
    assert f["Irrigation.ReturnCoeff"]["editable"] is True  # its module is on
    assert f["Reservoirs.SkipLines"]["editable"] is False  # a block file: not edited
    assert f["WaterDemand.DomDemandReturnFr"]["editable"] is False  # its module is off
    assert f["wbmParam.RhRt2"]["editable"] is True  # a dataset that accepts a number: a constant
    assert f["wbmParam.RhRt2"]["edit_as"] == "number" and f["wbmParam.alpha"]["edit_as"] is None
    assert f["wbmParam.RhRt2"]["type"] == "dataset" and f["wbmParam.RhRt2"]["current"] is None
    # its current value may be a path: shown as text, replaced by the constant
    assert f["rootingDepth"]["edit_as"] == "number"
    assert f["rootingDepth"]["current"] == "/wbm/data_init/soil/Effective_Rooting_Depth_mod.init"
    # a dataset that does not accept a number stays read-only
    assert f["Network"]["editable"] is False and f["Network"]["edit_as"] is None
    v = by_path("23.9.0", V2)
    assert v["wbmParam.alpha"]["editable"] is True  # `wbmParam => ''` is no block yet
    assert v["Irrigation.ReturnCoeff"]["editable"] is False  # Irrigation is off
    assert v["wbmParam.RhRt2"]["editable"] is True and v["wbmParam.RhRt2"]["edit_as"] == "number"
    assert v["Irrigation.ExtraCoeff"]["editable"] is False  # a dataset in a module that is off
    assert v["Irrigation.ExtraCoeff"]["edit_as"] == "number"


# ---- options ----------------------------------------------------------------------


def option_values(node: dict) -> list[str]:
    return [o["value"] for o in node["options"]]


def test_options_come_from_the_tree_as_value_label_pairs():
    f = by_path("22.1.1", WYOMING)
    assert f["Routing.method"]["options"] == [{"value": v, "label": v} for v in ("LRR", "Muskingum", "Flush")]
    assert f["Irrigation.Order"]["options"] == [
        {"value": "0", "label": "Groundwater first"},
        {"value": "1", "label": "Surface water first"},
    ]
    assert f["Spinup.Loops"]["options"] is None
    assert option_values(by_path("23.9.0", V2)["Spinup.Save_Vars"]) == ["0", "1", "2"]
    assert option_values(f["landCollapse"]) == ["", "average", "dominant"]


def test_pet_options_that_need_datasets_the_init_lacks_are_not_offered():
    assert option_values(by_path("22.1.1", WYOMING)["PET"]) == ["Hamon"]
    drivers = {k: {"Primary": "/wbm/data_init/x.init"} for k in ("MT_cloudFr", "MT_windU", "MT_windV", "MT_humidity")}
    with_drivers = {**drivers, "MT_albedo": {"Primary": "a.init"}}
    assert option_values(by_path("22.1.1", with_drivers)["PET"]) == ["Hamon", "FAO-56"]
    full = {**with_drivers, "canopyHt": "c.init", "MT_LAI": "l.init"}
    assert option_values(by_path("22.1.1", full)["PET"]) == ["Hamon", "Penman-Monteith", "FAO-56"]
    # the option the init already has stays, whatever it needs
    assert "Penman-Monteith" in option_values(by_path("22.1.1", {"PET": "Penman-Monteith"})["PET"])
