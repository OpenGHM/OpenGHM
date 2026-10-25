# Model parameters — architecture

How a draft sets WBM's model parameters: a schema that says which parameters exist,
what the wizard shows for them and what is allowed, and the path of a value from the
form to the init WBM reads.

**Status: built**, except section 6, which is target apart from three subsections. Built
(sections 1 to 5 and, of 6, "Switching a module on" with the dataset choices it uses, "Data `.init`
forks", and the checks before a submit): the tree file and the generated output lists, its
resolution for a WBM version with the snapshot's current values, the endpoint, the validation of
`custom_params` on save and on submit, their merge into the changes file, the wizard's Model
parameters section, switching a module on with datasets of the model input, editing a dataset as the
run's own copy (a fork), and the checks of the tree's `cross_rules` before a submit. Target (section 6
otherwise): choosing another dataset for a field of a module that is already on, forks of files named
inside other files, and the model-input side of the availability rule; apart from the init-based
availability filter that its own subsection marks as built, nothing in them exists, so a draft cannot
ask for any of it. The reasoning is
[ADR 0038](../decisions/0038-a-run-gets-its-init-edits-as-one-changes-file.md) and, for forks,
[ADR 0039](../decisions/0039-a-draft-edits-a-data-init-as-its-own-copy.md); what WBM
does with each value is [wbm-init.md](../reference/wbm-init.md); the draft and how it is
submitted are in [gateway.md](gateway.md#5-the-two-paths-that-leave-the-cluster) ("Jobs").

---

## 1. The tree file

Built. `web-gateway/backend/app/wbm_init/param_tree.yaml` is the wizard's form schema. It
maps about 280 init key paths. Its header is the vocabulary of every attribute, so this page
does not repeat it; what follows is what the parts are for.

| Part | Says |
|---|---|
| `code_versions` | The two WBM versions it covers, 22.1.1 and 23.9.0. One tree serves both: a field, module or option that exists in one version carries `versions`, and a default or option list that differs is a map keyed by version |
| `tree` | The fields, in groups. A field names its init key path (`wbm`), its `type`, its tier, its default, unit and options, the rules that bound it, and one or two sentences of help |
| `cross_rules` | Checks across fields, each with an id and a level (error, warn, info): a run window, a dataset's file coverage, the drivers a PET method needs, the outputs a module needs. The gateway evaluates them before a submit (section 6, "What the gateway checks before a submit") |
| `validation` | The rules that apply to every value: unknown keys, version gating, forbidden keys, locked fields, ASCII, number form, empty values, output names. The section is documentation of the rules; the checks that run are in `validate.py` (section 4) and cover the scalar fields a draft may change |
| `availability` | The options that need datasets in the draft's model input; section 3 says how the resolved tree uses it today |

Three attributes carry the contract between the tree and the rest of the system:

- **`type`** decides the component that renders the field (section 4).
- **`editable`** says what the wizard may change. A scalar field (number, int, enum, bool01,
  string, date) that is not locked, inert, never written or owned by a draft field is
  `editable: true`; a module the init has on can be switched off (`editable: switch_off`).
  A dataset field whose `accepts` lists `number` is editable as a constant, served as
  `edit_as: "number"` (the loader derives it; the tree has no `edit_as` attribute). Other
  dataset fields, and file, column and list fields, carry no `editable`: they are shown, not
  changed.
- **`draft_field`** marks an init key an existing wizard field already owns:
  `MT_Code_Name.Run_Start` and `Run_End` (`temporal_range_start` and `temporal_range_end`),
  `Output_vars` (`variables`) and the whole `PostProcessing` block (`post_processing`, for
  now the post-processing choice owns it). Such a key is not a custom parameter.

The output-variable lists are not in the tree. `Output_vars` points to one file per version,
`web-gateway/backend/app/wbm_init/output_vars/23.9.0.txt` (437 names) and `22.1.1.txt` (407),
generated from WBM's own `wbm.pl` and variable table by
`web-gateway/backend/scripts/gen_output_vars.py`; the header of each file holds the sha256
of the two files it came from.

The tree is data, and a test checks its structure
(`web-gateway/backend/tests/test_wbm_init_tree.py`). What is allowed is decided by WBM, so a
value in the tree is a measured or code-cited one; an unmeasured default is left out and
listed as open in [wbm-init.md](../reference/wbm-init.md#open-not-established).

## 2. Who does what

| | Owns |
|---|---|
| Gateway backend | The tree; resolving it for a WBM version; reading the snapshot's init for current values; validating a draft's `custom_params`; writing the draft's period, variables, post-processing choice and custom parameters into the changes file |
| Toolkit (`openghm`) | Editing the init (the changes file, `openghm.wbm_init`): quoting, ASCII, number form, converting flat `Spinup_*` keys, creating a missing block. The toolkit checks only what makes a changes file unusable: a malformed key path, a `code_version` that is not the snapshot's, a non-ASCII value, a key that is fatal to that version |
| Wizard | Rendering the resolved tree; showing the backend's message at the field |

The toolkit never reads the tree, and the backend never writes the init: two writers of one
file would disagree about the output directory, the post-processing `Run` and `Forks`, and
the cores. The backend keeps its own reader of the init, for display, as it already does for
the post-processing settings (`web-gateway/backend/app/services/run_start.py`).

## 3. Resolving the tree for a version

Built (`web-gateway/backend/app/wbm_init/tree.py`, `reader.py`). The loader reads the file once
and keeps each version's result for the life of the process. Given the WBM version of the
draft's snapshot (`uses.modelCode.version`, 22.1.1 or 23.9.0; any other is refused) it:

1. drops every node whose `versions` excludes it, so on 22.1.1 there is no `Spinup.Save_Vars`,
   no `PET.Scale`, no Aquifers;
2. picks the version's side of every version-keyed map the wizard serves: `default`, `pattern`
   and `options`, so `wbmParam.RhRt2` defaults to 0.56 on 22.1.1 and 0.2 on 23.9.0 (`forms`,
   `n_values` and `options_from` are not resolved or served: the output-variable lists belong to
   the draft's variables field);
3. takes each node's effective tier (the rule is in the tree's header) and serves it as `basic`
   or `advanced`: a module's own tier is shown as `basic`, since its fields appear while the
   module is on;
4. indexes the fields and modules by init key path, for validation, and keeps the group nesting,
   for the wizard;
5. leaves out of the wizard what is `locked`, `inert`, `write: never` or owned by a
   `draft_field`, which a custom parameter may not name either, and what is not an init key
   (`ui_only` choices, command-line options, modules derived from an output name). A key left
   out as outside the version, draft-field, inert or locked is remembered with that reason, so
   that validation can say it; groups left with no children are dropped;
6. offers an option that needs datasets (`availability`, for example the PET method) only
   when the snapshot's init names them, or when it is the option the init already has. The
   init stands in for the model input here; reading the model input itself is later work
   (section 6).

Current values come from the snapshot's init. The reader is the small one the backend
already has for post-processing, extended to the whole init, and it shares that code's fetch
and cache (`run_start.read_init_text`: a public S3 read, kept per snapshot, a failed read not tried
again for 60 s). It reads the Perl-hash dialect of the init as WBM does, with the oddities the
published inits carry ([wbm-init.md](../reference/wbm-init.md#6-writing-a-value-so-that-wbm-reads-it)),
and returns the values as strings by key path. It is tested against the toolkit's reader on every
init in the toolkit's test fixtures (14 today), the published ones among them.
`web-gateway/backend/app/services/model_parameters.py` joins the two for the endpoint and for
the draft routes, so they cannot read a snapshot differently: it gives `init_unavailable` when
the init cannot be read or parsed and `model_code_version_missing` when the snapshot names no
version the tree covers.

A key that WBM reads under two names resolves to the one that wins. An init key listed in
`aliases` (`Irrigation.SearchDist`, `Irrigation.AqfCoeff`) overrides the native key when the
init has it, so the current value is read from the alias and a change to the setting is written
to the alias the init uses. A string that stands for a block key (`Routing => 'LRR'` for
`Routing.method`) is shown as that key's current value.

## 4. How a value moves

```
wizard field ──▶ draft: parameters.custom_params  { init key path: value }
                    │
                    ├─ PATCH /jobs/{id}   validate against the resolved tree ──▶ 422, one message per key
                    ▼
                 submit                   validate again, check the cross rules (section 6), convert to JSON types
                    │
                    ▼
                 changes file  { code_version, set: {...}, unset: [...], forks: [...] }
                    │            = the period, the variables, the post-processing choice, the custom parameters,
                    │              and the dataset copies the draft makes (section 6, "Data `.init` forks")
                    ▼
                 openghm sim run --changes   the toolkit's editor writes the staged init
```

- **Validation** (`web-gateway/backend/app/wbm_init/validate.py`) runs on a draft's save and on
  its submit, against the tree resolved for the draft's snapshot, with one message per key. It
  refuses:
  - an unknown key, a key outside the version, and a locked, inert or draft-field key;
  - a value that is not text, is not ASCII, or is over 256 characters;
  - a value of the wrong form: a number in WBM's own form (`.5` is not one), a whole number,
    0 or 1, a real date, a choice among the options, a single line of text that fits the
    version's pattern; and a number outside the field's range or bounds;
  - an empty value, except to switch a module off or where a choice lists it (`landCollapse`);
  - a field with `edit_as: "number"` given anything but a number in WBM's form, which replaces
    its dataset with that constant in every grid cell;
  - a module that cannot be switched off, is already off, or is given a value, unless it is one
    the snapshot has off that the save switches on (section 6, "Switching a module on");
  - a module switched off while the draft's output variables still need it: any variable in its
    `unlocks_outputs`, and for Glaciers any variable ending in `_pg`. The message is at the
    module's path. A PATCH checks the variables it sends, else the stored ones, and the submit
    checks the stored ones;
  - a field whose module is switched off in the same save, or is off in the snapshot and cannot be
    switched on (the message says why), and a field inside a block that the init sets from a file,
    which the gateway cannot edit;
  - a module switched on that does not set everything it requires (the message is at the module's
    path), a dataset that is not one of the model input's candidates, and one the snapshot's WBM
    version cannot read or the field's own rule refuses.

  A key whose value equals the snapshot's (the same text, or for a number the same number) is
  not a change and is dropped on save, before the rest is checked. (A field edited as a number
  is compared as a number.)
- **Typed values.** Submit sends an `int` and a `bool01` as an integer, a `number` (and a dataset
  field edited as a number) as a number,
  a module switched off as `''`, a dataset chosen from the model input as its container path (text)
  and every other value as text; a module is switched off with an
  empty value because that is how WBM reads a flag key. A setting the init holds under an
  alias is written to the alias.
- **Dataset forks** (`parameters.forks`, section 6) are checked with the same save and submit, one message
  per field path in the same `invalid_custom_params` answer (`web-gateway/backend/app/wbm_init/forks.py`).
  A submit writes each as an entry of the changes file's `forks` and sets the field's key to the copy.
- **The same changes file** is stored with the run (`simulation.json`) and re-run unchanged
  when a job continues ([ADR 0037](../decisions/0037-a-run-longer-than-one-job-continues-in-the-next.md)).

The endpoint that serves the resolved tree and the current values is
`GET /api/v1/repository/datasets/{id}/model-parameters`; its shape, and how the draft routes
answer, are in [gateway.md](gateway.md#4-where-state-lives) (drafts) and
[gateway.md](gateway.md#5-the-two-paths-that-leave-the-cluster) ("Jobs").

## 5. What the wizard renders

Built (`web-gateway/frontend/components/workspace/model-parameters/`,
`web-gateway/frontend/lib/workspace/model-parameters.ts`, `web-gateway/frontend/lib/workspace/use-model-parameters.ts`). The Run settings
step has a **Model parameters** section, collapsed by default and held open while the backend
has a message in it. `locked` and `inert` fields, and the keys a draft field owns, are not in the
response at all. A field of a module is shown while the module is on.

At the top of the open section are a search over labels, init keys and help text (a matching
group shows everything in it), a filter of All, Editable or Changed, a **Show advanced** switch, and,
once the draft changes something, **Reset all** (after a confirmation). Each top-level group is a
card that says how many parameters it shows and how many the draft changed; a card that holds a
change starts open, and a search or a filter opens every card with a match. Groups below the top
level are headings inside their card, not further disclosures. A node is advanced when its `tier`
or an ancestor's is; advanced nodes are hidden until Show advanced is on, except where they hold a
change, a fork or a message, or match the search (`web-gateway/frontend/lib/workspace/param-filter.ts`).
Modules that are off, cannot be switched on and hold nothing are gathered at the end of their
level, one line each with the reason.

Each field shows its label and init key, the tree's help text, its control (the unit inside a
number box), the snapshot's value when the draft changed it, WBM's default for the version when it
differs, the allowed range, and a reset that takes the key out of `custom_params`. A number with a
`calibration` range also draws the range as a bar with the snapshot's value and the draft's, and
says when the value is outside it; the range is the suggested one, shown with its source. The wizard fetches the tree once per snapshot as it opens and keeps it for the
page's life. Where the tree cannot be had (an init that cannot be read, or an error) the section
says so and offers Try again; the rest of the wizard is untouched, and the draft's changes are
still listed with a Remove. The Review step lists the changed keys, by the tree's label and a
readable value ("switched off", an option's label).
After submit the wizard is read-only, so the Run details card of `/workspace/<id>` lists the same
changes (`run-model-parameters.tsx`), fetching the tree only when the run changed something and
showing the init key and raw value until it arrives or where it cannot be had.
The Review step, the submit confirmation (`submit-summary.tsx`) and Run details draw the list with
one component (`web-gateway/frontend/components/workspace/model-parameters/change-list.tsx`) from `describeChanges`;
each keeps its own count line and frame.

The wizard's help panel has a Model parameters topic for this section
(`web-gateway/frontend/lib/workspace/wizard-help.ts`, [gateway.md](gateway.md)).

The component is chosen by `type` in one registry:

| `type` | Component | Notes |
|---|---|---|
| `number`, `int` | a number input with its unit | `range`, `min`, `max` bound it; an int rejects a fraction |
| `dataset` with `edit_as: "number"` | the same number input, with a "Constant" placeholder | emptying it puts the snapshot's dataset back; a value replaces the dataset |
| `enum` | a select | the options, labelled when `options` is a map |
| `bool01` | a switch | writes 0 or 1 |
| `string` | a text input | ASCII only, one line, and the version's `pattern` where the tree has one |
| `date` | a date input | |
| a module with `editable: switch_off` | a card with an on/off switch; switching it back on is the reset | the module the init has on; a module the snapshot has off shows no fields until it is switched on |
| a module the snapshot has off | a card with an on/off switch when the backend says it can be, else a line with the reason; switching it back off is the reset | section 6, "Switching a module on" |
| a `dataset` with `candidates` | a select of the model input's datasets in the field's unit, and a constant box beside it where the field takes a number | only in a module being switched on; one WBM cannot read, or whose data is not in the model input, is listed and disabled, its reason under the field |
| a `dataset` that is `forkable` and reads a data `.init` | the current value, read-only, with an **Edit dataset** button | opens the three values a copy may set, each with the original's value beside it, and a box that sets `Var_Scale` as the original's times a factor; section 6, "Data `.init` forks" |
| any other `dataset`, `file`, `column`, `list`, `block`, `flag` | the current value, read-only | choosing another dataset for a module that is on is later work (section 6) |

A field the tree allows but that cannot be set now (its module is off, or a file sets the block
it is in) arrives with `editable: false` and is shown read-only. `forkable` is separate from
`editable`: the dataset a forkable field reads is not edited in place, the draft edits a copy of it. The backend's message for a key
is shown at its field; a message for a key the tree has no field for is listed with the key.

---

## 6. Later work, and what it has built so far

Target, in the order the wizard will need it, except three subsections that are built whole:
"Switching a module on" (with the candidates it needs), "Data `.init` forks" (its last bullet says what is
still target) and the checks before a submit. The part of the availability rule that the init can answer is
built too, as its subsection marks. None of it was in the mission that built sections 3 to 5.

### Dataset choices

Built for a module being switched on (next subsection): the candidates are the entries of the model
input's `datasets[]`, read once and kept (`web-gateway/backend/app/services/model_parameters.py`,
`web-gateway/backend/app/wbm_init/choices.py`), and an entry is usable when its init is in the model input, WBM can
read it, and the data files it names are there (below). A field is offered the entries whose unit is the field's (`unit_matches`: spelling-insensitive,
m3/sec is m3/s) and no others; the tree says nothing else about what data fits a field, so a field
with no `unit` is offered none. An init that is not there or is not a dataset (no `Code_Name`) is listed with that reason and
cannot be chosen. One that on 23.9.0 has a `Code_Name` that is not its file name, or a non-ASCII byte, is
offered as **repaired by a copy** (`repair` on the candidate, `disabled` null): choosing it makes a fork
that sets nothing, and a save refuses the choice without it (`Data .init forks`, below).

The data files are looked for as `dataset_file_coverage` looks for them (`cross_rules.missing_first_files`:
the `File_Path` tokens, one listing per folder, kept by `model_input`), without the run's dates, which the list
does not know. A climatology, or a dataset with no `Time_Series`, needs the files of its first date: without
them the candidate is **disabled** with "Its data file is not in the model input: <path>." (said before a
repair, since a copy does not bring data). A dated dataset is judged only for a field the tree marks
`reads_first_file`, where WBM opens the dataset's first file at the start to read the grid
(`Glaciers.glMelt`, `glVolume`, and `glArea` on 23.9.0): its first file must be there, else it is disabled for that
field with that reason. For any other field a run reads the files of its own dates and the coverage check at
Review judges them, with the draft's dates. The save refuses a disabled candidate with the same reason, and a
module none of whose required fields has a usable dataset is not offered. A folder that cannot be listed makes the
whole model input unread (`choices` is none), as an unreadable descriptor does. The rest of this subsection is the
target for a field of a module that is on.

A `dataset` field with `accepts: [init]` points to a data `.init` (the dataset descriptor
[wbm-init.md](../reference/wbm-init.md#8-dataset-descriptors-data-init-files) describes).
Choosing another one means offering the entries of the draft's model input: the datasets of
its `metadata.json` (`datasets[]`: `code`, `init`, `timeSeries`, `temporalCoverage`) and its
networks (`networks[].file`). An entry is offered only when its init, and every file the init
points to, exists in that model input. `Code_Name` is not unique within a model input, so a
dataset is keyed by the path of its init.

The value kinds a field takes are the `accepts` list, and a value is classified by its form:

| Kind | Form | Accepted as |
|---|---|---|
| netcdf layer | `NETCDF:<file>:<layer>` | raster |
| template | contains `_YEAR_`, `_MONTH_` or `_DAY_` | path only; expanded to check every file |
| data init | ends in `.init` | init |
| raster | `.tif`, `.tiff`, `.asc`, `.ascii`, `.nc`, `.nc4`, `.grd`, `.img` | raster |
| table | `.csv`, `.txt` | file |
| folder | `/wbm/...` with no extension | path only |
| constant | a number, or a string without `/` | number |

Every reference is under `/wbm/data/`, `/wbm/data_init/` or `/wbm/wbm_init/`. A path that
does not exist as written is looked up inside the same model input by the longest shared
path suffix; a tie is an error and a hit is a warning with the corrected path. Magic-Table
IDs and the `DEFAULT` keyword are never offered: no model input has the files they need.

### Data `.init` forks

Built (mission `2026-10-24-data-init-forks`, [ADR 0039](../decisions/0039-a-draft-edits-a-data-init-as-its-own-copy.md)).
A data `.init` is shared (`merra2_prectotcorr_d.init` is used by three run inits of the Wyoming snapshot),
and a published model input is read-only, so a draft edits one as its own copy. The gateway keeps the edit
and never the file; the run's toolkit makes the copy.

- **What the draft holds.** `parameters.forks`: per fork, `{path, original, set}`: the init key of the field
  that reads the dataset (or of a module that is itself one), the data `.init` it reads, and the values to
  set. At most one per field. Only `Var_Scale`, `Var_Offset` and `Units` can be set (as text; `Code_Name` and
  ASCII are fixed by the toolkit, and the dates, `File_Path` and the rest are not the draft's to change). An
  empty `set` is a repair.
- **The copy's name.** `<original basename>__<8 hex>.init` under `/wbm/wbm_init/datasets/`, the 8 hex being
  the start of a hash of the original's path and the values set (numbers as numbers, so `1.1` and `1.10` are
  one edit). The same edit has the same name, another value another: the spool cache variant hashes every
  `.init` a run init names, so a fork is never edited in place. The folder name is the gateway's convention.
- **Validation** (save and submit, `forks.validate`, then `forks.check_originals`). The field takes a data
  `.init`, its modules are on (or the same save switches them on with the dataset), no block above it is a
  file, and `original` is the dataset the field reads in this draft: its value in the init, or the one the
  draft chooses for a module it switches on. A field that holds a constant number is not forked. Values:
  `Var_Scale` and `Var_Offset` in WBM's number form (and `Var_Scale` not 0, which WBM reads as 1), `Units` one
  line of ASCII, an empty value is refused (leave it out). The original must be in the model input and have a
  `Code_Name`; a model input that cannot be read refuses nothing, the toolkit checks again.
- **Submit.** The changes file gets `forks: [{from, to, set}]`, one entry per distinct copy, and the field's key
  (the alias the init uses) in `set` is the copy's path: a fork does not repoint the run init by itself.
- **Repair.** A switch-on candidate disabled only for its `Code_Name` or a non-ASCII byte is chosen with an
  empty fork (the wizard makes it); a save refuses the choice without one.
- **The checks before a submit** read the copy as the run will: the field still names the original, so the
  dates and files coverage reads are the original's (a copy cannot change them), and the unit rules read the
  copy's `Units`.
- **What the wizard shows.** A `forkable` field that reads a data `.init` has **Edit dataset**: `Var_Scale`,
  `Var_Offset` and `Units`, each with the original's value beside it (`GET .../dataset-init?path=`), a Reset
  that drops the fork. The Review step, the submit confirmation and the job page say "copy of
  `<original file>`, Var_Scale 95040".
- **Not built.** A fork of a file named inside another file (the `Irrigation.CropParFile` CSV, a reservoir
  block file): editing `Merra_irrigationGross_Freq_dc.init` would fork the reservoir block file that names it,
  and editing any of the 13 data inits of the CSV would fork the CSV; the gateway refuses to fork what the run
  init does not name directly. Editing the dates, `File_Path` or other keys of a descriptor, and tables and
  block files brought by a draft. Choosing another dataset for a field of a module that is on.

The fuller data-init editor (target, not built: the wizard edits three values today) would show a descriptor in four groups: source (`File_Path`,
`Var_Name`, `Bands`, `Projection`, `Processing`), time (`Time_Series`, `Start_Date`,
`End_Date`), units and conversion (`Units`, `Orig_Units`, `Var_Scale`, `Var_Offset`, `Round`)
and description (`Code_Name`, locked, and the descriptive keys), with these checks:

| Level | Check |
|---|---|
| error | the required keys exist (an empty value is fine); `Time_Series` is one of the forms; `File_Path` is not empty; `Var_Scale` and `Var_Offset` are numbers or blank. A dataset's date and file coverage is the `dataset_file_coverage` rule of the tree |
| error | on 23.9.0, `Code_Name` equals the file name and the file has no non-ASCII byte |
| warn | `Time_Series` is empty; `Var_Scale` is 0 (WBM reads 1); a `*_clim` dataset uses `_YEAR_`; `Projection` differs from the run's; a referenced file is not in the model input; two datasets share a `Code_Name`; a time series sits in a field that samples one date |

### Switching a module on

Built. A module the snapshot's init has off and the tree lets the wizard switch (`editable:
switch_off`) is **offered** when everything its `required` children need can be given
(`tree.switch_on_decisions`):

| A required child that is | Can be given when |
|---|---|
| a scalar (number, int, enum, bool01, string, date) | the tree has a `default` for it: it starts there. One WBM has no default for (`Aquifers.Type`) cannot |
| a `dataset` that accepts `number` | always: it is a constant the person types (no default is needed) |
| any other `dataset` that accepts `init` | the tree states `fit: unit` for it and the model input has a usable dataset in the field's `unit` (a volume per pixel is a volume). Without `fit` the tree does not say which dataset fits, whatever the unit: the field cannot be given and the module says so |
| a `file`, `column` or `list`, or a raster-only `dataset` | never: the module is not offered (Irrigation, Reservoirs, ConnectivityNetwork, WaterDemand, Runoff_mask) |

Two attributes of the tree decide before the table. `fit` is what states which datasets fit a field: its
only value today is `unit` (datasets in the field's unit), set on the three glacier datasets and on
`Impervious`; a field or module without it is offered no dataset, which is the general form of "the tree does
not say which dataset fits" (a richer statement, a name or `Code_Name` pattern, would be a second value).
`same_grid` names the dataset fields of a module that a code version needs on one grid, which the gateway
cannot read (GeoTIFF and NetCDF headers): the module is not offered on that version, with that reason. It
is on `Glaciers` for 23.9.0, which stops when the cell sizes of `glMelt` and `glArea` or `glVolume` differ
([wbm-init.md](../reference/wbm-init.md#open-not-established)); 22.1.1 has no such check.

A module that is itself the value (`openWaterEvap`, `Impervious`, `MT_LAI`) follows the same rules with
its own `unit`, `fit` and `accepts`; a `file` module (Springs, LandCover) and a `flag` that needs
files beside the network (`snowBands`) are not. A `required_if` child is not judged: it holds only for
a form the wizard does not offer. A module whose model input cannot be read is not offered when it
needs a dataset, and says so; one that is given by constants needs no model input. Today, on all three
published snapshots (v2, Wyoming, Global), Impervious (the fraction datasets, or a constant) and DIN
(constants for its two land-use fractions) are offered and nothing else: Glaciers on v2 is withheld by
`same_grid`; openWaterEvap (mm/day would offer precipitation), openWater, MT_LAI and lapseDownscale have no
`fit`; the rest need a file.

- **What is served.** `GET .../model-parameters` gives such a module `switch_on` (true or false),
  `switch_on_reason` (the sentence the card shows when it is false) and, for a module that is itself
  a dataset, `candidates`. Every field has `required`, and a `dataset` field of an offered module has
  `candidates`: `{value (the container path), name, code, time_series, unit, disabled, repair}`,
  `disabled` being the reason or null (an init WBM cannot read, a Units rule, a data file missing from the model
  input) and `repair` what a copy repairs or null, listed only for a field with a `unit` (a module that is itself
  a dataset also has `edit_as`, `"number"` where it takes a constant). The tree's attribute
  `unit_contains` (`Glaciers.glArea`, on 23.9.0: `frac`) is the field's own rule: a dataset whose
  Units lack it is disabled for that field (a field in fractions is offered datasets whose Units
  already contain it, so it is a second line of defence). The endpoint always reads the model input's
  datasets; a model input that cannot be read is no failure.
- **How it is switched on.** A block module (`Glaciers`) by setting its fields, each required dataset
  chosen from the field's candidates (or typed, where it takes a number), each required scalar
  starting at its default; a module that is itself a dataset by a value on its own key. The keys go into `custom_params` as for any change, a
  chosen dataset as its container path (`/wbm/data_init/glaciers/....init`) and a constant as a number, and the changes file
  sets them; the toolkit creates the block. Until something is chosen a block module has nothing in
  `custom_params`: it is only open in the wizard, and Reset closes it.
- **What save and submit refuse.** The checks of section 4: a field of an offered module is accepted
  when its value is a candidate WBM can read; the save must set every required child of the module
  (the `module_on_has_value` rule, said on save at the module's path), and then the cross rules run on
  submit with the module on, so its datasets go through the same coverage check as any other. The
  datasets of the model input are read when `custom_params` names such a module and not otherwise.
- **Outputs.** A module's `unlocks_outputs` (Glaciers: `glMelt`, `glArea` and `glVolume`, which WBM
  writes only while the block is set) are refused when the module is switched off while one is
  listed, as for a module the snapshot has on. The wizard's variable list is the snapshot's own
  `outputVariables`, so a variable the snapshot does not describe is not offered, whatever module
  is on: choosing one the module unlocks, and publishing a run that has one, is later work.
- **Not done.** Choosing another dataset for a field of a module that is on, and
  judging that two datasets of one module share a resolution (WBM 23.9.0 stops when the `glMelt` and
  `glArea` cell sizes differ; [wbm-init.md](../reference/wbm-init.md#open-not-established) says what the published data does).

### The availability rule

PET = Penman-Monteith, PET = FAO-56, open-water `Calculate` and the `_twt` outputs all need
the same four driver datasets (cloud fraction, wind U and V, humidity); Penman-Monteith also
needs albedo, canopy height and leaf area index, FAO-56 albedo, `Calculate` elevation. The
`availability` section states it. Built: the resolved tree leaves out an option whose datasets
the snapshot's init does not name (section 3). Target: judge an option by the draft's model
input rather than by the init, and show a missing one disabled with the datasets named, not
leave it out. Today neither published model input has any of the datasets.

### What the gateway checks before a submit

Built (`web-gateway/backend/app/wbm_init/cross_rules.py`; the route and the refusal are in
[gateway.md](gateway.md#5-the-two-paths-that-leave-the-cluster)). `wbm.pl -test` is a cheap first
check and not a complete one: it passes a dataset that ends too early and a Msk output without a
`Runoff_mask` block, and the real run then stops, after the queue wait and perhaps months of
simulated time. Before it submits, the gateway evaluates the tree's `cross_rules` on the run as it
will be.

- **The run as it will be.** The snapshot's init with the draft's changes applied the way the
  changes file applies them: the period (a date equal to the snapshot's own is not a change), the
  output variables, the post-processing choice and the custom parameters, a module switched off
  as `''`. The draft is not validated here: a date that is not a date, or a custom parameter the
  tree refuses, is for the submit's own checks to say, and the rules judge what is left.
- **Reading the model input** (`web-gateway/backend/app/wbm_init/model_input.py`). A path an init
  writes maps to a public object: `/wbm/data/x` and `/wbm/data_init/x` to the model input's `x`
  and `data_init/x` (the model input the snapshot names, `uses.modelInput.id`), and
  `/wbm/wbm_init/x` to the snapshot's own `wbm_init/x`. Any other `/wbm/` folder is the run's own
  and is not read. The module answers what the dataset choices will need too: a data `.init`
  parsed, with its text for the ASCII and `Code_Name` checks (`read_init`), a folder's names
  (`list_names`), whether a file is there (`file_exists`), and the model input's `metadata.json`
  and `datasets[]`. It reads with `tree_browse`'s listing and ranged `GET`, eight at a time, and
  keeps what it read for the life of the process, since a published artifact does not change
  under its id; an object that is not there, or a read that failed, is not asked for again for 60 s.
- **Dataset file coverage** (`dataset_file_coverage`) is judged from the files that exist in the
  model input, never from the dates a data `.init` or the model input's metadata declares: the
  published model inputs declare more than they hold (`52585562` declares precipitation for
  2000-2015 and holds 2000-2001), and `ff0ba2e5` holds more than it declares (1980-2024 against
  1980-2018). It looks at every dataset and file field of the tree whose modules are on and whose
  value names a file, at the data inits inside the block file of a module (`Reservoirs`), and at
  the data inits in the cells of the crop parameter tables (`Irrigation.CropParFile` and its
  patch). The dates are those the run reads: each spin-up loop's period when `Spinup.Loops` is
  above 0, and the run, which ends where the air temperature dataset does when `Run_End` is empty.
  A dated series (`daily`, `daily{N}`, `monthly`, `yearly`, `decadal`) must have `Start_Date` to
  `End_Date` covering them and a file for every date WBM looks up
  ([wbm-init.md](../reference/wbm-init.md#8-dataset-descriptors-data-init-files) says how: a daily
  run reads a monthly dataset by month, a 365-day dataset has no February 29); a climatology
  must have the files of one cycle whatever the run; a static dataset or file must exist. A field
  WBM reads once, on 2001-01-01, is judged on that date, and a dated series in one is a warning;
  `glArea` and `glVolume` get the second look a year later that WBM gives them. A time-series form
  the check does not read (`8day`, `daily[N]`) is not judged. The message names the dataset
  (`Code_Name`), the field that reads it and the first date with no data or no file, and where the
  files stop; its `paths` include the draft's own date field responsible (`MT_Code_Name.Run_End`,
  `Spinup.Start`). It also asks for the first file of the datasets WBM reads the grid of at the start
  (the tree's `reads_first_file`: the glacier datasets, and with `lapseDownscale` on its elevations and
  the air temperature): the file of the dataset's own `Start_Date`, which no run date needs and WBM opens
  all the same (measured: SLURM 21598634, a 1980 glacier file the v2 model input lacks). The message
  names that file.
- **The other rules.** Every rule id of the tree is in `EVALUATORS` (a pure function of the
  effective run, tested with no network), in `FILE_RULES` (coverage, and `snow_bands_files`, which
  looks for the three `<network>.elv*` files `snowBands_init` requires, wbm.pl:4683-4684) or in
  `NOT_EVALUATED` with the reason, and a test fails when one is in none. One is not evaluated:
  `output_dir_absolute`, since the gateway and the toolkit set the output directory. Each message is
  one or more plain sentences, one entry per failed rule.
- **Where it is said.** `POST /repository/datasets/{id}/checks` takes the draft's parameters, the
  ones on screen, saved or not, and answers `{errors, warnings, files_checked}`; the wizard asks
  it when the Review step opens. The Review step lists the errors with the submit card, each with
  a link to the field that mends it, and the submit button stays off; says an error about a date
  under the run period, and again beside the date on Run settings; and shows the warnings and
  notes as "Heads up". A submit asks the same and refuses an error with `422 cross_rules_failed`,
  one entry per failed rule. When the model input cannot be read, coverage is reported as not
  checked, a warning, and nothing is refused for it; the other rules still run. On the global
  snapshot the first check took 8.6 s and a repeated one 0.1 s (2026-10-23, the local gateway
  against Anvil S3).
