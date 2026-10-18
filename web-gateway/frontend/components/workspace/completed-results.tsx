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
    <div className="mt-5 space-y-5">
      {workDir && (
        <div className="space-y-2 rounded-[14px] bg-secondary p-4">
          <div className="text-xs font-semibold text-secondary-foreground">Results on Anvil scratch</div>
          <div className="flex items-center gap-2.5">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-hero [scrollbar-width:thin]">
              {workDir}
            </code>
            <CopyButton text={workDir} label="path" tone="primary" />
          </div>
        </div>
      )}

      {output ? (
        <div className="flex flex-wrap items-center justify-between gap-x-7 gap-y-2.5">
          <div className="flex gap-7">
            <Stat value={output.file_count} label="files" />
            <Stat value={output.nc_count} label=".nc files" />
            <Stat value={formatBytes(output.total_bytes)} label="total" />
          </div>
          {output.files.length > 0 && <OutputFileList files={output.files} fileCount={output.file_count} />}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This simulation finished before the gateway recorded what it wrote, so its file count and size are
          not shown.
        </p>
      )}

      <p className="flex items-center gap-2.5 rounded-xl bg-warning/10 px-3.5 py-3 text-[13.5px] leading-normal text-warning">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-queued" />
        <span>
          {around ? (
            <>
              Anvil deletes these files around{" "}
              <TimeStamp value={around} format="date" className="font-semibold" /> if unused
            </>
          ) : (
            <>Anvil deletes files that are not used for {RETENTION_DAYS} days</>
          )}{" "}
          &mdash; copy what you need.
        </span>
      </p>
    </div>
  );
}

/** A figure of the results: a mono value over a small label. */
function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xl font-medium text-foreground">{value}</span>{" "}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
