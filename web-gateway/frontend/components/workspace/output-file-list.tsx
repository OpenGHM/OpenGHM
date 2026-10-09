"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { OutputFile } from "@/lib/jobs/types";
import { formatBytes } from "@/lib/workspace/format";
import { groupManifest, limitRows } from "@/lib/workspace/manifest";

/** Rows drawn at once. A simulation can write of files; the rest are counted. */
const MAX_ROWS = 300;

/**
 * A finished simulation's files, collapsed until asked for and grouped by top folder
 * (`daily/`, `monthly/`, ...). Paths are relative to the simulation's directory.
 * `fileCount` is the real total, which can exceed `files` when the manifest
 * was cut short.
 */
export function OutputFileList({
  files,
  fileCount,
}: {
  files: OutputFile[];
  fileCount: number;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const groups = useMemo(() => groupManifest(files), [files]);

  const shown = useMemo(() => limitRows(groups, MAX_ROWS), [groups]);
  const notShown = fileCount - shown.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={regionId}
        className="-ml-1 flex min-h-10 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
      >
        {open ? (
          <ChevronDown className="size-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4" aria-hidden="true" />
        )}
        {open ? "Hide" : "Show"} file list ({fileCount})
      </button>

      {open && (
        <div
          id={regionId}
          tabIndex={0}
          className="max-h-72 space-y-3 overflow-auto rounded-xl bg-muted p-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {shown.map((g) => (
            <section key={g.folder || "."} aria-label={g.folder || "Top level"}>
              <h4 className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs font-semibold text-foreground">
                <span className="min-w-0 break-all font-mono">{g.folder ? `${g.folder}/` : "Top level"}</span>
                <span className="font-normal text-muted-foreground">
                  {g.fileCount} {g.fileCount === 1 ? "file" : "files"} · {formatBytes(g.totalBytes)}
                </span>
              </h4>
              <ul className="mt-1 space-y-0.5">
                {g.rows.map((f) => (
                  <li key={f.name} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 break-all font-mono text-foreground/80">{f.name}</span>
                    <span className="shrink-0 text-muted-foreground">{formatBytes(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {notShown > 0 && (
            <p className="text-xs text-muted-foreground">
              …and {notShown} more {notShown === 1 ? "file" : "files"} not listed here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
