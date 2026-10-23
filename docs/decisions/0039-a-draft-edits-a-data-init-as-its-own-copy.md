# ADR 0039 — A draft edits a data `.init` as its own copy, a fork the changes file carries

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-24 |
| **Affects** | the changes file of [ADR 0038](0038-a-run-gets-its-init-edits-as-one-changes-file.md) (a new `forks` list); the toolkit's `sim run` and `sim submit`; the gateway's draft and submit ([`../architecture/model-parameters.md`](../architecture/model-parameters.md) section 6); [`../reference/wbm-init.md`](../reference/wbm-init.md) section 8 |

## Context

A data `.init` is a dataset descriptor: it names the file a run reads and how to read it
(`File_Path`, `Var_Name`, `Units`, `Var_Scale`, `Var_Offset`, the dates). It is a file of
the published model input, shared by every run init that names it (`merra2_prectotcorr_d.init`
is used by three run inits of the Wyoming snapshot), and a published model input is
read-only. A draft that wants a scale or an offset on a dataset (the plain way to run an input
sensitivity experiment) cannot edit the descriptor in place.

A second need is the same mechanism. WBM 23.9.0 refuses some shipped descriptors for a fault
of the file and not of its data: `Code_Name` that is not the file's name (6 arc-minute glacier
area of model input `52585562`), and any non-ASCII byte (`irrEfficiency.init`,
`mirca_cropAreaFraction.init` and `rice_percolationRate.init`, identical in both model inputs;
measured, [`wbm-init.md`](../reference/wbm-init.md) section 8). A copy with those two repaired
runs (measured: `v2_fork_subdir`).

The three shipped files hold these non-ASCII characters, read from `52585562` and
`ff0ba2e5` (byte-identical in both):

| File | Character | Where |
|---|---|---|
| `crops/mirca_cropAreaFraction.init` | `ö` (U+00F6), `–` (U+2013, en dash) | `citation`: "Döll", "MIRCA2000 – Global" |
| `crops/rice_percolationRate.init` | `ö` (U+00F6) twice | `Comment`: "Vörösmarty" |
| `irrEfficiency.init` | `ö` (U+00F6) | `citation`: "Döll" |

All of them are in free text that WBM does not read (`citation`, `Comment`), so the spelling
changes no value the model uses.

## Decision

**The changes file gains an optional `forks` list.** Each fork is one copy of a data `.init`:

```json
{
  "code_version": "23.9.0",
  "forks": [
    { "from": "/wbm/data_init/climate/merra2_prectotcorr_d.init",
      "to":   "/wbm/wbm_init/datasets/merra2_prectotcorr_d__3fa91c20.init",
      "set":  { "Var_Scale": 1.1 } }
  ],
  "set": { "MT_Precip.Primary": "/wbm/wbm_init/datasets/merra2_prectotcorr_d__3fa91c20.init" }
}
```

- **`from`** is a container path under `/wbm/data/` or `/wbm/data_init/`, a file of the model
  input the run is bound to. The toolkit resolves it in that model input as WBM would
  (`/wbm/data/data_init/x` and `/wbm/data_init/x` are one file).
- **`to`** is a container path under `/wbm/wbm_init/`, ending in `.init`. The file is written
  in the run's own copy of `wbm_init/`, which is bound read-write there, so the copy exists for
  WBM and is uploaded with the run when it is published.
- **`set`** is an object of top-level descriptor keys to a string or a number (`Var_Scale`,
  `Var_Offset`, `Units`), written by the same writer rules as every other change
  ([ADR 0038](0038-a-run-gets-its-init-edits-as-one-changes-file.md): single-quoted literals,
  numbers with a leading digit, ASCII only).
- **The run init is pointed at the copy by the ordinary `set`**: the key that held `from`
  is set to `to`. A fork does not rewrite the run init by itself.

**The gateway names the copy; the toolkit makes it.** The gateway needs the name to write the
run init's key, and it knows the edit. The name is
`<original basename without .init>__<8 hex>.init` under `/wbm/wbm_init/datasets/`, where the 8 hex
characters are the start of a hash of the original path and the values set. The same edit gives the
same name and another value another, so a file is never edited in place: the spool cache variant
hashes every `.init` a run init names (`spool.py`), and a changed file under an old name would
reuse a spool built for the old content. The folder name is the gateway's convention, which WBM
does not read; the toolkit takes `to` as given.

**The toolkit makes the copy, in this order:**

1. read `from` from the staged model input;
2. rewrite it to ASCII (below);
3. set each `set` key, and set `Code_Name` to `to`'s basename without `.init`, which WBM 23.9.0
   requires of a data `.init` and 22.1.1 does not check (`Code_Name` in `set` is refused: the
   toolkit owns it);
4. stage the file with the run init, before anything computes the spool cache variant. `spool prepare`
   evaluates the staged run init and hashes each `.init` it names, so the variant sees the fork.

**ASCII is by transliteration, not replacement.** The whole file text, comments included, is
rewritten:

1. Unicode NFKD, then every combining mark is dropped (`ö` becomes `o`, `é` becomes `e`);
2. a small table for what does not decompose:

| Character | Written as |
|---|---|
| `–` `—` and the other dashes (U+2010 to U+2015), `−` (U+2212) | `-` |
| `‘` `’` `‚` `‛` | `'` |
| `“` `”` `„` | `"` |
| `…` | `...` |
| `°` | `deg` |
| `µ`, `μ` | `u` |
| `×` | `x` |
| `±` | +/- |
| `ß` | `ss` |
| `æ` `Æ` `œ` `Œ` | `ae` `AE` `oe` `OE` |
| `ø` `Ø` `đ` `Đ` `ł` `Ł` | `o` `O` `d` `D` `l` `L` |

3. a character left over is refused, naming it and its line: the toolkit does not guess
   at one it has no spelling for, and does not write `?`.

The shipped files need only `ö` and `–`; the rest of the table is for descriptors we do not have
yet and is deliberately short. A `set` value is not transliterated: it must already be ASCII, as in
ADR 0038.

**The toolkit checks only what makes a fork unusable**, before anything is staged:

- `from` and `to` are normalised absolute container paths in their roots, with no `..`;
- `to` ends in `.init`, its basename is made of letters, digits, `.`, `_`, `-`, and it is not the run
  init;
- `set` keys are plain names (no dots: a descriptor's own keys are top level), values are strings
  or numbers, and none is `Code_Name`;
- `from` exists in the model input, reads as an init and has a `Code_Name` (it is a descriptor,
  not a block file);
- no two forks have the same `to`, and `to` is not already a file of the snapshot's `wbm_init/`
  (a published artifact is never overwritten under its own name).

Whether `Var_Scale` 1.1 suits precipitation, or which keys a person may change, is not its question.

**The gateway keeps the edit and never the file.** A draft stores, per fork, the field it serves,
the original path and the values set. At submit it computes the name, writes `forks` and the field's
key into the changes file, and checks what it offers the person: only `Var_Scale`, `Var_Offset` and
`Units`; numbers in WBM's form; an original that the run reads. The files stay in the model input
until a run stages the copy, so the gateway holds no descriptor text and no copy to keep in step.

## Consequences

- **A fork travels with its run.** The copy is in the run's `wbm_init/`, so `openghm snapshot
  publish` uploads it (it uploads that folder with its subfolders) and the published snapshot's
  init points at a file that is in the snapshot. The layout check asks only for the required
  top-level entries, so `wbm_init/datasets/` is accepted. A test pins this.
- **The name hashes the original's path, not its bytes.** A model input is pinned by id (rule 2), so
  a path in one model input is one content; the same path in another model input would be another
  file, which is why a run's fork is made from the model input the run is bound to.
- **A descriptor that WBM 23.9.0 refuses is repaired by a fork with an empty `set`.** The repaired
  copy differs from the original only in `Code_Name` and ASCII.
- **The toolkit and the gateway agree on the name only by contract.** The toolkit does not
  recompute the hash, so a hand-written changes file can name a copy as it likes (inside the checks
  above).
- **Forks of files named inside other files are not covered**: the `Irrigation.CropParFile` CSV and a
  reservoir block file name data inits; a fork of one of those is read through the file that names it,
  which still points at the original. The gateway refuses to fork what the run init does not name
  directly.
- **`Var_Scale` 0 reads as 1.** WBM replaces a false `Var_Scale` or `Var_Offset` by its default
  (`WBM.pm` lines 233-234), so a scale of zero cannot be asked for.

## Alternatives not taken

- **The toolkit names the copy.** It would need the hash recipe, and the gateway would have to read
  the name back from the run to point the init at it, or recompute it. One owner of the name is
  simpler: the one who writes the key.
- **The gateway stores the edited file.** A copy of a descriptor per draft in the gateway's database
  or in S3, with content to keep in step with the model input. A descriptor is three lines of
  change over a file that already exists; the edit is the smaller thing to store.
- **Edit the descriptor in the model input.** Every other run that names it would change with it,
  and a published artifact is not edited in place (rule 1, once the project is in operation).
- **Replace non-ASCII with `?`.** It loses the text, and a `?` in a citation reads as a fault.
  Transliteration keeps the text readable, and is what the maintainer chose (2026-10-24).
- **Transliterate with a table only.** A table of every accented letter is long and still
  incomplete; NFKD covers all of them and a table covers the few it does not.
