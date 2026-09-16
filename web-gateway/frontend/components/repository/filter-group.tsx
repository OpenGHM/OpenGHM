"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

export function FilterGroup({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border pb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
      >
        {title}
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}
