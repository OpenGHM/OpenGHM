import type { ReactNode } from "react";
import { WizardHelpButton } from "@/components/workspace/wizard-help-panel";
import { STEP_LABELS, type DraftStep } from "@/lib/workspace/draft-wizard";

/** The id of a step's `<h2>`, which the wizard moves focus to on a step change. */
export const stepHeadingId = (step: DraftStep) => `draft-step-${step}-heading`;

/** The title of a step: 20 px, the weight of a section title in the design. */
export const STEP_TITLE = "text-xl font-[650] tracking-[-0.02em] text-foreground outline-none";

/**
 * The white card a step opens with, the one that overlaps the navy band: its
 * title (`children`'s first part) and the line under it. Both the Start screen
 * and the two steps after it use it, so the three read as one wizard.
 */
export function StepHeaderCard({ children }: { children: ReactNode }) {
  return <header className="space-y-1.5 rounded-card bg-card px-6 py-5 shadow-raised sm:px-7">{children}</header>;
}

/**
 * A step's title and one line saying what it is for, in `StepHeaderCard`. The
 * `<h2>` is focusable (`tabIndex={-1}`) so that the wizard can send focus here
 * when the step changes, and a screen reader starts at the new step instead of
 * at the top. Below `xl` the Help button (`WizardHelpButton`) sits at the end of
 * the title's row; inside a wizard layout only.
 */
export function DraftStepHeading({ step, children }: { step: DraftStep; children: ReactNode }) {
  return (
    <StepHeaderCard>
      <div className="flex items-center justify-between gap-3">
        <h2 id={stepHeadingId(step)} tabIndex={-1} className={STEP_TITLE}>
          {STEP_LABELS[step]}
        </h2>
        <WizardHelpButton />
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </StepHeaderCard>
  );
}
