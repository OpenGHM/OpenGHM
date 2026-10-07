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
| `uses` | the publisher, at publish | what the run depends on: the container and the model input it fetches from outside the snapshot, and the WBM code it carries, pinned by hash |
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
  "id": "245430dee68a5a97c11100a66dd09fa9b44c09ef3665717b4da1bf24877f1a58",
  "slug": "wbm_storage_v1.0.0_wyoming",

  "about": {
    "name": "WBM v1.0.0 Wyoming_tracking simulation …: [Wyoming] [2000-2009]",
    "description": "A WBM regional simulation over the Wyoming basin for 2022 model documentation paper.",
    "datePublished": "2026-09-23",
    "tags": ["publication"],
    "creator": [
      { "name": "Jordan Rivera", "email": "jordan.rivera@example.edu" },
      { "name": "Sam Whitfield", "email": "sam.whitfield@example.edu" }
    ],
    "license": "GPL-3.0-only",
    "keywords": ["Water Balance Model", "Wyoming_tracking", "hydrology"],
    "url": "https://openghm.org/snapshots/245430de…",
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
    "spatialCoverage": {
      "northlimit": 52.9167, "southlimit": 28.9167, "eastlimit": -77.8333, "westlimit": -123.75,
      "units": "Decimal degrees", "projection": "EPSG:4326"
    },
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
    "recommendedCompute": { "cores": 4, "walltime": "4:30:00" }
  },

  "uses": {
    "container": {
      "image": "wbm-v1-lite",
      "version": "1.0.0",
      "digest": "sha256:404a…",
      "oras": "oras://registry.openghm.org/openghm/wbm-v1-lite@sha256:9ed5…",
      "https": "https://s3.anvil.rcac.purdue.edu/openghm/containers/wbm-v1-lite/1.0.0/wbm-v1-lite-1.0.0.sif"
    },
    "modelCode": {
      "name": "wbm",
      "version": "22.1.1",
      "treeHash": "f210a78bd43a870cfdde3c0b80c293134fb2a40dc45128688d23a9dfc2014eec"
    },
    "modelInput": {
      "id": "ff0ba2e5d840027f9d6440c5cb922e01f730403b0227fdad4ced7e1dd3bc422d"
    }
  },

  "runtime": {
    "generatedAt": "2026-09-28T18:49:37Z",
    "execution": {
      "cluster": "anvil",
      "cores": 64,
      "elapsedWalltime": "4:01:06",
      "startedAt": "2026-05-04T20:52:35Z",
      "finishedAt": "2026-05-05T00:53:41Z",
      "slurmJobId": "16935452"
    }
  }
}
```

### Selectors

`simulation.init` is a **selector, not a path**. `wbm_init/` holds several `.init`
files — the Wyoming snapshot on Anvil has three — so the snapshot has to say which
one this simulation runs. The parent directory is not recorded because
[`layout/<version>.json`](snapshot-spec.md#layoutversionjson) already makes it
required. The spec ([snapshot-spec.md](snapshot-spec.md)) needs to define it
precisely — that definition is missing today:

| Field | Definition to add | Resolves to |
|---|---|---|
| `simulation.init` | path **relative to `wbm_init/`**, required — a snapshot with several init files has no default | `<snapshot>/wbm_init/<init>` → mounted at `/wbm/wbm_init/<init>` |

`uses.modelInput.id` is a link, not a selector: it names a published model input,
and the run binds that input's root at `/wbm/data` and its `data_init/` at
`/wbm/data_init`. The snapshot records nothing else about it.

### `uses.modelCode`

The WBM code the snapshot runs, `model/` and `utilities/`
([ADR 0032](../decisions/0032-wbm-code-is-published-and-pinned-by-tree-hash.md)).
Required, and all three fields are:

| Field | Holds |
|---|---|
| `name` | `"wbm"`, the only code there is |
| `version` | the `WBM_VERSION` constant in the tree's `model/wbm.pl`, such as `23.9.0`; bytes that declare a version already published get the suffix `-r<N>` |
| `treeHash` | 64 lowercase hex: the sha256 of the sorted `<sha256>  <path>` lines of every file under `model/` and `utilities/`, skipping any `_Inline` directory ([ADR 0008](../decisions/0008-exclude-inline-from-code-hash.md)); `openghm code hash <dir>` prints it |

The hash is the identity ([rule 2](../../AGENTS.md)); the name and version say
which directory under `wbm-code/` holds the bytes
([s3-layout.md](s3-layout.md#publish-a-code-version)). Unlike the container
and the model input it is not fetched from outside: a snapshot ships its own
`model/` and `utilities/`, and `uses.modelCode` is how a reader knows which
code that is. `openghm snapshot validate` (on a folder), `snapshot fetch` and
`snapshot publish` compare the tree they hold with `treeHash` and refuse a
mismatch. The container carries the runtime and no code, so
`uses.container.version` says nothing about the WBM version.

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
| `spatialCoverage` | the `.asc` header of the file `Network` points at: `xllcorner`, `yllcorner`, `ncols`/`nrows` × `cellsize`. `projection` comes from the `.init`'s `Projection`, [recognised rather than transcribed](#spatialcoverage) |
| `resolution` | the same header's `cellsize`, converted to `{ value, unit }` — 0.08333° → `{ 5, "arc-minute" }` |
| `outputVariables` | `Output_vars`, looked up in `model/WBM_dataCube_expand.csv` for `Full_name` and `Org_units` |
| `activeProcesses` | which optional keys carry a value (`Reservoirs`, `Glaciers`, `Irrigation`, `Runoff_mask`, …), plus the suffixes present in `Output_vars`: `*_ps`/`_pg`/`_pr`/`_pu` mean primary water source tracking, `*_irr`/`_pst`/`_rlt` mean irrigation water re-use tracking |

`recommendedCompute` is the exception: a person's estimate for whoever
re-runs the simulation, not an observation. The observation is
`runtime.execution`, written after a run finishes. `cores` is chosen for
**memory**, not speed: WBM uses about one CPU, and on Anvil's `shared`
partition memory comes only with cores (at most 1896 MiB each). It is the
snapshot's observed peak memory (`sacct` MaxRSS) times 1.25, rounded up to
whole cores, and rounded up further where only one run was measured. The
published Global (26 cores, a peak of about 35 GiB over the 4 d 15 h run),
Wyoming (4 cores, a peak of about 3.3 GiB) and v2 CONUS tutorial (1 core, a
peak of about 0.8 GiB in each of several runs) snapshots were set this way on
2026-10-02 to 2026-10-04; Global and Wyoming had carried the 64 cores that the
lab's original submit script asked for, the tutorial 16.
`walltime` is how long the reference run took.

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
file, under the linked model input's tree (mounted at `/wbm/data`):

```perl
MT_Precip => { Primary => '/wbm/data/climate/precip/merra2_prectotcorr_d.init' },
MT_airT   => { Primary => '/wbm/data/climate/airTemp/merra2_t2m_d.init' },
```

`dataset` is the record's own `Code_Name` field — read from inside that file,
**not** assumed from its path's basename. The two happen to agree for both
climate records above, but not in general: several records in the staged
ancillary data declare a `Code_Name` that differs from their filename (one
pair even has two different files declaring the *same* `Code_Name`), which is
exactly why this is read rather than derived. The record also carries `Name`
and `Units`, which become `fullName` and `unit`. That mirrors how
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
belong with the model input's own `datasets[]` entry
([below](#where-datasets-comes-from)) rather than being copied per snapshot.

The bias-correction inputs (`WM_mod_precip`, `WM_obs_precip`, `WM_mod_airT`,
`WM_obs_airT`) are deliberately excluded. They are reference series used to
correct a forcing, not the forcing the simulation is driven by, and folding them
in here would make the field answer two questions at once.

#### `spatialCoverage`

The element names are **DCMI Box**'s — `northlimit`, `southlimit`, `eastlimit`,
`westlimit`, `units`, `projection` — not a spelling of our own. Three reasons,
in order of weight:

- This file is a catalogue record, and DCMI Box is a metadata vocabulary for
  exactly that. The JSON-native alternative, a GeoJSON/STAC `bbox` array, is
  built for geometry a map draws, where positional order is worth the
  readability it costs. Nothing here draws geometry.
- It is the vocabulary this project already used. The `metadata.json` staged
  beside each snapshot on Anvil carries these same element names, alongside
  `hsterms:`-prefixed link types — i.e. it was written against HydroShare, the
  repository this domain's data actually lands in. The gateway's own models
  still read them.
- It settles where the CRS lives. `projection` is a DCMI Box element, so the
  standard already answers the question of whether a coordinate system belongs
  inside the bounding box or beside the grid description.

`units` and `projection` are both **single-value enums** — `Decimal degrees` and
`EPSG:4326` — for the same reason `runtime.execution.cluster` is: WBM refuses to
run anything else, so a closed set records reality instead of inventing a
constraint. A schema that accepted `EPSG:3408` would be calling a snapshot valid
that the model will not start on:

```perl
# images/wbm-tools-lite/wbm/model/wbm.pl:925
die "Fix code below for non-geographical projections. Aborting...\n\n"
	if $$extent{projection} ne 'epsg:4326';
```

`units` is carried at all because DCMI Box carries it — following the vocabulary
beats pruning one predictable field.

**The generator recognises the CRS; it does not transcribe it.** A `.init`'s
`Projection` can be an EPSG code, a Proj4 string or WKT
(`images/wbm-tools-lite/wbm/model/RIMS.pm`), so there is no textual
transformation that works — uppercasing `+proj=lcc … +units=m` corrupts it.
The rule is: resolve the value, confirm it is WGS84, emit `EPSG:4326`; anything
else is refused rather than recorded.

If WBM ever gains projected-network support, the addition is a native-CRS block
beside limits that stay WGS84 — the shape GeoJSON, schema.org and STAC all
converge on — not a second unit on the limits themselves.

DCMI's `box`, `name`, `uplimit`, `downlimit` and `zunits` are **not** carried.
`box` is a string restating the four limits, which rule 4 forbids; the other
three describe a vertical extent WBM does not model.

#### `resolution`

A structured pair, not the free string `"5 arc-minute"` every real snapshot
today happens to spell the same way. The consistency is coincidental — nothing
enforces it — and the string can't be queried or range-filtered. `unit` is the
name WBM's own grid convention uses (`arc-minute`, `arc-second`), not a
standard unit-conversion identifier.

#### `about.tags`

A closed list, not free text: one or more values from the table below, no
repeats. The catalogue's browse filter is built from them, and a filter is only
usable when the same thing is always spelled the same way. The field replaces
`about.category`, a single free string that mixed *purpose* (`publication`,
`tutorial`) with *content* and so could not say both at once; a snapshot can now
be a `publication` and a model input an `ancillary-data`, `climate-forcing` and
`river-network` artifact in one go.

| Value | Meaning |
|---|---|
| `publication` | Reproduces the results of a published paper. |
| `tutorial` | Teaching or workshop material, small and quick to run. |
| `test` | Verification or regression material, not for scientific use. |
| `ancillary-data` | Land-surface, water-use and other non-forcing model inputs. |
| `climate-forcing` | Meteorological forcing time series. |
| `river-network` | Flow-direction and river-network grids. |

Adding a value is an additive MINOR change, the same as a new forcing role;
removing or renaming one is breaking, because documents already carry it.

#### `about.isBasedOn`

Optional. The published artifacts this one was derived from, as a list of
`{ "kind": "snapshot" | "modelInput", "id": <64 lowercase hex> }`, at least one
entry when present. A snapshot published from a run of another snapshot names
that snapshot, so a reader can follow it back
([ADR 0031](../decisions/0031-a-snapshot-draft-is-published-by-a-job.md)):

```json
"isBasedOn": [{ "kind": "snapshot", "id": "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89" }]
```

It is provenance, not a dependency: nothing resolves it, and what a run needs
stays in `uses`. The field lives in the shared `about` block, so a model input
carries it with the same meaning. A snapshot that was not derived from another
one omits it, as the three published snapshots do.

#### `runtime.execution`

Records the run that produced this snapshot's `wbm_output/` — not a rebuild,
the actual job. For the two v1.0.0 snapshots (Wyoming, Global), that run used
the original prod container image, which the pinned `wbm-v1-lite` image
`uses.container` points at reproduces bit-identically — the verification
recorded in `images/wbm-v1-lite/lock/1.0.0.lock.json`.

Its `cores`, `elapsedWalltime`, `startedAt`, `finishedAt` and `slurmJobId`
each accept the literal `"unknown"` in place of their normal value, for a run
whose own record — SLURM accounting, logs — could not be recovered at rewrite
time. No other field accepts it, `cluster` included: `"unknown"` is not itself
a compute-node fact, only a stand-in for one that observation lost. None of
the five published documents uses it today; every field was recoverable.

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
that works without registry credentials. `uses.container.digest` is the
sha256 of the SIF bytes that `https` serves — not the OCI manifest digest,
which is already carried inside the `oras` URL (`@sha256:…`). The two are
different hashes of different things (a single-file image vs. an OCI
manifest) and cross-check each other rather than repeating the same value
twice.

`about`'s field names are schema.org/Dataset property names on purpose, so a
JSON-LD island can be generated for Google Dataset Search at render time. That
projection is **generated, never stored**: it drops `tags` (schema.org/Dataset has no counterpart), maps
`relatedLink` to `citation` with the DOI as a nested `identifier`
(`PropertyValue`, `propertyID: "DOI"`), reaches into `simulation` for
`spatialCoverage`, `temporalCoverage` and `outputVariables`, and reshapes those
to what schema.org expects — a `GeoShape.box`, built as the string
`"<southlimit> <westlimit> <northlimit> <eastlimit>"`, an ISO interval string,
and `variableMeasured`. Only the outputs project: schema.org's `variableMeasured`
means what the dataset reports, and a forcing series is an input to the run
rather than something it measured. This file claims conformance to nothing but
its own `$schema`.

## The gateway's catalogue

The repository UI's dataset shape ([`web-gateway/backend/app/models/repository.py`](../../web-gateway/backend/app/models/repository.py))
used to be its own document — DCMI Box bounds, schema.org `variableMeasured`,
title/creators/tag in the naming HydroShare's own catalogue uses — assembled by
hand before this spec existed and never brought into line with it
([ADR 0017](../decisions/0017-the-spec-is-the-source-of-truth.md),
[open item 14](open-items.md)). Mission `2026-09-18-gateway-on-the-spec`
(private, `ops/missions/`) replaced it, on one rule the maintainer gave in
place of reconciling each field:
**the schema is always the source of truth. The gateway is rebuilt around it,
not migrated field by field.** A legacy field with no basis in the spec is
dropped; one genuinely computable from spec fields is derived at read time and
never stored; nothing was added to the spec to keep an old field alive.

Nothing was added to the spec *document* even for fields the gateway
genuinely needs and cannot derive — `owner_user_id`, `visibility`,
`registered_at`. Since mission `2026-09-23-catalogue-envelope` these live
beside the document in an envelope, not inside it: the stored Mongo record is
`{ _id, document, owner_user_id, visibility, registered_at }`, and only
`document` — the spec's own shape, verbatim — is what this table describes.
`registered_at` is deliberately not the same value as `document`'s own
`runtime.generatedAt` or `about.datePublished`: those answer when the science
happened, `registered_at` answers when this gateway learned about it. A
snapshot mirrored to a second gateway would carry the same
`runtime.generatedAt` but a different `registered_at` (and a different
`owner_user_id`) — proof neither belongs in the spec document itself.

| Catalogue field | Spec source | How |
|---|---|---|
| `id`, `slug` | `id`, `slug` | direct |
| `about` | `about` | direct (the shared block — [ADR 0018](../decisions/0018-shared-definitions-and-no-renderings.md)) |
| `simulation` (`init`, `resolution`, …) | `simulation` | direct, whole — the legacy free-text `spatialResolution` label (`"5 arc-minute"`) is not reproduced; `resolution.value` and `resolution.unit` are already in the response for a client to format however it needs |
| `spatialCoverage` | `simulation.spatialCoverage` | direct (DCMI Box — already the gateway's own shape, just nested differently) |
| `spatialResolutionDegrees` | `simulation.resolution` | derived — `value` converted to degrees by `unit` (arc-minute ÷ 60, arc-second ÷ 3600) |
| `temporalCoverage` | `simulation.temporalCoverage` | direct |
| `inputVariables` | `simulation.inputVariables` | direct — not shown by the legacy UI at all; added, since the spec carries it and `outputVariables` was already shown |
| `activeProcesses` | `simulation.activeProcesses` | direct |
| `outputVariables` | `simulation.outputVariables` | direct (was `variablesMeasured`, `unitText` → `unit`; `standardName` dropped — no CF-standard-name source exists anywhere in the toolkit's variable dictionary) |
| `recommendedCompute` | `simulation.recommendedCompute` | direct (was a free-text list; now the spec's own `{cores, walltime}`) |
| `uses` | `uses` | direct — the container's pinned digest/`oras`/`https`, the WBM code's pin and the linked model input's id, not shown by the legacy UI at all |
| `runtime` | `runtime` | direct — `generatedAt` and the real execution record (cluster, cores, walltime, SLURM job id), also newly shown |
| `softwareVersion` (legacy name) | `uses.container.version` | not a separate field — `uses` is served whole, so a client reads `uses.container.version` directly rather than the catalogue duplicating it under a second name. (It is the *container's* version, not the WBM code's; that is `uses.modelCode.version`, [ADR 0032](../decisions/0032-wbm-code-is-published-and-pinned-by-tree-hash.md).) |
| `licenseUrl` | `about.license` | derived — a static SPDX-id → URL mapping, same rule as `spatialResolutionDegrees`: computed, never stored |
| `generatedAt` (was `lastUpdated`, the default sort key) | `runtime.generatedAt` | direct, renamed to match the spec's own spelling rather than kept as an internal alias |

**Dropped outright, with why:**

| Field | Why |
|---|---|
| `temporalResolution` | No spec field answers "how often is output written"; nothing to derive it from |
| `fileSize`, `format` | Properties of the stored tree, not of `metadata.json` — and the backend holds no S3 credentials by design ([`gateway.md` §5](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster)), so computing them from S3 was never architecturally available either |
| `spatialCoverage.riverNetworkSource`, `majorRivers` | The network file's identity belongs to a model input's `networks[]`, which this mission's catalogue does not join (model input is out of scope — [ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)) |
| `spinupPeriod` | Matches the already-documented deliberate exclusion of `Spinup` (`.init` fields that are neither searchable nor part of the overview, [above](#where-simulation-comes-from)) |
| `datasetVersion` | No traceable source; legacy leftover |
| the legacy `isBasedOn` | A free field with no traceable source. The spec's own [`about.isBasedOn`](#aboutisbasedon) replaces it: ids, not text, and carried through `about` as it is |
| `processesOn` | Duplicated `activeProcesses` |
| `variablesMeasured[].standardName` | A CF standard name is a controlled-vocabulary term; nothing populates it |
| `datasetType` | The catalogue is snapshot-only for this mission — model input is out of scope. A discriminator with one possible value describes nothing; a later mission adds it against a real second case, not an imagined one. That case has since arrived: the mixed list `GET /repository/catalogue` tags each item with a computed `kind` ([gateway.md](../architecture/gateway.md#the-data-repository)), still not stored |
| `adminMetadata` (`conformsTo`, `metadataStandard`, …) | Replaced outright by the schema.org JSON-LD projection this file already describes ([Notes](#notes)), computed at render time rather than stored |

## Model input's `metadata.json`

A published model input ([ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md))
carries the ancillary/reference data a WBM run reads besides its climate
forcing and network — crop calendars, glacier area, irrigation efficiency,
soil capacity. `schemas/model-input-spec/metadata/1.0.0.json` is its schema,
shaped the same way as the snapshot's: `about` is the identical shared block
([ADR 0018](../decisions/0018-shared-definitions-and-no-renderings.md)),
`coverage` and `datasets` are derived from the input's own `data_init/`
records, and `networks` describes the river-network files it carries.

```json
{
  "$schema": "https://schemas.openghm.org/model-input-spec/metadata/1.0.0.json",
  "id": "0000000000000000000000000000000000000000000000000000000000000000",
  "slug": "wbm_ancillary_data_v2.0.0",

  "about": { "…": "the shared block — see above" },

  "coverage": {
    "spatialCoverage": {
      "northlimit": 57.1667, "southlimit": 21.75, "eastlimit": -60.5833, "westlimit": -127.8333,
      "units": "Decimal degrees", "projection": "EPSG:4326"
    }
  },

  "networks": [
    {
      "file": "network/hyd_5m_CONUS_mississippi_patched.asc",
      "spatialCoverage": { "…": "same shape as coverage.spatialCoverage" },
      "resolution": { "value": 5, "unit": "arc-minute" }
    },
    { "file": "network/Merrimack_stn210_Subset.tif" }
  ],

  "datasets": [
    {
      "code": "merra2_prectotcorr_d",
      "init": "data_init/climate/merra2_prectotcorr_d.init",
      "name": "MERRA2 Total Surface Precipitation, bias corrected, Daily",
      "unit": "mm/day",
      "timeSeries": "daily",
      "temporalCoverage": { "start": "1980-01-01", "end": "2018-12-31" },
      "project": "MERRA2",
      "metadataLink": "https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/",
      "citation": "The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2), Ronald Gelaro, et al., 2017, J. Clim., doi: 10.1175/JCLI-D-16-0758.1"
    }
  ]
}
```

The full example, generated from the real ancillary data staged on Anvil
rather than invented, is
[`schemas/model-input-spec/examples/wbm_ancillary_data_v2.0.0.json`](../../schemas/model-input-spec/examples/wbm_ancillary_data_v2.0.0.json).

### Where `datasets` comes from

One entry per **MT record** under `data_init/` — the same kind of file a
snapshot's `MT_*` keys point at (see
[where an input variable's name and unit come from](#where-an-input-variables-name-and-unit-come-from)),
just read here directly rather than through a run's forcing keys:

| Field | Source | Present when |
|---|---|---|
| `code` | the record's own `Code_Name` | always — this is what makes it a dataset entry at all |
| `init` | the file's own path, relative to the model input's root | always |
| `name` | `Name` | the record has one |
| `unit` | `Units` (not `Orig_Units` — same rule as a snapshot's `inputVariables[].unit`) | the value isn't the empty string |
| `timeSeries` | `Time_Series` | the record has one |
| `temporalCoverage` | `Start_Date` / `End_Date` | neither uses WBM's `0000`-year "no real date" placeholder |
| `project` | `Project` | present — only the climate forcing records in the staged data carry one |
| `metadataLink` | `MetadataLink` | present |
| `citation` | `citation` | present — kept as the free string it already is; some carry a DOI inline as text |

**`code` is read from inside the file, never assumed from its filename.**
Confirmed necessary, not a defensive habit: four of the 28 records in the
staged ancillary data declare a `Code_Name` that differs from their file's
basename, and two separate files declare the *same* `Code_Name`
(`global_rgi6_glaciers_area_1km`) with near-identical but not byte-identical
content — a duplicate in the source data itself. `code` is unique within the
array; JSON Schema cannot express that (the same limitation already noted for
a snapshot's `inputVariables[].role`), so the generator and the validator
(`openghm.spec`) enforce it.

**Not every file under `data_init/` fits this shape.** One file in the staged
data, a dams database, has no `Code_Name` at all — a point-feature reference
table (location, capacity, catchment area) with its own `DOI`, `Author` and
`Citation`, not a time series. It is excluded from `datasets` rather than
forced in with fabricated fields; see [open items](open-items.md).

`unit` and `temporalCoverage` are **omitted, not transcribed as empty or
fake**, when the source has nothing real to report: several crop-coefficient
records declare `Units` as the empty string (the quantity is genuinely
dimensionless), and most non-climate records use the `0000`-year placeholder
because they are climatological — a repeating annual cycle, not a dated
series — rather than measured over a real period. The `0000`-year placeholder
still means omitted, whichever day follows it.

A `-00` day (WBM's monthly marker — `Start_Date`/`End_Date` such as
`1980-01-00`, meaning "this month" with no specific day) is a real period,
not a placeholder, and is recorded as the first day of that month for
`start` and the last day of that month for `end`: `1980-01-00` becomes
`1980-01-01` in `start` and `1980-01-31` in `end`.

## Container lock record

One per published image version, committed beside the recipe at
`images/<name>/lock/<version>.lock.json`, with the image's full apt list in
`<version>.dpkg.txt` next to it. Three exist, one each for `wbm-v1-lite`
1.0.0, `wbm-v2-lite` 2.0.0 and `wbm-tools-lite` 2026-05-31
(`2026-09-25-image-lock-records`, private). This is the v2 one, with its
one long reason shortened:

```json
{
  "image": "wbm-v2-lite",
  "version": "2.0.0",
  "base": {
    "os": "Ubuntu 20.04.6 LTS",
    "versionId": "20.04",
    "digest": null
  },
  "aptPins": "2.0.0.dpkg.txt",
  "cpanScope": "inc",
  "cpanPins": {
    "CGI": "4.46",
    "File::Tee": "0.07",
    "FFI::Platypus": "2.01",
    "Geo::GDAL::FFI": "0.09",
    "Inline": "0.86",
    "PDL": "2.063",
    "PkgConfig": "0.26026",
    "Time::DaysInMonth": "99.1117",
    "Time::JulianDay": "2011.0505",
    "Time::Timezone": "2015.0925"
  },
  "cpanUnversioned": [
    "Inline::denter"
  ],
  "supportsCode": {
    "wbmVersion": "2.0.0",
    "perl": "5.30.0",
    "inlineAbi": "perl-5.30"
  },
  "sif": {
    "filename": "wbm-v2-lite-2.0.0.sif",
    "size": 335466496,
    "sha256": "4ef9e35b3c15f08721a165cccb15266ab812f5fa51e0266d36061e9a77f222ea",
    "oras": "oras://registry.openghm.org/openghm/wbm-v2-lite@sha256:a9fc0281ed4010fcb89c788edcd53639cfc4fe76e5bc6b245d8c407d7cc76f43"
  },
  "verification": {
    "script": "images/wbm-v2-lite/test/reproduce_v2.slurm",
    "scriptCommit": "07c0bd3",
    "against": "wbm_opensource_v2.0.0_with_paws.sif",
    "result": "spool identical 3656/3656; all 16 netCDF outputs data-identical per images/verification/nc_datacmp.pl (the script's own ncdump step reports false differences on attribute order)",
    "date": "2026-09-25",
    "slurmJobId": "20909196",
    "dataCompare": {
      "script": "images/verification/nc_datacmp.pl",
      "commit": "741bc60",
      "slurmJobId": "20910382"
    }
  },
  "unrecoverable": {
    "base.digest": "…why, in one sentence…"
  }
}
```

**Every value is read from the published SIF, never from the recipe.** The
Dockerfile says what a build asked for; the artifact says what it got. So:

- `base` is the SIF's own `/etc/os-release`.
- `aptPins` names a verbatim `dpkg-query -W` of it.
- `cpanPins` are the versions each module prints from inside it.
- `sif` matches `containers/manifest.json` and a fresh hash of the mirror
  copy.

`verification` is a real SLURM run against those bytes, cited by job id,
with the script by repository path (and `scriptCommit` when the script
changed to make that run possible).

**A value that cannot be recovered is `null`, never a plausible guess.**
Every `null` has an entry in `unrecoverable`, keyed by field path (`base.digest`,
`supportsCode`, `verification.against`), giving the reason. `base.digest` is
`null` for all three published images. They were built with `apptainer
build docker-archive://<local tar>` from a tar deleted after the build, and
no base registry digest survives in the SIF. Today's digest for the same tag
would be a different image.

- `cpanScope` says which modules count. `"inc"` means every non-core module
  in `%INC` once the image's own entry point is compiled (`wbm.pl` with the
  snapshot's code bound read-only; tools-lite's three embedded utilities).
  Submodules sharing their distribution's version are folded into it.
- `cpanUnversioned` lists modules that load but declare no `$VERSION`,
  rather than giving them an invented one.
- `supportsCode` is the reverse declaration: which WBM code this container
  can run, from the SIF's `wbm_version` label and its Perl version.
  tools-lite's is `null`, because it embeds its own utilities and binds no
  model code. Nothing reads `supportsCode`. A published snapshot runs with
  the container its own `uses.container` pins, and its code is in its own
  `model/`, so the two already ran together. The check matters only when
  `openghm sim --sif` replaces the pinned image.

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
          "oras": "oras://registry.openghm.org/openghm/wbm-v2-lite@sha256:…",
          "verifiedAgainst": "prod-2.0.0"
        },
        "2.0.0-r2": { "…": "…", "status": "deprecated",
                      "reason": "GDAL CLI symlinks missing from /usr/local/bin" }
      }
    }
  }
}
```

`key`/`size`/`sha256`/`status`/`oras` are written by the publish step itself
([s3-layout.md](s3-layout.md#publish-a-container-image),
`ops/anvil/publish_container.sh`, private) — `oras` pins the pushed
**digest**, per rule 2, never a tag. `verifiedAgainst` and `reason` are added
by hand afterward: `verifiedAgainst` once the image's own bit-identity test
(`images/<name>/test/`) has run against it, `reason` when a later version
marks this one `"deprecated"`.
