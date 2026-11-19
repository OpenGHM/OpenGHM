"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useDownload } from "@/components/download/download-provider";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/workspace/format";
import {
  SUBSET_LIMIT_BYTES,
  maxSubsetBytes,
  subsetFilename,
  subsetQuery,
  type OutputInventory,
} from "@/lib/repository/output";
import {
  outputBase,
  downloadOptions,
  publishedFileUrl,
  type OutputSourceRef,
  type PublishedOutput,
  type Resolved,
  type DownloadScope,
} from "@/lib/output/view";
import { headContentType, saveInBrowser, showsInline } from "@/lib/download/browser-download";
import { SELECT_CLASS } from "./style-controls";

/**
 * "Download NetCDF" for the variable and resolution on screen, over the step,
 * its year or every year, whole grid. It is the output dialog's subset flow
 * (same route, same file) with the period taken from the card: the expected
 * size is an upper bound, since the file is deflated.
 *
 * For a published snapshot, a period that is exactly one of its files (a yearly variable's year,
 * a monthly variable's whole year) is that file, handed to the browser at its S3 URL: nothing is
 * prepared and no dialog opens. Anything else is cut on Anvil first, which the dialog shows.
 */
export function DownloadNetcdf({
  source,
  inventory,
  resolved,
  published,
}: {
  source: OutputSourceRef;
  /** A published snapshot's output in S3; absent for a run. */
  published?: PublishedOutput;
  inventory: OutputInventory;
  resolved: Resolved;
}) {
  const [scope, setScope] = useState<DownloadScope>("step");
  const { start, busy } = useDownload();

  const years = resolved.variable.resolutions[resolved.resolution]?.years ?? [];
  const options = downloadOptions(resolved.resolution, resolved.date, years);
  const option = options.find((o) => o.scope === scope) ?? options[0];
  const bytes = maxSubsetBytes(option.steps, inventory.grid.bounds, inventory.grid.cellSize);
  const tooBig = bytes > SUBSET_LIMIT_BYTES;
  const filename = subsetFilename(resolved.variable.name, resolved.resolution, option.period, false);

  const fileUrl = publishedFileUrl(published, resolved.variable.name, resolved.resolution, option);

  const download = () => {
    if (busy) return;
    if (fileUrl) {
      // The published file itself, if the bucket has it; else it is cut like any other period.
      void headContentType(fileUrl).then((type) => {
        if (type !== undefined && !showsInline(type)) saveInBrowser(fileUrl);
        else prepare();
      });
      return;
    }
    if (tooBig) return;
    prepare();
  };

  const prepare = () => {
    const query = subsetQuery({ variable: resolved.variable.name, resolution: resolved.resolution, period: option.period, box: null });
    start({
      title: `${resolved.variable.name}, ${resolved.resolution}, whole grid · ${option.label}`,
      filename,
      url: `${outputBase(source)}/subset?${query}`,
      expectedBytes: bytes,
      note: "The NetCDF file is cut from the simulation output on Anvil before it can download. This can take a minute.",
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-secondary p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Download as NetCDF
          <select
            className={SELECT_CLASS}
            value={option.scope}
            disabled={busy}
            onChange={(event) => setScope(event.target.value as DownloadScope)}
          >
            {options.map((o) => (
              <option key={o.scope} value={o.scope}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" onClick={download} disabled={busy || (tooBig && !fileUrl)} className="h-9">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          Download NetCDF
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {resolved.variable.name}, {resolved.resolution}, whole grid · {option.steps.toLocaleString("en-US")}{" "}
        {option.steps === 1 ? "time step" : "time steps"} ·{" "}
        {fileUrl
          ? "the published file"
          : `up to ${formatBytes(bytes)} (the file is compressed) · prepared on Anvil first`}
      </p>
      {tooBig && !fileUrl && (
        <p role="alert" className="text-xs text-destructive">
          Over 1 GB before compression, more than one download may hold. Choose a shorter period.
        </p>
      )}
    </div>
  );
}
