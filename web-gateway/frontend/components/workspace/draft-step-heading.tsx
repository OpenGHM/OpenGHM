import { STEP_LABELS, type DraftStep } from "@/lib/workspace/draft-wizard";

/** The id of a step's `<h2>`, which the wizard moves focus to on a step change. */
export const stepHeadingId = (step: DraftStep) => `draft-step-${step}-heading`;

/**
 * A step's title and one line saying what it is for. The `<h2>` is focusable
 * (`tabIndex={-1}`) so that the wizard can send focus here when the step
 * changes, and a screen reader starts at the new step instead of at the top.
 */
export function DraftStepHeading({ step, children }: { step: DraftStep; children: React.ReactNode }) {
  return (
    <header className="space-y-1">
      <h2
        id={stepHeadingId(step)}
        tabIndex={-1}
        className="text-xl font-semibold text-foreground outline-none"
      >
        {STEP_LABELS[step]}
      </h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </header>
  );
}
