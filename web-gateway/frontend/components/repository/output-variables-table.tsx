"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface Variable {
  name: string;
  unitText: string;
  standardName?: string | null;
}

const INITIAL_ROWS = 5;

export function OutputVariablesTable({ variables }: { variables: Variable[] }) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? variables : variables.slice(0, INITIAL_ROWS);
  const hasMore = variables.length > INITIAL_ROWS;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="rounded-l-lg bg-emerald-50 px-3 py-2.5 font-semibold text-emerald-800">Name</th>
              <th className="bg-emerald-50 px-3 py-2.5 font-semibold text-emerald-800">Unit</th>
              <th className="rounded-r-lg bg-emerald-50 px-3 py-2.5 font-semibold text-emerald-800">Standard Name</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => (
              <tr key={v.name} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2.5 font-medium text-foreground">{v.name}</td>
                <td className="px-3 py-2.5">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                    {v.unitText}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                  {v.standardName || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
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
