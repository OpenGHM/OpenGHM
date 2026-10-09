"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ModelInput } from "@/lib/repository/types";

const INITIAL_ROWS = 8;

export function ModelInputDatasetsTable({
  datasets,
}: {
  datasets: ModelInput["datasets"];
}) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? datasets : datasets.slice(0, INITIAL_ROWS);
  const hasMore = datasets.length > INITIAL_ROWS;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[14px] border border-border/70">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Time Series</TableHead>
              <TableHead>Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((d) => (
              <TableRow key={d.code}>
                <TableCell className="py-3 font-mono text-[13px] font-medium">{d.code}</TableCell>
                <TableCell className="whitespace-normal text-foreground/90">{d.name ?? "—"}</TableCell>
                <TableCell className="font-mono text-[13px] text-foreground/75">{d.unit || "—"}</TableCell>
                <TableCell className="text-foreground/90">{d.timeSeries ?? "—"}</TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground" title={d.init}>
                  {d.init}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 self-start rounded-[10px] bg-muted px-3.5 py-[9px] text-[13.5px] font-semibold transition-colors outline-none hover:bg-secondary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-4" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-4" />
              Show {datasets.length - INITIAL_ROWS} more
            </>
          )}
        </button>
      )}
    </div>
  );
}
