import Link from "next/link";
import { FileArchive, Download, Upload, Info } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { FakeOutputFile } from "@/lib/workspace/fixtures";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * COMPLETED — the result: output files, and the door into publishing.
 * No route returns a result listing yet (nothing writes output to S3 —
 * open item Next 8), so the file list here is always fixture data
 * (`fakeOutputFiles()`) and every link is inert by construction
 * (`href: null` in the fixture) rather than a button that quietly does
 * nothing.
 */
export function CompletedResultsCard({
  jobId,
  files,
  publishHref,
}: {
  jobId: string;
  files: FakeOutputFile[];
  publishHref: string;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-emerald-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
            <FileArchive className="size-4 text-emerald-600" />
          </div>
          Output Files
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Illustrative only — output isn&apos;t written to S3 yet, so nothing
            is downloadable here.
          </span>
        </div>
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.path}
              className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <span className="truncate font-mono text-xs text-foreground">{f.path}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {formatBytes(f.sizeBytes)}
                <Download className="size-3.5 opacity-40" aria-label="Not available" />
              </span>
            </li>
          ))}
        </ul>
        <Button asChild size="sm" className="w-full gap-1.5 bg-[#006994] hover:bg-[#00b4d8]">
          <Link href={publishHref} data-job-id={jobId}>
            <Upload className="size-4" />
            Publish as a Snapshot
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
