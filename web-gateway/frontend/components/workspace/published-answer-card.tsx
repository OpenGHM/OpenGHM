import { CheckCircle2, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublishedAnswer, PublishedFile, PublishedFileGroup } from "@/lib/jobs/types";
import { formatBytes } from "@/lib/workspace/format";

const GROUPS: { group: PublishedFileGroup; title: string }[] = [
  { group: "daily", title: "Daily" },
  { group: "monthly", title: "Monthly" },
  { group: "yearly", title: "Yearly" },
];

/** A file's rows are `variable` sub-lists for monthly and yearly, one list for
 *  daily (a daily file holds every published variable). */
interface Block {
  /** Null for the daily list. */
  variable: string | null;
  files: PublishedFile[];
}

function blocksOf(files: readonly PublishedFile[]): Block[] {
  const byVariable = new Map<string | null, PublishedFile[]>();
  for (const file of files) {
    const list = byVariable.get(file.variable);
    if (list) list.push(file);
    else byVariable.set(file.variable, [file]);
  }
  return [...byVariable.entries()].map(([variable, list]) => ({
    variable,
    files: [...list].sort((a, b) => a.year - b.year),
  }));
}

function FileRow({ file, label }: { file: PublishedFile; label: string }) {
  return (
    <li className="flex min-h-10 items-center justify-between gap-3 border-t border-border/60 px-1 first:border-t-0 sm:min-h-9">
      <span className="font-mono text-sm text-foreground">{file.year}</span>
      <span className="ml-auto text-xs text-muted-foreground">{formatBytes(file.size)}</span>
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Download ${label} ${file.year}`}
        className="inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
      >
        <Download className="size-3.5" aria-hidden="true" />
        Download
      </a>
    </li>
  );
}

/**
 * Review, when the snapshot's published results already answer the draft:
 * instead of the submit card, which run they come from and for which period,
 * and every file that answers it (daily, then monthly and yearly by variable)
 * with its year, its size and a plain link to the public file. Nothing here
 * runs anything. The card says that files are per year and that a daily file
 * holds every published variable, so what is listed can be wider than what the
 * draft asked for; and, when the draft starts later than the published run, that
 * these years come from that run.
 */
export function PublishedAnswerCard({
  answer,
  draftStart,
}: {
  answer: PublishedAnswer;
  /** The run period start on the draft being reviewed. */
  draftStart: string;
}) {
  const grouped = GROUPS.map(({ group, title }) => ({
    group,
    title,
    files: answer.files.filter((f) => f.group === group),
  })).filter((g) => g.files.length > 0);
  const startsLater = !!answer.period && !!draftStart && draftStart > answer.period.start;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-success/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          </div>
          <h3>Results already published</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5 pb-6">
        <p className="text-sm text-foreground">
          This model snapshot already publishes the results this run would compute, so there is nothing
          to submit. Download them below.
        </p>

        <dl className="grid gap-2 sm:grid-cols-2">
          {answer.period && (
            <div className="rounded-lg bg-muted px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Published period</dt>
              <dd className="font-medium text-foreground">
                {answer.period.start} → {answer.period.end}
              </dd>
            </div>
          )}
          {answer.run_id && (
            <div className="rounded-lg bg-muted px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Run</dt>
              <dd className="break-all font-mono text-sm font-medium text-foreground">{answer.run_id}</dd>
            </div>
          )}
        </dl>

        {startsLater && (
          <p className="text-sm text-muted-foreground">
            Your run starts later than the published one. These years come from the published run, whose
            spinup began earlier.
          </p>
        )}

        <div className="space-y-4">
          {grouped.map(({ group, title, files }) => (
            <section key={group} aria-label={`${title} files`} className="space-y-2">
              <h4 className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold text-foreground">
                <span>{title}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
                  {formatBytes(files.reduce((n, f) => n + f.size, 0))}
                </span>
              </h4>
              <div className="space-y-3 rounded-lg bg-muted px-3 py-1">
                {blocksOf(files).map((block) => (
                  <div key={block.variable ?? "all"}>
                    {block.variable && (
                      <div className="pt-2 font-mono text-xs font-semibold text-muted-foreground">
                        {block.variable}
                      </div>
                    )}
                    <ul>
                      {block.files.map((file) => (
                        <FileRow
                          key={file.key}
                          file={file}
                          label={block.variable ? `${group} ${block.variable}` : group}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Files are per year, and a daily file holds every published variable, not only the ones you chose.
        </p>
      </CardContent>
    </Card>
  );
}
