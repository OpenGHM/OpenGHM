# Model parameters — architecture

How a draft sets WBM's model parameters: a schema that says which parameters exist,
what the wizard shows for them and what is allowed, and the path of a value from the
form to the init WBM reads.

**Status: built**, except section 6, which is target. Built (sections 1 to 5): the tree file and
the generated output lists, its resolution for a WBM version with the snapshot's current values,
the endpoint, the validation of `custom_params` on save and on submit, their merge into the
changes file, and the wizard's Model parameters section. Target (section 6): dataset choices,
data `.init` forks, switching a module on, the model-input side of the availability rule and the
checks before a submit; apart from the init-based availability filter that its own subsection
marks as built, nothing in it exists, so a draft cannot ask for any of it. The reasoning is
[ADR 0038](../decisions/0038-a-run-gets-its-init-edits-as-one-changes-file.md); what WBM
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
| `cross_rules` | Checks across fields, each with an id and a level (error, warn, info): a run window, a dataset's file coverage, the drivers a PET method needs, the outputs a module needs. Nothing evaluates them yet (section 6, "What the gateway checks before a submit") |
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
                 submit                   validate again, convert to JSON types
                    │
                    ▼
                 changes file  { code_version, set: {...}, unset: [...] }
                    │            = the period, the variables, the post-processing choice, the custom parameters
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
  - a module that cannot be switched off, is already off, or is given a value;
  - a module switched off while the draft's output variables still need it: any variable in its
    `unlocks_outputs`, and for Glaciers any variable ending in `_pg`. The message is at the
    module's path. A PATCH checks the variables it sends, else the stored ones, and the submit
    checks the stored ones;
  - a field whose module is off in the snapshot or is switched off in the same save, and a field
    inside a block that the init sets from a file, which the gateway cannot edit.

  A key whose value equals the snapshot's (the same text, or for a number the same number) is
  not a change and is dropped on save, before the rest is checked. (A field edited as a number
  is compared as a number.)
- **Typed values.** Submit sends an `int` and a `bool01` as an integer, a `number` (and a dataset
  field edited as a number) as a number,
  a module switched off as `''` and every other value as text; a module is switched off with an
  empty value because that is how WBM reads a flag key. A setting the init holds under an
  alias is written to the alias.
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
has a message in it. It renders the groups of the tree as nested sections, and a group that
already holds a change starts open. A field with `tier: advanced` sits in an "Advanced"
disclosure inside its group (one level only: nothing below an advanced group has another);
`locked` and `inert` fields, and the keys a draft field owns, are not in the response at all. A
field of a module is shown while the module is on.

Each field shows its label and init key, its current value in the snapshot's init, WBM's default
for the version when it differs, the unit, the range, and a reset that takes the key out of
`custom_params`. The wizard fetches the tree once per snapshot as it opens and keeps it for the
page's life. Where the tree cannot be had (an init that cannot be read, or an error) the section
says so and offers Try again; the rest of the wizard is untouched, and the draft's changes are
still listed with a Remove. The Review step lists the changed keys, by the tree's label and a
readable value ("switched off", an option's label).

The component is chosen by `type` in one registry:

| `type` | Component | Notes |
|---|---|---|
| `number`, `int` | a number input with its unit | `range`, `min`, `max` bound it; an int rejects a fraction |
| `dataset` with `edit_as: "number"` | the same number input, with a "Constant" placeholder | emptying it puts the snapshot's dataset back; a value replaces the dataset |
| `enum` | a select | the options, labelled when `options` is a map |
| `bool01` | a switch | writes 0 or 1 |
| `string` | a text input | ASCII only, one line, and the version's `pattern` where the tree has one |
| `date` | a date input | |
| a module with `editable: switch_off` | a card with a Switch off button, and Reset once it is off | the module the init has on; a module the snapshot has off shows no fields |
| any other `dataset`, `file`, `column`, `list`, `block`, `flag` | the current value, read-only | choosing a dataset is later work (section 6) |

A field the tree allows but that cannot be set now (its module is off, or a file sets the block
it is in) arrives with `editable: false` and is shown read-only. The backend's message for a key
is shown at its field; a message for a key the tree has no field for is listed with the key.

---

## 6. Later work

Target, in the order the wizard will need it. None of it is built (the availability subsection
marks the one part that is), and none of it was in the mission that built sections 3 to 5.

### Dataset choices

A `dataset` field with `accepts: [init]` points to a data `.init` (the dataset descriptor
[wbm-init.md](../reference/wbm-init.md#8-dataset-descriptors-data-init-files) describes).
Choosing another one means offering the entries of the draft's model input: the datasets of
its `metadata.json` (`datasets[]`: `code`, `init`, `timeSeries`, `coverage`) and its
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

A data `.init` is shared (`merra2_prectotcorr_d.init` is used by three run inits of the
Wyoming snapshot), and a published model input is read-only, so editing one is
copy-on-write into the draft:

- **Trigger and place.** The first edit of any field copies the file into the draft's own
  `wbm_init/`, bound read-write at `/wbm/wbm_init`: a data `.init` as
  `/wbm/wbm_init/datasets/<basename>__<run>_r<n>.init`, a block file in a `blocks` subfolder and a
  table in a `tables` subfolder. The folder names are the gateway's convention; WBM does not read them.
- **A new name every time.** The spool cache variant hashes every `.init` a run init names,
  so a fork is never edited in place: a changed fork gets a new file name.
- **`Code_Name`** is rewritten to the new basename. WBM 23.9.0 requires it to equal the file
  name; 22.1.1 does not check it. A referenced file whose `Code_Name` already differs from its
  name, or that holds a non-ASCII byte, is repaired by forking it, whatever else is edited.
- **ASCII.** A fork is written ASCII-only. How non-ASCII text is rewritten (transliterated or
  replaced) is undecided.
- **Repoint and propagate.** Every reference to the original in the run init is replaced by
  the fork, and a file that names the original is forked and repointed too: editing
  `Merra_irrigationGross_Freq_dc.init` forks the reservoir block file that names it, and
  editing any of the 13 data inits of the `Irrigation.CropParFile` table forks that CSV.
- **Revert** drops the fork and points back to the original. A fork is published with its
  snapshot, because publishing uploads the run's `wbm_init/` with its subfolders.
- **Not staged.** The toolkit does not yet stage files under `/wbm/wbm_init` that a draft
  brings (forks, copied tables, uploads); that is part of this work.

The data-init editor would show a descriptor in four groups: source (`File_Path`,
`Var_Name`, `Bands`, `Projection`, `Processing`), time (`Time_Series`, `Start_Date`,
`End_Date`), units and conversion (`Units`, `Orig_Units`, `Var_Scale`, `Var_Offset`, `Round`)
and description (`Code_Name`, locked, and the descriptive keys), with these checks:

| Level | Check |
|---|---|
| error | the required keys exist (an empty value is fine); `Time_Series` is one of the forms; `File_Path` is not empty; `Var_Scale` and `Var_Offset` are numbers or blank. A dataset's date and file coverage is the `dataset_file_coverage` rule of the tree |
| error | on 23.9.0, `Code_Name` equals the file name and the file has no non-ASCII byte |
| warn | `Time_Series` is empty; `Var_Scale` is 0 (WBM reads 1); a `*_clim` dataset uses `_YEAR_`; `Projection` differs from the run's; a referenced file is not in the model input; two datasets share a `Code_Name`; a time series sits in a field that samples one date |

### Switching a module on

The wizard can switch a module off. Switching one on needs what the module requires: its
`required` children and the files they name, taken from the model input (or, later, from
the user). A module that is on has a value, its key or every `required` child
(`module_on_has_value`), so a module switched on with nothing is an error. Some modules
cannot be offered on a model input that lacks their files: `52585562` has no `dams`
folder, so the Reservoirs block file's data is missing there.

### The availability rule

PET = Penman-Monteith, PET = FAO-56, open-water `Calculate` and the `_twt` outputs all need
the same four driver datasets (cloud fraction, wind U and V, humidity); Penman-Monteith also
needs albedo, canopy height and leaf area index, FAO-56 albedo, `Calculate` elevation. The
`availability` section states it. Built: the resolved tree leaves out an option whose datasets
the snapshot's init does not name (section 3). Target: judge an option by the draft's model
input rather than by the init, and show a missing one disabled with the datasets named, not
leave it out. Today neither published model input has any of the datasets.

### What the gateway checks before a submit

`wbm.pl -test` is a cheap first check and not a complete one: it passes a dataset that ends
too early and a Msk output without a `Runoff_mask` block, and the real run then aborts. The
gateway evaluates those itself, as cross rules, before it submits: dataset file coverage,
the Msk-output and `Runoff_mask` pairing, a `DIN*` output and the `DIN` block,
`TA_multi_year_start` inside the run, the run start or spin-up start, the air temperature
end of the run, version gating and unknown keys.
