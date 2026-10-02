import { Globe, Lock } from "lucide-react";
import type { Visibility } from "@/lib/repository/types";

const BADGE: Record<Visibility, { label: string; Icon: typeof Globe }> = {
  public: { label: "Public", Icon: Globe },
  private: { label: "Private", Icon: Lock },
};

/**
 * Who may find an artifact: "Public" with a globe, "Private" with a lock.
 * Neutral on purpose: visibility is a fact about the row, not a status to
 * scan for.
 */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const { label, Icon } = BADGE[visibility];
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
      <Icon aria-hidden="true" className="size-3 shrink-0 text-slate-500" />
      {label}
    </span>
  );
}
