# Anvil S3 layout

What lives under each prefix of the `openghm` bucket, and the rules for each.

## Anvil S3 bucket

The GPFS project space (`ops/docs/reference/anvil-environment.md`, private) is staging: where snapshots are assembled and
where compute jobs read from. Anvil S3 is the published, immutable
destination — everything in this document pins against it.

One bucket, `openghm`, six prefixes:

```
openghm/
  snapshots/<id>/…                   # full snapshot tree (snapshot-layout), immutable once published
  model-inputs/<id>/…                # axis 3; internal layout is dataset-specific
  wbm-code/<name>/<version>/…        # model/ + utilities/
  containers/<image>/<version>/…     # plain-S3 SIF mirror
  registry/…                         # zot's own blob store, content-addressed, opaque
  schemas/…                          # common/, snapshot-spec/, model-input-spec/ — proxied by nginx
```

| Prefix | Keyed by | Namespace | Mutable objects | Written by |
|---|---|---|---|---|
| `snapshots/` | minted id | **open** — any user | none | [Upload and lock](#upload-and-lock) |
| `model-inputs/` | minted id | **open** — any user | none | [Publish a model input](#publish-a-model-input) |
| `wbm-code/` | name + version | curated | none | [Publish a code version](#publish-a-code-version) |
| `containers/` | name + version | curated | `containers/manifest.json` only | [ADR 0003](../decisions/0003-zot-as-sif-registry.md) |
| `registry/` | content address | curated | zot's own bookkeeping | zot |
| `schemas/` | spec version | curated | `index.json` only | [snapshot-spec.md](snapshot-spec.md) |

One rule decides the key, and it is the **namespace**, not the artifact:

- **Open namespace → minted id.** Snapshots and model inputs are the prefixes
  users publish into. Two people will pick the same name (`global_test`,
  `merra2`), so a human-chosen key would collide and one publish would silently
  shadow the other. A minted id — 256 random bits, assigned once at publish and
  never reused ([ADR 0014](../decisions/0014-identity-is-a-minted-id.md)) —
  cannot collide.
- **Curated namespace → name + version.** We publish code and images, so
  collisions are a review problem rather than a storage problem, and a readable
  path is worth more: `wbm-code/wbm/2.0.0/` says what it is, `wbm-code/3ab7…/`
  does not.

Integrity does not depend on the key in either case. Every prefix ships a
`SHA256SUMS` (or `TREEHASH`) manifest, and verifying it is a step of its own —
the id says *which* artifact, the manifest says whether the bytes arrived
intact.

`containers/` and `registry/` hold the same images through two different
mechanisms — `containers/` for credential-free HTTPS reads, `registry/` for
`oras://` pulls.

The spec's files live here too, under `schemas/`. Git holds their **source**;
this bucket holds the **published copy** that `$id` URLs resolve to ([snapshot-spec.md](snapshot-spec.md)). No
prefix is served from a cluster volume — there is no PVC, no ConfigMap, and no
git-sync sidecar anywhere in this design.

## Upload and lock

Upload to `snapshots/<id>/` ([Anvil S3 bucket](#anvil-s3-bucket)) using an id
minted at publish time ([snapshot-layout.md](snapshot-layout.md#mint-the-id)).
The slug is not part of the key — it lives in `metadata.json`
([metadata-format.md](metadata-format.md)) and in the catalog, so two users can
both call their snapshot `global_test` without colliding.

```
openghm/
  snapshots/3f9c1a…/…
  snapshots/3f9c1a…/metadata.json
  snapshots/3f9c1a…/SHA256SUMS
  model-inputs/7d4e9a…/…
```

Finding a snapshot by name is the catalog's job, not the bucket's: the
`slug` → id mapping lives in `metadata.json` and in the OpenGHM application's
own index. Listing `snapshots/` gives ids, which is the point.

This is no longer aspirational: `snapshots/<id>/` holds three published
snapshots this way (v2.0.0, Wyoming and Global; mission
`2026-09-23-publish-the-staged-snapshots`, private), each with a
`metadata.json` and a `SHA256SUMS`, every key public-read. `snapshots/` also
still holds the original slug-keyed trees the id-keyed copies were made
from (`snapshots/wbm_storage_v2.0.0/`, `snapshots/wbm_storage_v1.0.0_Wyoming/`,
`snapshots/wbm_storage_v1.0.0_Global/`) — those predate this layout, have no
`metadata.json` or `SHA256SUMS` of their own, and stay for now because
`images/verification/job_*.slurm` and the `*-lite-s3` patch docs still read
them by slug ([open-items.md](open-items.md)). Retiring them is a follow-up,
not done here.

Enforce immutability with the strongest option available:

1. **Object Lock** (governance or compliance mode) on the `snapshots/` and
   `model-inputs/` prefixes. Requires bucket versioning and RCAC enablement ([open-items.md](open-items.md)).
2. **Bucket policy** denying `s3:PutObject` on existing keys for the publishing
   identity, with a separate write-once role.
3. **Publisher-side check** — refuse to upload when the key already exists.
   Needs no admin cooperation:

```bash
# fail if the key is already present
if curl -fsI "https://s3.anvil.rcac.purdue.edu/openghm/$KEY" >/dev/null; then
  echo "refusing: $KEY already exists" >&2; exit 1
fi
```

S3 conditional writes (`If-None-Match: *`) would make option 3 atomic, but
support is version-dependent ([open-items.md](open-items.md)).

## Publish a model input

A **model input** is the data a simulation mounts — prepared inputs published on
their own rather than copied into each snapshot
([ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)). The
internal layout is dataset-specific and the snapshot spec does not constrain it;
model input gets a spec of its own, which **does not exist yet**. What is fixed
today is the manifest and the key.

```bash
cd <dataset>
# same recipe as snapshot-layout, with no exclusions: a model input has no cache and no output
find . -type f -not -name 'SHA256SUMS' -print0 \
  | sort -z | xargs -0 sha256sum > SHA256SUMS
```

Then upload under a minted id ([snapshot-layout.md](snapshot-layout.md#mint-the-id)):

```
openghm/
  model-inputs/7d4e9a…/…
  model-inputs/7d4e9a…/SHA256SUMS
```

The key is a minted id rather than a name because this is an **open** prefix
([Anvil S3 bucket](#anvil-s3-bucket)) — admins publish into it today, but the
design assumes users will, and `merra2` is a name two of them will both pick.
The id is what `uses.modelInput.id` cites
([metadata-format.md](metadata-format.md)); the manifest is what makes a
downloaded copy checkable:

```bash
# consumer side, after downloading
sha256sum -c SHA256SUMS --quiet
```

Immutability enforcement is [Upload and lock](#upload-and-lock)'s list, applied to the `model-inputs/` prefix on
the same terms.

## Publish a code version

Named, versioned copies in Anvil S3 — the same pattern as containers and raw
data, no git involved. This is a curated prefix, so the path is readable and
the hash from [ADR 0008](../decisions/0008-exclude-inline-from-code-hash.md) is recorded rather than used as the key ([Anvil S3 bucket](#anvil-s3-bucket)).

```
openghm/
  wbm-code/wbm/2.0.0/model/…
  wbm-code/wbm/2.0.0/utilities/…
  wbm-code/wbm/2.0.0/TREEHASH      # the ADR 0008 hash of what is in this directory
```

Assembling a new snapshot: pull `model/` + `utilities/` from the version the
snapshot targets, then verify the tree hash against `TREEHASH` before recording
it in `metadata.json`. Publishing new code means a new version directory —
never an edit to an existing one.

Because the key is a name rather than a hash, two versions holding byte-identical
code are stored twice. At this size that is not worth solving; what matters is
that `TREEHASH` makes the duplication detectable.
