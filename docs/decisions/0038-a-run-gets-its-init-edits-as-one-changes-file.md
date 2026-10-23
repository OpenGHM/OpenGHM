# ADR 0038 — A run gets its init edits as one changes file, and the gateway owns the parameter schema

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-21 |
| **Affects** | the `openghm` toolkit's `sim run`, `sim submit` and `spool variant`; [`../architecture/gateway.md`](../architecture/gateway.md) (submitting); [ADR 0025](0025-a-gateway-job-runs-the-pinned-toolkit.md) (what a job passes the toolkit); [open item 9](../reference/open-items.md) |

## Context

A draft changes its snapshot's WBM init: the run period, the output variables, the
post-processing choice and, once open item 9 is closed, any model parameter. The
toolkit applies the changes when it stages a run. Until now each change had an option
of its own: `--run-start`, `--run-end`, `--output-vars`, `--spinup-start`,
`--spinup-end`, `--spinup-loops`, `--post-processing`. A regular expression
(`sim.py` `_set_perl_key`) set the first key of that name it found. `--spinup-start`
set whichever `Start` came first, whatever block held it.

That does not scale to model parameters. The parameter schema written for the wizard
(`wbm_param_tree`) maps about 280 init key paths, many of them nested
(`wbmParam.alpha`, `Irrigation.ReturnCoeff`). Measured on Anvil (2026-10-19 to
2026-10-21, SLURM 21521192 to 21579523, `wbm.pl -test` in each snapshot's own image),
WBM is also unforgiving about how a value is written:

- WBM ignores unknown and misspelt keys silently.
- WBM 23.9.0 aborts on any non-ASCII byte in an init.
- A climate driver written as a plain string instead of a `{ Primary => … }` block aborts.
- The flat `Spinup_*` keys some inits still carry abort both 22.1.1 and 23.9.0.
- `isNumber` does not accept `.5`.
- Some keys must not be written at all: `''` in `MT_Code_Name.spool_dir` sends the
  spool to `/`.
- The two WBM versions the published snapshots run (22.1.1 and 23.9.0) differ: for
  example, `Spinup.Save_Vars` aborts 22.1.1 even when it is 0.

Two things need a home: how a change reaches the toolkit, and what the wizard may offer.
They are different kinds of knowledge. What the wizard offers is about presentation
and validation: tiers, labels, help text, which component renders a field, which
values are allowed for which WBM version. Applying a change is about writing a Perl
hash correctly.

## Decision

**A run's init edits reach the toolkit as one JSON changes file, and the per-key
options are removed.** `sim run`, `sim submit` and `spool variant` take
`--changes <file>`:

```json
{
  "code_version": "23.9.0",
  "set":   { "MT_Code_Name.Run_End": "2005-12-31", "Output_vars": "runoff discharge",
             "wbmParam.alpha": 3, "PostProcessing.Run": 1 },
  "unset": ["Irrigation.irrAreaGrwth"]
}
```

- **Keys are init key paths**: names joined by dots, one per nested block.
- **`set` values** are a string, a number, or an object, which is written as a block.
  A missing key or block is created.
- **`unset`** removes a key.
- **`code_version`** must equal the snapshot's `uses.modelCode.version`.

**The toolkit's init editor** (`openghm.wbm_init`) reads the init as WBM does and
edits it in place. It keeps the source's layout and every key it does not touch. It
writes values by fixed rules:

- strings as single-quoted Perl literals, with `\` and `'` escaped;
- numbers with a leading digit;
- objects as blocks;
- ASCII only;
- flat `Spinup_*` keys converted to a `Spinup` block before any change.

The checks that stay in the toolkit run as they did: run-start alignment, the
aggregation window, post-processing staging. They now read the edited init.

**The toolkit checks only what makes a changes file unusable.** It refuses, before
anything is staged:

- a malformed key path;
- a `code_version` that is not the snapshot's;
- a non-ASCII value;
- a key that is fatal for that WBM version:
  - `FreeWaterEvap`, `MT_relHumidity` and any `spinup_*` key, on both versions;
  - `Spinup.Save_Vars`, a `PET` block and a `daily[…]` time series, on 22.1.1.

Whether a value is sensible for the model is not its question.

**The gateway owns the parameter schema.** The wizard's parameter tree lives in the
gateway backend. It says:

- which field maps to which init key path;
- which component renders it;
- which values are allowed, for each WBM version.

The backend serves the tree resolved for a draft's snapshot. It validates a draft's
`custom_params` (init key path → value) against it on save and on submit. At submit it
writes the draft's period, output variables, post-processing choice and custom
parameters into the changes file. The toolkit never reads the schema. The backend
keeps its own init reader, as it already does for the post-processing settings
(`web-gateway/backend/app/services/run_start.py`), tested on the same real inits as the toolkit's.

The applied changes are recorded in the run's `simulation.json`.

## Consequences

- One mechanism carries every edit. A new parameter needs a line in the schema, and
  no toolkit release.
- **The CLI breaks.** The seven options are gone, so a script that used them needs a
  changes file instead. The toolkit is pre-release; the README shows the new form.
- **A gateway job needs a toolkit install that knows `--changes`.** By ADR 0025 that
  is a new install on Anvil and a new `ANVIL_OPENGHM_HOME`. A continued job reruns its
  stored script with the same changes file, so ADR 0037 is unaffected.
- **Two init readers exist**, the toolkit's and the backend's. They answer different
  questions (edit versus display) and are tested on the same inits.

## Alternatives not taken

- **More options, one per key.** About 280 options, each a toolkit release.
- **The gateway writes the whole init and passes it.** The toolkit still has to edit
  it at run time: the output directory, the post-processing `Run` and `Forks` it
  stages, and the cores the job holds. So there would be two writers of one file.
- **Pass the parameter schema to the toolkit.** The schema is mostly presentation:
  tiers, labels, help text. The toolkit needs values, and would be tied to the
  wizard's layout.
- **The toolkit validates everything.** A CLI user would get the full rules too, but
  the rules would live in two places or the toolkit would carry the wizard's schema.
  The minimal checks stop what WBM would abort on or silently misread.
