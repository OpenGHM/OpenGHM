import { FileArchive, Info, HardDriveDownload } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/workspace/copy-button";
import { OutputFileList } from "@/components/workspace/output-file-list";
import { TimeStamp } from "@/components/workspace/time-stamp";
import { HUE } from "@/lib/jobs/status-hue";
import type { Job } from "@/lib/jobs/types";
import { formatBytes, purgeAround, RETENTION_DAYS } from "@/lib/workspace/format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

/**
 * COMPLETED — where the result is, from the job's own record of what it wrote
 * (`job.output`, ADR 0026), and how long Anvil keeps it. Output stays on Anvil
 * scratch (ADR 0023): the gateway serves no download, so the path is the
 * result. A run whose files Anvil's purge has removed shows that instead.
 * Deleting the simulation is in the page header, not here.
 */
export function CompletedResultsCard({ job }: { job: Job }) {
  const hue = HUE.COMPLETED;
  const purged = job.files === "purged";
  const output = job.output;
  const around = purgeAround(job.completed_at);

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader
        className={`border-b bg-gradient-to-r ${hue.gradient} to-transparent !py-4 !gap-0 grid-rows-1 items-center`}
      >
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${hue.tile}`}>
            <FileArchive className={`size-4 ${hue.icon}`} aria-hidden="true" />
          </div>
          Output Files
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        {purged ? (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
            <HardDriveDownload className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Anvil&apos;s scratch purge removed this run&apos;s files.</p>
          </div>
        ) : (
          <>
            {job.work_dir && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Scratch path
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                    {job.work_dir}
                  </code>
                  <CopyButton text={job.work_dir} label="path" />
                </div>
              </div>
            )}

            {output ? (
              <>
                <dl className="grid grid-cols-3 gap-2">
                  <Stat label="Files" value={String(output.file_count)} />
                  <Stat label=".nc files" value={String(output.nc_count)} />
                  <Stat label="Total size" value={formatBytes(output.total_bytes)} />
                </dl>
                {output.files.length > 0 && (
                  <OutputFileList files={output.files} fileCount={output.file_count} />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This job finished before the gateway recorded what it wrote, so its
                file count and size are not shown.
              </p>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-status-running/25 bg-status-running/5 p-3 text-sm text-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-status-running" aria-hidden="true" />
              <p>
                Anvil deletes files that are not used for {RETENTION_DAYS} days
                {around && (
                  <>
                    {" "}
                    &mdash; around <TimeStamp value={around} format="date" className="font-medium" />
                  </>
                )}
                . Publishing a run as a snapshot is not available yet, so copy
                what you need from the path above before then.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
