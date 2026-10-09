import type { ReactNode } from "react";

/**
 * The white bar above a Workspace list: the filter on the left, the search box
 * on the right. The first card of its page, so it is the one that overlaps the
 * navy band.
 */
export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] bg-card p-2.5 shadow-raised sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  );
}
