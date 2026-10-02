"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { revealsDraftField } from "@/components/workspace/draft-field";
import type { DraftField } from "@/lib/workspace/draft-wizard";

/**
 * The one surface a draft step is written on: a single bordered card whose
 * parts are separated by rules, not by more cards. Parts are `DraftSection`s.
 */
export function DraftPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "divide-y overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        className
      )}
    >
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
    <section className={cn("space-y-4 px-5 py-5 sm:px-7 sm:py-6", className)}>
      {(title || action) && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          {title && <h3 className="text-base font-semibold text-foreground">{title}</h3>}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A part of a step that most people leave as it is: its heading, a line that
 * says what it holds now (`summary`), anything that must stay in view
 * (`notes`: warnings and errors), and a button that opens the controls
 * (`children`), which are not rendered until then.
 *
 * `forceOpen` keeps the controls open, and takes the button away, for a state
 * that cannot be seen to from the summary (a value that is refused). The
 * button carries `revealsDraftField(field)`, so an Edit or Fix link that wants
 * a control inside opens the part first (`focusDraftField`).
 */
export function DraftCollapsible({
  title,
  summary,
  notes,
  fields,
  openLabel,
  closeLabel = "Done",
  forceOpen = false,
  children,
}: {
  title: string;
  summary: ReactNode;
  notes?: ReactNode;
  /** The fields whose controls are inside, for an Edit link to find. */
  fields: readonly DraftField[];
  /** The button while closed: "Choose…", "Change". */
  openLabel: string;
  closeLabel?: string;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;

  return (
    <DraftSection
      title={title}
      action={
        forceOpen ? undefined : (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={
              expanded
                ? `${closeLabel} with ${title.toLowerCase()}`
                : `${openLabel.replace("…", "")} ${title.toLowerCase()}`
            }
            onClick={() => setOpen((v) => !v)}
            {...revealsDraftField(...fields)}
            className="inline-flex min-h-10 items-center rounded-md border bg-background px-3.5 text-sm font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
          >
            {expanded ? closeLabel : openLabel}
          </button>
        )
      }
      className="space-y-3"
    >
      <div aria-live="polite" className="text-sm text-foreground">
        {summary}
      </div>
      {notes}
      {expanded && (
        <div id={panelId} className="space-y-4 pt-2">
          {children}
        </div>
      )}
    </DraftSection>
  );
}
