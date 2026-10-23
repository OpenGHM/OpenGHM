"""Checking `custom_params` against the resolved tree (app/wbm_init/validate.py; spec
criterion 2 of mission 2026-10-21-wizard-model-parameters), dropping what the snapshot
already has, and typing the rest for the changes file (criterion 3). The routes that call
these are tests/test_custom_params.py.

Wyoming (22.1.1) and the v2 tutorial (23.9.0) are the real inits.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.wbm_init import reader, tree, validate

FIXTURES = Path(__file__).parent / "fixtures"
V2 = reader.read((FIXTURES / "post_processing" / "fc66a2cd_wbm_test.init").read_text())
WYOMING = reader.read((FIXTURES / "wbm_init" / "Wyoming_tracking.init").read_text())
W = tree.resolve("22.1.1")
M = tree.resolve("23.9.0")


def check(custom, resolved=W, values=WYOMING, variables=()):
    return validate.validate(custom, resolved, values, variables)


def test_valid_entries_are_accepted():
    assert check(
        {
            "wbmParam.alpha": "3",
            "wbmParam.maxRffStorage": "1e3",
            "Spinup.Loops": "1",
            "Spinup.Start": "2000-02-01",
            "Irrigation.ReturnCoeff": "0.25",
            "Irrigation.useVIS": "1",
            "Irrigation.Order": "0",
            "wbmParam.Infiltration": "HBV",
            "Comment": "a short description",
            "MT_Code_Name.Time_Series": "monthly",
            "Glaciers": "",
            "Reservoirs": "",
        }
    ) == {}


def test_nothing_to_check_is_valid():
    assert check({}) == {}


# ---- which paths may be named --------------------------------------------------------


@pytest.mark.parametrize("path", ["nope", "wbmParam.nothing", "wbmParam", "Spinup", "spinup.loops", ""])
def test_an_unknown_path_is_refused(path):
    assert "not a model parameter" in check({path: "1"})[path]


@pytest.mark.parametrize(
    "resolved, values, path",
    [
        (W, WYOMING, "Spinup.Save_Vars"),
        (W, WYOMING, "PET.Scale"),
        (W, WYOMING, "wbmParam.ncDouble"),
        (W, WYOMING, "Aquifers"),
        (W, WYOMING, "Aquifers.Type"),
        (M, V2, "Irrigation.AqfCoeff"),
    ],
)
def test_a_path_outside_the_version_is_refused(resolved, values, path):
    message = check({path: "1"}, resolved, values)[path]
    assert message == f"WBM {resolved.version} does not read this parameter."


@pytest.mark.parametrize("path", ["MT_Code_Name.Run_Start", "MT_Code_Name.Run_End", "Output_vars", "PostProcessing", "PostProcessing.Run"])
def test_a_draft_field_path_is_refused(path):
    assert "own field in the draft" in check({path: "1"})[path]


@pytest.mark.parametrize("path", ["Projection", "MT_Code_Name.spool_dir", "Spinup.State_ID", "MT_Code_Name.Output_dir"])
def test_a_locked_path_is_refused(path):
    assert "gateway sets" in check({path: "x"})[path]


def test_an_inert_path_is_refused():
    assert "does not use" in check({"DIN.BFI": "1"})["DIN.BFI"]
    assert "does not use" in check({"WaterRights.domExThd": "1"})["WaterRights.domExThd"]


@pytest.mark.parametrize("path", ["Network", "MT_Precip.Primary", "Irrigation.CropParFile", "Reservoirs.File"])
def test_a_field_the_wizard_only_shows_is_refused(path):
    assert check({path: "1"})[path] == "This parameter cannot be changed here."


# ---- values -----------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["abc", ".5", "1,5", "", " 5", "5 ", "1e", "--1", "٣", "0x10"])
def test_a_non_number_in_a_number_field_is_refused(value):
    assert check({"wbmParam.alpha": value})["wbmParam.alpha"]


@pytest.mark.parametrize("value", ["5", "5.", "-2.5", "+3", "1e3", "2.5E-2", "0"])
def test_numbers_in_wbms_form_are_accepted(value):
    assert check({"wbmParam.alpha": value}) == {}


def test_a_number_too_large_to_be_finite_is_refused():
    assert "too large" in check({"wbmParam.alpha": "1e999"})["wbmParam.alpha"]


@pytest.mark.parametrize("value", ["1.5", "1e2", "x", "", "-"])
def test_an_int_is_a_whole_number(value):
    assert check({"Spinup.Loops": value})["Spinup.Loops"]


def test_a_value_outside_its_range_min_or_max_is_refused():
    assert check({"Irrigation.ReturnCoeff": "1.5"})["Irrigation.ReturnCoeff"] == "Must be between 0 and 1."
    assert check({"Irrigation.ReturnCoeff": "-0.1"})["Irrigation.ReturnCoeff"] == "Must be between 0 and 1."
    assert check({"Irrigation.ReturnCoeff": "1"}) == {} and check({"Irrigation.ReturnCoeff": "0"}) == {}
    assert check({"Spinup.Loops": "-1"})["Spinup.Loops"] == "Must be at least 0."
    assert check({"MT_Precip.Scale": "-0.5"})["MT_Precip.Scale"] == "Must be at least 0."


def test_a_value_outside_its_options_is_refused():
    message = check({"wbmParam.Infiltration": "Richards"})["wbmParam.Infiltration"]
    assert message == "Choose one of: FrAMES, HBV."
    assert "Choose one of" in check({"Irrigation.Order": "2"})["Irrigation.Order"]
    assert check({"Irrigation.Order": "Groundwater first"})  # the value, not the label
    assert check({"MT_Code_Name.Calendar": "360"})["MT_Code_Name.Calendar"].startswith("Choose one of")


def test_an_option_that_is_the_empty_string_may_be_chosen():
    assert check({"landCollapse": ""}) == {}
    assert check({"landCollapse": "average"}) == {}
    assert "Choose one of" in check({"landCollapse": "avg"})["landCollapse"]


@pytest.mark.parametrize("value", ["2", "true", "", "01", "1.0"])
def test_a_flag_is_zero_or_one(value):
    assert check({"wbmParam.NC4": value})["wbmParam.NC4"]
    assert check({"wbmParam.NC4": "0"}) == {} and check({"wbmParam.NC4": "1"}) == {}


@pytest.mark.parametrize("value", ["2000-13-01", "2000-02-30", "2000-1-1", "01/02/2000", "", "2000-01-01T00"])
def test_a_date_is_a_real_iso_date(value):
    assert check({"Spinup.Start": value})["Spinup.Start"]


def test_non_ascii_is_refused_in_any_field():
    for path, value in [("Comment", "café"), ("wbmParam.alpha", "5°"), ("Glaciers", "é")]:
        assert "ASCII" in check({path: value})[path], path


def test_a_string_is_a_short_single_line_in_its_form():
    assert "too long" in check({"Comment": "x" * 257})["Comment"]
    assert check({"Comment": "x" * 256}) == {}
    assert "single line" in check({"Comment": "one\ntwo"})["Comment"]
    assert check({"Comment": ""})["Comment"].startswith("A value is needed")
    assert check({"MT_Code_Name.Time_Series": "hourly"})
    assert check({"MT_Code_Name.Time_Series": "daily{4}"}) == {}


def test_time_series_forms_differ_by_version():
    assert check({"MT_Code_Name.Time_Series": "daily[5]"}, M, V2) == {}
    assert check({"MT_Code_Name.Time_Series": "daily[5]"}, W, WYOMING)


def test_a_non_text_value_is_refused():
    assert check({"wbmParam.alpha": 5})["wbmParam.alpha"] == "The value must be text."
    assert check({"wbmParam.alpha": None})["wbmParam.alpha"] == "The value must be text."


def test_one_message_per_bad_key():
    errors = check({"wbmParam.alpha": "x", "nope": "1", "Spinup.Loops": "2", "Projection": "x"})
    assert set(errors) == {"wbmParam.alpha", "nope", "Projection"}


def test_an_option_the_inits_datasets_cannot_support_is_refused():
    assert "Choose one of: Hamon." == check({"PET": "FAO-56"})["PET"]
    assert check({"PET": "Hamon"}) == {}


# ---- modules ---------------------------------------------------------------------------------


def test_an_empty_value_switches_a_module_that_is_on_off():
    assert check({"Glaciers": ""}) == {}
    assert check({"Irrigation": ""}) == {}
    assert check({"openWaterEvap": ""}, M, V2) == {}


def test_an_empty_value_is_refused_on_a_module_that_is_off_or_cannot_be_switched_off():
    assert check({"DIN": ""})["DIN"] == "This module is already off."
    assert check({"Glaciers": ""}, M, V2)["Glaciers"] == "This module is already off."
    assert check({"USGS": ""}, M, {"USGS": "/x.csv"})["USGS"] == "This module cannot be switched off here."


def test_a_module_takes_nothing_but_the_empty_value():
    assert "only be switched off" in check({"Glaciers": "1"})["Glaciers"]


def test_an_empty_value_is_refused_on_a_field_that_is_not_a_module():
    assert "only switches a module off" in check({"wbmParam.alpha": ""})["wbmParam.alpha"]


def test_a_field_of_a_module_that_is_off_is_refused():
    message = check({"WaterDemand.DomDemandReturnFr": "0.5"})["WaterDemand.DomDemandReturnFr"]
    assert "module is off" in message
    assert "module is off" in check({"Irrigation.ReturnCoeff": "0.5"}, M, V2)["Irrigation.ReturnCoeff"]


def test_a_field_of_a_module_switched_off_in_the_same_save_is_refused():
    errors = check({"Irrigation": "", "Irrigation.ReturnCoeff": "0.2"})
    assert set(errors) == {"Irrigation.ReturnCoeff"}
    assert "being switched off" in errors["Irrigation.ReturnCoeff"]


def test_a_field_in_a_block_file_is_refused_and_one_in_an_empty_block_is_not():
    # Reservoirs => '/wbm/data_init/dams/...init' and Routing => 'LRR' hold no block to edit
    for path in ("Reservoirs.search_dist", "Routing.velocity", "Routing.method"):
        assert "set from a file" in check({path: "1"})[path], path
    # wbmParam => '' in v2 is no block yet, so a change writes the block
    assert check({"wbmParam.alpha": "3"}, M, V2) == {}


# ---- dropping what the snapshot has --------------------------------------------------------------------


def drop(custom, resolved=W, values=WYOMING):
    return validate.drop_unchanged(custom, resolved, values)


def test_an_entry_equal_to_the_snapshots_value_is_dropped():
    custom = {"Spinup.Loops": "2", "Irrigation.ReturnCoeff": "0.5", "Irrigation.Order": "1", "wbmParam.alpha": "5"}
    assert drop(custom) == {"wbmParam.alpha": "5"}  # alpha is absent from the init: a real change


def test_numbers_are_compared_as_numbers():
    assert drop({"Irrigation.ReturnCoeff": "0.50", "Spinup.Loops": "2.0", "Irrigation.useVIS": "0.0"}) == {}
    assert drop({"Irrigation.ReturnCoeff": "0.51", "Spinup.Loops": "3"}) == {
        "Irrigation.ReturnCoeff": "0.51",
        "Spinup.Loops": "3",
    }


def test_a_module_that_is_off_with_an_empty_key_is_unchanged_but_an_absent_one_is_not():
    assert drop({"ConnectivityNetwork": ""}) == {}
    assert drop({"DIN": ""}) == {"DIN": ""}  # absent: kept, and validate refuses it


def test_an_alias_value_is_what_the_init_has():
    assert drop({"Irrigation.IrrSearchDist": "100"}) == {}
    assert drop({"Irrigation.IrrSearchDist": "120"}) == {"Irrigation.IrrSearchDist": "120"}


def test_entries_that_are_unknown_or_not_text_are_kept_for_validation():
    custom = {"nope": "1", "wbmParam.alpha": 5}
    assert drop(custom) == custom


# ---- typing for the changes file (criterion 3) ------------------------------------------------------------------


def typed(custom, resolved=W, values=WYOMING):
    return validate.typed_changes(custom, resolved, values)


def test_numbers_become_numbers_and_the_rest_stays_text():
    out = typed(
        {
            "wbmParam.alpha": "3",  # number
            "wbmParam.maxRffStorage": "1e3",
            "Spinup.Loops": "1",  # int
            "wbmParam.NC4": "0",  # bool01
            "Irrigation.Order": "0",  # an enum is text
            "wbmParam.Infiltration": "HBV",
            "Spinup.Start": "2000-02-01",  # date
            "Comment": "hi",
        }
    )
    assert out == {
        "wbmParam.alpha": 3.0,
        "wbmParam.maxRffStorage": 1000.0,
        "Spinup.Loops": 1,
        "wbmParam.NC4": 0,
        "Irrigation.Order": "0",
        "wbmParam.Infiltration": "HBV",
        "Spinup.Start": "2000-02-01",
        "Comment": "hi",
    }
    assert type(out["Spinup.Loops"]) is int and type(out["wbmParam.NC4"]) is int
    assert type(out["wbmParam.alpha"]) is float


def test_a_module_switched_off_is_the_empty_string():
    assert typed({"Glaciers": ""}) == {"Glaciers": ""}


def test_a_change_goes_to_the_alias_the_init_uses():
    assert typed({"Irrigation.IrrSearchDist": "120"}) == {"Irrigation.SearchDist": 120.0}
    # an init without the alias is written under the key's own name
    assert typed({"Irrigation.IrrSearchDist": "120"}, M, V2) == {"Irrigation.IrrSearchDist": 120.0}


# ---- datasets that take a constant number --------------------------------------------------


@pytest.mark.parametrize("resolved, values", [(W, WYOMING), (M, V2)])
@pytest.mark.parametrize("value", ["0.3", "5", "1e-2", "-1"])
def test_a_dataset_that_accepts_a_number_takes_a_constant(resolved, values, value):
    assert check({"wbmParam.RhRt2": value}, resolved, values) == {}


@pytest.mark.parametrize("resolved, values", [(W, WYOMING), (M, V2)])
@pytest.mark.parametrize("value", ["/wbm/data_init/x.init", "abc", ".5", "", "1e999"])
def test_anything_but_a_number_is_refused_for_such_a_field(resolved, values, value):
    message = check({"wbmParam.RhRt2": value}, resolved, values)["wbmParam.RhRt2"]
    assert message
    if value != "1e999":
        assert "constant number is the only value the wizard offers" in message


def test_a_dataset_that_does_not_accept_a_number_is_still_refused():
    assert check({"Network": "5"})["Network"] == "This parameter cannot be changed here."
    assert check({"MT_Precip.Primary": "5"})["MT_Precip.Primary"] == "This parameter cannot be changed here."


def test_such_a_field_follows_its_modules_editable_rules():
    assert "module is off" in check({"Irrigation.ExtraCoeff": "1"}, M, V2)["Irrigation.ExtraCoeff"]
    assert check({"rootingDepth": "1", "Reservoirs": ""}) == {}
    assert "being switched off" in check({"Irrigation.ExtraCoeff": "1", "Irrigation": ""})["Irrigation.ExtraCoeff"]


def test_a_constant_for_a_dataset_is_the_same_as_the_snapshots_when_it_is_that_number():
    node = W.fields["wbmParam.RhRt2"]
    assert validate.drop_unchanged({"wbmParam.RhRt2": "0.20"}, W, {"wbmParam": {"RhRt2": "0.2"}}) == {}
    assert validate.drop_unchanged({"wbmParam.RhRt2": "0.3"}, W, {"wbmParam": {"RhRt2": "0.2"}}) == {
        "wbmParam.RhRt2": "0.3"
    }
    assert node.edit_as == "number"


def test_a_constant_is_typed_as_a_json_number():
    out = validate.typed_changes({"wbmParam.RhRt2": "0.3", "rootingDepth": "2"}, W, WYOMING)
    assert out == {"wbmParam.RhRt2": 0.3, "rootingDepth": 2.0}
    assert all(type(v) is float for v in out.values())


# ---- a module cannot be switched off while its outputs are listed ---------------------------

GLACIER_OUTPUTS = ["discharge", "glMelt", "runoff_pg", "soilMoist_pg"]


def test_a_module_with_listed_outputs_is_refused_and_the_message_names_them():
    errors = check({"Glaciers": ""}, variables=GLACIER_OUTPUTS)
    assert list(errors) == ["Glaciers"]
    assert "remove glMelt first" in errors["Glaciers"]
    assert "remove runoff_pg, soilMoist_pg first" in errors["Glaciers"]
    assert "Primary-source glacier tracking needs glacier melt" in errors["Glaciers"]


def test_glaciers_is_refused_for_a_pg_variable_alone_and_for_glmelt_alone():
    only_pg = check({"Glaciers": ""}, variables=["runoff_pg"])["Glaciers"]
    assert "runoff_pg" in only_pg and "glMelt" not in only_pg
    only_melt = check({"Glaciers": ""}, variables=["glMelt"])["Glaciers"]
    assert "glMelt" in only_melt and "Primary-source" not in only_melt


def test_other_modules_name_their_own_outputs():
    errors = check({"Irrigation": ""}, variables=["irrigationGross", "etIrrCrops", "discharge"])
    assert "remove irrigationGross, etIrrCrops first" in errors["Irrigation"]
    assert "Primary-source" not in errors["Irrigation"]
    assert "remove dischMsk first" in check({"Runoff_mask": ""}, variables=["dischMsk"])["Runoff_mask"]


def test_a_module_with_no_unlocked_output_listed_is_accepted():
    assert check({"Glaciers": ""}, variables=["discharge", "runoff", "runoff_ps"]) == {}
    assert check({"Irrigation": ""}, variables=["glMelt", "runoff_pg"]) == {}
    assert check({"Reservoirs": ""}, variables=GLACIER_OUTPUTS) == {}
    assert check({"Glaciers": ""}) == {}


def test_outputs_do_not_matter_while_the_module_stays_on():
    assert check({"wbmParam.alpha": "2"}, variables=GLACIER_OUTPUTS) == {}
