import Link from "next/link";
import { TableHead, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/admin-states";
import { StackedBody, StackedCell, StackedHeader, StackedRow, StackedTable } from "@/components/admin/stacked-table";
import { StatePill, WorkshopStatusPill } from "@/components/admin/community/form-bits";
import { TimeStamp } from "@/components/common/time-stamp";
import type { Workshop } from "@/lib/community/types";

/** A workshop's dates as the list prints them: the first day, and the last when there is one. */
function DateRange({ workshop }: { workshop: Workshop }) {
  return (
    <span className="whitespace-nowrap">
      <TimeStamp value={workshop.date} format="date" />
      {workshop.end_date && workshop.end_date !== workshop.date && (
        <>
          {" – "}
          <TimeStamp value={workshop.end_date} format="date" />
        </>
      )}
    </span>
  );
}

/** Every workshop, newest first as the backend sends them, each a link to its editor. */
export function WorkshopList({ workshops }: { workshops: Workshop[] }) {
  if (workshops.length === 0) {
    return (
      <EmptyState title="No workshops yet.">
        Add the first one with New workshop. It stays a draft, off the site, until you publish it.
      </EmptyState>
    );
  }
  return (
    <StackedTable>
      <StackedHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>When</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </StackedHeader>
      <StackedBody>
        {workshops.map((w) => (
          <StackedRow key={w.id}>
            <StackedCell className="min-w-0">
              <Link
                href={`/admin/community/workshops/${encodeURIComponent(w.id)}`}
                className="font-medium text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {w.title}
              </Link>
              <p className="font-mono text-xs break-all text-muted-foreground">/{w.slug}</p>
            </StackedCell>
            <StackedCell label="Date" className="text-sm">
              <DateRange workshop={w} />
            </StackedCell>
            <StackedCell label="When">
              <WorkshopStatusPill status={w.status} />
            </StackedCell>
            <StackedCell label="State">
              <StatePill state={w.state} />
            </StackedCell>
            <StackedCell label="Updated" className="text-xs text-muted-foreground">
              <TimeStamp value={w.updated_at} format="relative" />
            </StackedCell>
          </StackedRow>
        ))}
      </StackedBody>
    </StackedTable>
  );
}
