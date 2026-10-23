"""Reading the files a run reads (`app.wbm_init.model_input`): the mapping from a container path
to a published object, a data init parsed, a folder's names, the model input's `datasets[]`, and
what is kept.

No network: the bucket is `tests/s3_fake.py`, with the real v2 model input (52585562) recorded in
`tests/fixtures/model_input/`.
"""

from __future__ import annotations

import asyncio

import pytest

from app.wbm_init import model_input as mi

from s3_fake import FakeBucket

SNAPSHOT = "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89"
MODEL_INPUT = "52585562109e15bd7b06fad0e6deb17d1f4fa72a38474828adac5e74c169bc5d"
SOURCE = mi.Source(SNAPSHOT, MODEL_INPUT)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def bucket(monkeypatch) -> FakeBucket:
    fake = FakeBucket().install(monkeypatch)
    assert fake.add_model_input("52585562") == MODEL_INPUT
    fake.put(f"snapshots/{SNAPSHOT}/wbm_init/datasets/own.init", "{ Code_Name => 'own' }")
    return fake


# ---- container path -> object -----------------------------------------------------------------


@pytest.mark.parametrize(
    "path, expected",
    [
        ("/wbm/data/climate/precip/x.init", ("model-inputs", MODEL_INPUT, "climate/precip/x.init")),
        ("/wbm/data_init/soil/a.init", ("model-inputs", MODEL_INPUT, "data_init/soil/a.init")),
        # `/wbm/data/` holds `data_init/`: the two spellings are one object
        ("/wbm/data/data_init/soil/a.init", ("model-inputs", MODEL_INPUT, "data_init/soil/a.init")),
        ("/wbm/wbm_init/datasets/own.init", ("snapshots", SNAPSHOT, "wbm_init/datasets/own.init")),
    ],
)
def test_a_container_path_is_the_published_object_it_is_bound_from(path, expected):
    assert mi.locate(SOURCE, path) == expected


@pytest.mark.parametrize(
    "path",
    [
        "/wbm/spool/x.nc",  # the run's own folders and the snapshot's model are not read from here
        "/wbm/wbm_output/run/x.nc",
        "/wbm/model/wbm.pl",
        "/wbm/user_data/x",
        "data/x.init",  # relative
        "/wbm/data/../model/wbm.pl",  # climbs out
        "/wbm/data//x.init",
        "/wbm/data/",  # a folder, not a file
        "/wbm/data/a\\b.init",
    ],
)
def test_a_path_that_is_not_a_published_file_is_not_located(path):
    assert mi.locate(SOURCE, path) is None


def test_a_folder_is_located_with_its_slash():
    assert mi.locate(SOURCE, "/wbm/data/climate/precip", folder=True) == (
        "model-inputs", MODEL_INPUT, "climate/precip/"
    )
    assert mi.locate(SOURCE, "/wbm/data/", folder=True) == ("model-inputs", MODEL_INPUT, "")
    assert mi.locate(SOURCE, "/wbm/data_init/", folder=True) == ("model-inputs", MODEL_INPUT, "data_init/")


def test_a_snapshot_with_no_model_input_reads_only_its_own_wbm_init():
    source = mi.Source(SNAPSHOT, None)
    assert mi.locate(source, "/wbm/data/x.init") is None
    assert mi.locate(source, "/wbm/data_init/x.init") is None
    assert mi.locate(source, "/wbm/wbm_init/x.init") == ("snapshots", SNAPSHOT, "wbm_init/x.init")


def test_the_source_of_a_catalogue_document_is_its_model_input():
    assert mi.source_of("s", {"uses": {"modelInput": {"id": "m"}}}) == ("s", "m")
    assert mi.source_of("s", {"uses": {}}) == ("s", None)
    assert mi.source_of("s", {}) == ("s", None)


def test_the_container_path_of_a_model_input_object_is_the_one_inits_write():
    loc = mi.Location("model-inputs", MODEL_INPUT, "climate/precip/x.init")
    assert mi.container_path(loc) == "/wbm/data/climate/precip/x.init"
    assert mi.container_path(mi.Location("model-inputs", MODEL_INPUT, "data_init/a.init")) == "/wbm/data_init/a.init"
    assert mi.container_path(mi.Location("snapshots", SNAPSHOT, "wbm_init/a.init")) is None
    for path in ("/wbm/data/climate/x.init", "/wbm/data_init/soil/a.init"):
        assert mi.container_path(mi.locate(SOURCE, path)) == path


# ---- a data init -------------------------------------------------------------------------------


def test_a_data_init_is_read_and_parsed(bucket):
    init = run(mi.read_container_init(SOURCE, "/wbm/data/climate/precip/merra2_prectotcorr_d.init"))
    assert init.name == "merra2_prectotcorr_d"
    assert init.get("Time_Series") == "daily"
    assert (init.get("Start_Date"), init.get("End_Date")) == ("2000-01-01", "2015-12-31")
    assert init.get("File_Path").startswith("/wbm/data/climate/precip/_YEAR_/")
    assert init.is_ascii
    assert init.get("Nope") == ""
    assert init.location.path == "climate/precip/merra2_prectotcorr_d.init"


def test_a_file_with_a_non_ascii_byte_says_so(bucket):
    key = f"model-inputs/{MODEL_INPUT}/crops/x.init"
    bucket.put(key, "{ Code_Name => 'x', Comment => 'Göteborg' }")
    init = run(mi.read_container_init(SOURCE, "/wbm/data/crops/x.init"))
    assert not init.is_ascii and init.name == "x"


def test_what_was_read_is_kept_for_the_life_of_the_process(bucket):
    for _ in range(3):
        run(mi.read_container_init(SOURCE, "/wbm/data/climate/precip/merra2_prectotcorr_d.init"))
    assert sum(1 for kind, _, _ in bucket.calls if kind == "get") == 1


def test_a_missing_file_is_not_found(bucket):
    with pytest.raises(mi.NotFound):
        run(mi.read_container_init(SOURCE, "/wbm/data/climate/none.init"))
    with pytest.raises(mi.NotFound):
        run(mi.read_container_init(SOURCE, "/wbm/spool/x.init"))  # not a published artifact


def test_an_init_that_is_not_a_hash_is_bad(bucket):
    bucket.put(f"model-inputs/{MODEL_INPUT}/crops/bad.init", "this is { not an init")
    with pytest.raises(mi.BadInit):
        run(mi.read_container_init(SOURCE, "/wbm/data/crops/bad.init"))


def test_a_binary_file_is_not_an_init(bucket):
    bucket.put(f"model-inputs/{MODEL_INPUT}/crops/x.nc", b"CDF\x01\x00\x00\xff")
    with pytest.raises(mi.BadInit):
        run(mi.read_text(mi.locate(SOURCE, "/wbm/data/crops/x.nc")))


def test_a_bucket_that_does_not_answer_is_unavailable_and_asked_again_only_after_a_minute(bucket, monkeypatch):
    bucket.fail = OSError("connection refused")
    path = "/wbm/data/climate/precip/merra2_prectotcorr_d.init"
    with pytest.raises(mi.Unavailable):
        run(mi.read_container_init(SOURCE, path))
    bucket.fail = None
    with pytest.raises(mi.Unavailable):  # not tried again at once
        run(mi.read_container_init(SOURCE, path))
    assert sum(1 for kind, _, _ in bucket.calls if kind == "get") == 1
    now = mi.time.monotonic()
    monkeypatch.setattr(mi.time, "monotonic", lambda: now + mi._RETRY_AFTER + 1)
    assert run(mi.read_container_init(SOURCE, path)).name == "merra2_prectotcorr_d"


# ---- a folder ----------------------------------------------------------------------------------


def test_the_precipitation_folder_of_the_v2_model_input_holds_731_day_files(bucket):
    root = run(mi.container_names(SOURCE, "/wbm/data/climate/precip/"))
    assert root.files == {"merra2_prectotcorr_d.init"}
    assert root.folders == {"2000", "2001"}
    years = run(mi.gather(mi.container_names(SOURCE, f"/wbm/data/climate/precip/{y}/") for y in sorted(root.folders)))
    assert [len(y.files) for y in years] == [366, 365]
    assert "MERRA2.PRECTOTCORR.2000-02-29.nc" in years[0] and "MERRA2.PRECTOTCORR.2001-12-31.nc" in years[1]
    assert "MERRA2.PRECTOTCORR.2002-01-01.nc" not in years[1]


def test_a_listing_is_read_to_its_last_page(bucket, monkeypatch):
    bucket.max_keys = 100
    names = run(mi.container_names(SOURCE, "/wbm/data/climate/precip/2000/"))
    assert len(names.files) == 366
    assert len(bucket.listings()) == 4  # 366 names in pages of 100


def test_a_folder_listing_is_kept(bucket):
    run(mi.container_names(SOURCE, "/wbm/data/soil/"))
    run(mi.container_names(SOURCE, "/wbm/data/soil/"))
    assert len(bucket.listings()) == 1


def test_a_folder_with_nothing_published_has_no_names(bucket):
    names = run(mi.container_names(SOURCE, "/wbm/data/dams/"))  # the v2 model input has no dams/
    assert (names.files, names.folders) == (frozenset(), frozenset())
    assert "x" not in names


def test_a_listing_that_cannot_be_read_is_unavailable(bucket):
    bucket.fail = OSError("down")
    with pytest.raises(mi.Unavailable):
        run(mi.container_names(SOURCE, "/wbm/data/soil/"))


def test_a_folder_of_too_many_pages_is_unavailable_not_a_short_list(bucket, monkeypatch):
    bucket.max_keys = 1
    monkeypatch.setattr(mi, "_MAX_PAGES", 3)
    with pytest.raises(mi.Unavailable):
        run(mi.container_names(SOURCE, "/wbm/data/climate/precip/2000/"))


def test_a_file_exists_when_its_folder_lists_it(bucket):
    exists = lambda p: run(mi.file_exists(mi.locate(SOURCE, p)))  # noqa: E731
    assert exists("/wbm/data/network/hyd_5m_CONUS_mississippi_patched.asc")
    assert not exists("/wbm/data/network/hyd_5m_CONUS_mississippi_patched.tif")
    assert not exists("/wbm/data/dams/HydConDams_Global_2021_v2.0.csv")
    # a folder name is not a file
    assert not exists("/wbm/data/climate/precip")


def test_the_snapshots_own_wbm_init_is_listed_and_read(bucket):
    names = run(mi.container_names(SOURCE, "/wbm/wbm_init/datasets/"))
    assert names.files == {"own.init"}
    assert run(mi.read_container_init(SOURCE, "/wbm/wbm_init/datasets/own.init")).name == "own"


# ---- the model input's metadata ----------------------------------------------------------------


def test_the_model_inputs_datasets_are_its_metadata(bucket):
    found = run(mi.datasets(MODEL_INPUT))
    assert len(found) == 26
    precip = found[0]
    assert precip["code"] == "merra2_prectotcorr_d"
    assert precip["init"] == "data_init/climate/merra2_prectotcorr_d.init"
    assert precip["temporalCoverage"] == {"start": "1980-01-01", "end": "2018-12-31"}
    assert run(mi.metadata(MODEL_INPUT))["id"] == MODEL_INPUT


def test_metadata_that_is_not_json_is_bad(bucket):
    bucket.put(f"model-inputs/{MODEL_INPUT}/metadata.json", "[1, 2]")
    mi.reset()
    with pytest.raises(mi.BadInit):
        run(mi.metadata(MODEL_INPUT))
    bucket.put(f"model-inputs/{MODEL_INPUT}/metadata.json", "{not json")
    mi.reset()
    with pytest.raises(mi.BadInit):
        run(mi.metadata(MODEL_INPUT))


def test_a_model_input_with_no_metadata_is_not_found(bucket):
    with pytest.raises(mi.NotFound):
        run(mi.datasets("0" * 64))


# ---- in parallel -------------------------------------------------------------------------------


def test_gather_keeps_the_order_and_the_limit():
    running = peak = 0

    async def job(n):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        return n

    assert run(mi.gather((job(n) for n in range(20)), limit=3)) == list(range(20))
    assert peak == 3


def test_gather_raises_the_first_error_and_stops_the_rest():
    started: list[int] = []

    async def job(n):
        started.append(n)
        if n == 1:
            raise mi.Unavailable("down")
        await asyncio.sleep(0.05)
        return n

    with pytest.raises(mi.Unavailable):
        run(mi.gather((job(n) for n in range(10)), limit=2))
    assert len(started) < 10
