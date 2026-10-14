"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Variable {
  name: string;
  fullName: string;
  unit: string;
}

const INITIAL_ROWS = 5;

// The design's swatch colours, taken in turn by row: a swatch tells the rows
// apart at a glance, it does not say what the variable is.
export const SWATCHES = [1, 8, 7, 2, 3, 6, 4, 5].map((n) => `var(--data-${n})`);

export function OutputVariablesTable({ variables }: { variables: Variable[] }) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? variables : variables.slice(0, INITIAL_ROWS);
  const hasMore = variables.length > INITIAL_ROWS;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[14px] border border-border/70">
        <Table className="min-w-[480px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead aria-hidden="true" className="w-7 pr-0" />
              <TableHead>Name</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Full Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((v, i) => (
              <TableRow key={v.name}>
                <TableCell className="pr-0">
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: SWATCHES[i % SWATCHES.length] }}
                    className="block size-3 rounded-[4px]"
                  />
                </TableCell>
                <TableCell className="py-3 font-mono text-[13px] font-medium">{v.name}</TableCell>
                <TableCell className="font-mono text-[13px] text-foreground/75">{v.unit}</TableCell>
                <TableCell className="whitespace-normal text-foreground/90">{v.fullName}</TableCell>
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
              Show {variables.length - INITIAL_ROWS} more
            </>
          )}
        </button>
      )}
    </div>
  );
}
