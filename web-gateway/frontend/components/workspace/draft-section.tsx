"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { revealsDraftField } from "@/components/workspace/draft-field";
import { useSectionHelp } from "@/components/workspace/wizard-help-context";
import type { DraftField } from "@/lib/workspace/draft-wizard";
import type { HelpSection } from "@/lib/workspace/wizard-help";

/** A white card of a draft step: 22 px corners, no border, the rest shadow. */
export const STEP_CARD = "rounded-card bg-card text-card-foreground shadow-card";

/** The label above a field of a step. */
export const FIELD_LABEL = "text-[13px] leading-snug font-semibold text-foreground";

/** What a field of a step adds to `Input`: 46 px tall, 12 px corners, a 1.5 px
 *  edge, and a ring in the brand colour on focus. */
export const FIELD_INPUT =
  "h-[46px] rounded-lg border-[1.5px] px-3.5 md:text-[14.5px] focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/12";

/** The small muted line under a field or a group of fields. */
export const FIELD_HINT = "text-xs text-muted-foreground";

/**
 * What a draft step is written on: a stack of white cards, one per part
 * (`DraftSection`), 16 px apart.
 */
export function DraftPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-4", className)}>{children}</div>;
}

/**
 * A part of a step, as a white card: a plain heading, an optional action at its
 * end, and the body. The heading is `h3` under the step's `h2`.
 *
 * `help` names the part for the wizard's help panel: focus inside the section,
 * or the pointer entering it, makes the panel show that section's help (see
 * `useSectionHelp`). It changes nothing on the section itself.
 */
export function DraftSection({
  title,
  action,
  help,
  className,
  children,
}: {
  title?: string;
  action?: ReactNode;
  help?: HelpSection;
  className?: string;
  children: ReactNode;
}) {
  const helpProps = useSectionHelp(help);
  return (
    <section {...helpProps} className={cn(STEP_CARD, "space-y-4 px-5 py-6 sm:px-[30px] sm:py-[26px]", className)}>
      {(title || action) && (
        <div className="flex min-h-9 items-center justify-between gap-3">
          {title && <h3 className="text-[19px] font-[650] tracking-[-0.02em] text-foreground">{title}</h3>}
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
  help,
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
  /** The part's help in the wizard's help panel (`DraftSection`). */
  help?: HelpSection;
  children: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;

  return (
    <DraftSection
      title={title}
      help={help}
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
            className="inline-flex min-h-10 items-center rounded-[10px] bg-muted px-3.5 text-[13.5px] font-semibold text-foreground outline-none transition-colors hover:bg-secondary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-9"
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
