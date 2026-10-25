# Glossary

Terms this project uses without re-explaining them.

| Term | Meaning |
|---|---|
| **snapshot** | one folder that reproduces one WBM simulation — code, run configuration, a link to the inputs, and the output it produced |
| **simulation** | one execution of WBM — what a snapshot reproduces, what a submitted snapshot draft performs on Anvil (Queued, Running, then Completed, Failed or Cancelled), and what the spec's `simulation` block describes. "Job" is the internal and SLURM word for it. Not the snapshot draft itself ([ADR 0030](decisions/0030-what-a-person-creates-is-a-snapshot-draft.md)) |
| **catalogue** | the gateway's list of published snapshots and model inputs: each one's `metadata.json` stored as `document` in a MongoDB record beside the gateway's own owner, visibility and registration time ([metadata-format.md](reference/metadata-format.md#the-gateways-catalogue)) |
| **snapshot draft** | what a person creates in the gateway's workspace: edited (status `DRAFT`, shown as "Editing"), submitted, run on Anvil, and later published as a snapshot. A `jobs` document in the backend; "draft" alone once it is clear |
| **model input** | the data a simulation mounts, published on its own outside any snapshot and linked by id (axis 3). Called `raw_data` until [ADR 0015](decisions/0015-model-input-is-a-published-artifact.md) |
| **minted id** | an artifact's identifier — 256 random bits assigned once at publish, unique but not derived from the bytes ([ADR 0014](decisions/0014-identity-is-a-minted-id.md)) |
| **init** | the Perl-hash file WBM reads to configure one run, in a snapshot's `wbm_init/`; `simulation.init` names the one a snapshot runs. A **data `.init`** is a dataset's descriptor, under a model input's `data_init/` ([wbm-init.md](reference/wbm-init.md#8-dataset-descriptors-data-init-files)) |
| **WBM code** | `model/` and `utilities/`, axis 5: published under `wbm-code/<name>/<version>/` and pinned in `uses.modelCode` by its **tree hash**, the sha256 of the sorted per-file hashes with `_Inline` skipped ([ADR 0032](decisions/0032-wbm-code-is-published-and-pinned-by-tree-hash.md)) |
| **toolkit** | the `openghm` library and CLI in `packages/openghm/`, which runs on Anvil: it fetches, runs, publishes and reads snapshots, and a gateway job is its caller ([ADR 0025](decisions/0025-a-gateway-job-runs-the-pinned-toolkit.md)) |
| **gateway** | the web application: the Data Repository, the Workspace and the admin console; it keeps state in MongoDB and starts jobs on Anvil over SSH, and holds no S3 credentials ([gateway.md](architecture/gateway.md)) |
| **spool** | WBM's cache of input data resampled onto the model grid — large, regenerable; kept per model input, network and variant, shared by simulations, not part of a snapshot |
| **spool cache** | the toolkit's per-variant directory of spool days that runs share (`sim run --spool cache`); a **variant** names the settings a spool is valid for: the image, the model code, the network and the init without what only names or times the run ([simulation-reuse.md](architecture/simulation-reuse.md) §4) |
| **scratch** | Anvil's scratch filesystem, where a run's work directory and output stay until the snapshot draft is published; purged by Anvil, so an unpublished result can disappear ([ADR 0023](decisions/0023-simulation-output-stays-on-scratch.md)) |
| **published answer** | a snapshot draft that asks for nothing its snapshot did not run is answered by the snapshot's own `wbm_output/` and is not queued ([simulation-reuse.md](architecture/simulation-reuse.md) §3) |
| **continuation** | a run that SLURM stopped at its time limit carried on in a new job from WBM's last saved state, so one simulation can be several jobs ([ADR 0037](decisions/0037-a-run-longer-than-one-job-continues-in-the-next.md)); not the same as a Continue run from a snapshot's published state, which is not built |
| **changes file** | one JSON file of a draft's edits to its snapshot's init — `set`, `unset` and `forks`, with the WBM `code_version` — that `openghm sim run --changes` applies when it stages a run ([ADR 0038](decisions/0038-a-run-gets-its-init-edits-as-one-changes-file.md)) |
| **parameter tree** | the gateway's schema of WBM's init keys (`param_tree.yaml`): which can be changed, how the wizard shows them, and the cross rules; resolved per WBM version ([model-parameters.md](architecture/model-parameters.md)) |
| **cross rule** | a check across fields of the parameter tree, evaluated on a draft before it is submitted: a dataset's file coverage, the drivers a method needs ([model-parameters.md](architecture/model-parameters.md#what-the-gateway-checks-before-a-submit)) |
| **switching a module on** | a draft turns on a WBM module its snapshot's init has off, by giving it the datasets of the model input it requires ([model-parameters.md](architecture/model-parameters.md#switching-a-module-on)) |
| **fork** | a draft's own copy of a data `.init`, with `Var_Scale`, `Var_Offset` or `Units` changed, that the changes file carries because a published model input is read-only ([ADR 0039](decisions/0039-a-draft-edits-a-data-init-as-its-own-copy.md)) |
| **post-processing** | the init's `PostProcessing` block and a draft's choice of it: *standard* (WBM's own daily, monthly and yearly output) or *climatology* (`Run` true: once WBM exits the toolkit runs `PostProcessing.pl` in the foreground, and the run fails if it fails); the gateway keeps climatology switched off by default ([gateway.md](architecture/gateway.md#5-the-two-paths-that-leave-the-cluster)) |
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
