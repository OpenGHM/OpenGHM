import type { ReactNode } from "react";

/**
 * The white card above a Workspace list: the filter on the left, the search
 * box (and the list's sort) on the right. The first card of its page, so it is
 * the one that overlaps the navy band.
 */
export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] bg-card p-2.5 shadow-raised lg:flex-row lg:items-center lg:justify-between">
      {children}
    </div>
  );
}
