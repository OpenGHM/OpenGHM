import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one surface a draft step is written on: a single bordered card whose
 * parts are separated by rules, not by more cards. Parts are `DraftSection`s.
 */
export function DraftPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y overflow-hidden rounded-xl border bg-card text-card-foreground", className)}>
      {children}
    </div>
  );
}

/**
 * A part of a step: a plain heading, an optional action at its end, and the
 * body. The heading is `h3` under the step's `h2`.
 */
export function DraftSection({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-4 px-5 py-5 sm:px-6", className)}>
      {(title || action) && (
        <div className="flex min-h-6 items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
