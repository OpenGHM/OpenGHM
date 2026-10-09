import { WizardHelpButton } from "@/components/workspace/wizard-help-panel";
import { STEP_LABELS, type DraftStep } from "@/lib/workspace/draft-wizard";

/** The id of a step's `<h2>`, which the wizard moves focus to on a step change. */
export const stepHeadingId = (step: DraftStep) => `draft-step-${step}-heading`;

/**
 * A step's title and one line saying what it is for. The `<h2>` is focusable
 * (`tabIndex={-1}`) so that the wizard can send focus here when the step
 * changes, and a screen reader starts at the new step instead of at the top.
 * Below `xl` the Help button (`WizardHelpButton`) sits at the end of the title's
 * row; inside a wizard layout only.
 */
export function DraftStepHeading({ step, children }: { step: DraftStep; children: React.ReactNode }) {
  return (
    <header className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <h2
          id={stepHeadingId(step)}
          tabIndex={-1}
          className="text-xl font-semibold text-foreground outline-none"
        >
          {STEP_LABELS[step]}
        </h2>
        <WizardHelpButton />
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </header>
  );
}
