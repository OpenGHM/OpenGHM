"""The checks across a draft's parameters (`app.wbm_init.cross_rules`, mission
2026-10-23-run-cross-rules): the registry of the tree's rule ids, each rule on a run built from
the published inits, the run as the draft will make it, the dates a run reads, and dataset file
coverage against the real v2 and Global/Wyoming model inputs recorded in
`tests/fixtures/model_input/` (a fake bucket, `tests/s3_fake.py`; no network).
"""

from __future__ import annotations

import asyncio
import copy
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.models.job import JobParameters
from app.services import job_script, model_parameters
from app.wbm_init import cross_rules as cr
from app.wbm_init import model_input as mi
from app.wbm_init import reader, tree

from s3_fake import FakeBucket

FIXTURES = Path(__file__).parent / "fixtures"
MODEL_INPUT_V2 = "52585562109e15bd7b06fad0e6deb17d1f4fa72a38474828adac5e74c169bc5d"
EXAMPLES = Path(__file__).parents[3] / "schemas" / "snapshot-spec" / "examples"

#: name -> (the catalogue document, the run init, the model input's fixture folder)
SNAPSHOTS = {
    "v2": ("wbm_storage_v2.0.0.json", FIXTURES / "post_processing" / "fc66a2cd_wbm_test.init", "52585562"),
    "global": ("wbm_storage_v1.0.0_Global.json", FIXTURES / "post_processing" / "v1_Global_tracking.init", "ff0ba2e5"),
    "wyoming": ("wbm_storage_v1.0.0_Wyoming.json", FIXTURES / "wbm_init" / "Wyoming_tracking.init", "ff0ba2e5"),
}


def run(coro):
    return asyncio.run(coro)


def snapshot_of(name: str) -> tuple[str, dict, model_parameters.Loaded]:
    doc_file, init_file, _ = SNAPSHOTS[name]
    doc = json.loads((EXAMPLES / doc_file).read_text())
    snapshot_id = doc["id"]
    loaded = model_parameters.Loaded(
        tree.resolve(doc["uses"]["modelCode"]["version"]), reader.read(init_file.read_text())
    )
    return snapshot_id, doc, loaded


def defaults(doc: dict, **over) -> JobParameters:
    return JobParameters(**{**job_script.snapshot_defaults(doc).model_dump(), **over})


@pytest.fixture
def bucket(monkeypatch) -> FakeBucket:
    fake = FakeBucket().install(monkeypatch)
    for _, _, folder in SNAPSHOTS.values():
        fake.add_model_input(folder)
    return fake


def check(name: str, **over) -> cr.Checks:
    snapshot_id, doc, loaded = snapshot_of(name)
    return run(cr.check(snapshot_id, doc, loaded, defaults(doc, **over)))


def failed(checks: cr.Checks) -> dict[str, cr.Finding]:
    return {f.rule: f for f in checks.findings}


# ---- the registry -----------------------------------------------------------------------------


def test_every_rule_id_of_the_tree_is_evaluated_or_listed_as_not_evaluated():
    ids = {r["id"] for v in tree.code_versions() for r in tree.cross_rules(v)}
    assert len(ids) == 39
    registered = [set(cr.EVALUATORS), set(cr.FILE_RULES), set(cr.NOT_EVALUATED)]
    for i, one in enumerate(registered):
        for other in registered[i + 1 :]:
            assert not one & other, f"in two places: {sorted(one & other)}"
    neither = ids - set().union(*registered)
    assert not neither, f"in none of EVALUATORS, FILE_RULES and NOT_EVALUATED: {sorted(neither)}"
    stale = set().union(*registered) - ids
    assert not stale, f"not a rule of the tree: {sorted(stale)}"


def test_a_rule_that_is_not_evaluated_says_why():
    assert set(cr.NOT_EVALUATED) == {"output_dir_absolute"}
    assert all(len(reason) > 40 for reason in cr.NOT_EVALUATED.values())


def test_the_rules_of_a_version_leave_out_the_other_versions():
    v22 = {r["id"] for r in tree.cross_rules("22.1.1")}
    v23 = {r["id"] for r in tree.cross_rules("23.9.0")}
    assert "springs_need_aquifers" in v23 - v22
    assert "muskingum_fallback_22" in v22 - v23


def test_a_module_needs_the_required_children_that_belong_to_it_and_not_to_one_of_its_forms():
    needs = tree.module_requirements("23.9.0")
    # `Runoff_mask`'s polygon and sub-pixel forms each require their own files: not the module's
    assert needs["Runoff_mask"] == ("Runoff_mask.colID", "Runoff_mask.colName")
    assert needs["Irrigation"] == ("Irrigation.CropAreaFrac", "Irrigation.CropParFile")
    assert needs["Glaciers"] == ("Glaciers.glMelt", "Glaciers.glArea")
    assert needs["Aquifers"] == ("Aquifers.Type",)
    assert needs["openWaterEvap"] == ()  # a module that is one dataset needs no child
    assert "Aquifers" not in tree.module_requirements("22.1.1")  # a 23.9.0 module


# ---- the run as it will be ---------------------------------------------------------------------


def make_ctx(values: dict, version: str = "23.9.0", inits=None, outputs=None) -> cr.Ctx:
    names = cr.output_names(values.get("Output_vars") or "") if outputs is None else tuple(outputs)
    return cr.Ctx(cr.Run(version, tree.resolve(version), values, names, frozenset()), values, inits or {})


def v2_values() -> dict:
    return reader.read(SNAPSHOTS["v2"][1].read_text())


def wyoming_values() -> dict:
    return reader.read(SNAPSHOTS["wyoming"][1].read_text())


def issues(rule: str, ctx: cr.Ctx) -> list[cr.Issue]:
    return list(cr.EVALUATORS[rule](ctx))


def say(rule: str, ctx: cr.Ctx) -> str:
    return " ".join(i.message for i in issues(rule, ctx))


def test_changes_are_set_as_the_toolkit_sets_them():
    out = cr.apply_changes(
        {"A": {"b": "1"}, "PET": "Hamon", "Routing": "LRR", "M": ""},
        {"A.b": 2, "A.c": 0.5, "New.deep.key": 1, "PET.Scale": 1.5, "Routing.velocity": 3.0, "M.x": "y", "Top": "t"},
    )
    assert out == {
        "A": {"b": "2", "c": "0.5"},
        "New": {"deep": {"key": "1"}},
        "PET": {"method": "Hamon", "Scale": "1.5"},
        "Routing": {"method": "LRR", "velocity": "3"},
        "M": {"x": "y"},
        "Top": "t",
    }


def test_the_output_names_are_read_as_wbm_reads_them():
    assert cr.output_names("  runoff\n\t discharge runoff ") == ("runoff", "discharge")
    assert cr.output_names("") == ()


def test_a_draft_at_the_snapshots_defaults_is_the_published_init():
    snapshot_id, doc, loaded = snapshot_of("wyoming")
    effective = cr.effective_run(doc, loaded, defaults(doc))
    assert effective.values == loaded.values
    assert effective.changed == frozenset()
    assert effective.outputs[:2] == ("runoff", "runoff_ps")


def test_the_drafts_period_variables_post_processing_and_custom_parameters_are_applied():
    snapshot_id, doc, loaded = snapshot_of("v2")
    parameters = defaults(
        doc,
        temporal_range_start="2000-07-01",
        temporal_range_end="2001-06-30",
        variables=["runoff", "dischMsk"],
        post_processing="climatology",
        custom_params={"wbmParam.alpha": "7", "Spinup.Loops": "0", "openWaterEvap": "", "Spinup.Loops ": "1"},
    )
    effective = cr.effective_run(doc, loaded, parameters)
    v = effective.values
    assert (v["MT_Code_Name"]["Run_Start"], v["MT_Code_Name"]["Run_End"]) == ("2000-07-01", "2001-06-30")
    assert v["Output_vars"] == "runoff dischMsk" and effective.outputs == ("runoff", "dischMsk")
    assert v["PostProcessing"]["Run"] == "1"
    assert v["wbmParam"] == {"alpha": "7"}  # `wbmParam => ''` becomes the block
    assert v["Spinup"]["Loops"] == "0"
    assert v["openWaterEvap"] == ""  # switched off
    assert effective.changed >= {
        "MT_Code_Name.Run_Start", "Output_vars", "PostProcessing.Run", "wbmParam.alpha", "openWaterEvap",
    }
    assert loaded.values["MT_Code_Name"].get("Run_Start") is None  # the snapshot's own is untouched


def test_a_period_equal_to_the_snapshots_is_not_a_change():
    snapshot_id, doc, loaded = snapshot_of("v2")
    effective = cr.effective_run(doc, loaded, defaults(doc, temporal_range_end="2001-12-31"))
    assert "MT_Code_Name.Run_End" not in effective.changed


def test_a_post_processing_choice_changes_nothing_when_the_init_has_no_block():
    snapshot_id, doc, loaded = snapshot_of("v2")
    values = copy.deepcopy(loaded.values)
    values["PostProcessing"] = ""
    effective = cr.effective_run(doc, model_parameters.Loaded(loaded.resolved, values), defaults(doc, post_processing="standard"))
    assert effective.values["PostProcessing"] == ""


def test_a_custom_parameter_the_tree_refuses_is_left_out_not_raised():
    snapshot_id, doc, loaded = snapshot_of("v2")
    effective = cr.effective_run(doc, loaded, defaults(doc, custom_params={"nope.key": "1", "wbmParam.alpha": "x"}))
    assert effective.values == loaded.values


# ---- the dates a run reads ---------------------------------------------------------------------


def test_the_window_is_the_spinup_loop_and_the_run():
    ctx = make_ctx(v2_values())
    window = cr.window_of(ctx)
    assert [(s.start, s.end) for s in window.spans] == [
        (date(2000, 1, 1), date(2000, 12, 31)),
        (date(2000, 1, 1), date(2001, 12, 31)),
    ]
    # the run starts at the spin-up start when it has no start of its own (M:492)
    assert (window.run.start_path, window.run.end_path) == ("Spinup.Start", "MT_Code_Name.Run_End")
    assert len(window.dates()) == 731 and window.dates()[0] == date(2000, 1, 1)
    assert window.span_of(date(2000, 3, 1)).start_path == "Spinup.Start"


def test_a_spinup_that_is_not_the_runs_own_dates_is_a_span_of_its_own():
    values = cr.apply_changes(v2_values(), {"Spinup.Start": "1995-03-15", "Spinup.End": "1995-04-10", "Spinup.Loops": 2, "MT_Code_Name.Run_Start": "2000-01-01"})
    window = cr.window_of(make_ctx(values))
    # the loop reads whole months: the 1st of the first, the last day of the last (M:4157-4158)
    assert [(s.start, s.end) for s in window.spans][0] == (date(1995, 3, 1), date(1995, 4, 30))
    assert date(1998, 1, 1) not in window.dates() and date(1995, 3, 1) in window.dates()


def test_no_spinup_loops_is_no_spinup_span():
    values = cr.apply_changes(v2_values(), {"Spinup.Loops": 0, "MT_Code_Name.Run_Start": "2000-06-01"})
    assert len(cr.window_of(make_ctx(values)).spans) == 1


def test_a_run_without_an_end_ends_where_the_air_temperature_dataset_does():
    values = copy.deepcopy(v2_values())
    del values["MT_Code_Name"]["Run_End"]
    ctx = make_ctx(values)
    assert cr.window_of(ctx) is None
    assert cr.window_of(ctx, "2015-12-31").run.end == date(2015, 12, 31)
    assert cr.window_of(ctx, "2015-12-31").run.end_path == "MT_airT.Primary"


@pytest.mark.parametrize("start, end", [("", "2001-12-31"), ("2001-12-31", "2000-01-01"), ("x", "2001-12-31"), ("2000-02-30", "2001-12-31")])
def test_dates_that_cannot_be_told_have_no_window(start, end):
    values = cr.apply_changes(v2_values(), {"MT_Code_Name.Run_Start": start or "x", "MT_Code_Name.Run_End": end})
    if not start:
        values["MT_Code_Name"]["Run_Start"] = ""
        values["Spinup"]["Start"] = ""
    assert cr.window_of(make_ctx(values)) is None


def test_a_monthly_run_reads_one_date_per_month_and_a_365_calendar_has_no_leap_day():
    values = cr.apply_changes(v2_values(), {"Spinup.Loops": 0, "MT_Code_Name.Run_Start": "2000-01-00", "MT_Code_Name.Run_End": "2000-12-00"})
    window = cr.window_of(make_ctx(values))
    assert window.monthly and window.dates() == [date(2000, m, 1) for m in range(1, 13)]
    values = cr.apply_changes(v2_values(), {"Spinup.Loops": 0, "MT_Code_Name.Calendar": "365"})
    window = cr.window_of(make_ctx(values))
    assert window.no_leap and date(2000, 2, 29) not in window.dates() and len(window.dates()) == 730


# ---- the rules that need no file ---------------------------------------------------------------


def rule_cases():
    """(rule, how to break the v2 init, a sentence the message holds). The v2 init passes every rule."""
    return [
        ("run_start_or_spinup_start", {"MT_Code_Name.Run_Start": "", "Spinup.Start": ""}, "no start date"),
        ("run_start_or_spinup_start", {"MT_Code_Name.Run_Start": "2000/01/01"}, "not a date written YYYY-MM-DD"),
        ("run_end_airT", {"MT_Code_Name.Run_End": "", "MT_airT.Primary": ""}, "needs a mean air temperature"),
        ("run_start_before_end", {"MT_Code_Name.Run_Start": "2002-01-01"}, "starts on 2002-01-01 but ends on 2001-12-31"),
        ("run_start_before_end", {"MT_Code_Name.Run_End": "soon"}, "run end 'soon' is not a date"),
        ("spinup_loops_dates", {"Spinup.End": ""}, "needs the spin-up start and end"),
        ("spinup_loops_dates", {"Spinup.End": "1999-12-31"}, "starts on 2000-01-01 but ends on 1999-12-31"),
        ("spinup_loops_dates", {"Spinup.Start": "June"}, "spin-up date 'June'"),
        ("calendar_not_360", {"MT_Code_Name.Calendar": "360"}, "not coded for it"),
        ("file_size_day_monthly", {"MT_Code_Name.File_Size": "day", "MT_Code_Name.Time_Series": "monthly"}, "monthly run cannot write one file per day"),
        ("file_size_day_monthly", {"MT_Code_Name.File_Size": "day", "MT_Code_Name.Run_Start": "2000-01-00"}, "monthly run"),
        ("network_routing", {"Network": ""}, "no river network"),
        ("network_routing", {"Network": "/wbm/data_init/x.init"}, "must be a raster"),
        ("network_routing", {"Routing": ""}, "no routing"),
        ("soil_fc_wp", {"soilAWCapacity": ""}, "field capacity and the wilting point; missing: FieldCap, WiltingPoint"),
        ("soil_fc_wp", {"soilAWCapacity": "", "FieldCap": "0.3", "WiltingPoint": "0.1"}, "cannot both be constants"),
        ("pet_drivers", {"PET": "FAO-56"}, "missing: MT_windU.Primary, MT_windV.Primary, MT_humidity.Primary, MT_cloudFr.Primary, MT_albedo.Primary"),
        ("pet_pm_canopy", {"PET": "Penman-Monteith"}, "missing: canopyHt, MT_LAI"),
        ("twt_inputs", {"Output_vars": "runoff discharge_twt"}, "discharge_twt needs the annual air temperature"),
        ("bias_correction_pairs", {"WM_mod_precip": "/wbm/data_init/x.init"}, "WM_mod_precip is set without WM_obs_precip"),
        ("springs_need_aquifers", {"Springs": "/wbm/data/s.csv"}, "Springs need the 3D groundwater"),
        ("modflow_required", {"Aquifers.Type": "ModFlow", "Aquifers.DEM": "/wbm/data/d.tif"}, "needs Aquifers.Net_DEM, Aquifers.Aqf_Thick"),
        ("modflow_required", {"Aquifers.Type": "ModFlow", "Aquifers.DEM": "/a.tif", "Aquifers.Net_DEM": "/b.tif", "Aquifers.Aqf_Thick": "/c.tif", "Aquifers.H_DEM_T": "/d.tif", "Aquifers.H_DEPTH_T": "5"}, "both set the same head"),
        ("irrigation_efficiency", {"Irrigation.CropAreaFrac": "/x.init"}, "needs an efficiency that is a data .init or a raster"),
        ("irrigation_efficiency", {"Irrigation.IrrEfficiency": "70"}, "needs an efficiency"),
        ("water_demand_required", {"WaterDemand.PopDensity": "/wbm/data_init/p.init"}, "needs WaterDemand.DomDemandPP"),
        ("open_water_mask", {"openWater.fracOpenWater": "0.1"}, "needs a mask dataset"),
        ("file_modules_need_file", {"Reservoirs.ID": "ID"}, "Reservoirs (Reservoirs) is on but does not set Reservoirs.File, Reservoirs.SkipLines"),
        ("file_modules_need_file", {"ConnectivityNetwork.ID": "ID"}, "ConnectivityNetwork"),
        ("msk_outputs_runoff_mask_pairing", {"Output_vars": "runoff dischMsk"}, "dischMsk needs the Runoff_mask block"),
        ("msk_outputs_runoff_mask_pairing", {"Runoff_mask.maskFile": "/wbm/data/m.asc"}, "needs at least one of dischMsk, runoffMsk and grndWtMsk"),
        ("din_outputs_din_block", {"Output_vars": "runoff DIN_Load"}, "DIN_Load needs the DIN block"),
        ("irr_outputs_without_irrigation", {"Output_vars": "runoff runoff_irr discharge_rlt"}, "runoff_irr, discharge_rlt"),
        ("pg_without_glaciers", {"Output_vars": "runoff runoff_pg"}, "runoff_pg"),
        ("comp_balance_tracking", {"wbmParam.compBalance": "1"}, "compBalance is 1"),
        ("output_vars_self_added", {"Output_vars": "runoff runoff_irr_2 dischMsk_7"}, "runoff_irr_2, dischMsk_7"),
        ("ta_multi_year_start_in_run", {"PostProcessing.TA_multi_year_start": "2003"}, "starts in 2003, but WBM can start it only from 2000 to 2001"),
        ("ta_multi_year_start_in_run", {"PostProcessing.TA_multi_year_timestep": ""}, "needs both its start year and its time step"),
        ("post_processing_required_inputs", {"PostProcessing.Var_list": "nothing_here"}, "no output variable to process"),
        ("post_processing_required_inputs", {"PostProcessing.Polygon_Aggregation.Rasterization_Res": "0.1"}, "needs the IDs"),
    ]


@pytest.mark.parametrize("rule, change, sentence", rule_cases(), ids=lambda v: v if isinstance(v, str) else "")
def test_a_rule_fails_on_what_it_is_about(rule, change, sentence):
    found = say(rule, make_ctx(cr.apply_changes(v2_values(), change)))
    assert sentence in found, f"{rule}: {found!r}"


def test_every_rule_passes_on_each_published_run():
    for name in ("v2", "global", "wyoming"):
        _, doc, loaded = snapshot_of(name)
        ctx = make_ctx(loaded.values, loaded.code_version)
        for rule_id, evaluator in cr.EVALUATORS.items():
            assert list(evaluator(ctx)) == [], f"{name}: {rule_id}"


def test_a_rule_about_the_inside_of_a_block_file_says_nothing_while_the_file_is_unread():
    values = wyoming_values()
    assert values["Reservoirs"].endswith(".init")
    ctx = make_ctx(values, "22.1.1")
    assert ctx.unread("Reservoirs.File")
    assert issues("file_modules_need_file", ctx) == []
    assert issues("module_on_has_value", ctx) == []  # the block is a string here: nothing to count


def test_a_block_file_that_is_read_is_judged_by_what_it_holds():
    values = wyoming_values()
    values["Reservoirs"] = {"ID": "ID", "Lon": "Lon", "Lat": "Lat"}  # as the block file would expand
    ctx = make_ctx(values, "22.1.1")
    assert "does not set Reservoirs.File, Reservoirs.SkipLines" in say("file_modules_need_file", ctx)
    assert issues("module_on_has_value", ctx) == []  # File and SkipLines are said by the rule above


def test_module_on_has_value_counts_the_required_children_of_a_block_that_is_on():
    values = wyoming_values()
    values["Irrigation"] = {"Order": "1"}
    values["Glaciers"] = {"glMelt": "/wbm/data_init/g.init"}
    values["lapseDownscale"] = {"lapseRate": "-6.5"}
    ctx = make_ctx(values, "22.1.1")
    found = {i.paths[0]: i.message for i in issues("module_on_has_value", ctx)}
    assert set(found) == {"Irrigation", "Glaciers", "lapseDownscale"}
    assert "Irrigation.CropAreaFrac, Irrigation.CropParFile" in found["Irrigation"]
    assert "Glaciers.glArea" in found["Glaciers"]


def test_a_module_switched_off_is_not_judged():
    values = cr.apply_changes(wyoming_values(), {"Irrigation": "", "Glaciers": ""})
    ctx = make_ctx(values, "22.1.1")
    assert issues("module_on_has_value", ctx) == []
    assert not ctx.on("Irrigation")


def test_muskingum_on_22_warns_when_a_module_replaces_it_and_always_notes():
    values = cr.apply_changes(wyoming_values(), {"Routing": "Muskingum"})
    ctx = make_ctx(values, "22.1.1")
    assert "Irrigation" in say("muskingum_fallback_22", ctx)
    assert "coarse grids" in say("muskingum_note", ctx)
    values = cr.apply_changes(wyoming_values(), {"Routing.method": "Muskingum", "Irrigation": "", "Reservoirs": ""})
    values = cr.apply_changes(values, {"Glaciers": ""})
    assert "Irrigation" not in say("muskingum_fallback_22", make_ctx(values, "22.1.1"))
    plain = cr.apply_changes(wyoming_values(), {})
    assert issues("muskingum_note", make_ctx(plain, "22.1.1")) == []


def test_the_air_temperature_end_stands_in_for_a_missing_run_end(bucket):
    values = copy.deepcopy(v2_values())
    del values["MT_Code_Name"]["Run_End"]
    air_t = run(mi.read_container_init(mi.Source("s", MODEL_INPUT_V2), "/wbm/data/climate/airTemp/merra2_t2m_d.init"))
    ctx = make_ctx(values, inits={"/wbm/data/climate/airTemp/merra2_t2m_d.init": air_t})
    assert cr._airt_end(ctx) == "2015-12-31"
    assert issues("run_start_before_end", ctx) == []
    values["Spinup"]["Start"] = "2016-01-01"
    ctx = make_ctx(values, inits=ctx.inits)
    assert "starts on 2016-01-01 but ends on 2015-12-31" in say("run_start_before_end", ctx)


def init_file(**keys) -> mi.InitFile:
    body = "{\n" + "".join(f"{k} => '{v}',\n" for k, v in keys.items()) + "}\n"
    return mi.InitFile(mi.Location("model-inputs", MODEL_INPUT_V2, "x/" + keys.get("Code_Name", "x") + ".init"), body, reader.read(body))


def test_precipitation_is_paired_with_its_fraction_and_has_the_units_wbm_reads():
    daily = init_file(Code_Name="p", Time_Series="daily", Units="mm/day")
    monthly = init_file(Code_Name="pm", Time_Series="monthly", Units="mm/month")
    fraction = init_file(Code_Name="f", Time_Series="daily", Units="fraction")
    wet = init_file(Code_Name="pw", Time_Series="monthly", Units="mm/day")
    base = v2_values()
    at = lambda **kw: make_ctx(cr.apply_changes(base, kw), inits={"/wbm/data/p.init": daily, "/wbm/data/pm.init": monthly, "/wbm/data/f.init": fraction, "/wbm/data/pw.init": wet})  # noqa: E731
    assert issues("precip_fraction_pairing", at(**{"MT_Precip.Primary": "/wbm/data/p.init"})) == []
    assert "needs a daily fraction" in say("precip_fraction_pairing", at(**{"MT_Precip.Primary": "/wbm/data/pm.init"}))
    assert issues("precip_fraction_pairing", at(**{"MT_Precip.Primary": "/wbm/data/pm.init", "precipFraction": "/wbm/data/f.init"})) == []
    assert "only for monthly precipitation" in say("precip_fraction_pairing", at(**{"MT_Precip.Primary": "/wbm/data/p.init", "precipFraction": "/wbm/data/f.init"}))
    assert "must be in mm/month" in say("precip_units", at(**{"MT_Precip.Primary": "/wbm/data/pw.init"}))
    daily_bad = init_file(Code_Name="pb", Time_Series="daily", Units="m/s")
    ctx = make_ctx(cr.apply_changes(base, {"MT_Precip.Primary": "/wbm/data/pb.init"}), inits={"/wbm/data/pb.init": daily_bad})
    assert "mm/day or mm/hour" in say("precip_units", ctx)
    ctx = at(**{"MT_Precip.Primary": "/wbm/data/pm.init", "precipFraction": "/wbm/data/pw.init"})
    assert "Units starting 'frac'" in say("precip_units", ctx)


def test_humidity_units_and_the_elevation_that_specific_humidity_needs():
    kg = init_file(Code_Name="h", Time_Series="daily", Units="kg/kg")
    pct = init_file(Code_Name="hp", Time_Series="daily", Units="%")
    odd = init_file(Code_Name="ho", Time_Series="daily", Units="furlongs")
    inits = {"/wbm/data/h.init": kg, "/wbm/data/hp.init": pct, "/wbm/data/ho.init": odd}
    at = lambda **kw: make_ctx(cr.apply_changes(v2_values(), kw), inits=inits)  # noqa: E731
    assert "needs an elevation that is not 0" in say("humidity_units", at(**{"MT_humidity.Primary": "/wbm/data/h.init"}))
    assert "needs an elevation" in say("humidity_units", at(**{"MT_humidity.Primary": "/wbm/data/h.init", "Elevation": "0"}))
    assert issues("humidity_units", at(**{"MT_humidity.Primary": "/wbm/data/h.init", "Elevation": "150"})) == []
    assert issues("humidity_units", at(**{"MT_humidity.Primary": "/wbm/data/hp.init"})) == []
    assert "furlongs" in say("humidity_units", at(**{"MT_humidity.Primary": "/wbm/data/ho.init"}))


def test_a_time_series_in_a_field_read_once_is_a_warning():
    series = init_file(Code_Name="ts", Time_Series="monthly", Start_Date="2000-01-00", End_Date="2001-12-00", File_Path="/wbm/data/a/_YEAR_.nc")
    static = init_file(Code_Name="st", Time_Series="", File_Path="/wbm/data/a/st.nc")
    inits = {"/wbm/data/ts.init": series, "/wbm/data/st.init": static}
    ctx = make_ctx(cr.apply_changes(v2_values(), {"rootingDepth": "/wbm/data/ts.init"}), inits=inits)
    assert "rootingDepth is read as one picture" in say("timeseries_in_layer_field", ctx)
    assert "monthly dataset ts on 2001-01-01" in say("timeseries_in_layer_field", ctx)
    ctx = make_ctx(cr.apply_changes(v2_values(), {"rootingDepth": "/wbm/data/st.init"}), inits=inits)
    assert issues("timeseries_in_layer_field", ctx) == []
    # a precipitation series is read on every date, not once
    ctx = make_ctx(cr.apply_changes(v2_values(), {"MT_Precip.Primary": "/wbm/data/ts.init"}), inits=inits)
    assert issues("timeseries_in_layer_field", ctx) == []


def test_lapse_downscaling_needs_a_mean_air_temperature_and_forcing_with_a_secondary():
    base = cr.apply_changes(v2_values(), {"lapseDownscale.climElevation": "/a.init", "lapseDownscale.netElevation": "/b.init"})
    assert issues("lapse_downscale_requires", make_ctx(base)) == []
    both = cr.apply_changes(base, {"MT_airT.Secondary": "/wbm/data_init/s.init"})
    assert "needs forceSecTemp" in say("lapse_downscale_requires", make_ctx(both))
    forced = cr.apply_changes(both, {"lapseDownscale.forceSecTemp": 1})
    assert issues("lapse_downscale_requires", make_ctx(forced)) == []
    minmax = cr.apply_changes(base, {"MT_airT.Primary": ""})
    assert "not a minimum and maximum pair" in say("lapse_downscale_requires", make_ctx(minmax))


def test_soil_awc_wins_over_field_capacity_and_wilting_point():
    ctx = make_ctx(cr.apply_changes(v2_values(), {"FieldCap": "/wbm/data/f.tif"}))
    assert "does not read FieldCap when soilAWCapacity is set" in say("soil_awc_precedence", ctx)
    assert issues("soil_awc_precedence", make_ctx(v2_values())) == []


def test_a_draft_that_ends_a_year_early_breaks_the_multi_year_start_and_december_31_counts_the_year():
    snapshot_id, doc, loaded = snapshot_of("v2")
    effective = cr.effective_run(doc, loaded, defaults(doc, temporal_range_end="2001-06-30"))
    assert "can start it only from 2000 to 2000" in say("ta_multi_year_start_in_run", make_ctx(effective.values))
    effective = cr.effective_run(doc, loaded, defaults(doc, temporal_range_end="2001-12-31"))
    assert issues("ta_multi_year_start_in_run", make_ctx(effective.values)) == []
    effective = cr.effective_run(doc, loaded, defaults(doc, temporal_range_end="2003-01-31"))
    assert issues("ta_multi_year_start_in_run", make_ctx(effective.values)) == []  # 2001 is inside 2000-2002


def test_post_processing_with_run_0_is_still_judged_but_none_at_all_is_not():
    values = cr.apply_changes(v2_values(), {"PostProcessing.Run": 0, "Output_vars": ""})
    assert "no output variable" in say("post_processing_required_inputs", make_ctx(values))
    off = cr.apply_changes(v2_values(), {"PostProcessing": "", "Output_vars": ""})
    assert issues("post_processing_required_inputs", make_ctx(off)) == []
    assert issues("ta_multi_year_start_in_run", make_ctx(off)) == []


def test_msk_outputs_are_not_counted_for_post_processing_unless_the_block_includes_them():
    values = cr.apply_changes(wyoming_values(), {"Output_vars": "dischMsk runoffMsk"})
    assert "no output variable" in say("post_processing_required_inputs", make_ctx(values, "22.1.1"))
    values = cr.apply_changes(values, {"Runoff_mask.PostProcessing": 1})
    assert issues("post_processing_required_inputs", make_ctx(values, "22.1.1")) == []


# ---- what a message carries --------------------------------------------------------------------


def test_a_finding_has_the_trees_level_and_the_paths_it_concerns(bucket):
    checks = check("v2", variables=["runoff", "dischMsk", "runoff_irr"])
    found = failed(checks)
    assert found["msk_outputs_runoff_mask_pairing"].level == "error"
    assert found["msk_outputs_runoff_mask_pairing"].paths == ("Output_vars", "Runoff_mask")
    assert found["irr_outputs_without_irrigation"].level == "warn"
    assert [f.rule for f in checks.errors] == ["msk_outputs_runoff_mask_pairing"]
    assert [f.rule for f in checks.warnings] == ["irr_outputs_without_irrigation"]
    assert checks.files_checked


def test_a_note_is_not_an_error(bucket):
    snapshot_id, doc, loaded = snapshot_of("wyoming")
    values = cr.apply_changes(loaded.values, {"Routing": "Muskingum"})
    checks = run(cr.check(snapshot_id, doc, model_parameters.Loaded(loaded.resolved, values), defaults(doc)))
    assert failed(checks)["muskingum_note"].level == "info"
    assert failed(checks)["muskingum_fallback_22"].level == "warn"
    assert not checks.errors


def test_the_findings_come_in_the_order_of_the_tree(bucket):
    checks = check("v2", variables=["runoff", "dischMsk", "DIN_Load"], temporal_range_end="2002-06-30")
    order = [r["id"] for r in tree.cross_rules("23.9.0")]
    assert [f.rule for f in checks.findings] == sorted((f.rule for f in checks.findings), key=order.index)
    assert [f.rule for f in checks.errors][0] == "dataset_file_coverage"


# ---- dataset file coverage: the published runs --------------------------------------------------


@pytest.mark.parametrize("name", ["v2", "global", "wyoming"])
def test_each_published_run_passes_every_rule_at_its_defaults(bucket, name):
    checks = check(name)
    assert checks.findings == ()
    assert checks.files_checked


def test_the_v2_run_is_judged_on_the_files_not_on_the_dates_its_init_declares(bucket):
    # `merra2_prectotcorr_d.init` declares 2000-01-01 to 2015-12-31; the model input holds 2000 and 2001
    snapshot_id, doc, loaded = snapshot_of("v2")
    source = mi.source_of(snapshot_id, doc)
    ctx = run(cr.gather_files(source, cr.effective_run(doc, loaded, defaults(doc))))
    assert ctx.inits["/wbm/data/climate/precip/merra2_prectotcorr_d.init"].get("End_Date") == "2015-12-31"
    assert ctx.problems == {}
    fields = {t.field for t in cr.dataset_targets(ctx)}
    assert fields == {"Network", "MT_Precip.Primary", "MT_airT.Primary", "soilAWCapacity", "rootingDepth", "openWaterEvap"}


def test_a_run_ending_after_the_last_precipitation_file_is_refused_with_the_dataset_and_the_date(bucket):
    found = failed(check("v2", temporal_range_end="2002-06-30"))["dataset_file_coverage"]
    assert found.level == "error"
    assert (
        "The dataset merra2_prectotcorr_d read by MT_Precip.Primary has no file for 2002-01-01: "
        "/wbm/data/climate/precip/2002/MERRA2.PRECTOTCORR.2002-01-01.nc is not in the model input. "
        "Its files run up to 2001-12-31." in found.message
    )
    assert "The dataset merra2_t2m_d read by MT_airT.Primary has no file for 2002-01-01" in found.message
    assert found.paths == ("MT_Precip.Primary", "MT_Code_Name.Run_End", "MT_airT.Primary")


def test_a_spinup_starting_before_the_data_is_refused_at_the_spinup_start(bucket):
    found = failed(check("v2", custom_params={"Spinup.Start": "1999-01-01"}))["dataset_file_coverage"]
    assert (
        "The dataset merra2_prectotcorr_d read by MT_Precip.Primary has no data for 1999-01-01: "
        "its Start_Date and End_Date run from 2000-01-01 to 2015-12-31." in found.message
    )
    assert "Spinup.Start" in found.paths and "MT_Precip.Primary" in found.paths
    # only the dates are said: no file of 1999 is looked for, since no date of the dataset is 1999
    assert "no file" not in found.message


def test_a_run_that_starts_before_the_data_is_refused_at_the_run_start(bucket):
    found = failed(check("v2", temporal_range_start="1999-06-01", custom_params={"Spinup.Loops": "0"}))["dataset_file_coverage"]
    assert "has no data for 1999-06-01" in found.message
    assert "MT_Code_Name.Run_Start" in found.paths


def test_a_dataset_that_declares_the_dates_but_lacks_the_files_at_the_start_says_the_first_missing_file(bucket):
    # Global: the glacier monthly and yearly files exist for 1980 and 2000-2009 only
    found = failed(check("global", temporal_range_end="2012-12-31"))["dataset_file_coverage"]
    assert (
        "The dataset glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m read by Glaciers.glMelt has no file "
        "for 2010-01-01: /wbm/data/glaciers/glacier_RDI40_6min_2010_m.nc is not in the model input. "
        "Its files run up to 2009-12-31." in found.message
    )
    assert "Glaciers.glVolume" in found.message
    snapshot_id, doc, loaded = snapshot_of("global")
    early = failed(check("global", temporal_range_start="1995-01-01", custom_params={"Spinup.Start": "1995-01-01"}))
    # no earlier file ran up to it, so no "run up to" is said
    assert "has no file for 1995-01-01" in early["dataset_file_coverage"].message
    assert "run up to" not in early["dataset_file_coverage"].message.split("glMelt")[1].split("The dataset")[0]


def test_wyoming_at_2000_2009_submits_as_before(bucket):
    checks = check("wyoming", temporal_range_start="2000-01-01", temporal_range_end="2009-12-31")
    assert checks.findings == ()


def test_a_shorter_period_inside_the_data_passes_the_coverage(bucket):
    checks = check("v2", temporal_range_start="2000-03-01", temporal_range_end="2001-06-30")
    # the multi-year aggregation starts in 2001, so a run ending in June is refused for that, not for files
    assert "dataset_file_coverage" not in failed(checks)


# ---- dataset file coverage: the forms of a time series ------------------------------------------


MODEL_INPUT = MODEL_INPUT_V2


def v2_source() -> mi.Source:
    _, doc, _ = snapshot_of("v2")
    return mi.source_of(doc["id"], doc)


def coverage(bucket, changes: dict, *, extra_files=(), inits=None, values=None) -> list[cr.Issue]:
    """`cover` for the v2 run with `changes` applied (a dataset the wizard cannot offer yet, so set
    here), `inits` (container path -> text) added to the model input, `extra_files` listed in it.
    Nothing read by an earlier call is kept."""
    mi.reset()
    mi.tree_browse.reset()
    for path, text in (inits or {}).items():
        bucket.put(f"model-inputs/{MODEL_INPUT}/{path.removeprefix('/wbm/data/')}", text)
    for path in extra_files:
        bucket.put(f"model-inputs/{MODEL_INPUT}/{path.removeprefix('/wbm/data/')}")
    snapshot_id, doc, loaded = snapshot_of("v2")
    run_ = cr.effective_run(doc, loaded, defaults(doc))
    run_ = cr.Run(run_.version, run_.resolved, cr.apply_changes(values or run_.values, changes), run_.outputs, run_.changed)
    ctx = asyncio.run(cr.gather_files(v2_source(), run_))
    return asyncio.run(cr.cover(v2_source(), ctx, cr.window_of(ctx, cr._airt_end(ctx))))


def descriptor(code, series, start, end, path, **more) -> str:
    keys = {"Code_Name": code, "Time_Series": series, "Start_Date": start, "End_Date": end, "File_Path": path, **more}
    return "{\n" + "".join(f"{k} => '{v}',\n" for k, v in keys.items()) + "}\n"


def test_a_monthly_dataset_covers_a_daily_run_by_month(bucket):
    init = descriptor("snow", "monthly", "2000-01-00", "2001-12-00", "/wbm/data/snow/_YEAR_/snow._YEAR_-_MONTH_.nc;")
    files = [f"/wbm/data/snow/{y}/snow.{y}-{m:02d}.nc" for y in (2000, 2001) for m in range(1, 13)]
    changes = {"MT_Precip.Secondary": "/wbm/data/snow/snow.init"}
    assert coverage(bucket, changes, inits={"/wbm/data/snow/snow.init": init}, extra_files=files) == []


def test_a_monthly_dataset_that_ends_a_month_early_is_refused_at_the_month(bucket):
    init = descriptor("snow", "monthly", "2000-01-00", "2001-11-00", "/wbm/data/snow/_YEAR_/snow._YEAR_-_MONTH_.nc;")
    files = [f"/wbm/data/snow/{y}/snow.{y}-{m:02d}.nc" for y in (2000, 2001) for m in range(1, 13)]
    found = coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/snow/snow.init"}, inits={"/wbm/data/snow/snow.init": init}, extra_files=files)
    assert len(found) == 1
    assert "The dataset snow read by MT_Precip.Secondary has no data for 2001-12-01: its Start_Date and End_Date run from 2000-01-00 to 2001-11-00." in found[0].message
    assert found[0].paths == ("MT_Precip.Secondary", "MT_Code_Name.Run_End")


def test_a_monthly_file_missing_in_the_middle_is_the_first_date_with_no_file(bucket):
    init = descriptor("snow", "monthly", "2000-01-00", "2001-12-00", "/wbm/data/snow/_YEAR_/snow._YEAR_-_MONTH_.nc;")
    files = [f"/wbm/data/snow/{y}/snow.{y}-{m:02d}.nc" for y in (2000, 2001) for m in range(1, 13) if (y, m) != (2000, 6)]
    found = coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/snow/snow.init"}, inits={"/wbm/data/snow/snow.init": init}, extra_files=files)
    assert "has no file for 2000-06-01: /wbm/data/snow/2000/snow.2000-06.nc is not in the model input. Its files run up to 2000-05-31." in found[0].message


def test_a_yearly_dataset_with_one_file_per_year(bucket):
    init = descriptor("vol", "yearly", "2000-01-00", "2001-12-00", "/wbm/data/vol/vol_YEAR_.nc;")
    changes = {"MT_Precip.Secondary": "/wbm/data/vol/vol.init"}
    both = ["/wbm/data/vol/vol2000.nc", "/wbm/data/vol/vol2001.nc"]
    assert coverage(bucket, changes, inits={"/wbm/data/vol/vol.init": init}, extra_files=both) == []
    bucket.objects.pop(f"model-inputs/{MODEL_INPUT}/vol/vol2001.nc")
    found = coverage(bucket, changes)
    assert "has no file for 2001-01-01: /wbm/data/vol/vol2001.nc" in found[0].message


def test_a_decadal_dataset_is_read_by_decade(bucket):
    init = descriptor("dec", "decadal", "2000-00-00", "2000-00-00", "/wbm/data/dec/dec_YEAR_.nc;")
    changes = {"MT_Precip.Secondary": "/wbm/data/dec/dec.init"}
    assert coverage(bucket, changes, inits={"/wbm/data/dec/dec.init": init}, extra_files=["/wbm/data/dec/dec2000.nc"]) == []
    bucket.objects.pop(f"model-inputs/{MODEL_INPUT}/dec/dec2000.nc")
    assert "dec2000.nc" in coverage(bucket, changes)[0].message


def test_a_climatology_needs_one_cycle_of_files_whatever_the_run(bucket):
    init = descriptor("clim", "monthly_clim", "0000-01-00", "0000-12-00", "/wbm/data/clim/clim_MONTH_.nc;")
    files = [f"/wbm/data/clim/clim{m:02d}.nc" for m in range(1, 12)]  # December is missing
    found = coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/clim/clim.init"}, inits={"/wbm/data/clim/clim.init": init}, extra_files=files)
    assert "has no file for 2001-12-01: /wbm/data/clim/clim12.nc" in found[0].message
    assert found[0].paths == ("MT_Precip.Secondary",)  # no date of the draft can mend it


def test_a_static_dataset_needs_its_file(bucket):
    init = descriptor("stat", "", "", "", "/wbm/data/stat/layer.tif")
    changes = {"MT_Precip.Secondary": "/wbm/data/stat/stat.init"}
    found = coverage(bucket, changes, inits={"/wbm/data/stat/stat.init": init})
    assert "The dataset stat read by MT_Precip.Secondary has no file for 2001-07-01: /wbm/data/stat/layer.tif is not in the model input." in found[0].message
    assert coverage(bucket, changes, extra_files=["/wbm/data/stat/layer.tif"]) == []


def test_a_pyramid_and_a_netcdf_wrapper_are_read_for_their_files(bucket):
    init = descriptor("pyr", "", "", "", "(1e10,1e6):/wbm/data/pyr/low.tif; (1e6,0):NETCDF:/wbm/data/pyr/high.nc:band;")
    changes = {"MT_Precip.Secondary": "/wbm/data/pyr/pyr.init"}
    found = coverage(bucket, changes, inits={"/wbm/data/pyr/pyr.init": init}, extra_files=["/wbm/data/pyr/low.tif"])
    assert "/wbm/data/pyr/high.nc is not in the model input" in found[0].message


def test_a_365_day_dataset_has_no_leap_day_and_the_run_falls_back_to_february_28(bucket):
    init = descriptor("noleap", "daily", "2000-01-01", "2001-12-31", "/wbm/data/nl/_YEAR_/nl._YEAR_-_MONTH_-_DAY_.nc;", Bands="365")
    files = [
        f"/wbm/data/nl/{d.year}/nl.{d.isoformat()}.nc"
        for d in (date.fromordinal(n) for n in range(date(2000, 1, 1).toordinal(), date(2002, 1, 1).toordinal()))
        if (d.month, d.day) != (2, 29)
    ]
    assert coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/nl/nl.init"}, inits={"/wbm/data/nl/nl.init": init}, extra_files=files) == []


def test_a_hourly_dataset_is_refused_for_a_run_that_steps_by_days(bucket):
    init = descriptor("hr", "daily{24}", "2000-01-01", "2001-12-31", "/wbm/data/hr/_YEAR_/hr._YEAR_-_MONTH_-_DAY_.nc;")
    found = coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/hr/hr.init"}, inits={"/wbm/data/hr/hr.init": init})
    assert "is an hourly series" in found[0].message and "cannot read it for a run that steps by days" in found[0].message


def test_a_form_the_check_does_not_read_is_not_judged_and_a_bad_date_is_said(bucket):
    odd = descriptor("odd", "8day", "2000-001", "2001-365", "/wbm/data/odd/_YEAR_.nc;")
    assert coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/odd/odd.init"}, inits={"/wbm/data/odd/odd.init": odd}) == []
    bad = descriptor("bad", "daily", "yesterday", "2001-12-31", "/wbm/data/bad/_YEAR_.nc;")
    found = coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/bad/bad.init"}, inits={"/wbm/data/bad/bad.init": bad})
    assert "Start_Date 'yesterday'" in found[0].message


def test_glacier_area_and_volume_may_start_a_year_after_the_run_as_wbm_looks_them_up_a_year_on(bucket):
    # `glVolume` is read with YR_UP (wbm.pl:1597): a missing date is tried once more a year later.
    init = descriptor("vol", "yearly", "2001-01-00", "2001-12-00", "/wbm/data/vol/vol_YEAR_.nc;")
    files = ["/wbm/data/vol/vol2001.nc"]
    inits = {"/wbm/data/vol/vol.init": init}
    values = cr.apply_changes(v2_values(), {"Glaciers.glMelt": "/wbm/data/vol/vol.init", "Glaciers.glArea": "/wbm/data/vol/vol.init", "Glaciers.glVolume": "/wbm/data/vol/vol.init"})
    # 2000 is a year before the data, 2001 is in it: glVolume and glArea accept it; glMelt does not
    found = coverage(bucket, {}, inits=inits, extra_files=files, values=values)
    assert [i.paths[0] for i in found] == ["Glaciers.glMelt"]
    assert "no data for 2000-01-01" in found[0].message


def test_snow_elevation_bands_need_their_three_files_next_to_the_network(bucket):
    values = cr.apply_changes(v2_values(), {"snowBands": "1"})
    snapshot_id, doc, loaded = snapshot_of("v2")
    run_ = cr.Run(loaded.code_version, loaded.resolved, values, (), frozenset())

    def snow() -> list[cr.Issue]:
        mi.reset()
        mi.tree_browse.reset()
        ctx = asyncio.run(cr.gather_files(v2_source(), run_))
        return asyncio.run(cr._snow_bands(v2_source(), ctx))

    (found,) = snow()
    assert found.paths == ("snowBands", "Network")
    for suffix in (".elvBands.dat", ".elvAverg.dat", ".elvBands.txt"):
        assert f"/wbm/data/network/hyd_5m_CONUS_mississippi_patched{suffix}" in found.message
    for suffix in (".elvBands.dat", ".elvAverg.dat"):
        bucket.put(f"model-inputs/{MODEL_INPUT}/network/hyd_5m_CONUS_mississippi_patched{suffix}")
    (found,) = snow()
    assert "elvBands.txt" in found.message and "elvBands.dat" not in found.message
    bucket.put(f"model-inputs/{MODEL_INPUT}/network/hyd_5m_CONUS_mississippi_patched.elvBands.txt")
    assert snow() == []


def test_a_snapshot_without_snow_bands_judges_no_band_file(bucket):
    snapshot_id, doc, loaded = snapshot_of("v2")
    ctx = asyncio.run(cr.gather_files(v2_source(), cr.effective_run(doc, loaded, defaults(doc))))
    assert asyncio.run(cr._snow_bands(v2_source(), ctx)) == []


def test_snow_bands_are_a_finding_of_their_own_rule(bucket):
    snapshot_id, doc, loaded = snapshot_of("v2")
    values = cr.apply_changes(loaded.values, {"snowBands": "1"})
    checks = run(cr.check(snapshot_id, doc, model_parameters.Loaded(loaded.resolved, values), defaults(doc)))
    assert [f.rule for f in checks.errors] == ["snow_bands_files"]


def test_a_dataset_that_is_not_in_the_model_input_is_said(bucket):
    found = coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/nowhere/x.init"})
    assert "points to /wbm/data/nowhere/x.init, but it is not in the model input." in found[0].message
    assert found[0].paths == ("MT_Precip.Secondary",)


def test_a_data_init_that_cannot_be_read_is_said(bucket):
    found = coverage(bucket, {"MT_Precip.Secondary": "/wbm/data/bad/x.init"}, inits={"/wbm/data/bad/x.init": "this is { not an init"})
    assert "cannot be read" in found[0].message


def test_a_file_field_names_a_file_that_must_exist(bucket):
    found = coverage(bucket, {"Network": "/wbm/data/network/nope.asc"})
    assert "Network names /wbm/data/network/nope.asc, which is not in the model input." in found[0].message


def test_a_path_the_run_makes_itself_is_not_judged(bucket):
    assert coverage(bucket, {"MT_Precip.Secondary": "/wbm/spool/x.init"}) == []


def test_a_module_switched_off_reads_nothing(bucket):
    assert "openWaterEvap" in coverage(bucket, {"openWaterEvap": "/wbm/data/climate/evwater/none.init"})[0].message
    assert coverage(bucket, {"openWaterEvap": ""}) == []
    # a module with children: its datasets are read while it is on and not once it is off
    glaciers = {"Glaciers.glMelt": "/wbm/data/nowhere/melt.init"}
    assert "Glaciers.glMelt points to /wbm/data/nowhere/melt.init" in coverage(bucket, glaciers)[0].message
    assert coverage(bucket, {**glaciers, "Glaciers": ""}) == []


# ---- dataset file coverage: the first file WBM opens for a grid -------------------------------------

GLACIERS = {
    "Glaciers.glMelt": "/wbm/data_init/glaciers/glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m.init",
    "Glaciers.glArea": "/wbm/data_init/glaciers/global_rgi6_glaciers_area_1km.init",
    "Glaciers.glVolume": "/wbm/data_init/glaciers/glacier_RDI40_6min_ERA-Interim_hindcast_Volume_y.init",
}


def test_wbm_opens_the_first_file_of_a_glacier_dataset_and_the_v2_listing_has_none_for_1980(bucket):
    # the v2 model input (52585562) holds glacier files for 2000-2009, the run is 2000-2001, and the
    # datasets start in 1980: WBM opens the 1980 file to read the grid (measured: SLURM 21598634)
    found = coverage(bucket, GLACIERS)
    assert [i.paths for i in found] == [("Glaciers.glMelt",), ("Glaciers.glVolume",)]
    assert found[0].message == (
        "The dataset glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m read by Glaciers.glMelt has no file at "
        "its Start_Date (1980-01-00): WBM opens /wbm/data/glaciers/glacier_RDI40_6min_1980_m.nc when it starts, "
        "to read the grid, and it is not in the model input."
    )
    assert "glacier_RDI40_6min_1980_y.nc" in found[1].message and "(1980-01-00)" in found[1].message
    # the area is a climatology, whose cycle of files the rule reads whole: nothing more to ask of it


def test_the_first_file_is_there_when_the_listing_has_it(bucket):
    files = ["/wbm/data/glaciers/glacier_RDI40_6min_1980_m.nc", "/wbm/data/glaciers/glacier_RDI40_6min_1980_y.nc"]
    assert coverage(bucket, GLACIERS, extra_files=files) == []


@pytest.mark.parametrize("name", ["wyoming", "global"])
def test_the_first_file_is_there_in_the_global_and_wyoming_model_input_which_holds_1980(bucket, name):
    # ff0ba2e5 holds glacier files for 1980 and 2000-2009: the snapshots, with Glaciers on, pass at defaults
    assert check(name).errors == []


def test_the_rule_asks_the_first_file_on_22_1_1_too_for_the_melt_and_the_volume_and_not_for_the_area(bucket):
    snapshot_id, doc, loaded = snapshot_of("wyoming")
    for key in [k for k in bucket.objects if k.endswith("/glaciers/glacier_RDI40_6min_1980_m.nc")]:
        del bucket.objects[key]
    errors = run(cr.check(snapshot_id, doc, loaded, defaults(doc))).errors
    (error,) = errors
    assert "Glaciers.glMelt" in error.paths and "glacier_RDI40_6min_1980_m.nc" in error.message
    # 22.1.1 reads the extent of the area's first file in no line (wbm.pl:655-656 are the melt and the volume)
    assert not tree.resolve("22.1.1").fields["Glaciers.glArea"].reads_first_file
    assert tree.resolve("23.9.0").fields["Glaciers.glArea"].reads_first_file is True


def test_the_air_temperature_first_file_is_asked_for_only_with_lapse_downscale(bucket):
    airt = descriptor("airt99", "daily", "1999-01-01", "2001-12-31", "/wbm/data/climate/airt/_YEAR_/airt._YEAR_-_MONTH_-_DAY_.nc;")
    elevation = descriptor("elev", "yearly_clim", "0000-00-00", "0000-00-00", "/wbm/data/climate/elev.tif;")
    inits = {"/wbm/data/climate/airt99.init": airt, "/wbm/data/climate/elev.init": elevation}
    files = ["/wbm/data/climate/elev.tif"] + [
        f"/wbm/data/climate/airt/{y}/airt.{y}-{m:02d}-{d:02d}.nc"
        for y, m, d in cr_dates(date(2000, 1, 1), date(2001, 12, 31))
    ]
    swap = {"MT_airT.Primary": "/wbm/data/climate/airt99.init"}
    assert coverage(bucket, swap, inits=inits, extra_files=files) == []
    lapse = {**swap, "lapseDownscale.climElevation": "/wbm/data/climate/elev.init", "lapseDownscale.netElevation": "/wbm/data/climate/elev.init"}
    (found,) = coverage(bucket, lapse, inits=inits, extra_files=files)
    assert "The dataset airt99 read by MT_airT.Primary has no file at its Start_Date (1999-01-01)" in found.message
    assert "/wbm/data/climate/airt/1999/airt.1999-01-01.nc" in found.message


def test_a_dated_elevation_dataset_first_file_is_asked_for(bucket):
    elev = descriptor("elev90", "yearly", "1990-01-00", "2001-12-00", "/wbm/data/climate/elev/elev_YEAR_.nc;")
    files = ["/wbm/data/climate/elev/elev2000.nc", "/wbm/data/climate/elev/elev2001.nc"]
    lapse = {"lapseDownscale.climElevation": "/wbm/data/climate/elev90.init", "lapseDownscale.netElevation": "/wbm/data/climate/elev90.init"}
    found = coverage(bucket, lapse, inits={"/wbm/data/climate/elev90.init": elev}, extra_files=files)
    assert sorted(i.paths[0] for i in found) == ["lapseDownscale.climElevation", "lapseDownscale.netElevation"]
    assert all("/wbm/data/climate/elev/elev1990.nc" in i.message for i in found)


def cr_dates(first: date, last: date):
    d = first
    while d <= last:
        yield d.year, d.month, d.day
        d += timedelta(days=1)


# ---- dataset file coverage: what a run init names inside other files ---------------------------


CROP_TABLE = (
    "Land_ID\tGroup\tPriority\tRootDepth\tCropDepletionFactor\tLandFracTS\tKc_TS\tAddedWaterTS\n"
    "Fallow\tFallow\t74\t\t\t/wbm/data_init/crops/fallow.init\t\t\n"
    "Rice\tIrrigated_av\t1\t/wbm/data_init/crops/awcap.init\t0.5\t/wbm/data_init/crops/frac.init\t/wbm/data_init/crops/kc.init\t\n"
    "Orphan\t\t9\t/wbm/data_init/crops/never.init\t\t\t\t\n"
)


def test_the_data_inits_a_crop_table_names_are_read_and_judged(bucket):
    text = descriptor("c", "daily_clim", "0000-01-01", "0000-12-31", "/wbm/data/crops/c.nc")
    inits = {
        "/wbm/data_init/crops/fallow.init": text, "/wbm/data_init/crops/awcap.init": text,
        "/wbm/data_init/crops/frac.init": text, "/wbm/data_init/crops/kc.init": text,
        "/wbm/data_init/crops/params.csv": CROP_TABLE,
    }
    for path, body in inits.items():
        bucket.put(f"model-inputs/{MODEL_INPUT}/{path.removeprefix('/wbm/data/').replace('/wbm/data_init/', 'data_init/')}", body)
    changes = {"Irrigation.CropAreaFrac": "7", "Irrigation.CropParFile": "/wbm/data_init/crops/params.csv", "Irrigation.IrrEfficiency": "/wbm/data_init/crops/kc.init"}
    found = coverage(bucket, changes)
    messages = " ".join(i.message for i in found)
    # the climatology file the tables' inits share is missing; a row with no Group is not read
    assert "Irrigation.CropParFile (row Fallow, column LandFracTS)" in messages
    assert "Irrigation.CropParFile (row Rice, column RootDepth)" in messages
    assert "never.init" not in messages
    # IrrEfficiency, then the four cells of the table that name an init
    assert messages.count("/wbm/data/crops/c.nc is not in the model input") == 5


def test_a_block_file_the_init_names_is_read_for_the_keys_inside_it(bucket):
    block = "{ File => '/wbm/data/dams/d.csv', SkipLines => 0, ID => 'ID', Lon => 'Lon', Lat => 'Lat', IrrFrequency => '/wbm/data_init/irr.init' }"
    irr = descriptor("irr", "daily_clim", "0000-01-01", "0000-12-31", "/wbm/data/irrigation/irr.nc")
    bucket.put(f"model-inputs/{MODEL_INPUT}/data_init/dams/block.init", block)
    bucket.put(f"model-inputs/{MODEL_INPUT}/data_init/irr.init", irr)
    found = coverage(bucket, {"Reservoirs": "/wbm/data_init/dams/block.init"})
    messages = " ".join(i.message for i in found)
    assert "Reservoirs.File names /wbm/data/dams/d.csv, which is not in the model input." in messages
    assert "The dataset irr read by Reservoirs.IrrFrequency has no file for" in messages and "irr.nc" in messages


def test_a_block_file_that_is_missing_is_said(bucket):
    found = coverage(bucket, {"Reservoirs": "/wbm/data_init/dams/none.init"})
    assert found[0].message == "Reservoirs is read from /wbm/data_init/dams/none.init, but it is not in the model input."
    assert found[0].paths == ("Reservoirs",)


# ---- when the files cannot be read ------------------------------------------------------------


def test_a_bucket_that_does_not_answer_leaves_the_coverage_not_checked_and_the_other_rules_running(bucket):
    bucket.fail = OSError("down")
    checks = check("v2", variables=["runoff", "dischMsk"])
    assert not checks.files_checked
    found = failed(checks)
    assert found["dataset_file_coverage"].level == "warn"
    assert "could not be checked right now" in found["dataset_file_coverage"].message
    assert [f.rule for f in checks.errors] == ["msk_outputs_runoff_mask_pairing"]
    # unreachable at every read: one answer, not one timeout per file
    assert len(bucket.calls) < 12


def test_a_bucket_that_fails_at_the_listing_is_not_checked_either(bucket, monkeypatch):
    real = bucket.get

    async def listing_down(url, *, params):
        if params["prefix"].endswith("/climate/precip/2000/"):
            raise OSError("down")
        return await real(url, params=params)

    monkeypatch.setattr(mi.tree_browse, "_get", listing_down)
    checks = check("v2")
    assert not checks.files_checked and failed(checks)["dataset_file_coverage"].level == "warn"


def test_a_snapshot_with_no_model_input_judges_no_file(bucket):
    snapshot_id, doc, loaded = snapshot_of("v2")
    doc = copy.deepcopy(doc)
    doc["uses"].pop("modelInput")
    checks = run(cr.check(snapshot_id, doc, loaded, defaults(doc)))
    assert checks.findings == () and checks.files_checked


# ---- how long it takes --------------------------------------------------------------------------


def test_a_second_check_reads_nothing_again(bucket):
    """What the first check reads (about 60 objects and folders for Global) is kept: published
    artifacts do not change under an id."""
    check("global")
    calls = len(bucket.calls)
    assert calls > 20
    assert check("global").findings == ()
    assert len(bucket.calls) == calls
