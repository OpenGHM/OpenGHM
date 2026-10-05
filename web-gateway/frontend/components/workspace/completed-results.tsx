import { HardDriveDownload } from "lucide-react";
import { CopyButton } from "@/components/workspace/copy-button";
import { OutputFileList } from "@/components/workspace/output-file-list";
import { TimeStamp } from "@/components/common/time-stamp";
import type { FilesState, OutputManifest } from "@/lib/jobs/types";
import { formatBytes, purgeAround, RETENTION_DAYS } from "@/lib/workspace/format";

/**
 * COMPLETED, under the status headline: where the result is, from the job's
 * own record of what it wrote (`output`, ADR 0026), and when Anvil may delete
 * it. Output stays on Anvil scratch (ADR 0023): the gateway serves no download,
 * so the path is the result. A run whose files Anvil's purge has removed says
 * that instead.
 */
export function CompletedResults({
  workDir,
  completedAt,
  output,
  files,
}: {
  workDir: string | null;
  completedAt: string | null;
  output: OutputManifest | null;
  files: FilesState | null;
}) {
  if (files === "purged") {
    return (
      <p className="mt-5 flex items-start gap-2 text-sm text-muted-foreground">
        <HardDriveDownload className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Anvil&apos;s scratch purge removed this simulation&apos;s files.
      </p>
    );
  }
  const around = purgeAround(completedAt);

  return (
    <div className="mt-5 space-y-3">
      {workDir && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Results on Anvil scratch</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
              {workDir}
            </code>
            <CopyButton text={workDir} label="path" />
          </div>
        </div>
      )}

      {output ? (
        <>
          <p className="text-sm text-foreground">
            <span className="font-semibold">{output.file_count}</span> files
            <span aria-hidden="true" className="mx-2 text-muted-foreground">·</span>
            <span className="font-semibold">{output.nc_count}</span> .nc files
            <span aria-hidden="true" className="mx-2 text-muted-foreground">·</span>
            <span className="font-semibold">{formatBytes(output.total_bytes)}</span>
          </p>
          {output.files.length > 0 && <OutputFileList files={output.files} fileCount={output.file_count} />}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This job finished before the gateway recorded what it wrote, so its file count and size are
          not shown.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {around ? (
          <>
            Anvil deletes these files around{" "}
            <TimeStamp value={around} format="date" className="font-medium text-foreground" /> if unused
          </>
        ) : (
          <>Anvil deletes files that are not used for {RETENTION_DAYS} days</>
        )}{" "}
        &mdash; copy what you need.
      </p>
    </div>
  );
}
