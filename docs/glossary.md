# Glossary

Terms this project uses without re-explaining them.

| Term | Meaning |
|---|---|
| **snapshot** | one folder that reproduces one WBM simulation — code, run configuration, a link to the inputs, and the output it produced |
| **simulation** | one execution of WBM — what a snapshot reproduces, what a submitted snapshot draft performs on Anvil (Queued, Running, then Completed, Failed or Cancelled), and what the spec's `simulation` block describes. "Job" is the internal and SLURM word for it. Not the snapshot draft itself ([ADR 0030](decisions/0030-what-a-person-creates-is-a-snapshot-draft.md)) |
| **snapshot draft** | what a person creates in the gateway's workspace: edited (status `DRAFT`, shown as "Editing"), submitted, run on Anvil, and later published as a snapshot. A `jobs` document in the backend; "draft" alone once it is clear |
| **model input** | the data a simulation mounts, published on its own outside any snapshot and linked by id (axis 3). Called `raw_data` until [ADR 0015](decisions/0015-model-input-is-a-published-artifact.md) |
| **minted id** | an artifact's identifier — 256 random bits assigned once at publish, unique but not derived from the bytes ([ADR 0014](decisions/0014-identity-is-a-minted-id.md)) |
| **spool** | WBM's cache of input data resampled onto the model grid — large, regenerable; kept per model input, network and variant, shared by simulations, not part of a snapshot |
| **Apptainer** | the container runtime on Anvil (formerly Singularity; `singularity` is a symlink to it) |
| **SIF** | Singularity Image Format — one file that is the whole container |
| **squashfs** | the compressed read-only filesystem inside a SIF; it embeds timestamps, which is why a rebuild is not bit-identical |
| **`_Inline`** | `model/_Inline` — prebuilt Perl C extensions (`.so`) shipped with the code; they load only against the Perl ABI they were compiled for |
| **OCI** | Open Container Initiative — the image and registry standards Docker created and everything else now implements |
| **OCI artifact** | any blob stored in an OCI registry, not only a container image layer; this is how a SIF is stored byte-for-byte instead of being rebuilt |
| **OCI Distribution** | the HTTP API an OCI registry speaks (`/v2/…`) — what `push` and `pull` talk to |
| **ORAS** | OCI Registry As Storage — stores a SIF as one plain OCI artifact, so a pull returns the pushed bytes unchanged |
| **zot** | single-binary OCI registry (Go, Apache-2.0) — the registry we run |
| **GHCR** | GitHub Container Registry (`ghcr.io`) — used here only to fetch zot's own Helm chart; no WBM image lives there |
| **tag vs digest** | a tag (`2.0.0-r3`) can be moved to point at different bytes; a digest (`sha256:9f2c…`) cannot. Pins use digests |
| **Helm chart** | a packaged, parameterised set of Kubernetes manifests; `helm install` renders and applies it |
| **PVC** | PersistentVolumeClaim — a Kubernetes request for durable disk. Nothing in this design uses one |
| **ConfigMap** | small configuration data stored in Kubernetes itself, mounted into a pod as files |
| **cert-manager** | the cluster add-on that issues and renews TLS certificates, already running |
| **Object Lock** | S3 feature that refuses to overwrite or delete an object |
| **GPFS** | Anvil's shared parallel filesystem — where snapshots are staged and where jobs read from |
| **SLURM** | Anvil's batch scheduler; compute work runs as SLURM jobs, never as standing services |
| **modulefile** | a Tcl file Anvil's module system loads to set `PATH` and environment variables for one installed version |
