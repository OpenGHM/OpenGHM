"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ComputeFields } from "@/components/workspace/compute-fields";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { updateSimulation } from "@/lib/jobs/actions";
import { UNSUPPORTED_REASON, validateSlurmConfig } from "@/lib/jobs/compute";
import { fetchModelInputById } from "@/lib/repository/actions";
import type { Job, JobParameters, PartialAbout, SlurmConfig } from "@/lib/jobs/types";
import type { Dataset } from "@/lib/repository/types";
import { ModelInputSection, type ModelInputSectionChoice } from "@/components/workspace/model-input-section";

interface CreatorRow {
  name: string;
  email: string;
  orcid: string;
}

function creatorsFromAbout(about: PartialAbout | null): CreatorRow[] {
  const creators = about?.creator ?? [];
  if (creators.length === 0) return [{ name: "", email: "", orcid: "" }];
  return creators.map((c) => ({
    name: c.name ?? "",
    email: c.email ?? "",
    orcid: c.orcid ?? "",
  }));
}

/** Builds the `about` PATCH payload from form state — omits empty scalar
 * fields and only includes `keywords`/`creator` when non-empty, since
 * PartialAbout (app/models/job.py) carries the generated block's
 * `min_length=1` constraints on those arrays whenever they're present at
 * all (app/models/partial.py's `_partial_model`). */
function buildAboutPayload(state: {
  name: string;
  description: string;
  category: string;
  license: string;
  keywords: string;
  creators: CreatorRow[];
}): PartialAbout {
  const keywords = state.keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const creators = state.creators
    .filter((c) => c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      ...(c.email.trim() && { email: c.email.trim() }),
      ...(c.orcid.trim() && { orcid: c.orcid.trim() }),
    }));

  return {
    ...(state.name.trim() && { name: state.name.trim() }),
    ...(state.description.trim() && { description: state.description.trim() }),
    ...(state.category.trim() && { category: state.category.trim() }),
    ...(state.license.trim() && { license: state.license.trim() }),
    ...(keywords.length > 0 && { keywords: keywords as [string, ...string[]] }),
    ...(creators.length > 0 && {
      creator: creators as PartialAbout["creator"],
    }),
  };
}

export function SimulationEditor({
  job,
  availableVariables,
  dataset,
}: {
  job: Job;
  availableVariables: string[];
  /** The base snapshot, for `uses.modelInput.id` — the id a draft with no
   *  override inherits from. Best-effort fetched by the page; null when the
   *  snapshot itself couldn't be loaded. */
  dataset: Dataset | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // -- Model input form state -------------------------------------------------
  // `modelInputChoice.mode === "chosen"` is the PATCH payload's source of
  // truth for `model_input_id` (the id alone, known synchronously — the
  // `modelInput` object is display-only and may still be resolving).
  // "inherit" always PATCHes `model_input_id: null`, same as the wizard's
  // revert-to-inherit control.
  const [modelInputChoice, setModelInputChoice] = useState<ModelInputSectionChoice>(
    job.model_input_id ? { mode: "chosen", id: job.model_input_id, modelInput: null } : { mode: "inherit" }
  );
  useEffect(() => {
    if (!job.model_input_id) return;
    let cancelled = false;
    fetchModelInputById(job.model_input_id)
      .then((mi) => {
        if (cancelled) return;
        setModelInputChoice((prev) =>
          prev.mode === "chosen" && prev.id === job.model_input_id ? { ...prev, modelInput: mi } : prev
        );
      })
      .catch(() => {
        /* leave modelInput null — the section renders the "no longer resolves" fallback */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.model_input_id]);

  // -- About form state -----------------------------------------------------
  const [name, setName] = useState(job.about?.name ?? "");
  const [description, setDescription] = useState(job.about?.description ?? "");
  const [category, setCategory] = useState(job.about?.category ?? "");
  const [license, setLicense] = useState(job.about?.license ?? "");
  const [keywords, setKeywords] = useState((job.about?.keywords ?? []).join(", "));
  const [creators, setCreators] = useState<CreatorRow[]>(creatorsFromAbout(job.about));

  // -- Parameters form state -------------------------------------------------
  const [start, setStart] = useState(job.parameters.temporal_range_start);
  const [end, setEnd] = useState(job.parameters.temporal_range_end);
  const [selectedVars, setSelectedVars] = useState<Set<string>>(
    () => new Set(job.parameters.variables)
  );
  const [spatialEnabled, setSpatialEnabled] = useState(job.parameters.spatial_domain !== null);
  const [north, setNorth] = useState(String(job.parameters.spatial_domain?.north ?? ""));
  const [south, setSouth] = useState(String(job.parameters.spatial_domain?.south ?? ""));
  const [east, setEast] = useState(String(job.parameters.spatial_domain?.east ?? ""));
  const [west, setWest] = useState(String(job.parameters.spatial_domain?.west ?? ""));
  // Not editable here. Kept so a draft that arrived with some (through the
  // API) can have them removed, because a submit refuses them.
  const [customParams, setCustomParams] = useState(job.parameters.custom_params);
  const hasCustomParams = customParams !== null && Object.keys(customParams).length > 0;

  // -- Compute form state ------------------------------------------------------
  const [compute, setCompute] = useState<SlurmConfig>({
    cores: job.slurm_config.cores ?? null,
    walltime: job.slurm_config.walltime ?? null,
  });
  const computeInvalid = Object.keys(validateSlurmConfig(compute)).length > 0;

  const variableOptions = useMemo(() => {
    const set = new Set(availableVariables);
    for (const v of job.parameters.variables) set.add(v);
    return Array.from(set);
  }, [availableVariables, job.parameters.variables]);

  const toggleVar = (v: string) => {
    setSelectedVars((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const updateCreator = (i: number, patch: Partial<CreatorRow>) => {
    setCreators((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSessionExpired(false);
    try {
      const parameters: JobParameters = {
        temporal_range_start: start,
        temporal_range_end: end,
        spatial_domain: spatialEnabled
          ? {
              north: Number(north) || 0,
              south: Number(south) || 0,
              east: Number(east) || 0,
              west: Number(west) || 0,
            }
          : null,
        variables: Array.from(selectedVars),
        custom_params: customParams,
      };
      const about = buildAboutPayload({ name, description, category, license, keywords, creators });
      const model_input_id = modelInputChoice.mode === "chosen" ? modelInputChoice.id : null;

      const result = await updateSimulation(job.id, {
        about,
        parameters,
        model_input_id,
        slurm_config: compute,
      });
      if (!result.ok) {
        if (result.reason === "session_expired") {
          setSessionExpired(true);
          toast.error("Your session has expired. Sign in to save your changes.");
        } else {
          const msg =
            result.reason === "error" ? result.message : "This simulation no longer exists.";
          setError(msg);
          toast.error(msg);
        }
        return;
      }
      toast.success("Saved.");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {sessionExpired && <SessionExpiredBanner />}
      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-status-failed">
          {error}
        </div>
      )}

      {/* About */}
      <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
          <CardTitle className="text-lg font-semibold text-foreground">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5 pb-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled simulation" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. tutorial" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              placeholder="What is this simulation for?"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">License (SPDX id)</Label>
              <Input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="e.g. GPL-3.0-only" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Keywords (comma-separated)</Label>
              <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="hydrology, runoff" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Creators</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreators((prev) => [...prev, { name: "", email: "", orcid: "" }])}
              >
                <Plus className="mr-1 size-3.5" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {creators.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                  <Input
                    value={c.name}
                    onChange={(e) => updateCreator(i, { name: e.target.value })}
                    placeholder="Name"
                  />
                  <Input
                    value={c.email}
                    onChange={(e) => updateCreator(i, { email: e.target.value })}
                    placeholder="Email (optional)"
                  />
                  <Input
                    value={c.orcid}
                    onChange={(e) => updateCreator(i, { orcid: e.target.value })}
                    placeholder="ORCID (optional)"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreators((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={creators.length <= 1}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model input — only choosable while DRAFT (mirrors the server's
          `_is_editable`, which 409s a PATCH once the simulation has moved
          past DRAFT; this page only renders SimulationEditor for a draft at
          all, but the gate is kept explicit here too rather than relying on
          the caller). */}
      {job.status === "DRAFT" && (
        <ModelInputSection
          inheritedId={dataset?.uses.modelInput.id ?? null}
          choice={modelInputChoice}
          onChoiceChange={setModelInputChoice}
        />
      )}

      {/* Parameters */}
      <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
          <CardTitle className="text-lg font-semibold text-foreground">Simulation Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-5 pb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">End</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          {variableOptions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Output Variables ({selectedVars.size}/{variableOptions.length})
              </Label>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-lg border p-3 sm:grid-cols-3">
                {variableOptions.map((v) => (
                  <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedVars.has(v)}
                      onChange={() => toggleVar(v)}
                      className="size-3.5 rounded border-slate-300"
                    />
                    <span className="truncate" title={v}>
                      {v}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {/* The toolkit has no option for a spatial subset yet, so a submit
                refuses one (ADR 0025). It can be switched off, not on. */}
            <label
              className={`flex items-center gap-2 text-xs font-medium ${
                spatialEnabled ? "text-muted-foreground" : "text-muted-foreground/60"
              }`}
            >
              <input
                type="checkbox"
                checked={spatialEnabled}
                disabled={!spatialEnabled}
                onChange={(e) => setSpatialEnabled(e.target.checked)}
                className="size-3.5 rounded border-slate-300"
              />
              Restrict to a spatial subset
            </label>
            <p className="text-xs text-muted-foreground">
              {spatialEnabled
                ? "A subset cannot run yet. Switch it off to submit."
                : UNSUPPORTED_REASON.spatialSubset}
            </p>
            {spatialEnabled && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">North</Label>
                  <Input type="number" value={north} disabled onChange={(e) => setNorth(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">South</Label>
                  <Input type="number" value={south} disabled onChange={(e) => setSouth(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">East</Label>
                  <Input type="number" value={east} disabled onChange={(e) => setEast(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">West</Label>
                  <Input type="number" value={west} disabled onChange={(e) => setWest(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {hasCustomParams && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <p>
                This draft has custom parameters. {UNSUPPORTED_REASON.customParams} Remove them to submit.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 shrink-0 bg-white sm:min-h-8"
                onClick={() => setCustomParams(null)}
              >
                Remove
              </Button>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              Spinup, routing and post-processing settings live in the model&apos;s{" "}
              <code className="font-mono">.init</code> file, not here — the gateway will show
              the <code className="font-mono">.init</code> itself rather than restate it (see{" "}
              <code className="font-mono">docs/reference/metadata-format.md</code>).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Compute — what SLURM is asked for. Account and partition are the
          gateway's, so only cores and walltime are here. */}
      <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-compute/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
          <CardTitle className="text-lg font-semibold text-foreground">Compute</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5 pb-6">
          <ComputeFields
            config={compute}
            recommended={dataset?.simulation.recommendedCompute ?? null}
            onChange={setCompute}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || computeInvalid}
          className="min-h-10 sm:min-h-9"
        >
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
