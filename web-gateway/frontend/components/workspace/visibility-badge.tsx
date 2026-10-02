import { Globe, Lock } from "lucide-react";
import type { Visibility } from "@/lib/repository/types";

const BADGE: Record<Visibility, { label: string; Icon: typeof Globe }> = {
  public: { label: "Public", Icon: Globe },
  private: { label: "Private", Icon: Lock },
};

/**
 * Who may find an artifact: "Public" with a globe, "Private" with a lock, as
 * quiet muted text with no box around it. Neutral on purpose: visibility is a
 * fact about the row, not a status to scan for.
 */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const { label, Icon } = BADGE[visibility];
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}
