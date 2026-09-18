# Data formats

`metadata.json` and the other JSON records the system reads and writes.

## `metadata.json`

One object per snapshot. Every axis from [the architecture doc](../architecture/artifact-versioning.md) resolves
from it, and so does everything the catalog shows a person.

Top-level blocks are grouped by **where their contents come from**, which is the
only division that stays stable as the system grows:

| Block | Filled by | Holds |
|---|---|---|
| `about` | a person, at publish | citation metadata — title, authors, licence, links |
| `simulation` | derived from the selected `.init` | what the run is driven by and what it computes: extent, period, input and output variables, processes |
| `uses` | the publisher, at publish | the two artifacts a run has to fetch from outside the snapshot |
| `runtime` | the system | the document's own timestamp, and the record of a run that finished |

`uses` and `runtime` are separate because they answer different questions at
different times. `uses` is fixed when the snapshot is published and says what
this simulation depends on; `runtime` is written by the system and says what
happened. Keeping the container and the model input together also matches how
they behave — both are pinned, both live outside the snapshot, and both are
pulled when the run is assembled.

`id` and `slug` sit at the root because they identify the whole artifact:
`id` is the minted, immutable identifier
([ADR 0014](../decisions/0014-identity-is-a-minted-id.md)) and the S3 key;
`slug` is the human name at publish time, which the catalog — not this file —
maps to ids for browsing.

```json
{
  "$schema": "https://schemas.openghm.org/snapshot-spec/metadata/1.0.0.json",
  "id": "3f9c1a2b5d8e4f7a0c3b6d9e2f5a8c1b4d7e0f9a2c5b8d1e4f7a0c3b6d9e2f5a",
  "slug": "wbm_storage_v1.0.0_wyoming",

  "about": {
    "name": "WBM v1.0.0 Wyoming_tracking simulation …: [Wyoming] [2000-2009]",
    "description": "A WBM regional simulation over the Wyoming basin for 2022 model documentation paper.",
    "datePublished": "2026-02-24",
    "category": "publication",
    "creator": [
      { "name": "Jordan Rivera", "email": "jordan.rivera@example.edu" },
      { "name": "Sam Whitfield", "email": "sam.whitfield@example.edu" }
    ],
    "license": "GPL-3.0-only",
    "keywords": ["Water Balance Model", "Wyoming_tracking", "hydrology"],
    "url": "https://openghm.org/snapshots/3f9c1a2b…",
    "relatedLink": [
      {
        "relation": "isDescribedBy",
        "roleName": "Primary Publication",
        "url": "https://gmd.copernicus.org/articles/15/7287/2022/",
        "doi": "10.5194/gmd-15-7287-2022",
        "description": "Primary publication describing the model methodology."
      }
    ]
  },

  "simulation": {
    "init": "Wyoming_tracking.init",
    "spatialCoverage": { "west": -123.75, "south": 28.9166, "east": -77.8333, "north": 52.9167, "crs": "EPSG:4326" },
    "resolution": { "value": 5, "unit": "arc-minute" },
    "temporalCoverage": { "start": "2000-01-01", "end": "2009-12-31" },
    "inputVariables": [
      { "role": "precipitation",  "dataset": "merra2_prectotcorr_d",
        "fullName": "MERRA2 Total Surface Precipitation, bias corrected, Daily", "unit": "mm/day" },
      { "role": "airTemperature", "dataset": "merra2_t2m_d",
        "fullName": "MERRA2 Temperature at 2m, Daily", "unit": "C" }
    ],
    "activeProcesses": [
      "Reservoirs", "Runoff from Glaciated Areas", "Source water tracking by land area",
      "Irrigated Crops", "Primary water source tracking", "Irrigation water re-use tracking"
    ],
    "outputVariables": [
      { "name": "runoff", "fullName": "Runoff", "unit": "mm/day" },
      { "name": "discharge", "fullName": "Discharge", "unit": "m3/sec" }
    ],
    "recommendedCompute": { "cores": 64, "walltime": "4:30:00" }
  },

  "uses": {
    "container": {
      "image": "wbm-v2-lite",
      "version": "2.0.0-r3",
      "digest": "sha256:9f2c…",
      "oras": "oras://registry.openghm.org/openghm/wbm-v2-lite@sha256:9f2c…",
      "https": "https://s3.anvil.rcac.purdue.edu/openghm/containers/wbm-v2-lite/2.0.0-r3/wbm-v2-lite-2.0.0-r3.sif"
    },
    "modelInput": {
      "id": "7d4e9a1c8b2f5e0a3d6c9b1e4f7a0c3d6b9e2f5a8c1d4e7f0a3b6c9d2e5f8a1b",
      "mountAs": "Wyoming_tracking"
    }
  },

  "runtime": {
    "generatedAt": "2026-02-24T16:45:00Z",
    "execution": {
      "cluster": "anvil",
      "cores": 64,
      "elapsedWalltime": "3:52:14",
      "startedAt": "2026-05-01T10:00:00Z",
      "finishedAt": "2026-05-01T13:52:14Z",
      "slurmJobId": "12345678"
    }
  }
}
```

### Selectors

`init` and `mountAs` are **selectors, not paths**. `wbm_init/` holds several
`.init` files — the Wyoming snapshot on Anvil has three — so the snapshot has to
say which one this simulation runs. The parent directory is not recorded because
[`layout/<version>.json`](snapshot-spec.md#layoutversionjson) already makes it
required. The spec ([snapshot-spec.md](snapshot-spec.md)) needs to define both
precisely — that definition is missing today:

| Field | Definition to add | Resolves to |
|---|---|---|
| `simulation.init` | path **relative to `wbm_init/`**, required — a snapshot with several init files has no default | `<snapshot>/wbm_init/<init>` → mounted at `/wbm/wbm_init/<init>` |
| `uses.modelInput.mountAs` | name of the `data/` child the linked model input is materialised as | `<snapshot>/data/<mountAs>` → mounted at `/wbm/data` |

Defining `init` as relative to `wbm_init/` rather than as a bare filename costs
nothing now — every real value is a plain filename — and leaves room for
`sub/x.init` later without a second field.

### Where `simulation` comes from

Every field in it except `recommendedCompute` is derived mechanically from the
`.init` named by `init`, but not from that file alone:

| Field | Source |
|---|---|
| `temporalCoverage` | `MT_Code_Name.Run_Start` / `Run_End` — dates, no time of day |
| `inputVariables` | the `MT_*` time series the `.init` names — see [the role vocabulary](#forcing-roles) |
| `spatialCoverage` | the `.asc` header of the file `Network` points at: `xllcorner`, `yllcorner`, `ncols`/`nrows` × `cellsize`. `crs` is the `.init`'s `Projection`, normalised to uppercase |
| `resolution` | the same header's `cellsize`, converted to `{ value, unit }` — 0.08333° → `{ 5, "arc-minute" }` |
| `outputVariables` | `Output_vars`, looked up in `model/WBM_dataCube_expand.csv` for `Full_name` and `Org_units` |
| `activeProcesses` | which optional keys carry a value (`Reservoirs`, `Glaciers`, `Irrigation`, `Runoff_mask`, …), plus the suffixes present in `Output_vars`: `*_ps`/`_pg`/`_pr`/`_pu` mean primary water source tracking, `*_irr`/`_pst`/`_rlt` mean irrigation water re-use tracking |

`recommendedCompute` is the exception: a person's a priori estimate for whoever
re-runs the simulation, not an observation. The observation is
`runtime.execution`, written after a run finishes.

Two gaps in the variable dictionary a generator has to handle: `Units` is a list
per aggregation depth (`['mm/day','mm/month','mm/year']`) so the native
`Org_units[0]` is the one recorded, and a few variables appear on more than one
row with conflicting units (`glMelt`), which needs a documented tie-break.

`.init` fields that are neither searchable nor part of the overview — `Routing`,
`Spinup`, `PostProcessing` — are deliberately absent. The gateway will show the
`.init` itself; this file does not restate it.

#### Forcing roles

`inputVariables` holds one entry per forcing time series the run actually uses.
It is **variable length, not a fixed pair** — WBM takes far more than
precipitation and temperature, evapotranspiration alone needs humidity, wind
and radiation, and a snapshot that drives those has to be able to say so — but
`role` itself is a closed vocabulary:

| `role` | `.init` source | Units WBM expects |
|---|---|---|
| `precipitation` | `MT_Precip.Primary` | mm/(hour\|day\|month) |
| `precipitationFraction` | `precipFraction` | fraction |
| `airTemperature` | `MT_airT.Primary` | C |
| `windU` / `windV` | `MT_windU` / `MT_windV` | m/sec |
| `cloudFraction` | `MT_cloudFr` | fraction |
| `humidity` | `MT_humidity` | % or kg/kg or C |
| `albedo` | `MT_albedo` | fraction |
| `leafAreaIndex` | `MT_LAI` | m2/m2 |

Only roles the `.init` names appear; there are no null placeholders. The Wyoming
example carries two because that `.init` sets two. Adding a role to this table is
a MINOR bump ([snapshot-spec.md](snapshot-spec.md#version-rules)), which is the
point of leaving the length open while the vocabulary is fixed.

A role appears **at most once**. An array cannot express that the way the map it
replaced did for free, and JSON Schema has no way to say it, so the generator and
the validator enforce it instead.

#### Where an input variable's name and unit come from

Each `MT_*` key in the `.init` points at an **MT record** — itself a `.init`
file, under the snapshot's own `data/` tree:

```perl
MT_Precip => { Primary => '/wbm/data/climate/precip/merra2_prectotcorr_d.init' },
MT_airT   => { Primary => '/wbm/data/climate/airTemp/merra2_t2m_d.init' },
```

`dataset` is that path's basename — the record's `Code_Name`. The record also
carries `Name` and `Units`, which become `fullName` and `unit`. That mirrors how
`outputVariables` resolves `Full_name` and `Org_units` out of the model's
variable dictionary: the two sides of a run are described the same way on
purpose.

**`Units`, not `Orig_Units`.** Both are in the record and they routinely differ,
because `Orig_Units` describes the file on disk and `Units` describes what WBM
reads after applying `Var_Scale` and `Var_Offset`. Read off the three staged
snapshots, where the same two records appear identically in all of them:

| `dataset` | `Name` → `fullName` | `Units` → `unit` | `Orig_Units` | scaling |
|---|---|---|---|---|
| `merra2_prectotcorr_d` | MERRA2 Total Surface Precipitation, bias corrected, Daily | mm/day | kg/(m^2 s) | `Var_Scale` 86400 |
| `merra2_t2m_d` | MERRA2 Temperature at 2m, Daily | C | K | `Var_Offset` −273.15 |

`Orig_Units` would record kelvin for a series the model and every output treat as
Celsius, so it is the wrong one to carry. The units column in the role table
above is what WBM expects of a role in general; `unit` is what this snapshot's
record actually declares.

`fullName` and `unit` are **optional** for one reason: they are copied out of
files that leave the bundle under
[ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md). Recording
them here is what keeps this document readable once those files are addressed by
id somewhere else — and a generator that cannot reach the MT record writes the
entry without them rather than guessing.

Fields the record carries that this file deliberately does not: `Project`,
`MetadataLink` and `citation` describe the *provenance* of a forcing dataset, and
belong with model input once that has a spec of its own (ADR 0015) rather than
being copied per snapshot.

The bias-correction inputs (`WM_mod_precip`, `WM_obs_precip`, `WM_mod_airT`,
`WM_obs_airT`) are deliberately excluded. They are reference series used to
correct a forcing, not the forcing the simulation is driven by, and folding them
in here would make the field answer two questions at once.

#### `resolution`

A structured pair, not the free string `"5 arc-minute"` every real snapshot
today happens to spell the same way. The consistency is coincidental — nothing
enforces it — and the string can't be queried or range-filtered. `unit` is the
name WBM's own grid convention uses (`arc-minute`, `arc-second`), not a
standard unit-conversion identifier.

#### `about.category`

A free string, not an enum. The three real snapshots on Anvil carry two values
(`publication`, `wbm_storage_v1.0.0_Wyoming` and `_Global`; `tutorial`,
`wbm_storage_v2.0.0`), and more may exist that this project hasn't seen. Closing
the value set now, on three data points, risks rejecting a legitimate value
later. A suggested vocabulary — `publication`, `tutorial`, and by the same
logic `test`, `demo` — is documented here for the catalog's filter UI to seed
itself from, but the field stays unvalidated against it: a new value never
needs a spec bump.

#### `runtime.execution.cluster`

Enum, currently `["anvil"]`. Every compute-node fact in this project — the
Anvil environment reference, the SSH config, the SLURM account — assumes one
cluster, so a closed enum documents that reality rather than inventing a
constraint. Adding a second cluster is additive: a new enum value is a MINOR
bump, same as a new forcing role.

#### Walltime fields

`recommendedCompute.walltime` and `runtime.execution.elapsedWalltime` are
**SLURM `--time` syntax**, not ISO 8601 durations: `minutes:seconds`,
`hours:minutes:seconds`, `days-hours`, `days-hours:minutes`, or
`days-hours:minutes:seconds`, where the hours field is not capped at 24
(observed on Anvil: `"4:30:00"`, `"111:30:00"`, `"15:00"`). The spec should
validate against this grammar directly rather than borrowing a duration
`format` that doesn't match it.

### Notes

Both `oras` and `https` are recorded: the plain-HTTPS mirror is the only path
that works without registry credentials.

`about`'s field names are schema.org/Dataset property names on purpose, so a
JSON-LD island can be generated for Google Dataset Search at render time. That
projection is **generated, never stored**: it drops `category`, maps
`relatedLink` to `citation` with the DOI as a nested `identifier`
(`PropertyValue`, `propertyID: "DOI"`), reaches into `simulation` for
`spatialCoverage`, `temporalCoverage` and `outputVariables`, and reshapes those
to what schema.org expects (a `GeoShape.box`, an ISO interval string, and
`variableMeasured`). Only the outputs project: schema.org's `variableMeasured`
means what the dataset reports, and a forcing series is an input to the run
rather than something it measured. This file claims conformance to nothing but
its own `$schema`.

## Container lock record

One per image revision, committed alongside the recipe — for the v2 image
that is `container/v2/lock/2.0.0-r3.lock.json`. **No lock record exists yet**;
this is the shape mission 0005 will write.

```json
{
  "image": "wbm-v2-lite",
  "version": "2.0.0-r3",
  "base": "ubuntu:20.04@sha256:…",
  "aptPins": "2.0.0-r3.dpkg.txt",
  "cpanPins": { "PDL": "2.063", "FFI::Platypus": "2.01", "Geo::GDAL::FFI": "0.09+double6" },
  "supportsCode": { "wbmVersion": "2.0.0", "perl": "5.30", "inlineAbi": "perl-5.30" },
  "sif": {
    "filename": "wbm-v2-lite-2.0.0-r3.sif",
    "size": 371195904,
    "sha256": "…",
    "oras": "oras://registry.openghm.org/openghm/wbm-v2-lite@sha256:…"
  },
  "verification": {
    "script": "container/v2/test/reproduce_v2.slurm",
    "against": "wbm_opensource_v2.0.0.sif",
    "result": "spool sha256 identical; all daily vars maxabs=0",
    "date": "2026-08-05",
    "slurmJobId": "…"
  }
}
```

`supportsCode` is the reverse declaration — which model code this container can
run. `openghm sim` refuses a snapshot whose `modelCode.wbmVersion` falls
outside it, rather than failing at runtime on an `_Inline` ABI mismatch.

## `containers/manifest.json`

The only mutable object under `containers/`. Aliases are pointers inside the
manifest, not duplicated objects — S3 has no symlinks.

```json
{
  "manifestVersion": 1,
  "images": {
    "wbm-v2-lite": {
      "aliases": { "latest": "2.0.0-r3", "2.0.0": "2.0.0-r3" },
      "versions": {
        "2.0.0-r3": {
          "key": "containers/wbm-v2-lite/2.0.0-r3/wbm-v2-lite-2.0.0-r3.sif",
          "size": 371195904,
          "sha256": "…",
          "status": "current",
          "verifiedAgainst": "prod-2.0.0"
        },
        "2.0.0-r2": { "…": "…", "status": "deprecated",
                      "reason": "GDAL CLI symlinks missing from /usr/local/bin" }
      }
    }
  }
}
```
