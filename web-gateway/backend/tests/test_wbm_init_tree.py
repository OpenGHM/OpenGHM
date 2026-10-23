"""Structure of the WBM parameter tree, `app/wbm_init/param_tree.yaml`.

The tree is the wizard's form schema (docs/architecture/model-parameters.md). These checks
are the structural half of the audit it came from; what WBM does with each value is in
docs/reference/wbm-init.md. They read the file as data and import nothing from the tree
loader, so they hold whatever the loader does. The one exception is the label test at the
end, which asks the loader what the wizard is served.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from app.models.job import JobParameters

WBM_INIT = Path(__file__).resolve().parent.parent / "app" / "wbm_init"
TREE = WBM_INIT / "param_tree.yaml"

CODE_VERSIONS = ["22.1.1", "23.9.0"]

# The top-level keys WBM copies from a run init: wbm_params() in RIMS/WBM.pm, lines 92-95,
# identical in WBM 22.1.1 and 23.9.0 (RIMS/WBM.pm of 23.9.0 is images/wbm-tools-lite/wbm/model/RIMS/WBM.pm;
# 22.1.1 is in the public bucket under wbm-code/wbm/22.1.1/model/RIMS/). `Elevation` is read
# by wbm.pl but is not in the list.
WBM_PARAMS = """
ID Comment Project MT_Code_Name Spinup Output_vars MT_Precip precipFraction MT_airT Network
Projection Routing wbmParam ConnectivityNetwork Reservoirs soilAWCapacity FieldCap WiltingPoint
rootingDepth PET MT_windU MT_windV MT_cloudFr MT_humidity MT_albedo airT_yc openWaterEvap
Glaciers Aquifers Springs snowBands lapseDownscale DIN Runoff_mask Impervious openWater
canopyHt MT_LAI WaterDemand landCollapse LandCover Irrigation WM_mod_precip WM_obs_precip
WM_mod_airT WM_obs_airT PostProcessing WaterRights USGS
""".split()

# Keys WBM tests with exists or defined, so '' is a value and not the same as absent
# (docs/reference/wbm-init.md, "Keys where an empty value is not absence").
EMPTY_IS_VALUE = [
    "MT_Code_Name.spool_dir", "MT_Code_Name.run_state_dir", "MT_Code_Name.MT_file", "MT_Code_Name.credits",
    "MT_Code_Name.MT_ID", "MT_airT.Primary", "Glaciers.glVolume",
    "Aquifers.aqfInfiltFr", "Aquifers.Conf_Thick", "Aquifers.Aqf_Sy", "Aquifers.Aqf_SyCnfd", "Aquifers.Aqf_Ph",
    "Aquifers.Aqf_Kh", "Aquifers.Aqf_Kv", "Aquifers.Aqf_KhConf", "Aquifers.Aqf_KvConf", "Aquifers.eFolding",
    "Aquifers.BRes", "WaterDemand.DomSearchDist", "WaterDemand.IndSearchDist", "WaterDemand.StkSearchDist",
    "WaterDemand.StkRefYear", "Runoff_mask.attFile", "Runoff_mask.maskList", "Runoff_mask.basinIDFile",
]

# The init keys an existing wizard field owns, and the JobParameters field that owns them.
DRAFT_FIELDS = {
    "MT_Code_Name.Run_Start": "temporal_range_start",
    "MT_Code_Name.Run_End": "temporal_range_end",
    "Output_vars": "variables",
    "PostProcessing": "post_processing",
}

OPTION_COUNTS = {"23.9.0": 437, "22.1.1": 407}
ACCEPTS = {"init", "number", "raster", "file"}
TIERS = {"basic", "module", "advanced", "locked"}
SCALAR_TYPES = {"number", "int", "enum", "bool01", "string", "date"}
LEVELS = {"error", "warn", "info"}
TOP_LEVEL = {"schema_version", "code_versions", "availability", "validation", "tree", "cross_rules"}
# Text that belongs to evidence, not to a form schema.
EVIDENCE = re.compile(r"SLURM|measured|\b[WM](\(22\))?:\s?\d|manual L\d|\(L\d+|\bL\d{3}\b|doc_conflicts|inferred")
REMOVED_ATTRIBUTES = {"catalog", "preset_from", "sheet_default", "doc_row", "write_as", "from", "accepts_note"}


class _DupLoader(yaml.SafeLoader):
    duplicates: list[str] = []


def _construct(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        if key_node.tag == "tag:yaml.org,2002:merge":
            continue
        key = loader.construct_object(key_node, deep=True)
        if key in seen:
            _DupLoader.duplicates.append(f"{key!r} at line {key_node.start_mark.line + 1}")
        seen.add(key)
    loader.flatten_mapping(node)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


_DupLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct)


@pytest.fixture(scope="module")
def doc():
    _DupLoader.duplicates = []
    with TREE.open() as f:
        loaded = yaml.load(f, Loader=_DupLoader)  # noqa: S506 - the loader is SafeLoader's subclass
    assert not _DupLoader.duplicates, f"duplicate mapping keys: {_DupLoader.duplicates}"
    return loaded


def walk(nodes, parent_tier=None, in_module=False, owned=False, inert=False):
    """Yield (node, effective_tier, owned_by_draft_field, inert) for every node, depth first.

    The tier of a node is its own, else its parent's, else `basic` at the top; the children of a
    module that sets no tier get `module` (header of param_tree.yaml)."""
    for n in nodes:
        own = n.get("tier")
        if own is not None:
            tier = own
        elif parent_tier is not None:
            tier = parent_tier
        else:
            tier = "module" if in_module else "basic"
        is_owned = owned or "draft_field" in n
        is_inert = inert or bool(n.get("inert"))
        yield n, tier, is_owned, is_inert
        kids = n.get("children") or []
        # a module's tier-less children are `module`, not their parent's `basic`
        child_parent = own if own is not None else (parent_tier if parent_tier is not None else None)
        yield from walk(kids, child_parent, in_module or "module" in n, is_owned, is_inert)


def nodes(doc):
    return [n for n, *_ in walk(doc["tree"])]


def wbm_paths(doc):
    return [n["wbm"] for n in nodes(doc) if "wbm" in n]


def every_value(x):
    if isinstance(x, dict):
        for v in x.values():
            yield from every_value(v)
    elif isinstance(x, list):
        for v in x:
            yield from every_value(v)
    else:
        yield x


def every_key(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from every_key(v)
    elif isinstance(x, list):
        for v in x:
            yield from every_key(v)


def test_parses_with_the_expected_sections(doc):
    assert set(doc) == TOP_LEVEL
    assert doc["code_versions"] == CODE_VERSIONS
    assert doc["schema_version"] == 1


def test_wbm_params_list_is_the_49_keys():
    assert len(WBM_PARAMS) == 49 and len(set(WBM_PARAMS)) == 49


def test_every_node_is_one_kind(doc):
    for n in nodes(doc):
        kinds = [k for k in ("group", "module", "key") if k in n]
        assert len(kinds) == 1, n


def test_every_wbm_path_starts_with_a_key_wbm_reads(doc):
    allowed = set(WBM_PARAMS) | {"Elevation"}
    paths = wbm_paths(doc)
    assert len(paths) > 250
    for w in paths:
        assert w.split(".")[0] in allowed, f"{w}: top-level key is not in wbm_params() and is not Elevation"


def test_wbm_paths_are_unique(doc):
    paths = wbm_paths(doc)
    # a block that is both a group and the home of its children is listed once, as the group
    dupes = {p for p in paths if paths.count(p) > 1}
    assert not dupes, dupes


def test_versions_are_code_versions(doc):
    count = 0
    for k, v in _items(doc):
        if k == "versions":
            count += 1
            assert isinstance(v, list) and v and set(v) <= set(CODE_VERSIONS), v
        if k in ("default", "forms", "pattern") and isinstance(v, dict):
            assert set(v) <= set(CODE_VERSIONS), (k, v)
        if k == "options_from":
            assert set(v) == set(CODE_VERSIONS), v
    assert count >= 10


def _items(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k, v
            yield from _items(v)
    elif isinstance(x, list):
        for v in x:
            yield from _items(v)


def test_accepts_uses_the_four_kinds(doc):
    seen = 0
    for n in nodes(doc):
        if "accepts" in n:
            seen += 1
            assert isinstance(n["accepts"], list) and set(n["accepts"]) <= ACCEPTS, n
    assert seen > 50


def test_tiers_are_known(doc):
    for n, tier, *_ in walk(doc["tree"]):
        assert tier in TIERS, n


def test_default_maps_and_default_from(doc):
    paths = set(wbm_paths(doc))
    for n in nodes(doc):
        if isinstance(n.get("default"), dict):
            assert set(n["default"]) == set(CODE_VERSIONS), n
        if "default_from" in n:
            assert n["default_from"] in paths and "default" not in n, n
    by_wbm = {n["wbm"]: n for n in nodes(doc) if "wbm" in n}
    assert by_wbm["wbmParam.RhRt2"]["default"] == {"23.9.0": 0.2, "22.1.1": 0.56}
    assert by_wbm["Spinup.Save_Vars"]["versions"] == ["23.9.0"]
    assert by_wbm["Aquifers"]["versions"] == ["23.9.0"]
    assert by_wbm["PET.Scale"]["versions"] == ["23.9.0"]


def test_option_files_exist_with_the_expected_counts(doc):
    found = 0
    for n in nodes(doc):
        for version, rel in (n.get("options_from") or {}).items():
            found += 1
            path = WBM_INIT / rel
            assert path.is_file(), path
            text = path.read_text().splitlines()
            assert text[0].startswith("# GENERATED by web-gateway/backend/scripts/gen_output_vars.py"), path
            names = [line for line in text if line and not line.startswith("#")]
            assert len(names) == OPTION_COUNTS[version], (path, len(names))
            assert names == sorted(set(names)), f"{path} is not sorted and unique"
            assert all(re.fullmatch(r"[A-Za-z0-9_]+", name) for name in names), path
    assert found == 2


def test_empty_is_value_is_set_on_the_keys_wbm_tests_with_exists(doc):
    flagged = {n["wbm"] for n in nodes(doc) if n.get("empty_is_value") is True and "wbm" in n}
    assert len(EMPTY_IS_VALUE) == 25
    assert set(EMPTY_IS_VALUE) <= flagged, set(EMPTY_IS_VALUE) - flagged


def test_draft_fields_exist_and_own_the_expected_keys(doc):
    owners = {n["wbm"]: n["draft_field"] for n in nodes(doc) if "draft_field" in n}
    assert owners == DRAFT_FIELDS
    for field in owners.values():
        assert field in JobParameters.model_fields, field
    # the whole PostProcessing block is owned: none of its fields is editable
    for n, _tier, owned, _inert in walk(doc["tree"]):
        if n.get("wbm", "").startswith("PostProcessing"):
            assert owned and "editable" not in n, n


def test_editable_is_what_the_header_says(doc):
    editable = 0
    for n, tier, owned, inert in walk(doc["tree"]):
        want = None
        if "wbm" in n and not owned and not inert and tier != "locked" and n.get("write") != "never" \
                and not n.get("derived") and not n.get("ui_only"):
            if n.get("type") in SCALAR_TYPES:
                want = True
            elif ("module" in n or n.get("switch")) and n.get("on_if") == "key_present":
                want = "switch_off"
        assert n.get("editable") == want, n
        editable += want is not None
    assert editable > 100


def test_dataset_file_column_and_list_fields_are_read_only(doc):
    for n in nodes(doc):
        if n.get("type") in {"dataset", "file", "column", "list", "block"}:
            assert n.get("editable") is not True, n  # a module's off-switch is "switch_off"


def test_only_what_the_gateway_needs_is_left(doc):
    assert not (REMOVED_ATTRIBUTES & set(every_key(doc["tree"]))), REMOVED_ATTRIBUTES & set(every_key(doc["tree"]))
    for gone in ("gateway", "doc_conflicts", "open", "model_inputs", "catalog_source", "presets", "dataset_init"):
        assert gone not in doc


def test_no_evidence_in_any_string(doc):
    bad = [v for v in every_value(doc) if isinstance(v, str) and EVIDENCE.search(v)]
    assert not bad, bad


def test_the_header_names_each_attribute_the_tree_uses():
    header = "\n".join(line for line in TREE.read_text().splitlines() if line.startswith("#"))
    with TREE.open() as f:
        body = yaml.safe_load(f)
    used = {k for n in nodes(body) for k in n} - {"children"}
    missing = {k for k in used if not re.search(rf"\b{re.escape(k)}\b", header)}
    assert not missing, f"attributes used but not described in the header: {sorted(missing)}"


def test_cross_rules_and_validation(doc):
    ids = [r["id"] for r in doc["cross_rules"]]
    assert len(ids) == len(set(ids)) and len(ids) > 30
    for r in doc["cross_rules"]:
        assert r["level"] in LEVELS and r["rule"], r
        assert set(r.get("versions", CODE_VERSIONS)) <= set(CODE_VERSIONS), r
    for name, rule in doc["validation"].items():
        assert rule["level"] in LEVELS and rule["rule"], name
    assert {"unknown_keys", "version_gating", "forbidden_keys", "ascii", "output_vars", "numbers"} <= set(doc["validation"])
    availability = doc["availability"]
    assert availability["drivers"] and len(availability["options"]) == 4


def test_leftovers_of_the_old_design_are_gone(doc):
    text = TREE.read_text()
    assert "/wbm/user_data" not in text
    for n in nodes(doc):
        assert n.get("wbm") != "landCover", "landCover is not an alias of LandCover"
        assert n.get("cli") != "-m", "wbm.pl has no -m option"
        assert "landCover" not in (n.get("aliases") or [])


# ---------------------------------------------------------------------------
# Every served node has a label written in the file
# ---------------------------------------------------------------------------

_NO_LABEL = "\0no written label: "


def _served_without_label(monkeypatch, doc=None) -> list[str]:
    """The `kind key` of every node the loader serves with the label it makes up from the tree
    key (`tree._label`) instead of one written in the file, for both code versions.

    `_label` is swapped for a marker, so a label that is written, even one that happens to read
    like the derived one, is not mistaken for it. The loader's caches are cleared before and
    after, so no other test sees the marker."""
    from app.wbm_init import tree

    def served(nodes):
        for n in nodes:
            yield n
            yield from served(n.get("children") or [])

    with monkeypatch.context() as m:
        m.setattr(tree, "_label", lambda key: _NO_LABEL + key)
        if doc is not None:
            m.setattr(tree, "_doc", lambda: doc)
        tree.resolve.cache_clear()
        try:
            missing = []
            for version in CODE_VERSIONS:
                resolved = tree.resolve(version)
                for group in tree.render(resolved, {}):
                    for n in served([group]):
                        label = n["name"] if n["kind"] == "module" else n["label"]
                        if label.startswith(_NO_LABEL):
                            missing.append(f"{version} {n['kind']} {label[len(_NO_LABEL):]}")
            return missing
        finally:
            tree.resolve.cache_clear()


def test_every_served_node_has_a_written_label(monkeypatch):
    missing = _served_without_label(monkeypatch)
    assert not missing, f"served without a label written in param_tree.yaml: {missing}"


def test_the_label_test_sees_a_label_taken_away(monkeypatch):
    import copy

    from app.wbm_init import tree

    doc = copy.deepcopy(tree._doc())
    victims = [
        n for n in nodes(doc)
        if n.get("key") == "hbv_beta" or n.get("module") == "reservoirs" or n.get("group") == "stream_geometry"
    ]
    assert len(victims) == 3
    for n in victims:
        n.pop("label", None)
        n.pop("name", None)
    missing = _served_without_label(monkeypatch, doc)
    assert any(m.endswith("field hbv_beta") for m in missing), missing
    assert any(m.endswith("module reservoirs") for m in missing), missing
    assert any(m.endswith("group stream_geometry") for m in missing), missing
    assert not _served_without_label(monkeypatch)
