# Anvil S3 layout

What lives under each prefix of the `openghm` bucket, and the rules for each.

## Anvil S3 bucket

The GPFS project space (`ops/docs/reference/anvil-environment.md`, private) is staging: where snapshots are assembled and
where compute jobs read from. Anvil S3 is the published, immutable
destination — everything in this document pins against it.

One bucket, `openghm`, seven prefixes:

```
openghm/
  snapshots/<id>/…                   # full snapshot tree (snapshot-layout), immutable once published
  model-inputs/<id>/…                # axis 3; internal layout is dataset-specific
  wbm-code/<name>/<version>/…        # model/ + utilities/
  containers/<image>/<version>/…     # plain-S3 SIF mirror
  registry/…                         # zot's own blob store, content-addressed, opaque
  schemas/…                          # common/, snapshot-spec/, model-input-spec/ — proxied by nginx
  schema-docs/…                      # the browsable spec docs (ADR 0021) — proxied by the same nginx, at /docs/
```

| Prefix | Keyed by | Namespace | Mutable objects | Written by |
|---|---|---|---|---|
| `snapshots/` | minted id | **open** — any user | none | [Upload and lock](#upload-and-lock) |
| `model-inputs/` | minted id | **open** — any user | none | [Publish a model input](#publish-a-model-input) |
| `wbm-code/` | name + version | curated | none | [Publish a code version](#publish-a-code-version) |
| `containers/` | name + version | curated | `containers/manifest.json` only | [ADR 0003](../decisions/0003-zot-as-sif-registry.md) |
| `registry/` | content address | curated | zot's own bookkeeping | zot |
| `schemas/` | spec version | curated | `index.json` only | [snapshot-spec.md](snapshot-spec.md) |
| `schema-docs/` | not versioned — single artifact, no version axis | curated | every file — redeployed on each change, not versioned as an artifact ([ADR 0021](../decisions/0021-generate-schema-docs-with-json-schema-for-humans.md)) | **built** by `just schema-docs-gen` (`schema-docs/generated/`, committed) then **published** by a manual `s3cmd put`, same as `schemas/` before automation — no dedicated publish walkthrough exists yet |

**`containers/` and `registry/` hold real content as of `2026-09-25-zot-deploy`
(private):** three images (`wbm-v1-lite`, `wbm-v2-lite`, `wbm-tools-lite`,
the non-`-s3` variants), pushed to zot and mirrored to
`containers/<name>/<version>/`, `containers/manifest.json` listing all three.
Pushing the first one 413'd — ingress-nginx's own default request-body cap is
1m, nowhere near a ~300 MiB SIF — fixed with
`nginx.ingress.kubernetes.io/proxy-body-size: "0"` on zot's Ingress. Anyone
adding a workload that receives large uploads through this cluster's ingress
needs the same annotation; nothing defaults it higher.

**`schema-docs/`'s first publish put `.css` and `.js` on S3 as plain text.**
`s3cmd put` without `-M`/`--guess-mime-type` on this endpoint does not guess by
extension — a gap `schemas/`'s all-JSON tree never surfaced. Every `.html`
file came back with the right content type, but `.css` and `.js` did not, and
a browser silently refuses to apply a stylesheet served with the wrong
content type (no error, the rule just never takes effect). Fixed by passing
an explicit `--mime-type` per file on upload (text/css for `.css`,
application/javascript for `.js`); the same care is needed for any future
prefix that serves anything other than JSON.

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
model input has a spec of its own, `schemas/model-input-spec/`
([snapshot-spec.md](snapshot-spec.md), [metadata-format.md](metadata-format.md#model-inputs-metadatajson)).
What is fixed by that spec is the manifest, the key, and `metadata.json`'s
shape.

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

This is no longer aspirational: `model-inputs/` holds two published model
inputs this way (mission `2026-09-24-publish-the-model-inputs`, private), the
two ids the three published snapshots already cite in `uses.modelInput.id`:

- `model-inputs/52585562…/` — `wbm_ancillary_data_v2.0.0`, 1,542 keys, copied
  from `snapshots/fc66a2cd…/data/wbm_ancillary_data_v2.0.0/`.
- `model-inputs/ff0ba2e5…/` — `wbm_ancillary_data_v1.0.0`, 32,959 keys, copied
  from `snapshots/245430de…/data/Wyoming_tracking/` (Global's
  `data/Global_tracking/` is byte-identical; Wyoming's was used because it is
  listed first).

Each has a `metadata.json` and a `SHA256SUMS`, every key public-read, and both
were re-hashed anonymously from `model-inputs/<id>/` after publishing. Unlike
[Upload and lock](#upload-and-lock)'s snapshot copy, these copied
**server-side**: the source trees under `snapshots/<snapshot-id>/data/<child>/`
were uploaded by our own `EES260008` identity rather than Xiao Liu's, so
`s3cmd`'s `CopyObject` works here (`ops/docs/reference/anvil-environment.md`,
private). The publish script, `ops/anvil/publish_model_input.sh` (private),
derives `SHA256SUMS` from the source snapshot's own manifest — keeping only
the `./data/<child>/` lines and rewriting their prefix to `./` — rather than
re-hashing local bytes the way the recipe above does; both produce the same
manifest shape.

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

## Publish a container image

Two distribution paths for the same bytes ([ADR 0003](../decisions/0003-zot-as-sif-registry.md)):
zot for `oras://` pulls (anonymous read, htpasswd publisher push), plain S3
under `containers/<name>/<version>/` for a credential-free HTTPS read. Both
are written by `ops/anvil/publish_container.sh` (private `ops/` repo), run
on Anvil where the built SIF and `oras`/`s3cmd` live:

```bash
just publish-container wbm-v1-lite 1.1.0 \
  /anvil/scratch/x-openghm/apps/wbm/v1-lite/wbm_v1_lite.sif
```

The script never builds the SIF (rule 3 — store artifacts, do not rebuild
them); it only publishes one already built by `images/<name>/deploy_to_anvil.sh`
or an `apptainer build` from a `.def`. It:

1. Pushes to zot from a **relative-named symlink**, never the SIF's absolute
   path — an absolute source path embeds itself as the artifact's filename
   annotation, and a later anonymous `oras pull` then refuses with `"path
   traversal disallowed"` (oras's own client-side safety guard against a
   publisher writing outside the pull directory; found and fixed during
   `2026-09-25-zot-deploy`, private).
2. Pulls it back anonymously and compares `sha256sum` against the source —
   never trusts `oras push`'s own success message.
3. Mirrors it to `containers/<name>/<version>/<name>-<version>.sif` with
   `s3cmd put --acl-public --mime-type=application/octet-stream`, then
   re-fetches over plain HTTPS and compares `sha256sum` again.
4. Updates `containers/manifest.json` — the mirror's only mutable object
   ([Anvil S3 bucket](#anvil-s3-bucket)): adds the new version (`status:
   "current"`, an `oras://registry.openghm.org/openghm/<name>@sha256:…`
   reference pinned to the pushed **digest**, per rule 2 — pin by identity,
   not by name), marks this image's previous `"current"` version
   `"deprecated"` with a reason (never deletes it — rule 1), and moves
   `aliases.latest`. Refuses outright if the version string already exists,
   rather than silently overwriting a published entry.

**A version string is never reused for different bytes.** A respin needs a
new version — bump semver, or for a metadata-only respin of the same
code, the `-rN` suffix `metadata-format.md`'s own `containers/manifest.json`
example uses (`2.0.0-r3`).

**No cluster step is needed.** zot is a content-addressed store; adding a
version changes no config, so nothing here restarts or redeploys it.
Whatever snapshot's `metadata.json` should cite the new version is a
separate, later step — an already-published snapshot's `metadata.json` is
never edited to point at it (rule 1).

**The three images published on 2026-09-25 predate this script.** They went
out with a tag reference in their `oras` field
(`registry.openghm.org/openghm/<name>:<version>`, no `oras://` scheme, no
digest) instead of the digest-pinned form above. Fixed the same day, once the
script existed to compare against: `manifest.json`'s `oras` field is metadata
about the pointer, not the artifact — the `key`/`size`/`sha256` an existing
version pins never changed, so correcting it is not an edit of a published
artifact (rule 1), it is exactly the kind of update `manifest.json` being
**the only mutable object under `containers/`** exists for. All three now
read `oras://registry.openghm.org/openghm/<name>@sha256:…`, each digest
resolved anonymously against the live registry and verified against the
manifest.json actually served afterward, not just `s3cmd`'s own success
message.
