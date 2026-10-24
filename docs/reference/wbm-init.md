# WBM init values — how WBM 22.1.1 and 23.9.0 treat them

What WBM does with each value of a run `.init`, as read in its code and as measured
on Anvil. It is the evidence behind the gateway's parameter tree
(`web-gateway/backend/app/wbm_init/param_tree.yaml`, shape in
[model-parameters.md](../architecture/model-parameters.md)): the tree states what is
allowed, this page says why. Where a source disagrees, the order of trust is a
measurement, then the code, then the manual, then the input spreadsheet.

What is not established is marked open, in [Open: not established](#open-not-established).

## 1. Sources and citations

| Citation | Means |
|---|---|
| `W:n` | line n of `wbm.pl` of WBM 23.9.0: `images/wbm-tools-lite/wbm/model/wbm.pl` |
| `M:n` | line n of `images/wbm-tools-lite/wbm/model/RIMS/WBM.pm`, WBM 23.9.0; `R:n` is `images/wbm-tools-lite/wbm/model/RIMS.pm` and `D:n` is `images/wbm-tools-lite/wbm/model/RIMS/DataSet.pm` |
| `W(22):n`, `M(22):n` | the same files of WBM 22.1.1, which is not in this repository: public bucket `wbm-code/wbm/22.1.1/model/` (`https://s3.anvil.rcac.purdue.edu/openghm/wbm-code/wbm/22.1.1/model/`) |
| `manual Ln` | line n of the text extracted from `WBM_Documentation.v2.0.Jan2023.docx`, the WBM manual |
| *measured:* `case`, SLURM job | `wbm.pl` run in the snapshot's own image on Anvil with the toolkit's binds, by the harness in `ops/anvil/param-tests/`. Every case is in [Measured on Anvil](#9-measured-on-anvil) |

Two more sources were read: the input spreadsheet *WBM_Usage_and_Input_Reference* (Google
Sheet `1CiIqUfildxRi72SUEzJKsfp3klXsiOWq`, sheets "Input" and "WBM Usage"), whose defaults
are quoted as "sheet", and the metadata extraction document (Google Doc
`1eVH-DHb3K_h9gvdD5mcThFzSW-pq369KD8u5Ja1SLzs`), whose bold names are the tree's module
names. The manual is a process manual, not an input manual: it has no section on the run
init, prints an init key name only for the 20 ModFlow inputs, and states most defaults not
at all.

## 2. The two code versions, and what runs them

| Snapshot | Id | WBM | Image | Model input | Run inits in `wbm_init/` |
|---|---|---|---|---|---|
| `wbm_storage_v2.0.0` (the v2 tutorial) | `fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89` | 23.9.0 | `wbm-v2-lite` 2.0.0 | `52585562` | `wbm_test.init` (the published run), `wbm_SHORT.init`, `wbm_SHORT_standard.init`; also `ReadMe.txt` |
| `wbm_storage_v1.0.0_global` | `4604e608b526f8bbbda269dbc4635ab89a3b8fbc44ed7e79315e31ce0b47aeb0` | 22.1.1 | `wbm-v1-lite` 1.0.0 | `ff0ba2e5` | `Global_tracking.init` (the published run), `test.init` |
| `wbm_storage_v1.0.0_wyoming` | `245430dee68a5a97c11100a66dd09fa9b44c09ef3665717b4da1bf24877f1a58` | 22.1.1 | `wbm-v1-lite` 1.0.0 | `ff0ba2e5` | `Wyoming_tracking.init` (the published run), and byte-identical copies of `Global_tracking.init` and `test.init` |

| Prefix | Model input | Used by | WBM | Files its datasets point to that are not there |
|---|---|---|---|---|
| `52585562` | `52585562109e15bd7b06fad0e6deb17d1f4fa72a38474828adac5e74c169bc5d` (wbm_ancillary_data_v2.0.0) | wbm_storage_v2.0.0 | 23.9.0 | data_init/crops/CDF/MC_nonrice_irr_CDF_av.init and MC_rice_irr_CDF_av.init (-> crops/CDF_av/), crops/mirca_cropAreaFraction.init (-> crops/mirca_cropAreaFraction.nc), irrigation/irrEfficiency.init (-> irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc), soil/harmonized_AWC_5min.init (-> soil/Harmonized-SoilMap_AWC-mm_5min.nc), dams/HydConDams_Global_2021_v2.0.csv (no dams/ folder); climate/precip and climate/airTemp declare 2000-2015 but hold 2000-2001 only |
| `ff0ba2e5` | `ff0ba2e5d840027f9d6440c5cb922e01f730403b0227fdad4ced7e1dd3bc422d` (wbm_ancillary_data_v1.0.0) | wbm_storage_v1.0.0_wyoming, wbm_storage_v1.0.0_global | 22.1.1 | none. Missing on purpose: climate/evwater/merra2_evwater_dc.init and soil/root_depth.init exist only in 52585562; glacier monthly/yearly files exist for 1980 and 2000-2009 only |

The snapshot's `metadata.json` names its code in `uses.modelCode.version`. A published run
init is not necessarily runnable on its model input: `wbm_SHORT.init` and
`wbm_SHORT_standard.init`, converted to a `Spinup` block, still stop at once because
`/wbm/data/network/Merrimack_stn210_Subset.asc` is not in `52585562` (it holds only the `.tif`) and
`soil/SSURGO_AWC_1km.init` and `/wbm/data/evap/freeWaterEvap/merra_evwater_d.init` are missing too
(measured: `v2_short_conv`, `v2_short_std_conv`, SLURM 21579523). Of the 298 key and snapshot
pairs in the six published run inits, every key is read by its own code version, except
the flat `Spinup_*` keys, which are fatal in both.

## 3. How WBM reads a value

Line numbers are 23.9.0; 22.1.1 is the same unless the row says so.

| Function | What it does | Consequence |
|---|---|---|
| `isInitFile($s)` (M:245-249; M(22):230-234) | True when `$s` contains `/` or `\`, or ends in `.init`, or is a readable text file in the current directory | A raster path handed to a field that reads an init dies in `read_init`, so a raster is valid only where the field accepts one |
| `attrib($id, $MT, $key)` (M:189-243; M(22):183-228) | Dies on empty. Takes an inline hash, an init file, or a Magic-Table ID looked up in `/wbm/data/DataID_DB.csv`. Needs the keys `Code_Name Time_Series Start_Date End_Date Var_Name Bands Projection File_Path` to **exist**; an empty value is accepted (M:205-208). Blank `Var_Scale` or `Var_Offset` is read as 1 and 0 (M:233-234); `Var_Scale` 0 also becomes 1 | A number is not an `attrib` value. No snapshot or model input has a `DataID_DB.csv`, so a Magic-Table ID always fails |
| `Code_Name` against the file name | 23.9.0 dies when an init's `Code_Name` differs from its file name without `.init` (M:210-213). 22.1.1 does not check | A copied data init must rewrite `Code_Name` on 23.9.0 |
| Date check | 23.9.0: `Start_Date` and `End_Date` must match `\d{4}-\d{2}-\d{2}` (so `YYYY-MM-00` and `0000-00-00` pass) or be empty (M:227-230; R:1711-1719; D:62-65). A file path is replaced by the first date in it. 22.1.1 ignores the result (M(22):216-217; R(22):1605-1612) | |
| `read_Layer` (M:801-818; M(22):744-761) | A number is returned as it is (M:812); a file GDAL opens is read as a raster (M:814); anything else goes through `attrib` and is sampled at 2001-01-01 (M:817) | Number, raster, init or ID. A time-series init in such a field is sampled on one date |
| `init_DSet` (M:438-453; M(22):386-401) | The same three branches, but a time series stays a time series | |
| A number in a layer field | A number reaches a method call (`->lclip`, `->double`, `->hclip`) as a plain scalar wherever the code then works on the result | Aborts: `IrrEfficiency` (measured: `w_irreff_num`), `soilAWCapacity` (`v2_awc_num`). The same pattern is at W:5022, W:4463, M:3459-3461 |
| `isNumber` (M:455-460; M(22):403-407) | `^[-+]?\d+(\.\d*)?([eE][-+]?\d+(\.\d*)?)?$`. `.5` is not a number; `1e-3`, `+5` and `5.` are | A number must be written with a leading digit |
| `set_default($v, $d)` (R:1791-1795) | The default when the value is undefined **or the empty string**; `0` and `'0'` are kept | `''` is safe only for a key read with `set_default` |
| `read_init` (M:351-386; M(22):336-369) | Strips `\r`, repairs `=> ,` to `=> ''` (M:366), checks ASCII (M:360; absent in 22.1.1), `eval`s the text (M:366-367). The keys of `wbm_reqParams()` must be truthy (M:376; M(22):361): `ID MT_Code_Name Output_vars MT_Precip MT_airT Network Projection Routing rootingDepth` (M:97-100) | A whitespace-only `Output_vars` is truthy and gives a run with no output (W:264; W(22):247) |
| `read_param_str($H, $key)` (M:388-399; M(22):373-382) | A false value is empty; a string for which `isInitFile` holds is read as an init; a hash reference is the block; anything else dies | A block key takes a block or the path of an init holding it |
| `wbm_params()` (M:92-95, identical in both versions) | 49 keys: `ID Comment Project MT_Code_Name Spinup Output_vars MT_Precip precipFraction MT_airT Network Projection Routing wbmParam ConnectivityNetwork Reservoirs soilAWCapacity FieldCap WiltingPoint rootingDepth PET MT_windU MT_windV MT_cloudFr MT_humidity MT_albedo airT_yc openWaterEvap Glaciers Aquifers Springs snowBands lapseDownscale DIN Runoff_mask Impervious openWater canopyHt MT_LAI WaterDemand landCollapse LandCover Irrigation WM_mod_precip WM_obs_precip WM_mod_airT WM_obs_airT PostProcessing WaterRights USGS` | `Elevation` is read but not in the list; `landCover` is neither. Only listed keys are copied by `dump_init` (W:1290; M:147-179) and into the output NetCDF attributes (W:358) |

The Aquifers layers `aqfInfiltFr`, `Conf_Thick`, `Aqf_Sy`, `Aqf_SyCnfd`, `Aqf_Ph`, `Aqf_Kh`,
`Aqf_Kv`, `Aqf_KhConf`, `Aqf_KvConf`, `eFolding` and `BRes` are read with `read_Layer`, so
each is an init, a number or a raster (M:3472-3497).

### Required, by condition

What WBM requires of an init, as enforced in the code:

| When | Required | 23.9.0 | 22.1.1 |
|---|---|---|---|
| always | `ID MT_Code_Name Output_vars MT_Precip MT_airT Network Projection Routing rootingDepth`, truthy | M:97-100, 376 | M(22):361 |
| no `Spinup.Start` | `MT_Code_Name.Run_Start` | M:492, 503 | M(22):439, 450 |
| `Run_End` empty | `MT_airT.Primary` (not the min/max form) | M:507 | M(22):454 |
| precipitation monthly | `precipFraction`; with daily precipitation it must be empty | W:549-556 | W(22):528, 534 |
| Penman-Monteith or FAO-56 PET, or `Calculate`, or any `*_twt` output | `MT_cloudFr MT_windU MT_windV MT_humidity` | W:585-590 | W(22):562-567 |
| Penman-Monteith or FAO-56 PET | `MT_albedo` | W:636 | W(22):614 |
| Penman-Monteith PET or any `*_twt` output | `canopyHt`, `MT_LAI` | W:625-627 | W(22):602-604 |
| any `*_twt` output | `airT_yc` | W:711 | W(22):683 |
| `Calculate`, or humidity Units kg/kg | `Elevation`, truthy (non-zero, or a layer) | W:622-623, 628 | W(22):599-600, 605 |
| `lapseDownscale` | `MT_airT.Primary` (no Secondary unless `forceSecTemp`), `climElevation`, `netElevation` (no numbers) | W:4809-4831 | the same |
| `soilAWCapacity` absent | `FieldCap` and `WiltingPoint` | W:5021-5024 | W(22):4512-4515 |
| `Irrigation` | `CropAreaFrac`, `CropParFile`, `IrrEfficiency` as init or raster (or the tech-application file) | W:5105, 5170, 2535 | the same |
| `WaterDemand` | `PopDensity`, `DomDemandPP`, `IndDemandPP`, `LivestockParam` | W:1238, 1242, 1247, 1252 | the same |
| `DIN` block | an output starting `DIN`, else the block is ignored; with such outputs the block is mandatory | W:730-732 | W(22):701-703 |
| `DIN.WWTP` | `PopDensity` (an init) and `WWTP_File` | W:752 | the same |
| `openWater` | `MaskDataset` | W:773 | W(22):745 |
| `Glaciers` | `glMelt`, `glArea` (Units contain `frac` on 23.9.0) | W:674-676, 694 | W(22):652-653 |
| `Runoff_mask` block | at least one of `dischMsk runoffMsk grndWtMsk` in `Output_vars` | W:4889-4890 | W(22):4383-4384 |
| `ConnectivityNetwork`, `Reservoirs` | `File` (it must exist) and `SkipLines` | M:2094-2096, 2632-2634 | the same |
| `Springs` | aquifers initialised | M:3160 | a stub |
| Aquifers `ModFlow` | `DEM Net_DEM Aqf_Thick` | M:3450-3452 | a stub |
| Aquifers `Virtual` or `Lumped` | `Aqf_Par_File` (with ID 1 when there is no `Aqf_ID_File`) | M:3659, 3677-3685 | a stub |
| `Spinup.Loops` above 0 | `Spinup.Start`, `Spinup.End` | M:130-131 | M(22):130-131 |
| `PostProcessing` block | `PP_Perl_path` exists; at least one variable to process; `Polygon_Aggregation.IDs` for polygon aggregation; `Rasterization_Res` for vector masks | M:4221, 4244-4254, 4270 | the same |
| `snowBands` | band files next to the `Network` file | W:4683-4684 | W(22):4177 |

Also:
- A climate driver written as a plain string instead of a block dies on the `strict refs` line W:535 (22.1.1: W(22):513).
- `spinup_*` (any case, M:117-118), `MT_relHumidity` and `FreeWaterEvap` (W:281-282; W(22):258-259) are fatal if the key merely exists.
- `Output_vars` is deduplicated (W:257) and split on whitespace (M:549).
- Post-processing is started with `system("perl -w script &")` (W:4271): a background process that outlives WBM.
- A key that WBM does not read is ignored without a message, at the top level and inside blocks; only `Spinup` and `PET` validate their keys (M:122, M:419).

## 4. What differs between 22.1.1 and 23.9.0

| Area | 22.1.1 | 23.9.0 |
|---|---|---|
| `Spinup` keys | `Start End Loops State_ID Force_ID_Date` (M:122-123) | adds `Save_Vars` 0, 1 or 2 (M:122-123, 139-140) and the `-noStateID` option |
| `PET` | a plain string (W(22):562, 608-627) | a string, or `{ method, Scale }` (M:401-424; W:584) |
| `MT_Code_Name.Time_Series` | `daily`, `daily{N}`, `monthly` (M(22):436-437) | adds `daily[N]`, `lastDay` and a run step (M:488-491; W:439-449) |
| Data init `Code_Name` against its file name | not checked | dies (M:210-213) |
| Data init date check | ignored | dies on a bad `Start_Date` or `End_Date` (M:227-230; D:62-65) |
| ASCII | not checked | `check_ascii_file` on inits and tables (M:360; R:215; R:1799-1811); the reservoir and inter-basin tables are exempt (M:2097, 2635) |
| `Aquifers`, `Springs`, `USGS` | stubs, "Removed from public domain" (M(22):2899-2994; W(22):1316) | full ModFlow, Lumped and Virtual aquifers, springs, USGS |
| `wbmParam.RhRt2` default | 0.56 (W(22):844-845) | 0.2 (W:872-873) |
| Irrigation, withdrawal factor over aquifers | `AqfCoeff` (W(22):1080); `ExtraAqfCoeff` is not read | `ExtraAqfCoeff`, with `AqfCoeff` as an alias (W:1105, 1113) |
| `wbmParam.ncDouble` | not read | double precision NetCDF (W:270) |
| Muskingum routing | falls back to LRR with a warning when `ConnectivityNetwork`, `WaterDemand`, `Irrigation` or `openWaterEvap` is present (W(22):462-472) | honoured |
| Glacier input | no `glArea` unit check, no resolution check (W(22):649...) | both (W:683-695): `glArea` Units must contain `frac` |
| `DIN.luAgr` | start year clipped at 1800 (W(22):708) | not clipped (W:736) |
| Crop datasets | no start-year clip or spool delta (W(22):4612-4668) | `START_YEAR_CLIP => $yr_start`, `SP_DELTA` (W:5121-5181) |
| `Output_vars` universe | CSV: 540 named rows, 530 unique; `%data_out`: 269 hits; 407 names accepted | CSV: 575 named rows, all unique; `%data_out`: 308 hits; 437 names accepted |
| Failure on NaN or Inf at run time | not checked | dies (W:4036) |
| Spool pre-processing | no `-bldSpool`, no `-noStateID` | present (W:216-229, 1431-1445) |
| `-by` option | accepted (W(22):207-210) | unknown: prints `Unknown option` and exits 0 without running |
| `read_init` error text | an explicit eval message with a non-ASCII hint (M(22):351-352) | generic (M:366-367) |

The same in both: `wbm_params()` and `wbm_reqParams()` (49 and 9 keys), `isInitFile`,
`attrib`, `read_Layer`, `init_DSet`, `set_default`, the output-trigger regexes
(W:969-982; W(22):940-953), the `Projection` check, the `Calendar 360` abort, `Elevation`
truthiness, the `PostProcessing` logic, the `WaterDemand`, `DIN` and `Irrigation` defaults, the
`Runoff_mask` branches and `lapseDownscale`.

## 5. Keys where an empty value is not absence

An empty string is the same as an absent key only where WBM reads the key with
`set_default`. The keys below are tested with `exists` or `defined`, so `''` is a value to
WBM. The tree marks them `empty_is_value: true`, and a key with that mark is omitted rather
than written empty.

| Key | Why | Line (23.9.0) |
|---|---|---|
| `MT_Code_Name.spool_dir`, `run_state_dir`, `MT_file`, `credits` | an `exists` test overrides the configuration; an empty spool folder becomes `/` | W:4300 |
| `MT_Code_Name.MT_ID` | a `defined` test: `''` stays empty and `_runoff` is appended | M:484-485 |
| `MT_airT.Primary` | `exists Primary` selects the Primary branch even when `''`, and `attrib('')` dies | W:570 |
| `Glaciers.glVolume` | `exists` | W:673 |
| `Aquifers.aqfInfiltFr`, `Conf_Thick`, `Aqf_Sy`, `Aqf_SyCnfd`, `Aqf_Ph`, `Aqf_Kh`, `Aqf_Kv`, `Aqf_KhConf`, `Aqf_KvConf`, `eFolding`, `BRes` | `!exists` gives the default; otherwise `read_Layer('')` dies | M:3435, 3472-3497 |
| `WaterDemand.DomSearchDist`, `IndSearchDist`, `StkSearchDist`, `StkRefYear` | `exists`: `''` becomes a 0 km search distance, or an empty year | W:1244, 1249, 1256, 1257 |
| `Runoff_mask.attFile`, `maskList`, `basinIDFile` | `exists` selects the branch | W:4897, 4906, 4926 |
| `FreeWaterEvap`, `MT_relHumidity` | `exists` is fatal | W:281-282 |
| `Irrigation.SearchDist`, `AqfCoeff` | `exists` overrides the new name with `''`; `set_default` then falls back, which is harmless | W:1104-1105 |

Safe as `''`: `Spinup.*` (M:125); `wbmParam.*`, `Routing.*` and `Irrigation.*` keys read with
`set_default`; the top-level module keys, which are flags (`Reservoirs`, `Irrigation`, `DIN`,
`snowBands` ...: `''` and `0` are off). `PostProcessing` is a flag too, but a block counts as on
even with `Run => 0`, so off is `''` (W:254, M:4217; measured: `v2_dates_short_real`).

## 6. Writing a value so that WBM reads it

These are the constraints the toolkit's init editor satisfies
([ADR 0038](../decisions/0038-a-run-gets-its-init-edits-as-one-changes-file.md)) and the
validator checks.

- **Literals.** The init is evaluated as Perl (M:366-367). A value is a single-quoted literal
  with `\` and `'` escaped, no interpolation and no newline: a free-text comment with `'`,
  `\` or `$x` would break the file or inject code.
- **Numbers** have a leading digit and no trailing dot: `.5` is read as a path or an ID (`isNumber`, M:455-460).
- **ASCII only.** 23.9.0 rejects any non-ASCII byte in an init (measured: `v2_nonascii`; M:360); 22.1.1 accepts it.
- **Climate drivers** (`MT_Precip`, `MT_airT`, `MT_windU`, `MT_windV`, `MT_cloudFr`, `MT_humidity`, `MT_albedo`) are always blocks `{ Primary => ... }` (measured: `v2_precip_str`, W:535).
- **`Output_vars`** is one whitespace-separated string, never empty or whitespace-only (measured: `v2_ov_empty`, `v2_ov_space`).
- **`PostProcessing`** off is `''`: a block, even with `Run => 0`, switches the script generation and its checks on (W:254, M:4217; measured: `v2_dates_short_real`).
- **`PET`** is the plain string, which works on both versions; the block `{ method, Scale }` only where a scale is set and the code is 23.9.0 (a block is fatal on 22.1.1, measured: `w_pet_block`).
- **`Routing`** is always written (required and truthy, measured: `v2_routing_empty`), as the plain method string when only the method is set.
- **`Spinup`** is always the nested block. The flat keys (`Spinup_Start`, `Spinup_End`, `Spinup_Loops`, `spinup_state_ID`) read as `Spinup.Start`, `End`, `Loops`, `State_ID`, and a source init that has them is converted before anything else. `Save_Vars` is written only for 23.9.0.
- **Version gating.** A key whose `versions` excludes the code version is never written.
- **Keys never written:** `MT_Code_Name.spool_dir` (an empty value sends the spool to `/`, measured: `v2_spool_empty`; `WBM.conf` already gives `/wbm/spool/`, model/WBM.conf:14), `run_state_dir` (W:4300; `WBM.conf` gives `/wbm/WBM_run_state/`), `MT_file` (W:4300; no model input has a `DataID_DB.csv`) and `credits` (W:4300; also free text that must stay ASCII). Of the published run inits only `Global_tracking.init` and `Wyoming_tracking.init` set `spool_dir`, to `/wbm/spool/`; none sets the other three. The toolkit rewrites a `spool_dir` an init has to `/wbm/spool/`; a `spool_dir` the source has is passed through, never empty.
- **Obsolete and forbidden keys:** `FreeWaterEvap`, `MT_relHumidity` and any `spinup_*` are fatal when present, even empty.
- **Unknown keys** are ignored silently, so a typo in a block is a silent no-op (measured: `v2_unknown_top`, `v2_typo_block`). The one block file the published inits point to, `HydConDams_Global_v2.0.init`, carries `Comment`, `Author`, `Citation`, `URL` and `DOI`, which WBM does not read; a block file keeps them.
- **Lowercase `landCover`** is not an alias of `LandCover`: both versions read only `$runIO{LandCover}` (W:5033, 5044; W(22):4524-4526; measured: `w_landcover_lc`).
- **Aliases.** `Irrigation.IrrSearchDist` is read natively by both versions, and the old `Irrigation.SearchDist` overrides it when the init has that key (W:1104; W(22):1072). `AqfCoeff` is the native 22.1.1 key (W(22):1080); on 23.9.0 the native key is `ExtraAqfCoeff` (W:1113) and `AqfCoeff` overrides it when present (W:1105); 22.1.1 does not read `ExtraAqfCoeff`.
- **Init dialect.** The files are Perl hashes: `{ key => value, ... }` with a value that is a string (single- or double-quoted), a number, a bareword or a block. The published files hold these oddities, which WBM reads without complaint: `,,`, read as one comma (`wbm_SHORT.init` and `wbm_SHORT_standard.init`, line 34); `key => ,`, read as `''` (WBM rewrites `=>\s*,` to `=> ''` before the eval, so it also matches across a line break, M:366): `Polygon_Aggregation => ,` in `wbm_test.init`, `Var_Scale => ,` in ten data inits and `Processing => ,` in `rice_percolationRate.init`; a trailing comma before `}` (`Global_tracking.init`, `test.init`, `Wyoming_tracking.init` and, inside `Spinup`, `wbm_test.init`); double-quoted values (`Comment`, `Author`, `Citation`, `URL` and `DOI` of `/wbm/data_init/dams/HydConDams_Global_v2.0.init`).
- **Paths.** A string with `/` or `\` or ending in `.init` is an init file (M:245). A `File_Path` may list several files, each ending in `;`; the last `;` is optional (12 of 30 shipped data inits omit it). Where a run finds files:

| Path in the init | Is | Mode |
|---|---|---|
| `/wbm/data/` | the model input's root; it contains `data_init/`, so `/wbm/data/data_init/x` and `/wbm/data_init/x` are one file | read-only |
| `/wbm/data_init/` | the model input's `data_init/` | read-only |
| `/wbm/wbm_init/` | a per-run copy of the draft's `wbm_init/` (`shutil.copytree`, recursive) | read-write |
| `/wbm/spool/`, `/wbm/wbm_output/`, `/wbm/WBM_run_state/` | the run's own folders | read-write |
| `/wbm/model/`, `/wbm/utilities/`, `/wbm/gdal_test_files/` | the snapshot's own | read-only |

These are the binds of `packages/openghm/src/openghm/sim.py`. Nothing binds `/wbm/user_data`, which only the test harness does. A path as written in an init may not exist while the same file does under a similar name inside the same model input (basenames repeat: `/wbm/data/climate/precip/merra2_prectotcorr_d.init` and `/wbm/data_init/climate/merra2_prectotcorr_d.init`).

## 7. Output variables

A name in `Output_vars` is accepted by `make_list_out` (M:546-565; M(22):491-510) only if
1. it is in `get_wbm_var_list()`, which scrapes the text of `wbm.pl` itself between `my %data_out =` and `### End of %data_out` (M:569-584; M(22):514-529), or it ends in `_irrigation`, `_irrDemand`, `_soilMoistFrac`, `_PET`, `_AET`, `_netIrrigation`, `_BW_ET` or `_GW_ET` (the per-crop names, M:555); and
2. it is in the `WBM_dataCube_expand.csv` that `WBM.conf` names (M:551, 560-561).

The scrape matches this regex against each line of the block:

```
['"](\w+)(_\$id|_\$_)*['"]\s*=>\s*\[\s*\$
```

A name that fails the first test aborts WBM ("does not exist in the WBM output list"), and so does one that fails the second ("not found in the WBM variable table"). Measured: `glCount` is in the CSV only and `vMean` in the code only; both abort (`v2_ov_csvonly`, `v2_ov_codeonly`). Names WBM adds itself after the check (`<var>_irr_<k>` when `nIrrTracking` is above 1, W:4985-4999; `dischMsk_<id>`, W:4960-4967) must not be listed. A validated name with no value in the run is dropped with a printed message, not an error (W:3906-3915; W(22):3476).

| | 23.9.0 | 22.1.1 |
|---|---|---|
| CSV | `model/WBM_dataCube_expand.csv`, 581 lines | the same file in the public bucket, 546 lines |
| Named `Var` rows | 575, all unique | 540, 530 unique (duplicated: `cropArea glArea glMelt glVolume soilMoist_pg soilMoist_pgi soilMoist_pgn soilMoist_pr soilMoist_ps soilMoist_pu`) |
| Names scraped from `%data_out` | 308 hits, 293 unique | 269 hits, 263 unique |
| CSV rows that pass | **437** | **407** |
| CSV rows that abort | 138 (for example 19 of the 28 `DIN_*` rows, all `*_pgi` and `*_pgn`, `discharge_irr_1` to `4`, `DOC_*`, `grndWater_twt`, `Wetland_*`, `glCount`, `glPrecip`, `glRefreezing`, `glSnow`, `hwc*`, `lawn*`, `domUseEvap_mm_p?`, `aqfStorage_mm_p?`, `irrVIS_mm_p?`) | 123 (the same families, no `DOC_*`; also `endoStrg_mm_p?`, `resStorage_mm_p?`, `soilMoist_mm_p?`, `runoffStrg_mm_p?`, `smResStrg_mm_p?`) |
| In the code but not in the CSV (abort) | `AQF_DH_Depth_T IrrReuseInGrossAqf_irr IrrReuseInGrossFlow_irr IrrReuseInGrossGrwt_irr irrFracInGross_irr vMean` | the same six |

The two lists are generated: `web-gateway/backend/scripts/gen_output_vars.py` writes
`web-gateway/backend/app/wbm_init/output_vars/23.9.0.txt` and `22.1.1.txt` with the
sha256 of both inputs in their headers.

What an output name switches on. WBM turns a process on when any output name matches
its trigger (W:969-982; W(22):940-953, identical regexes), so the tree lists them as
derived modules with no init key of their own.

| Process | Trigger | Notes |
|---|---|---|
| Water age | an output matching `streamAge` | |
| Runoff source tracking | an output ending `_gm`, `_sm`, `_rr` or `_bf` | 12 CSV names, all accepted (measured: `runoff_gm` prints `Component tracking: rSource`, `v2_ov_gm`) |
| Primary source tracking | an output ending `_pg`, `_ps`, `_pr` or `_pu` | 128 CSV rows; 104 accepted on 23.9.0, 80 on 22.1.1 (108 CSV rows on 22.1.1). Choosing such a variable switches the process on (measured: `v2_ov_ps`, `Component tracking: pSource`). The manual says glacier melt can only be tracked when glacier water is provided (manual L914) |
| Irrigation re-use tracking | an output ending `_pst`, `_irr`, `_use` or `_rlt` | 19 CSV rows, 17 on 22.1.1. Cancelled when `Irrigation` is falsy (W:984; W(22):955); the variables are then dropped with a message (measured: `v2_ov_irr`, `Component tracking: None`). The `IrrReuse*` and `*_irr_N` outputs also need the component balance (W:1139-1140) |
| Water temperature | the bucket needs `(runoff\|discharge)_twt$` (W:978); the inputs it needs are required on **any** `_twt` output (W:583) | accepted names: `discharge_twt` and `baseflow_twt` |
| Spatial masks | the `Runoff_mask` **block** is the trigger (W:980); then at least one of `dischMsk runoffMsk grndWtMsk` is required (W:4889-4890) | a Msk output without the block has no Magic-Table entry (M:654) and fails at the start of a real run, though `-test` passes (measured: `v2_ov_msk_real`, `v2_ov_msk`) |
| DIN | an output starting `DIN` (W:730) | the block is ignored and forced to `''` otherwise (W:763); with such an output it is mandatory (measured: `v2_ov_din2`) |
| Green and blue water | an output matching `Moist(Gr\|Bl)` or `[BG]W_(ET\|SM)` (W:987) | |
| Endorheic components | an output matching `^endoStrg_(mm_\|km3_)*(pg\|ps\|pr\|pu)` (W:986) | 23.9.0 accepts four names; 22.1.1 accepts none |
| Irrigation re-use cycles | `nIrrTracking` above 1 | adds `<var>_irr_<k>` for every listed `*_irr` variable (W:4985-4999) |

## 8. Dataset descriptors (data `.init` files)

A `dataset` field with `accepts: [init]` points to a data `.init`, the RIMS dataset
descriptor read by `attrib()`. A file that has a `Code_Name` is a descriptor; one that
does not (`HydConDams_Global_v2.0.init`) is a block file, which a module's own keys edit.

- **Required keys**, which `MT_reqParams()` makes `attrib()` check for existence only (M:205-208): `Code_Name Time_Series Start_Date End_Date Var_Name Bands Projection File_Path`. An empty value is accepted: three shipped files have `Var_Name => ''`, and `crops/mirca_cropAreaFraction.init` has an empty `Time_Series` and `End_Date`.
- **`Time_Series`** is one of `daily`, `daily{N}` (an hourly series), `monthly`, `yearly`, `decadal`, `daily_clim`, `monthly_clim`, `yearly_clim` or empty; empty becomes `yearly_clim` with dates `0000-00-00` (D:107-108, 125-130).
- **Dates** are `YYYY-MM-DD`, `YYYY-MM-00` (monthly), `YYYY-01-00` to `YYYY-12-00` (yearly, as in the shipped glacier volume file) and `0000-00-00` or `0000-MM-DD` (climatology); WBM checks only that a date is empty or contains `dddd-dd-dd` (M:227-230; R:1711-1719).
- **`File_Path`** is one file or a `;`-terminated list; it may use `_YEAR_`, `_MONTH_` and `_DAY_`. A shapefile needs `polygon` in `Processing` (M:224).
- **Coverage is not checked at start-up.** A dataset that does not cover the first spin-up day fails at once, even in `-test` (measured: `v2_spinup1999`). One that ends early passes `-test`, and the real run works until it reaches the gap and then dies (measured: `v2_dates_short_real2`, six months in). The published model inputs declare more than they hold: `52585562` `/wbm/data/climate/precip` and `/wbm/data/climate/airTemp` declare 2000-2015 and hold 2000-2001; its `data_init/climate` declares 1980-2018 over the same 731 files; glacier monthly and yearly files declare 1980-2012 and exist for 1980 and 2000-2009 ([open item 23](open-items.md)).
- **Which date WBM looks up, which file it opens, and what lies outside `Start_Date`..`End_Date`** (read in the code of both versions; no run was needed). `RIMS::DataSet->new` builds the dataset's whole list of dates and file names once, from `Start_Date` to `End_Date` (D:110-115; D(22):98-103). It opens no file: `RIMS::chk_date_list`, which would test that the files exist, is defined and called nowhere (R:1608; R(22):1502). The list steps by the days of a month for `monthly`, 365 or 366 days for `yearly`, 3653 for `decadal` and 1/N of a day for `daily{N}` (R:1454-1460; R(22):1359-1364), from the middle of the first period (`unzero_dates`: day 15 of a month, July 1 of a year, R:1361-1373) and, for a climatology, in 2001, a year with no February 29 (R:1381). A date's file is `File_Path` with `_YEAR_`, `_MONTH_`, `_DAY_`, `_HOUR_` and `_MIN_` replaced by that date's parts (R:1551-1555; R(22):1444-1449), so the file of a monthly dataset has day 15 and of a yearly one month 07 and day 01. A pyramid entry `(1e10,1e6):path;` is one file per scale (`file_pyramid`, R:962-979). A run date is looked up among the dataset's own dates and, when it is not one, as its month (`YYYY-MM-00`), then its year, then its decade (D:222-226; D(22):210-214): a daily run reads a monthly or yearly dataset by month or year. A February 29 the dataset lacks is looked up as February 28 (D:212-214; D(22):200-202), and a climatology date has no year or leap day (D:206-210). **A date the dataset does not have is fatal: "Date ... does not exist in ... dataset" (D:190-192; D(22):178-180). Nothing clamps it, for any time series**, so a monthly or a yearly dataset that does not cover the run dies as the measured daily case does. The one exception is `glArea` and `glVolume`, read with `DATE_SEARCH_OPT => {YR_UP => 1}` (W:690, 1595-1597; W(22):666, 1488-1490), which look the date up again one year later when the first look fails (D:156-193). An hourly dataset (`daily{N}`) cannot be read for a run that steps by days (D:203-204; D(22):191-192). A field read with `read_Layer` takes one date, 2001-01-01 (M:817), whatever its series. The gateway's rule is built on these lines (`web-gateway/backend/app/wbm_init/cross_rules.py`).
- **The first file of a dataset is opened at the start, whatever the run's dates.** WBM reads the grid of some datasets from `fileList[0][0]`, the file of the dataset's own `Start_Date` (monthly: day 15 of that month, yearly: July 1 of that year): `glMelt`, `glArea` and `glVolume` (W:677-679; on 22.1.1 only `glMelt` and `glVolume`, W(22):655-656, and `gl_scale` opens `glMelt`'s on both, R:3384, R(22):2959), and, with `lapseDownscale` on, `climElevation`, `netElevation` and the air temperature `MT_airT.Primary` (W:4820-4832; W(22):4314-4326). The file is needed even when no run date reads it. Measured: SLURM 21598634 (the local gateway, `v2` with Glaciers switched on, datasets starting 1980, a model input that holds glacier files for 2000-2009): exit 2 after 40 s, "Requested file (in get_extent)- /wbm/data/glaciers/glacier_RDI40_6min_1980_m.nc does not exist", before the resolution check. `ff0ba2e5` holds 1980 as well, which is why Wyoming and Global run. The tree marks these fields `reads_first_file`, and `dataset_file_coverage` requires the file (`web-gateway/backend/app/wbm_init/cross_rules.py`).
- **`Code_Name` equals the file name** on 23.9.0 only. In both model inputs `Effective_Rooting_Depth_mod.init` has `Code_Name` `root_depth`, `irrEfficiency.init` has `fao_irrEfficiency` and `FAO_SWGW_ratio_mod.init` has `FAO_SW_GW_ratio_mod`; the unreferenced `glacier_RDI6_..._Area_yc.init` has `global_rgi6_glaciers_area_1km`. `Code_Name` is not unique across a model input: `root_depth`, `merra2_prectotcorr_d` and `merra2_t2m_d` each name two different files in `52585562`. A fork rewrites `Code_Name` to the copy's file name, which repairs this (ADR 0039).
- **Non-ASCII bytes** in three shipped data inits (`crops/mirca_cropAreaFraction.init`, `crops/rice_percolationRate.init`, `/wbm/data_init/irrigation/irrEfficiency.init`), identical in both model inputs, abort a 23.9.0 run. All are in free text WBM does not read (`citation`, `Comment`): `ö` (U+00F6) in all three and `–` (U+2013) once, in `mirca_cropAreaFraction.init`. A fork writes them as `o` and `-` (the toolkit transliterates, ADR 0039; read from the published files 2026-10-24).
- **Extra keys** (`citation`, `download_link`, `Comment` ...) are not in `MT_params()` and are ignored.
- **A fork runs.** A copy of a data `.init` at `/wbm/wbm_init/datasets/` with its `Code_Name` rewritten ran (measured: `v2_fork_subdir`). `openghm snapshot publish` uploads the run's `wbm_init/` with its subfolders (`packages/openghm/src/openghm/publish.py`), and the layout check asks only for the required top-level entries (`schemas/snapshot-spec/layout/1.0.0.json`), so a fork is published with its snapshot. The spool cache variant hashes every `.init` the run init names (`packages/openghm/src/openghm/spool.py`), so a changed fork needs a new file name, not an edit in place.
- **A draft's fork** (ADR 0039, built 2026-10-24). The changes file's `forks` list carries `{from, to, set}`: the gateway names the copy `<original basename>__<8 hex>.init` under `/wbm/wbm_init/datasets/` (the hash is of the original's path and the values set, so the same edit has the same name) and sets the field's key to it; the toolkit writes the copy with `Code_Name` set to that name and its text transliterated to ASCII. A draft may set `Var_Scale`, `Var_Offset` and `Units`. **`Var_Scale` is the whole factor, not a multiplier on top of the file's own: WBM computes `value * Var_Scale + Var_Offset` (M:1105), and a blank or 0 `Var_Scale` is read as 1 (M:233, 1026).** `merra2_prectotcorr_d.init` has `Var_Scale` 86400, the conversion of kg/(m^2 s) to mm/day, so 10 % more precipitation is 95040; 1.1 would leave about 1e-5 mm/day. What a copy changes in a run is measured only as far as `v2_fork_subdir` (a copy runs); the precipitation sensitivity run and a `-test` of a repaired `irrEfficiency.init` are [open](#open-not-established) until the maintainer runs them.
- **The `Irrigation.CropParFile` CSV** holds 13 data `.init` paths in its `RootDepth`, `CropDepletionFactor`, `LandFracTS`, `Kc_TS` and `AddedWaterTS` columns; `Reservoirs.IrrFrequency` in the reservoir block file is another data `.init`.

## 9. Measured on Anvil

Every case ran `wbm.pl -v -test` unless the row says otherwise, with the harness in
`ops/anvil/param-tests/`. `v2` is snapshot `fc66a2cd` (WBM 23.9.0); `w` is Wyoming
`245430de` (WBM 22.1.1). Exit is `wbm.pl`'s exit status.

**E0, SLURM 21521192** (2026-10-19): `v2` with only `Output_dir` made absolute: exit 0 in 6 s, `Routing ... LRR with 2.48 km/hr`. The velocity 2.18 is the 30 arc-minute value; `wbm.pl` scales it by 1-0.077 ln(cellsize/0.5) (W:927), giving 2.48 at 5 arc-minutes. `wbm.pl` dies unless `Projection` is exactly `epsg:4326` (W:925-926).

**Batch 1, SLURM 21521320** (2026-10-19)

| Case | Code | Change | Exit | Result |
|---|---|---|---|---|
| `v2_codename_bad` | 23.9.0 | `MT_airT.Primary` to a copy of `merra2_t2m_d.init` named `t2m_copy.init`, `Code_Name` unchanged | 255 | "Dataset init file name does not match its ID in Code_Name entry." |
| `v2_codename_ok` | 23.9.0 | the same with `Code_Name` `t2m_copy2` | 0 | runs; a path outside `/wbm/data` works when it is bound |
| `w_codename_bad` | 22.1.1 | the same mismatch | 0 | runs: no check |
| `v2_flat_spinup`, `w_flat_spinup` | both | `Spinup_Start`, `Spinup_End`, `Spinup_Loops` instead of a `Spinup` block | 255, 255 | "Obsolete spinup parameters input. Use "Spinup" block instead. Aborting..." |
| `v2_short_raw`, `v2_short_std_raw` | 23.9.0 | the published `wbm_SHORT.init`, `wbm_SHORT_standard.init` as they are | 255, 255 | the same message |
| `v2_savevars0` | 23.9.0 | `Spinup.Save_Vars => 0` | 0 | runs |
| `w_savevars0` | 22.1.1 | the same | 2 | `Wrong key "Save_Vars" in the "Spinup" input block.` |
| `v2_ov_empty` | 23.9.0 | `Output_vars => ''` | 255 | `Parameter "Output_vars" is required` |
| `v2_ov_space` | 23.9.0 | `Output_vars => ' '` | 0 | runs, with no output |
| `v2_ov_bad`, `w_ov_bad` | both | add `fooBar` | 255, 255 | "does not exist in the WBM output list" |
| `v2_ov_csvonly` | 23.9.0 | add `glCount` (in the CSV, not in `%data_out`) | 255 | "does not exist in the WBM output list" |
| `v2_ov_codeonly` | 23.9.0 | add `vMean` (in the code, not in the CSV) | 255 | `Variable "vMean" is not found in the WBM variable table` |
| `v2_nonascii` | 23.9.0 | `Comment` with `é` | 25 | "non-ASCII character \xC3 at column 17 of line 3" |
| `w_nonascii` | 22.1.1 | the same | 0 | runs |
| `v2_unknown_top` | 23.9.0 | an extra top-level key `Fooo => 1` | 0 | runs; the key is ignored |
| `v2_typo_block` | 23.9.0 | `wbmParam => { alpah => 3 }` | 0 | runs; the key is ignored |
| `v2_proj_upper` | 23.9.0 | `Projection 'EPSG:4326'` | 2 | "Fix code below for non-geographical projections. Aborting..." |
| `v2_rootnum` | 23.9.0 | `rootingDepth => '1000'` | 0 | runs; the water balance changes |
| `v2_owe_num` | 23.9.0 | `openWaterEvap => '2'` | 2 | "Couldn't open /wbm/data/DataID_DB.csv": a number is a Magic-Table ID, and none exists |
| `v2_owe_calc` | 23.9.0 | `openWaterEvap => 'Calculate'` | 2 | "MT_cloudFr input is required" |
| `v2_pm` | 23.9.0 | `PET => 'Penman-Monteith'` with no drivers | 2 | "MT_cloudFr input is required" |
| `w_pet_block` | 22.1.1 | `PET => { method => 'Hamon' }` | 2 | `Unknown PET method: "HASH(...)"` |
| `v2_precip_str` | 23.9.0 | `MT_Precip => '<path>'`, no block | 2 | "Can't use string ... as a HASH ref ... wbm.pl line 535" |
| `v2_routing_empty` | 23.9.0 | `Routing => ''` | 255 | `Parameter "Routing" is required` |
| `v2_muskingum` | 23.9.0 | `Routing => { method => 'Muskingum' }`, with `openWaterEvap` | 0 | "Routing method: Muskingum" |
| `w_muskingum` | 22.1.1 | `Routing => 'Muskingum'`, with `Irrigation` and `Reservoirs` | 0 | "Warning- Muskingum routing is not compatible with ... LRR is used instead." |
| `v2_velocity1` | 23.9.0 | `Routing` velocity 1 | 0 | "LRR with 1.14 km/hr" |
| `v2_spool_empty` | 23.9.0 | `MT_Code_Name.spool_dir => ''` | 30 | "mkdir /hyd_5m_CONUS_mississippi_patched/: Read-only file system" |
| `v2_loops0_nostart` | 23.9.0 | `Spinup.Loops 0` and no `Run_Start` | 0 | runs: `Run_Start` is optional when `Spinup.Start` is set (the published `wbm_test.init` has none) |
| `v2_dates_short` | 23.9.0 | `MT_airT` dataset `End_Date` 2000-06-30, run into 2001 | 0 | `-test` passes |
| `v2_mflag` | 23.9.0 | `wbm.pl -m` | **0** | "Unknown option: m": exits 0 without running |
| `w_irreff_num` | 22.1.1 | `Irrigation.IrrEfficiency => 70` | 25 | `Can't locate object method "lclip" via package "70" ... wbm.pl line 2259` |
| `w_landcover_lc` | 22.1.1 | `landCover => <csv>` (lowercase) | 0 | log identical to `w_base`: ignored |
| `w_base` | 22.1.1 | the published `Wyoming_tracking.init` | 0 | 67 to 77 s per test |

**Batch 2, SLURM 21521393**

| Case | Code | Change | Exit | Result |
|---|---|---|---|---|
| `v2_ov_ps` | 23.9.0 | `Output_vars 'runoff runoff_ps'` | 0 | "Component tracking: pSource" |
| `v2_ov_gm` | 23.9.0 | `'runoff runoff_gm'` | 0 | "Component tracking: rSource" |
| `v2_ov_irr` | 23.9.0 | `'runoff runoff_irr'`, no `Irrigation` | 0 | "Component tracking: None": the variable is dropped without an error |
| `v2_ov_msk` | 23.9.0 | `'runoff dischMsk'`, no `Runoff_mask`, test mode | 0 | "Component tracking: None"; a real run is `v2_ov_msk_real` |
| `v2_ov_twt` | 23.9.0 | `'runoff discharge_twt'` | 2 | "MT_cloudFr input is required" |
| `v2_ov_din` | 23.9.0 | `'runoff DIN_Conc'` | 255 | not in the output list (a name that does not exist) |
| `v2_spinup1999` | 23.9.0 | `Spinup.Start` 1999-01-01, data from 2000 | 2 | `Date 1999-01-01 ... does not exist in "merra2_t2m_d" dataset`: a dataset that misses the first day fails at once, also in `-test` |
| `w_mask_noout` | 22.1.1 | Wyoming without `dischMsk`, `runoffMsk`, `grndWtMsk`, `Runoff_mask` kept | 2 | "No Runoff Masks output variables are listed ... Aborting" |
| `v2_dates_short_real` | 23.9.0 | a real run 2000-01 to 08, `PostProcessing` block kept with `TA_multi_year_start` 2001 | 2 | "Aggregation multi-year start is outside of the run dates...": `PostProcessing` is validated even with `Run => 0` |

**Batch 3, SLURM 21521414**

| Case | Code | Change | Exit | Result |
|---|---|---|---|---|
| `v2_ov_din2` | 23.9.0 | `'runoff DIN_Load'`, no `DIN` block, `-test` | 2 | `DIN model requires "DIN" input...` |
| `v2_ov_msk_real` | 23.9.0 | a real run 2000-01-01 to 10, `'runoff dischMsk'`, no `Runoff_mask`, `PostProcessing ''` | 255 | `Attributes for WMB_test_dischMsk_m are not found in .../wbm_test.MT.csv ... Aborting`. `-test` passed (`v2_ov_msk`), so `-test` is not a complete dry run |
| `v2_dates_short_real2` | 23.9.0 | a real run 2000-01-01 to 08-31, `MT_airT` dataset `End_Date` 2000-06-30, `PostProcessing ''` | 255 after 180 s | ran January to June, then `Date 2000-07-01 ... does not exist in "t2m_short" dataset` |
| (code) | 23.9.0 | `openWaterEvap` absent | n/a | W:878, 1640: `openWtrCoeff` (default 1) times PET; the sheet's "2 x PET" is wrong and the manual's "100% of PET" is right |

**Batch 4, SLURM 21521585**

| Case | Code | Change | Exit | Result |
|---|---|---|---|---|
| `v2_awc_num` | 23.9.0 | `soilAWCapacity => '150'` | 255 | `Can't locate object method "lclip" via package "150" ... wbm.pl line 5024` |
| `v2_calendar360` | 23.9.0 | `Calendar => '360'` | 255 | "WBM is not coded for 360 calendar. Aborting..." |
| `v2_calendar365` | 23.9.0 | `Calendar => '365'` | 0 | runs |
| `w_irreff_absent` | 22.1.1 | Wyoming without `Irrigation.IrrEfficiency` | 25 | `Can't locate object method "lclip" via package "1" ... wbm.pl line 2259`: the default 1 is itself a number |
| `w_cropfrac_num` | 22.1.1 | `Irrigation.CropAreaFrac => '0.1'` | 0 | runs |

**Batch 5, SLURM 21579523** (2026-10-21)

| Case | Code | Change | Exit | Result |
|---|---|---|---|---|
| `v2_fork_subdir` | 23.9.0 | `MT_airT.Primary` to `/wbm/wbm_init/datasets/merra2_t2m_d__wbm_test_r1.init`, a copy with `Code_Name` rewritten, copied in with `WBM_INIT_EXTRA` | 0 | runs |
| `v2_short_conv` | 23.9.0 | the published `wbm_SHORT.init` with its flat spin-up keys converted to a `Spinup` block | 2 | "Requested file (in get_extent)- /wbm/data/network/Merrimack_stn210_Subset.asc does not exist" |
| `v2_short_std_conv` | 23.9.0 | the same for `wbm_SHORT_standard.init` | 2 | the same |

**Batch 6, SLURM 21598634** (2026-10-23; a run of the local gateway, not the harness)

| Case | Code | Change | Exit | Result |
|---|---|---|---|---|
| `v2` + Glaciers on | 23.9.0 | `Glaciers` switched on in the wizard: `glMelt` the monthly discharge, `glArea` the 1 km area fraction, `glVolume` the yearly volume of `52585562`, all starting 1980 | 2 | "Requested file (in get_extent)- /wbm/data/glaciers/glacier_RDI40_6min_1980_m.nc does not exist" after 40 s: the first file of the melt dataset is the file of 1980, and the model input holds 2000-2009 |

**Batch 7, data `.init` forks** (2026-10-24; toolkit `01500cf`, ADR 0039)

| Case | Code | Change | Exit | Result |
|---|---|---|---|---|
| `v2` + precipitation fork (SLURM 21609692, local gateway) | 23.9.0 | `MT_Precip.Primary` to a copy of `merra2_prectotcorr_d.init` with `Var_Scale` 95040 (86400 x 1.1), staged as `wbm_init/datasets/merra2_prectotcorr_d__4af6b921.init` with that `Code_Name` | 0 | completed in 14 min; mean daily `runoff` over 2000-2001 0.709 against 0.564 for the same draft unforked (SLURM 21609701), +26 %; mean `discharge` 49.0 against 37.8 |
| `v2_fork_irr` (SLURM 21609705, harness) | 23.9.0 | `Impervious` to a repaired copy of `irrEfficiency.init` (empty `set`: `Code_Name` `irrEfficiency__542d381d`, `Döll` written `Doll`), copied in with `WBM_INIT_EXTRA` | 2 | passes the descriptor checks and stops later, reading the data: "Requested file (in read_GDAL)- /wbm/data/irrigation/Global_Crops_IrrEfficiencyGlobalExtent_30min.nc does not exist": `52585562` has no such file. The gateway's coverage check refuses the same draft before submit |
| `v2_orig_irr` (SLURM 21609705, harness) | 23.9.0 | `Impervious` to the original `irrEfficiency.init` | 25 | "It has non-ASCII character \xC3 at column 15 of line 15", at reading the init |

## 10. Where the sources disagree

The input spreadsheet, the WBM manual, the two code versions and the measurements, key by
key. The code value is the one the tree uses. "-" means that source says nothing. A bare
`Ln` is a line of the manual's text extract; `W`, `M` and `(22)` are as in section 1.

| Key | Sheet | WBM manual | 22.1.1 code | 23.9.0 code | Measured |
|---|---|---|---|---|---|
| wbmParam.RhRt2 | 0.56 | silent; Fig 7.1 plots C_SRP 0.05/0.2/0.8 (L274-275) | 0.56 (W(22):844-845) | 0.2 (W:872-873) | - |
| DIN.scale | 12.1 | silent (Wollheim 2008, no numbers, L976-980) | 12.2 (W(22):709) | 12.2 (W:737) | - |
| DIN.asym_ag | 4.2 | silent | 4.8, only with Irrigation (W(22):711) | 4.8, only with Irrigation (W:739) | - |
| DIN.intercept | key intcpt | -2.975 (L1007), no key | reads $param{intercept}, stores intcpt (W(22):715) | same (W:743) | - |
| WaterDemand.StkDemandReturnFr | 0.89 | no value (L895) | 0.95 (W(22):1214) | 0.95 (W:1255) | - |
| Aquifers.Aqf_Ph | 13.1 | 13.1, log10 m2 (L605) | stub, ignored | -13.1 (M:3478-3479) | - |
| Aquifers.Aqf_SyCnfd | 0.001 | 0.001 (L601-627) | stub, ignored | 0.01, read as a layer (M:3476-3477) | - |
| PostProcessing.Trim | 1 | silent | absent = 0 (M(22):3198) | absent = 0 (M:4232) | - |
| openWaterEvap default | 2 x PET | 100% of PET (sec 3.2, L217) | openWtrCoeff (1) x PET (W(22):850,1530) | openWtrCoeff (1) x PET (W:878,1640) | code only (no run); sheet and the old tree were wrong |
| lapseDownscale.lapseRate | -6.49 | -6.4; may be a gridded layer (sec 4, L238) | -6.49, only if isNumber (W(22):4297,4308) | -6.49, only if isNumber (W:4803,4814) | - |
| Irrigation.Order | 1 = surface water first | default order: shallow groundwater in the cell, then river storage in the cell (sec 12.2.1, L792-798) | comment '0 Grnd Water; 1 Stream priority' (W(22):1077); used as a numeric ratio layer zeros+Order when SW_GW_ratio is absent | same (W:1110, 1175-1176) | -; the tree labels follow the code, the manual disagrees (open) |
| Irrigation.IrrEfficiency | 100 (%) | Ieff [-] (eq 12.1-5, L773) | default 1; percent, read_dateLayer(...)->lclip(10)/100 (W(22):1073, 2257-2259) | default 1; same use (W:1106, 2535-2537) | a number crashes: w_irreff_num, SLURM 21521320 (exit 25, lclip on a scalar); so the default 1 is unusable as well |
| Routing.velocity | 2.18 km/h | silent (L398) | default 2.18 at 30 arc-min, scaled by 1-0.077 ln(cellsize/0.5) (W(22):886,899) | same (W:914,927) | 2.18 gives 2.48 km/h at 5': E0, SLURM 21521192; velocity 1 gives 1.14: v2_velocity1, SLURM 21521320 |
| wbmParam.CLeafMax unit | mm m-2 s-1 ??? | m h-1 (Table 1, L186) | mm/s, x secDay/1000 = m/day (W(22):3966) | same (W:4466) | - |
| Aquifers.BRes unit | day | day (L619) and day-1 (L581) in the same manual | stub | comment 'Riverbed resistance (day)' (M:3496) | - |
| DIN.asym unit | mg DIN/L | g/L (L978) | - | - | - (mg/L kept; 1.4 g/L is implausible) |
| WaterDemand.DomDemandPP / IndDemandPP unit | per capita, per year | mm/d per capita (L892) | - | - | - (unit left blank until confirmed) |
| DIN.intercept (sheet name intcpt) | intcpt | no key names | intercept (W(22):715) | intercept (W:743) | - |
| Irrigation.SearchDist / AqfCoeff | old names | IrrSearchDist 100 km (L791) | SearchDist is aliased (W(22):1072); AqfCoeff is the live key (W(22):1080); ExtraAqfCoeff is not read | both old names are aliased (W:1104-1105); ExtraAqfCoeff is native (W:1113) | -; the tree has one field for each version's native key |
| Aquifers key names | Net_DEM, H_DEM_B/T, Aqf_Kh, Aqf_Kv | STN_DEM, WT_DEM_B/T, Aqf_Kh_B, Aqf_Kv_B (L591-609) | stub, ignored (M(22):2989-2994) | reads the sheet names (M:3450-3497) | - |
| Aquifers / Springs / USGS availability | enabled | not in the public release (L428, L586) | stubs 'Removed from public domain' (M(22):2899-2994) | full ModFlow, Lumped, Virtual, springs, USGS | not run |
| openWaterEvap value | GDAL-Layer or Calculate | input data or scaled PET; 'Calculate' never appears | init only (W(22):631); Calculate keyword (W(22):560) | init only (W:652-654); Calculate keyword (W:582) | a number is taken as an MT ID: v2_owe_num, SLURM 21521320; 'Calculate' needs MT_cloudFr: v2_owe_calc, SLURM 21521320. Neither is offered |
| MT_windU/MT_windV/MT_cloudFr/MT_humidity/MT_albedo | GDAL-Layer or MT ID/init | - | init only (W(22):562-567, 614) | init only (W:587-590, 636) | MT IDs cannot work: no DataID_DB.csv (v2_owe_num, SLURM 21521320) |
| Runoff_mask.maskFile | GDAL-Layer or MT ID/init | - | raster only (W(22):4395) | raster only (W:4901) | - |
| Irrigation.ricePaddyDepth | number \| GDAL-Layer \| MT ID/init | - | number only (W(22):1089) | number only (W:1122) | - |
| Irrigation.CropParFile cells | GDAL layers, MT IDs/inits or numbers | - | LandFracTS, Kc_TS, RootDepth via attrib (init only); CropDepletionFactor number or init (W(22):4590-4690) | same (W:5120-5150) | - |
| Calculate / DEFAULT keywords | listed as values | - | check_defaults needs WBM.conf data_dir and /wbm/data/defaults/&lt;Key>/&lt;SubKey>/ (M(22):265-315) | same (M:280-332) | no model input has defaults/ folders; keywords are not offered |
| landCover (lowercase) | alias of LandCover | - | not read; only $runIO{LandCover} (W(22):4524-4526) | not read; only $runIO{LandCover} (W:5033, 5044) | ignored: w_landcover_lc, SLURM 21521320 |
| Projection | EPSG code or definition | - | must be exactly epsg:4326 (W(22):897-898) | same (W:925-926) | 'EPSG:4326' aborts: v2_proj_upper, SLURM 21521320 (exit 2) |
| MT_Code_Name.Calendar 360 | standard, 366, 365 | silent | regex accepts 360, then dies (M(22):416; W(22):255) | regex accepts 360, then dies (M:468; W:278) | v2_calendar360, SLURM 21521585: WBM is not coded for 360 calendar |
| MT_Code_Name.Time_Series | daily, hourly daily{24} | daily only (L748) | daily, daily{N}, monthly (M(22):436-437) | adds daily[N], daily[N,..lastDay], ':daily..' step suffix (M:488-491) | - |
| Spinup flat keys | Spinup_Start/End/Loops in wbm_SHORT*.init | - | fatal (M:117-118) | fatal (M:117-118) | v2_flat_spinup, w_flat_spinup, v2_short_raw, v2_short_std_raw: 'Obsolete spinup parameters', exit 255, SLURM 21521320 |
| Spinup.Save_Vars | bool01 | silent | not an allowed key, even 0 (M:122-123) | 1 or 2, 0 = off (M:139-140) | w_savevars0 exit 2 (22.1.1); v2_savevars0 exit 0 (23.9.0), SLURM 21521320 |
| Routing.method Muskingum | enum | exits if abstractions exist; coarse grids only (L347) | falls back to LRR with a warning when IBT, WaterDemand, Irrigation or openWaterEvap exists (W(22):462-472) | honoured | w_muskingum: warning and LRR; v2_muskingum with openWaterEvap ran Muskingum, SLURM 21521320 |
| Output_vars | not required; empty turns output off | silent | required and truthy (M(22):361); whitespace-only passes (W(22):247) | required and truthy (M:97-100, 376); whitespace-only passes (W:264) | v2_ov_empty exit 255; v2_ov_space runs with no outputs, SLURM 21521320 |
| Output_vars universe | 580 variables | silent | CSV 530 unique names; 407 accepted | CSV 575 named rows (5 blank); 437 accepted | v2_ov_csvonly and v2_ov_codeonly both fatal, SLURM 21521320 |
| Elevation | yes for P-M PET and OWE calculation | silent | not in wbm_params(); used W(22):599-605, 644 | not in wbm_params() (M:94); used W:622-628, 666; a constant 0 is false for the required checks | - |
| Runoff_mask.model | 0 simple, 1 full (see documentation) | not defined anywhere | set_default(model, 0); any true value = full (W(22):4466) | set_default(model, 0); any true value = full (W:4972) | - |
| MT_LAI | triggers canopy interception | interception proportional to LAI (L250); also P-M (L184) and water temperature (L955) | ATTR (W(22):636); required for P-M and _twt (W(22):604) | ATTR (W:658); required for P-M and _twt (W:627) | v2_pm and v2_ov_twt need the drivers, SLURM 21521320/21521393 |
| snowBands | flag | band range/size are preprocessing inputs (L228) | flag; band files next to the Network (W(22):830, 4177) | flag (W:858); band files (W:4683-4684) | - |

Sheet defaults that differ from the tree's and are not in the table above:

| Key | Sheet default | Tree default |
|---|---|---|
| `MT_Code_Name.MT_ID` | ID | none |
| `Routing.slope` | 0.1/1000 | 0.0001 |
| `Aquifers.H_DEM_T` | Net_DEM | none |
| `Aquifers.H_DEM_B` | Net_DEM | none |
| `Aquifers.SLE` | 0 \| min | 0 |
| `Aquifers.wellMax` | No limit | 1000000 |
| `WaterDemand.DomSearchDist` | IrrSearchDist | follows Irrigation.IrrSearchDist |
| `WaterDemand.IndSearchDist` | IrrSearchDist | follows Irrigation.IrrSearchDist |
| `WaterDemand.StkSearchDist` | IrrSearchDist | follows Irrigation.IrrSearchDist |
| `Irrigation.SW_GW_ratio` | Order | none |
| `PostProcessing.Polygon_Aggregation` | 0 | none |
| `PostProcessing.Polygon_Aggregation.MT` | Global_MT | none |

## 11. Evidence by init key

What each field's `doc`, `rule` and tuning hint said before the tree was trimmed to
user-facing help, keyed by the init key path, in the tree's order. A key with no entry
needs none.

#### Run setup

- `Comment`: Anything to describe the run. ASCII only: a non-ASCII byte aborts a 23.9.0 run (measured: v2_nonascii, SLURM 21521320)
- `Project`: Used only in the output title ('WBM-TrANS, &lt;Project>', M:496-497); default 'My project'. A short name is conventional but WBM has no rule; 3 of 6 shipped inits contain spaces
- `ID`: Unique WBM run ID, alphanumeric, no spaces; required and truthy (M:97-100, 376)
- `MT_Code_Name.Run_Start`: Run start date; YYYY-MM-00 gives a monthly time series. WBM uses Run_Start, else Spinup.Start, and dies only when both are empty (M:492, 503; measured: v2_loops0_nostart, SLURM 21521320; the published wbm_test.init has no Run_Start)
- `MT_Code_Name.Run_End`: Rule: end > start; empty -> climate.air_temp.primary must be set (the airTmin/airTmax form is not enough, M:507)
- `MT_Code_Name.Time_Series`: Output time step in MT format. Hourly is 'daily{N}' with N sub-daily intervals (N in 1,2,3,4,6,8,12,24; wbm.pl:449, 22.1.1: 417). 23.9.0 only: daily[N] = multi-day interval of N days, and a ':daily...' suffix sets the run step (M:488-491); 22.1.1 aborts on those (M(22):436-437 'Illegal value'). The manual documents daily processes only. Default monthly when Run_Start ends in -00, else daily
- `MT_Code_Name.Calendar`: standard is 366 (W:249)
- `MT_Code_Name.File_Size`: Rule: forced to day for hourly runs; day is invalid with a monthly time series (M:499-502)
- `MT_Code_Name.credits`: exists-tested (W:4300): never written
- `MT_Code_Name.MT_ID`: Rule: no leading '/' and no '\' (wbm_SHORT.init has one); defined-tested: '' stays empty, '_runoff' is appended (M:484-485)
- `MT_Code_Name.Output_dir`: Rule: absolute path (wbm_test.init has 'wbm/...'); the toolkit rewrites it to /wbm/wbm_output/&lt;sim_id>
- `MT_Code_Name.spool_dir`: never written ('' sends the spool to /: measured v2_spool_empty, SLURM 21521320). WBM.conf already sets /wbm/spool/ (model/WBM.conf:14), and the toolkit rewrites a spool_dir an init has to /wbm/spool/ (sim.py build_persim_init); no -spoolDir is passed. Of the published inits only Global_tracking and Wyoming_tracking set it, to /wbm/spool/; none sets run_state_dir, MT_file or credits (checked 2026-10-21)
- `MT_Code_Name.run_state_dir`: never written; the toolkit passes -stateDir (/wbm/WBM_run_state/, the WBM.conf default)
- `MT_Code_Name.MT_file`: never written; no model input has a DataID_DB.csv
- `Spinup`: Allowed keys: Start, End, Loops, State_ID, Force_ID_Date and (23.9.0) Save_Vars; any other key aborts (M:122-123). Always written nested: flat spinup_* keys are fatal in both versions
- `Spinup.Loops`: Number of spin-up loops. A non-number is read as 0; the code has no upper limit (M:124); ui_max is a UI guard only
- `Spinup.Start`: The day of Start is forced to 01 (M:4156)
- `Spinup.End`: The day of End is forced to the last day of its month (M:4157)
- `Spinup.Save_Vars`: 1 = save monthly and yearly aggregates during spin-up; 2 = yearly only (W:3989, 3407). 0 = off. 22.1.1 aborts on the key even with 0 (measured: w_savevars0 exit 2; v2_savevars0 exit 0, SLURM 21521320)
- `run.run_options.test`: One time step, no output. The gateway's cheap first check, NOT a complete dry run (section 12)
- `run.run_options.threads`: Clamped to 8 by WBM (wbm.pl:289)
- `run.run_options.bld_spool`: N_FORKS [NC]: build the spool; not allowed with -test or -noOutput (W:222-223)

#### Model domain

- `Network`: GDAL file; sets the grid, resolution and extent; the cache folder is named after it. The extension is part of the name: Merrimack_stn210_Subset exists only as .tif (the wbm_SHORT*.init inits ask for .asc). A circular network aborts WBM
- `Projection`: Exactly the lowercase string 'epsg:4326' (W:925-926; 22.1.1: 897-898); 'EPSG:4326' aborts (measured: v2_proj_upper exit 2, SLURM 21521320)
- `Elevation`: Used by Penman-Monteith/FAO-56 PET and to convert specific humidity (kg/kg); not in wbm_params(). A constant 0 is false for the 'required' checks (W:622-623), so when Elevation is required give a non-zero constant or a layer

#### River routing

- `Routing.method`: Always written (measured: v2_routing_empty exit 255, SLURM 21521320). Flush = flow accumulation. On 22.1.1 Muskingum is replaced by LRR with a warning when ConnectivityNetwork, WaterDemand, Irrigation or openWaterEvap is present (measured: w_muskingum, SLURM 21521320); 23.9.0 honours it (measured: v2_muskingum, SLURM 21521320). The manual: coarse grids only, Courant number << 1, exits when abstractions exist (L347)
- `Routing.weightedLength`: Weighted stream reach length in LRR routing; any string without 'No' means weighted, so never offer 0/false (W:2942)
- `Routing.velocity`: The 30 arc-min value; WBM scales it by 1-0.077*ln(cellsize/0.5) (W:927; 22.1.1: 899). Measured: 2.18 gives 2.48 km/h on a 5 arc-min network (E0, SLURM 21521192); 1 gives 1.14 (v2_velocity1, SLURM 21521320)
- `Routing.beta`: Shape parameter sigma (manual L374)

#### Climate forcing

- `MT_Precip.Primary`: Opens in the data .init editor; e.g. merra2_prectotcorr_d.init. Units must start mm/m (monthly) or mm/d, mm/h (W:559-565); at least monthly resolution. In 52585562 two different files carry this Code_Name (climate/precip/ declares 2000-2015, data_init/climate/ declares 1980-2018; both have files for 2000-2001 only)
- `precipFraction`: Rule: must be empty (omitted) when precipitation is daily: a non-empty value is fatal (W:555-556); Units must start 'frac'
- `MT_airT.Primary`: exists-tested (W:570): omitted in the min_max form, never ''
- `PET`: PET function. Penman-Monteith and FAO-56 need wind, humidity, cloud fraction, albedo (measured: v2_pm 'MT_cloudFr input is required', SLURM 21521320); Penman-Monteith also needs MT_LAI and canopyHt (W:625-627)
- `PET.Scale`: Multiplies land-cover PET (W:2229-2230). Written as a PET block { method, Scale }, which 22.1.1 aborts on (measured: w_pet_block, SLURM 21521320)
- `climate.extra_drivers`: Needed for Penman-Monteith/FAO-56 PET and for water temperature (_twt outputs). Open-water 'Calculate' is not offered
- `MT_windU.Secondary`: Patches nodata in the primary dataset; an empty Secondary is deleted by WBM (W:537)
- `MT_windV.Secondary`: Patches nodata in the primary dataset; an empty Secondary is deleted by WBM (W:537)
- `MT_humidity`: Relative (%), specific (kg/kg), or dew point (C); Units must match ^per|^%, ^kg or ^deg..C|^C (W:611-619); kg/kg needs a non-zero Elevation (W:622-623)
- `MT_humidity.Secondary`: Patches nodata in the primary dataset; an empty Secondary is deleted by WBM (W:537)
- `MT_cloudFr.Secondary`: Patches nodata in the primary dataset; an empty Secondary is deleted by WBM (W:537)
- `MT_albedo.Secondary`: Patches nodata in the primary dataset; an empty Secondary is deleted by WBM (W:537)
- `airT_yc`: Mean annual 2 m air temperature; base-layer temperature of the water-temperature model (W:711) and proxy for deep groundwater temperature. A constant is not verified against the Springs slicing at W:1861 (open)
- `lapseDownscale`: Requires: climate.air_temp.input_form == mean (MT_airT.Primary must exist, W:4817-4819)
- `lapseDownscale.climElevation`: Elevation of the climate drivers. A number dies (W:4822); a geopotential layer needs Var_Scale 0.1019716 in its data .init
- `lapseDownscale.netElevation`: Elevation of the river network grid. A number dies (W:4831)
- `lapseDownscale.lapseRate`: Used only if numeric (W:4814). The manual says -6.4 and allows a gridded layer; the code has -6.49 and a number (section 10)
- `lapseDownscale.forceSecTemp`: Allow downscaling when a Secondary temperature dataset is used; otherwise a Secondary dies (W:4809-4810)
- `climate.bias_correction`: Each modelled/observed pair needs both members; a lone member is silently ignored (M:976). Must be daily or monthly climatology datasets

#### Soil and land surface

- `land.soil_water.input_form`: If soilAWCapacity is given, FieldCap and WiltingPoint are not read (W:5021-5024) and are not written
- `soilAWCapacity`: wbm_test.init uses the netcdf_layer form NETCDF:&lt;file>.nc:layer. A number crashes: the code calls ->lclip on the layer (W:5022; same pattern as measured w_irreff_num, SLURM 21521320). SSURGO_AWC_1km is in neither model input. harmonized_AWC_5min is dangling in 52585562
  Accepted kinds: a number crashes (measured: v2_awc_num, SLURM 21521585, wbm.pl:5024)
- `FieldCap`: Rule: FieldCap and WiltingPoint must not both be numbers: (FieldCap - WiltingPoint)->lclip(0) is a method call on a plain scalar (W:5023-5025)
- `rootingDepth`: A number works (measured: v2_rootnum, SLURM 21521320). Code_Name root_depth names two different files in 52585562 (soil/root_depth.init and data_init/soil/Effective_Rooting_Depth_mod.init): pick by path
- `landCollapse`: Empty: use all land covers/crops; average: averaged (WBM also accepts avg); dominant: whole-cell dominant type (also accepts one). Read only with LandCover or Irrigation (W:5033-5035)
- `canopyHt`: A number crashes: the code calls ->lclip on it (W:4463; inferred from the code, same pattern as measured w_irreff_num)

#### Model parameters

- `wbmParam.alpha`: Soil moisture drying coefficient (sheet: 1 wet, 10 drier, 20 dry; larger alpha = AET less water-limited)
  Calibration hint: source: WBM manual sec 3.1 (L208): 'can be adjusted to calibrate the model'. No range is given: Fig 3.1 plots 2, 5 and 8 only as examples (L210)
- `wbmParam.Infiltration`: Anything not matching /HBV/i behaves as FrAMES (W:2222)
- `wbmParam.infiltrFrac`: Calibration hint: range: [0.4, 0.6]; source: WBM manual sec 7.1 (L271): 'generally robust in the range of 0.4 to 0.6'
- `wbmParam.HBV_Beta`: Direct infiltration recharge factor for HBV; not documented in the manual (L291)
- `wbmParam.groundWatBETA`: Baseflow release coefficient from groundwater storage (60-day time scale, manual L309)
- `wbmParam.RhRt2`: Runoff storage release (Rhole/Rtank)^2. The default differs by version: 0.56 on 22.1.1 (W(22):844), 0.2 on 23.9.0 (W:872); write it explicitly to reproduce a run across versions. The same coefficient drives the irrigation pool
  Calibration hint: range: [0.05, 0.8]; source: WBM manual Fig 7.1 (L278): C_SRP = 0.05, 0.2, 0.8 are 'three reasonable values'; C_SRP is RhRt2 (eq. 7.1-1, L276, is the code's RhRt2 * sqrt(G2 * surfStg), W:2706)
- `wbmParam.maxRffStorage`: Calibration hint: source: WBM manual sec 7.2 (L284, L287): T_SRP set to 1000 mm by default; the manual gives no tuning range; not applied to the irrigated fraction
- `wbmParam.CLeafMax`: Max leaf stomatal conductance (Dingman 2008, Table 7-5); the code multiplies by secDay/1000 to m/day (W:4466), so the unit is mm/s, not the sheet's 'mm m-2 s-1' or the manual's m/h
- `wbmParam.InterceptPar`: Canopy interception parameter (0.15 Dingman 2002 / BROOK90; 0.2 Dickinson 1984; 0.25 VIC, manual L252)
- `wbmParam.openWtrCoeff`: Open-water evaporation = coeff x PET when no openWaterEvap dataset is given (W:878, 1640)
- `wbmParam.oceanMask_file`: GDAL raster only (M:2007)
- `wbmParam.compBalance`: Tracking component balance, written as spreadsheets to the output folder (Global_tracking: 1, Wyoming_tracking: 0). WBM forces it to 0 unless a primary-source or irrigation re-use bucket is on (W:988-989) and to 1 when one of UseReuseOutGross_irr, IrrReuseInGross_irr, IrrReuseInGrossFlow_irr, IrrReuseInGrossGrwt_irr, IrrReuseInGrossAqf_irr, IrrReuseOutNet_irr, IrrReuseOutNonben_irr, irrFracInGross, UseReuseInGross_use is listed (W:1139-1140)
- `wbmParam.resetSpinupTracking`: Restart tracking after spin-up: 0 = representative mixtures, 1 = accumulate a component flux during the run. The sheet says 'reset groups 2 and 3', the manual says all stocks (L907-910): group scope open
- `wbmParam.nIrrTracking`: Number of irrigation water reuse cycles tracked in group 3. With N > 1 WBM adds &lt;var>_irr_&lt;k> for every listed *_irr variable itself (W:4985-4999); do not list those names (discharge_irr_1..4 are fatal in the output list)
- `wbmParam.outputScale`: /Cell/i on, anything else off (W:880-881)

#### Modules

- `ConnectivityNetwork.File`: Database/spreadsheet of inter-basin transfers (IBT); must exist (M:2094). Read without the ASCII check (M:2097). Optional columns with hard-coded names: Speculative
- `ConnectivityNetwork.SkipLines`: Required: WBM dies when it is undefined (M:2095-2096), so always written (form pre-filled with 0)
- `ConnectivityNetwork.Use`: Rows with an empty value in this column are skipped (M:2111). Behaviour when the key is absent: open
- `ConnectivityNetwork.Speculative`: A flag, not a column name: 1 = also use rows whose literal 'Speculative' column is non-empty (M:2112, 2218)
- `Reservoirs`: Not offered on 52585562: its model input has no dams/ folder, so the block file's File (HydConDams_Global_2021_v2.0.csv) is dangling. A block file keeps unknown keys (Comment, Author, Citation, URL, DOI) unchanged
- `Reservoirs.File`: Database/spreadsheet of reservoirs; must exist (M:2632). Read without the ASCII check (M:2635). Optional columns with hard-coded names, not init keys: ForceTo_Lon and ForceTo_Lat (force snapping to the network, M:2782-2784)
- `Reservoirs.SkipLines`: Required: WBM dies when it is undefined (M:2633-2634), so always written
- `Reservoirs.CatchArea`: Used without an existence guard (M:2737-2760): give CatchArea, Capacity and Area
- `Reservoirs.Capacity`: Effective storage, dead storage excluded (manual L712)
- `Reservoirs.StartYear`: The default-to-0 fix exists in 23.9.0 only (M:2737)
- `Reservoirs.IrrFrequency`: Data .init (Merra_irrigationGross_Freq_dc.init); editing it also forks the block file
- `Reservoirs.damUseParams`: Operating parameters by dam use (6 rows, 8 or 9 columns; manual Table 11-1 suggests values)
- `Reservoirs.damCusParams`: Custom operating parameters by dam ID; needs a column named Dam_ID (M:2667-2669)
- `Reservoirs.damObsOutflowDir`: Folder of observed dam discharge files (*.csv with columns DateTime, Q_out_m3d; M:2679-2709)
- `openWaterEvap`: Absent: open-water evaporation is 1 x PET, via wbmParam.openWtrCoeff (W:878, 1640); the sheet's '2 x PET' is wrong (the manual says 100% of PET). Only a data .init is offered as a file; the 'Calculate' keyword is offered only when the `availability` section of the tree allows it (it needs MT_cloudFr and more drivers, measured: v2_owe_calc, SLURM 21521320); a number is read as an MT ID and fails (measured: v2_owe_num, SLURM 21521320). On 22.1.1 a present openWaterEvap makes Muskingum fall back to LRR (cross_rules)
- `openWater`: Static or time series. MaskDataset is required whenever the block is on (W:773)
- `openWater.MaskDataset`: Land-cover index data; a time series is read as a data set, a static layer as a layer (W:775-783)
- `openWater.fracOpenWater`: Optional additional layer (W:786-793). A time-series fracOpenWater is built from MaskDataset instead (W:788; 22.1.1: 760): looks like a WBM bug, open. The manual caps open water + rivers + reservoirs at 97.5% of a pixel
- `Glaciers`: WBM has no glacier module; it reads rasterized glacier area and glacier runoff. On 52585562 the glacier time series have files for 2000-2009 only
- `Glaciers.glMelt`: Monthly discharge per glacier outlet; resolution must match glArea (W:683-692). The published one, `glacier_RDI40_6min_ERA-Interim_hindcast_Discharge_m.init` of `52585562` and `ff0ba2e5` (`Code_Name` equal to the file name, ASCII, Units m3/sec, `monthly`, `1980-01-00` to `2012-12-00`), reads NetCDF files of 1800 x 3600 cells, 6 arc-minutes (gdalinfo of `glacier_RDI40_6min_2000_m.nc`, `Discharge`: 12 x 1800 x 3600)
- `Glaciers.glArea`: Units must contain 'frac' on 23.9.0 (W:694-695); 22.1.1 does not check. The published ones, `global_rgi6_glaciers_area_1km.init` (ASCII, `Code_Name` equal to the file name) and `glacier_RDI6_6min_ERA-Interim_hindcast_Area_yc.init` (its `Code_Name` is the first one's, so 23.9.0 refuses it), have Units `fraction`, `yearly_clim`, and both name the file global_rgi6_glaciers_1km.tif of the model input's glaciers folder, 43200 x 21600 cells, 30 arc-seconds (gdalinfo). No 6 arc-minute area file is in the model input
- `Glaciers.glVolume`: Optional (wbm.pl:673), exists-tested: omitted when empty, never ''. Only needed for total water mass per pixel. The published one, `glacier_RDI40_6min_ERA-Interim_hindcast_Volume_y.init`: Units `m3`, `yearly`, 6 arc-minutes
- `Glaciers` outputs: `glMelt`, `glArea` and `glVolume` are in the output table only while `Glaciers` is set (W:3613-3617), and all three are in the output list of both versions (437 names on 23.9.0)
- `Aquifers`: 22.1.1 ignores the whole block ('Removed from public domain', M(22):2989-2994); the manual says aquifers are not in the public release (L428, L586). Aquifers need a long spin-up to equilibrate
- `Aquifers.Type`: ModFlow is matched exactly (M:3447)
- `Aquifers.gwtUseCoeff`: Shallow groundwater use before tapping the aquifer (M:3704)
- `Aquifers.Aqf_Par_File`: CSV headers: ID, Capacity (m3, optional), Sy, InfiltFrac, Thickness and BaseElev (Lumped). Without Aqf_ID_File all cells are aquifer 1 and the file must contain ID 1 (M:3677-3685)
- `Aquifers.Aqf_ID_File`: Optional; must exist as a plain path (no NETCDF: form, M:3615, 3663); also valid for ModFlow, where it is ignored when Aqf_Clump is on (M:3614)
- `modules.groundwater_3d.modflow`: DEFAULT datasets are not offered (needs a defaults/ folder, section 10). DEM, Net_DEM and Aqf_Thick are required and cannot be numbers (->double, M:3459-3461)
- `Aquifers.Net_DEM`: The manual calls it STN_DEM
- `Aquifers.H_DEM_T`: Head elevation ASL of the top layer; default Net_DEM. The manual calls it WT_DEM_T
  Rule: mutually exclusive with head_depth_top (both for the same layer is fatal, M:3453-3471); ->hclip: no number
- `Aquifers.H_DEM_B`: The manual calls it WT_DEM_B
  Rule: mutually exclusive with head_depth_bottom; ->hclip: no number
- `Aquifers.H_DEPTH_T`: Head depth below DEM; head = DEM + value (M:3454-3471)
- `Aquifers.Aqf_SyCnfd`: Storage coefficient of the confined aquifer; code default 0.01 (M:3476-3477), the sheet and the manual say 0.001
- `Aquifers.Aqf_Ph`: Near-surface horizontal permeability, log10 m2; negative (M:3478-3479); the sheet and the manual drop the sign
- `Aquifers.Aqf_Kh`: The manual calls it Aqf_Kh_B
- `Aquifers.Aqf_Kv`: The manual calls it Aqf_Kv_B
- `Aquifers.BRes`: Riverbed resistance in days (the manual also says day-1 once)
- `Aquifers.SLE`: 0, or a string starting 'min' = min(Net_DEM) (M:3498-3499); 'min' is not in the manual
- `Aquifers.Aqf_Clump`: Read only for ModFlow (M:3501; the ModFlow branch is M:3447-3654); speeds up runs
- `Aquifers.wellMax`: Well depth; 1e6 m = no limit. Read only for ModFlow (M:3502)
- `Aquifers.MF_steps`: Raise when the log reports a stability criterion > 0.5 (manual L627)
- `Springs`: CSV headers: ID, Lon, Lat, Discharge, Elevation (read_table_hash on ID, M:3140-3143). 22.1.1 ignores it. Whether a Lumped springs file needs a Conductance column: open
- `snowBands`: Elevation bands for the snowpack; for coarse Network grids. Needs the band files made by elevation_bands.pl next to the Network file (*.elvBands.dat, *.elvAverg.dat, *.elvBands.txt; wbm.pl:4683-4684). Uses the lapse rate from climate.lapse_downscale (W:856). Band range and size are chosen when running elevation_bands.pl (default 0-5000 m, 250 m)
- `DIN`: The block alone does nothing: WBM reads it only when an output name starts with DIN (W:730) and forces it to '' otherwise (W:763). With such an output the block is mandatory (measured: v2_ov_din2 'DIN model requires "DIN" input', SLURM 21521414). Accepted outputs: DIN_Conc_Cons, DIN_Conc_Dsch, DIN_Conc_Rnff, DIN_Denit, DIN_Land_Load, DIN_Load, DIN_WWTP_Input, DIN_WWTP_Load, DIN_WWTP_Removal (the same nine in both versions). The manual says the DIN parameters are 'accepted as input for the purposes of model calibration' (L980) and that uptake varies with water temperature (L1002): whether the water-temperature drivers are required is open
- `DIN.luSub`: Land-use fraction, developed; required (W:735)
- `DIN.luAgr`: Land-use fraction, agriculture; required (W:736). 22.1.1 clips the start year at 1800 (W(22):708), 23.9.0 does not (open)
- `modules.din_tracking.loading`: Calibration hint: source: WBM manual L980: the sigmoid parameters are accepted as input 'for the purposes of model calibration'
- `DIN.asym_ag`: Used only when Irrigation is on (W:739)
- `DIN.BFI`: Stored, never used (W:742)
- `modules.din_tracking.removal`: Calibration hint: source: WBM manual L980, L1020: slope and intercept 'can be input'
- `DIN.intercept`: Sheet calls it intcpt; WBM reads 'intercept'
- `DIN.WWTP.PopDensity`: Data .init only: a raster path dies in read_init (W:758)
- `DIN.WWTP.t_level`: Treatment level; the manual's removal lookup: Primary 0.1, Secondary 0.5, Secondary (Advanced)/Tertiary 0.8 (Table 17-1); exact strings unverified
- `DIN.WWTP.refYear`: A year (used as $refYear-00-00, W:753, 759), not a column name
- `Runoff_mask`: The BLOCK is the trigger (W:980), not an output variable. When the block is present at least one of dischMsk, runoffMsk, grndWtMsk must be an output (W:4889; measured: w_mask_noout 'No Runoff Masks output variables are listed', SLURM 21521393). The reverse is also required by the gateway: a Msk output without the block fails at the start of a real run ('Attributes for ..._dischMsk are not found'; measured: v2_ov_msk_real, SLURM 21521414) although -test passes (v2_ov_msk, SLURM 21521393). Switching the module off removes the three Msk outputs
- `Runoff_mask.maskFile`: Contains polygon IDs; GDAL raster only (W:4901)
- `Runoff_mask.attFile`: CSV of polygon attributes; exists-tested, selects the polygon branch (W:4897)
- `Runoff_mask.basinIDFile`: Optional; reduces output to these basins; exists-tested (W:4906); GDAL raster only (W:4908)
- `Runoff_mask.maskList`: CSV listing at least two fraction layers; exists-tested, selects the sub-pixel branch (W:4926)
- `Runoff_mask.model`: Any true value means the full model (W:4972). The manual does not define it
- `Impervious`: Static or time series; a static value is read as a layer (number, raster or init), a time series only as an init (W:799-808). 0 counts as off
- `MT_LAI`: Leaf area index; turns on leaf water interception. Also required by Penman-Monteith PET and by the water-temperature model (W:627)
- `WaterDemand.DomDemandPP`: Required: undefined dies (W:1242). Per capita; the sheet says per year, the manual mm/d
- `WaterDemand.DomSearchDist`: exists-tested (W:1244): omitted when empty; '' would mean a 0 km search distance
- `WaterDemand.IndDemandPP`: Required: undefined dies (W:1247)
- `WaterDemand.IndSearchDist`: exists-tested (W:1249)
- `WaterDemand.LivestockParam`: CSV; required and must exist (W:1252-1254). Needs a column named Stock (W:4851); manual Table 13-1 lists the six categories
- `WaterDemand.StkDemandReturnFr`: Sheet says 0.89; WBM uses 0.95 (W:1255)
- `WaterDemand.StkSearchDist`: exists-tested (W:1256)
- `WaterDemand.StkRefYear`: exists-tested (W:1257): omitted when empty
- `LandCover`: CSV file (needs a column named Description, W:5053); turns on land covers for the relevant processes. Only the spelling LandCover is read: a lowercase landCover key is ignored (measured: w_landcover_lc, SLURM 21521320)
- `Irrigation`: On 52585562 the crop inits are partly dangling (CDF_av, mirca_cropAreaFraction.nc, irrEfficiency .nc): not offered there
- `Irrigation.CropAreaFrac`: A constant number is accepted by init_DSet but not verified downstream (open)
- `Irrigation.CropParFile`: Crop parameters CSV for 26 crop categories. LandFracTS, Kc_TS and RootDepth cells are data .init paths (init only, not rasters); CropDepletionFactor is a number or a data .init (W:5120-5150). Forking any of those .init forks this CSV too
- `Irrigation.SW_GW_ratio`: Surface-to-groundwater intake ratio; if absent, Order is used; cannot be a time series (W:1177). The file is FAO_SWGW_ratio_mod.init, Code_Name FAO_SW_GW_ratio_mod
- `Irrigation.Order`: Code comment: 0 groundwater, 1 stream priority (W:1110); used as a numeric ratio layer (W:1175-1176). The manual's default order (shallow groundwater first) disagrees (section 10). Do not validate server-side as an enum: fractions are used as numbers
- `Irrigation.IrrSearchDist`: Search distance for stream water. Both versions read IrrSearchDist; the old key SearchDist is an alias that wins when the init has it (section 6)
- `Irrigation.ExtraCoeff`: Unsustainable groundwater withdrawal factor outside aquifers; cannot be a time series (W:1187)
- `Irrigation.AqfCoeff`: The 22.1.1 name of aqf_coeff (W(22):1080); the aquifers it refers to do not exist there (Aquifers is ignored), so it has no effect
- `Irrigation.useVIS`: Virtual irrigation storage (daily irrigation withdrawal). The manual describes it as part of the daily mode only (L772); dependency on dailyIrr is open
- `Irrigation.IrrEfficiency`: Percent, clipped at 10 and divided by 100 (W:2535-2537). A number crashes (measured: w_irreff_num exit 25, SLURM 21521320), and so does the WBM default 1 when the key is absent (measured: w_irreff_absent exit 25, SLURM 21521585), so an init or raster is required unless IrrTechApplicationFile supplies the efficiency. The file is irrEfficiency.init, Code_Name fao_irrEfficiency
- `Irrigation.ReturnCoeff`: Share of irrigation return flow going to groundwater (rest to surface runoff); whether the manual's return fraction (L809) is the same quantity is open
- `Irrigation.dailyIrr`: Not compatible with process-based irrigation efficiency (W:1204-1205)
- `Irrigation.IrrTechDeliveryFile`: Delivery parameters for efficiency- or process-based modeling (see template headers)
- `modules.water_age`: The published wbm_test.init lists streamAge
- `modules.runoff_source_tracking`: Tracks runoff by source: _rr rain/surface runoff, _bf baseflow, _sm snow melt, _gm glacier melt (manual L916). 12 CSV names, all accepted. Measured: runoff_gm prints 'Component tracking: rSource' (v2_ov_gm, SLURM 21521393)
- `modules.primary_source_tracking`: Tracks water by primary source (_ps snow, _pg glacier, _pr rain, _pu unsustainable groundwater). Choosing a suffix variable turns the process on (measured: runoff_ps prints 'Component tracking: pSource', v2_ov_ps, SLURM 21521393). Glacier melt can only be tracked when glacier water is provided (manual L914)
- `modules.irrigation_reuse_tracking`: Tracks irrigation water re-use and related sources (_pst pristine, _rlt relict, _use dom/ind/stk return; wbm.pl:3765-3770). Cancelled when Irrigation is off: the variables are dropped silently, not an error (W:984; measured: v2_ov_irr prints 'Component tracking: None', SLURM 21521393)
- `modules.water_temperature`: Accepted names: discharge_twt and baseflow_twt only. Needs airT_yc, MT_cloudFr, MT_windU, MT_windV, MT_humidity, canopyHt and MT_LAI (W:583-590, 625-627, 711; measured: v2_ov_twt 'MT_cloudFr input is required', SLURM 21521393). The manual: N_sr 5 d, N_bf 15 d, w_tl 0.59, depth capped at 20 m; no init keys known for them (L931-933)
- `modules.green_blue_water`: Triggered by any output matching Moist(Gr|Bl) or [BG]W_(ET|SM), including the per-crop _BW_ET/_GW_ET names. Requirements are not established (open)
- `modules.endorheic_components`: 23.9.0 accepts four names (endoStrg_mm_pg/ps/pr/pu); 22.1.1 has the trigger but no accepted name. Requirements are not established (open)

#### Other blocks

- `WaterRights`: Ignored by WBM: the key is only in wbm_params() (M:94) and is never read in either version. Kept so that inits that carry it still round-trip
- `USGS`: USGS gauge metadata CSV; data in daily/ or hourly/ -> state code -> CSV files next to it (read_table_hash on site_no, M:3231-3236). 22.1.1 ignores the key (M(22):2911-2916)

#### Outputs

- `Output_vars`: Option rule: A name is accepted only if it is in WBM_dataCube_expand.csv (column Var) AND in the names scraped from the %data_out block of that version's wbm.pl (or ends in one of the 8 per-crop suffixes _irrigation _irrDemand _soilMoistFrac _PET _AET _netIrrigation _BW_ET _GW_ET), RIMS/WBM.pm:546-584. A CSV-only name is fatal (measured: v2_ov_csvonly glCount, SLURM 21521320), so is a code-only name (v2_ov_codeonly vMean, SLURM 21521320). Names WBM adds itself (&lt;var>_irr_&lt;k> when nIrrTracking > 1, dischMsk_&lt;id>) must not be listed. A validated name with no value in the run is dropped with a printed message, not fatal (W:3906-3915)
- `PostProcessing`: Builds a temporal/spatial post-processing script; hourly to daily is done during the run. Off is written as '' (never { Run => 0 }). Needs PP_Perl_path to exist (M:4221) and at least one variable to process (M:4270). The script is started as a background process (W:4271): open
- `PostProcessing.TA_multi_year_start`: Rule: within the run years whenever the block is present, even with Run 0; start and timestep are both set or both empty (M:4274-4279; measured: v2_dates_short_real, SLURM 21521393)
- `PostProcessing.Trim`: Absent means 0 (M:4232; 22.1.1: M(22):3198); the sheet's default 1 is wrong
- `PostProcessing.Polygon_Aggregation`: 0/empty = off, or a block. IDs must be data .init paths: no DataID_DB.csv exists, and the doc examples (country_6min, riverbasinmask_207) are in neither model input
- `PostProcessing.Polygon_Aggregation.MT`: Ignored by WBM: never read (the generated script uses the run's own MT)
- `PostProcessing.Polygon_Aggregation.Rasterization_Res`: Required for vector polygon masks (M:4250-4254)

## 12. Evidence for the validation rules

Keyed by the `id` of the rule in the tree's `cross_rules`, `validation` and `availability`.
`-test` (`wbm.pl -v -test`, one time step and no output; about 6 s on the v2 tutorial and 67
to 77 s on Wyoming) is a cheap first check and not a complete one: it passes a dataset that
ends too early (`v2_dates_short`, `v2_dates_short_real2`), a Msk output without a
`Runoff_mask` block (`v2_ov_msk`, `v2_ov_msk_real`), and it catches a bad
`TA_multi_year_start` only through the `PostProcessing` block (`v2_dates_short_real`).

- `run_start_or_spinup_start`: M:492, 503; measured: v2_loops0_nostart exit 0 without Run_Start, SLURM 21521320; the published wbm_test.init has none
- `run_end_airT`: M:507
- `file_size_day_monthly`: M:499-502
- `network_routing`: measured: v2_routing_empty, SLURM 21521320
- `dataset_file_coverage`: the audit of the published snapshots; the first file of a dataset WBM reads the grid of (`reads_first_file`): the bullet "The first file of a dataset" of section 8, measured: SLURM 21598634; the dates and files WBM looks up, and that nothing clamps a date outside `Start_Date`..`End_Date`: the bullet "Which date WBM looks up" of section 8; measured: v2_spinup1999 (first day missing: fails at once, even -test, SLURM 21521393); v2_dates_short_real2 (gap after 6 months: dies mid-run, SLURM 21521414); -test misses both later gaps
- `precip_fraction_pairing`: W:549-556
- `precip_units`: W:559-565
- `pet_drivers`: W:585-590, 636; measured: v2_pm 'MT_cloudFr input is required', SLURM 21521320
- `pet_pm_canopy`: W:625-627
- `twt_inputs`: W:583-590, 625-627, 711; measured: v2_ov_twt, SLURM 21521393
- `humidity_units`: W:622-623
- `soil_fc_wp`: W:5021-5025
- `lapse_downscale_requires`: W:4809-4819
- `bias_correction_pairs`: M:976
- `modflow_required`: M:3450-3452, 3453-3471
- `snow_bands_files`: W:4683-4684
- `irrigation_efficiency`: W:2535; measured: w_irreff_num, SLURM 21521320
- `water_demand_required`: W:1238-1254
- `open_water_mask`: W:773
- `file_modules_need_file`: M:2094-2096, 2632-2634
- `muskingum_fallback_22`: W(22):462-472; measured: w_muskingum, SLURM 21521320 (23.9.0 keeps Muskingum, v2_muskingum)
- `muskingum_note`: v2_muskingum, SLURM 21521320
- `msk_outputs_runoff_mask_pairing`: block => Msk output: measured w_mask_noout (SLURM 21521393); Msk output => block: measured v2_ov_msk_real (SLURM 21521414); -test misses the second (v2_ov_msk, SLURM 21521393)
- `din_outputs_din_block`: measured: v2_ov_din2, SLURM 21521414; W:730-736
- `din_block_without_output`: W:730, 763
- `irr_outputs_without_irrigation`: W:984; measured: v2_ov_irr, SLURM 21521393
- `comp_balance_tracking`: W:988-989
- `output_vars_self_added`: W:4960-4967, 4985-4999
- `ta_multi_year_start_in_run`: M:4274-4279; measured: v2_dates_short_real, SLURM 21521393
- `post_processing_required_inputs`: M:4244-4254, 4270

The validator rules of the tree's `validation` section carry this evidence:

- `unknown_keys`: error for any key (top level or inside a block) that is not in this tree for the target version, except unknown keys inside a source block FILE, which round-trip unchanged. WBM ignores such keys silently (measured: v2_unknown_top, v2_typo_block, SLURM 21521320). Rejecting them breaks no published init: of the 298 key/init pairs in the six published inits, every key is read by its own code version except the flat Spinup_* keys, which are fatal anyway (checked 2026-10-21). The block file HydConDams_Global_v2.0.init carries Comment, Author, Citation, URL and DOI, which WBM does not read; they round-trip
- `version_gating`: error when a field or module outside the target version has a value (Save_Vars, PET block, Time_Series daily[N] on 22.1.1); warn-and-drop on read for keys 22.1.1 ignores silently (Aquifers, Springs, USGS, ncDouble, ExtraAqfCoeff)
- `landcover_lowercase`: warn: landCover is ignored by WBM (measured: w_landcover_lc, SLURM 21521320); offer to rename to LandCover
- `forbidden_keys`: error: FreeWaterEvap, MT_relHumidity, ^spinup_ (section 6)
- `reference_prefixes`: error: a dataset or file reference outside the allowed prefixes of section 6
- `ascii`: error: non-ASCII byte in the written init or in any data .init / block file used by a 23.9.0 run
- `output_vars`: error: a name not in the version's option list (the tree's options_from), an empty list, or a whitespace-only list

The `availability` options, with the lines that require each (W:583-641 holds the checks):

- PET = Penman-Monteith: W:585-590, 625-627, 634-636
- PET = FAO-56: W:585-590, 634-636
- openWaterEvap = Calculate: W:582, 585-590, 628
- any *_twt output: W:583-590, 625-627, 711

What the published model inputs hold of those drivers: Neither model input (52585562, ff0ba2e5; 26 datasets each, checked 2026-10-21) has a wind, humidity, cloud, albedo or LAI dataset, so all four are shown disabled with the missing inputs named, not hidden

## 13. What the manual says users tune

The manual (`WBM_Documentation.v2.0.Jan2023.docx`, lines of its text extract) names these
as adjustable, which is where the tree's `calibration` hints and its tiers come from:

- `alpha`: "can be adjusted to calibrate the model" (manual L208); Fig 3.1 plots 2, 5 and 8 as examples and gives no range.
- `infiltrFrac`: "generally robust in the range of 0.4 to 0.6" (manual L271).
- `RhRt2` (the manual's C_SRP): Fig 7.1 plots 0.05, 0.2 and 0.8 as "three reasonable values" (manual L274-278); its equation 7.1-1 is the code's `RhRt2 * sqrt(G2 * surfStg)` (W:2706). That supports 0.2 over 0.56 as the 23.9.0 default.
- `maxRffStorage` (T_SRP): 1000 mm by default, no tuning range (manual L284, L287).
- `InterceptPar`: 0.15 (Dingman 2002, BROOK90), 0.2 (Dickinson 1984) or 0.25 (VIC) (manual L252).
- `lapseRate`: -6.4, a constant or a gridded layer (manual L238); the code has -6.49 and only a number.
- The DIN loading and removal parameters are accepted "for the purposes of model calibration" (manual L980) and slope and intercept "can be input" (manual L1020).

Parameters the manual calls tunable but for which no init key is known are not exposed:
the snow thresholds Ts and Tm (-1 and +1 C), reservoir F_irr_max (0.05), the spillway
flood-area rate (0.3 per m), reservoir size thresholds, the water-temperature N_sr (5 d),
N_bf (15 d) and w_tl (0.59), the WWTP removal lookup (primary 0.1, secondary 0.5,
secondary advanced or tertiary 0.8, manual Table 17-1), and the sprinkler mist-loss fraction and
distribution uniformity. Fixed in the model and not exposed: the 80% river withdrawal cap
(manual L807), the 5-year rolling mean discharge (manual L341, L677), the Muskingum
constants other than sigma (`beta`), the Hamon coefficient and the snowmelt polynomial.

## Open: not established

Not settled by the code reading or by the measurements. A bare `Ln` is a line of the manual's
text extract.

- openWater.fracOpenWater read as a time series is built from MaskDataset (W:788; 22.1.1: 760): looks like a WBM bug; confirm with the WBM team before the gateway offers a time-series init
- ConnectivityNetwork.Use, StartYear and Reservoirs.StartYear when the key is absent: $$header{undef} indexes column 0 silently (M:2111, 2737); behaviour not measured
- PostProcessing starts 'perl -w script &' (W:4271), a background process that may be killed when the SLURM job ends right after WBM (inferred, not measured)
- Irrigation.Order: the manual's default order (shallow groundwater in the cell first, L792-798) disagrees with the code comment and the tree labels (W:1110); whether fractional values are meaningful is unknown
- A constant number is accepted by the code but its use downstream is not verified for airT_yc (Springs slicing, W:1861) and Irrigation.CropAreaFracPatch; Irrigation.CropAreaFrac => 0.1 ran (measured: w_cropfrac_num, SLURM 21521585)
- Requirements of runoff-source tracking, Green/Blue water and endorheic components (and whether compBalance applies to runoff-source tracking) are not established
- The manual says DIN uptake depends on water temperature (L1002); whether the water-temperature drivers are required for DIN outputs is not tested
- wbmParam.resetSpinupTracking: groups 2 and 3 (sheet) or all stocks (manual L907-910)
- Irrigation.useVIS only matters with dailyIrr = 1 per the manual (L772); not verified in the code
- Whether a Lumped-aquifer springs file needs a Conductance column (manual L422-426)
- 22.1.1 clips luAgr at start year 1800 (W(22):708) and has no crop start-year clip or spool delta (W(22):4612-4668); effect on time-series crop data unknown
- Meaning of 'lastDay' in daily[N,..lastDay] and of the ':daily...' run-step suffix is only read from the regex (M:488-491, 4121-4140), not measured
- Glaciers on 23.9.0 with the published data: WBM 23.9.0 stops at the start when the cell sizes of `glMelt` and `glArea` differ ("Mismatch in glArea and glMelt dataset spatial resolutions", W:691-693, compared with `get_extent` of the first file of each, RIMS/WBM.pm:1168-1200), and the published melt is 6 arc-minutes and the only published area 30 arc-seconds. That is read from the code and the file headers, not run: the 22.1.1 runs of Wyoming and Global use the same files and pass because 22.1.1 has no such check. The one run so far (SLURM 21598634) stopped earlier, on the missing first file of the melt (section 8), so the resolution check was not reached; a run with the 1980 files added is the evidence
- Unpublished LOCA2 inits give MT_airT airTmin and airTmax together with Secondary; the tree shows secondary only for the mean form
- Unpublished LOCA2 staging copies use forms this tree does not model: a '(low,high):' valid-range prefix and .json in File_Path, Processing pm0:noScale, NETCDF layer names like :Band1, wbmParam.snowSublimation (read by neither version), MT_Code_Name as a string
- Calendar 360 is listed as not runnable (wbm.pl:278; measured: v2_calendar360, WBM is not coded for 360 calendar, SLURM 21521585); revisit if WBM gains a 360-day calendar
- PET.Scale (23.9.0 block form) was not run; the key set was read from M:401-424
- Manual parameters with no known init key (snow thresholds Ts/Tm, F_irr_max, spillway flood-area rate, N_sr/N_bf/w_tl, WWTP removal lookup) are not exposed
- A data `.init` whose descriptor passes but whose data file is missing from the model input is still offered as a switch-on candidate (repaired or not): the candidate list reads the descriptor, not the files it names, and only the submit's coverage check refuses it (measured: `v2_fork_irr`, batch 7)
