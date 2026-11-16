"use client";

import { useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/workspace/format";
import {
  SUBSET_LIMIT_BYTES,
  maxSubsetBytes,
  refusalMessage,
  subsetFilename,
  subsetQuery,
  type OutputInventory,
} from "@/lib/repository/output";
import { outputBase, downloadOptions, type OutputSourceRef, type Resolved, type DownloadScope } from "@/lib/output/view";
import { SELECT_CLASS } from "./style-controls";
import { saveBlob } from "./series-chart";

type Fetch =
  | { state: "idle" }
  | { state: "preparing" }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "done" }
  | { state: "failed"; message: string };

/**
 * "Download NetCDF" for the variable and resolution on screen, over the step,
 * its year or every year, whole grid. It is the output dialog's subset flow
 * (same route, same file) with the period taken from the card: the expected
 * size is an upper bound, since the file is deflated.
 */
export function DownloadNetcdf({
  source,
  inventory,
  resolved,
}: {
  source: OutputSourceRef;
  inventory: OutputInventory;
  resolved: Resolved;
}) {
  const [scope, setScope] = useState<DownloadScope>("step");
  const [fetchState, setFetchState] = useState<Fetch>({ state: "idle" });
  const abort = useRef<AbortController | null>(null);

  const years = resolved.variable.resolutions[resolved.resolution]?.years ?? [];
  const options = downloadOptions(resolved.resolution, resolved.date, years);
  const option = options.find((o) => o.scope === scope) ?? options[0];
  const bytes = maxSubsetBytes(option.steps, inventory.grid.bounds, inventory.grid.cellSize);
  const tooBig = bytes > SUBSET_LIMIT_BYTES;
  const busy = fetchState.state === "preparing" || fetchState.state === "downloading";
  const filename = subsetFilename(resolved.variable.name, resolved.resolution, option.period, false);

  const download = async () => {
    if (busy || tooBig) return;
    const controller = new AbortController();
    abort.current = controller;
    setFetchState({ state: "preparing" });
    try {
      const query = subsetQuery({ variable: resolved.variable.name, resolution: resolved.resolution, period: option.period, box: null });
      const response = await fetch(`${outputBase(source)}/subset?${query}`, { signal: controller.signal });
      if (!response.ok || !response.body) {
        const body: unknown = await response.json().catch(() => null);
        setFetchState({ state: "failed", message: refusalMessage(body) ?? "The file could not be made. Try again." });
        return;
      }
      const total = Number(response.headers.get("content-length")) || null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      setFetchState({ state: "downloading", received, total });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setFetchState({ state: "downloading", received, total });
      }
      saveBlob(new Blob(chunks as BlobPart[], { type: "application/x-netcdf" }), filename);
      setFetchState({ state: "done" });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        setFetchState({ state: "idle" });
        return;
      }
      setFetchState({ state: "failed", message: "The download stopped before it finished. Try again." });
    }
  };

  const percent =
    fetchState.state === "downloading" && fetchState.total
      ? Math.min(100, Math.round((fetchState.received / fetchState.total) * 100))
      : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-secondary p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Download as NetCDF
          <select
            className={SELECT_CLASS}
            value={option.scope}
            disabled={busy}
            onChange={(event) => {
              setScope(event.target.value as DownloadScope);
              setFetchState({ state: "idle" });
            }}
          >
            {options.map((o) => (
              <option key={o.scope} value={o.scope}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" onClick={download} disabled={busy || tooBig} className="h-9">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          {fetchState.state === "preparing"
            ? "Preparing…"
            : fetchState.state === "downloading"
              ? `Downloading${percent !== null ? ` ${percent}%` : ` ${formatBytes(fetchState.received)}`}`
              : "Download NetCDF"}
        </Button>
        {busy && (
          <Button type="button" variant="ghost" size="sm" onClick={() => abort.current?.abort()} aria-label="Stop the download">
            <X aria-hidden="true" />
            Stop
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {resolved.variable.name}, {resolved.resolution}, whole grid · {option.steps.toLocaleString("en-US")}{" "}
        {option.steps === 1 ? "time step" : "time steps"} · up to {formatBytes(bytes)} (the file is compressed)
      </p>
      {tooBig && (
        <p role="alert" className="text-xs text-destructive">
          Over 1 GB before compression, more than one download may hold. Choose a shorter period.
        </p>
      )}
      {fetchState.state === "failed" && (
        <p role="alert" className="text-xs text-destructive">
          {fetchState.message}
        </p>
      )}
      {fetchState.state === "done" && <p className="text-xs text-muted-foreground">Saved as {filename}.</p>}
    </div>
  );
}
