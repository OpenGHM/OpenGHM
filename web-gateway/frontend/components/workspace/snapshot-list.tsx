import type { ReactNode } from "react";
import { CheckCircle2, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimeStamp } from "@/components/common/time-stamp";
import { TagChips } from "@/components/repository/tag-chips";
import { resolutionText } from "@/lib/repository/catalogue-format";
import type { Dataset } from "@/lib/repository/types";

/** `2000-01-01` and `2009-12-31` as "2000–2009"; one year as "2001". */
function years({ start, end }: { start: string; end: string }): string {
  const a = start.slice(0, 4);
  const b = end.slice(0, 4);
  return a === b ? a : `${a}–${b}`;
}

/** The muted line under a title: which model, and when the snapshot was published. */
function MetaLine({ dataset }: { dataset: Dataset }) {
  return (
    <span className="text-xs text-muted-foreground">
      WBM {dataset.uses.container.version}
      <span aria-hidden="true" className="mx-1.5">
        ·
      </span>
      Published <TimeStamp value={dataset.generatedAt} format="date" />
    </span>
  );
}

/**
 * The model snapshots the Start screen's picker offers, one per row. The title
 * has the widest column and is clamped to two lines (the whole text is in its
 * `title` attribute, and in the Details sheet); the tags and a muted model
 * line sit under it, then the years it covers, its resolution and the two
 * actions: Details, which opens the sheet, and Select, which commits. A row is
 * not clickable as a whole, so the title is plain text.
 *
 * Two layouts, and CSS shows one: a real table from `sm` up, a list of compact
 * cards below it. The hidden one is `display: none`, so it is out of the
 * accessibility tree and the tab order, and a screen reader meets a table or a
 * list, never both. (A table forced to `display: block` loses its table
 * semantics, which is why it is not one layout.)
 */
export function SnapshotList({
  datasets,
  onDetails,
  onSelect,
  emptyAction,
}: {
  datasets: Dataset[];
  /** Details: open the sheet for this snapshot. */
  onDetails: (dataset: Dataset) => void;
  /** Select: start a draft from this snapshot. */
  onSelect: (dataset: Dataset) => void;
  /** Under "No model snapshots found": a way out, such as Reset. */
  emptyAction?: ReactNode;
}) {
  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border bg-card px-4 py-16 text-center">
        <SearchX aria-hidden="true" className="mb-3 size-10 text-muted-foreground/40" />
        <h3 className="text-base font-semibold text-foreground">No model snapshots found</h3>
        <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filters</p>
        {emptyAction && <div className="mt-3">{emptyAction}</div>}
      </div>
    );
  }

  const detailsLabel = (dataset: Dataset) => `Details: ${dataset.about.name}`;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="hidden sm:block">
        <Table aria-label="Model snapshots" className="table-fixed">
          <TableHeader>
            <TableRow className="bg-muted/40 text-xs text-muted-foreground hover:bg-muted/40">
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Name</TableHead>
              <TableHead className="w-24 text-xs font-semibold text-muted-foreground lg:w-28">
                Coverage
              </TableHead>
              <TableHead className="w-24 text-xs font-semibold text-muted-foreground lg:w-28">
                Resolution
              </TableHead>
              <TableHead className="w-52 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datasets.map((dataset) => (
              <TableRow key={dataset.id}>
                <TableCell className="px-4 py-3 whitespace-normal">
                  <div
                    title={dataset.about.name}
                    className="line-clamp-2 font-medium break-words text-foreground"
                  >
                    {dataset.about.name}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <TagChips tags={dataset.about.tags} size="sm" className="shrink-0" />
                    <MetaLine dataset={dataset} />
                  </div>
                </TableCell>
                <TableCell className="px-2 text-muted-foreground">
                  {years(dataset.simulation.temporalCoverage)}
                </TableCell>
                <TableCell className="px-2 text-muted-foreground">
                  {resolutionText(dataset.simulation.resolution)}
                </TableCell>
                <TableCell className="py-2 pr-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={detailsLabel(dataset)}
                      onClick={() => onDetails(dataset)}
                      className="text-muted-foreground"
                    >
                      Details
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => onSelect(dataset)}
                      className="font-semibold"
                    >
                      <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
                      Select
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul aria-label="Model snapshots" role="list" className="divide-y sm:hidden">
        {datasets.map((dataset) => (
          <li key={dataset.id} className="px-4 py-3.5">
            <p
              title={dataset.about.name}
              className="line-clamp-2 font-medium break-words text-foreground"
            >
              {dataset.about.name}
            </p>
            <TagChips tags={dataset.about.tags} size="sm" className="mt-1.5" />
            <p className="mt-1.5 text-sm text-muted-foreground">
              {years(dataset.simulation.temporalCoverage)}
              <span aria-hidden="true" className="mx-2">
                ·
              </span>
              {resolutionText(dataset.simulation.resolution)}
            </p>
            <p className="mt-0.5">
              <MetaLine dataset={dataset} />
            </p>
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <Button
                variant="outline"
                aria-label={detailsLabel(dataset)}
                onClick={() => onDetails(dataset)}
                className="h-10 px-4"
              >
                Details
              </Button>
              <Button onClick={() => onSelect(dataset)} className="h-10 w-full font-semibold">
                <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
                Select
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
