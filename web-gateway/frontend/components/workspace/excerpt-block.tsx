"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/workspace/copy-button";

/**
 * A log excerpt: collapsed until asked for, monospace, scrolling inside a
 * fixed height so a long one does not push the page, with a Copy button.
 */
export function ExcerptBlock({
  excerpt,
  label = "Log excerpt",
}: {
  excerpt: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={regionId}
          className="-ml-1 flex min-h-10 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
          {label}
        </button>
        <CopyButton text={excerpt} label={label.toLowerCase()} />
      </div>
      {open && (
        <pre
          id={regionId}
          tabIndex={0}
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {excerpt}
        </pre>
      )}
    </div>
  );
}
