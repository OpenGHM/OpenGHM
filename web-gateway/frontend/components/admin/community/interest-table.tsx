import { TableHead, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/admin-states";
import { StackedBody, StackedCell, StackedHeader, StackedRow, StackedTable } from "@/components/admin/stacked-table";
import { CopyButton } from "@/components/workspace/copy-button";
import { TimeStamp } from "@/components/common/time-stamp";
import type { GroupInterest } from "@/lib/community/types";

/** The addresses as one comma-separated line, which a mail client's To or Bcc field takes. */
export function emailList(entries: GroupInterest[]): string {
  return entries.map((e) => e.email).join(", ");
}

/**
 * The signed-in users who asked to be told when Discussion groups open, newest
 * first, with one button that copies every address.
 */
export function InterestTable({ entries }: { entries: GroupInterest[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState title="Nobody has asked yet.">
        People who press “Tell me when groups open” on the Community page appear here, with their email address.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{entries.length === 1 ? "1 person" : `${entries.length} people`}</p>
        <CopyButton text={emailList(entries)} label="all email addresses" />
      </div>
      <StackedTable>
        <StackedHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Asked on</TableHead>
          </TableRow>
        </StackedHeader>
        <StackedBody>
          {entries.map((entry) => (
            <StackedRow key={entry.user_id}>
              <StackedCell className="text-sm break-all">{entry.email}</StackedCell>
              <StackedCell label="Asked on" className="text-xs text-muted-foreground">
                <TimeStamp value={entry.created_at} format="datetime" />
              </StackedCell>
            </StackedRow>
          ))}
        </StackedBody>
      </StackedTable>
    </div>
  );
}
