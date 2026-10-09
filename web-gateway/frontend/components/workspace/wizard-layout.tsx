"use client";

import type { ReactNode } from "react";
import { WizardHelpPanel } from "@/components/workspace/wizard-help-panel";
import { WizardHelpProvider } from "@/components/workspace/wizard-help-context";
import { WIZARD_CONTAINER } from "@/components/workspace/page-header";
import { cn } from "@/lib/utils";
import type { HelpFacts, HelpStep } from "@/lib/workspace/wizard-help";

/**
 * The body of a draft wizard screen: the step's content and, from `xl` up, the
 * help panel in a column beside it. The content is exactly what it was alone
 * (it takes the rest of the width, up to 1024 px); the panel is 20 rem wide,
 * 2 rem away, `sticky` just under the site header (81 px at `lg` and up, so
 * `top-24` leaves a gap) and scrolls by itself when the viewport is shorter than
 * it. Below `xl` there is no column and nothing moves: `WizardHelpButton`, in
 * the step's heading, opens the same help in a sheet.
 *
 * It brings the `WizardHelpProvider`, which the sections of the steps and the
 * panel talk through, so everything that shows help for `step` goes inside it.
 */
export function WizardLayout({
  step,
  facts,
  className,
  children,
}: {
  step: HelpStep;
  facts: HelpFacts;
  /** The vertical padding of the body. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <WizardHelpProvider step={step} facts={facts}>
      <div className={cn("flex-1", className)}>
        <div className={WIZARD_CONTAINER}>
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-8">
            <div className="min-w-0">{children}</div>
            <aside
              aria-label="Help"
              className="hidden xl:sticky xl:top-24 xl:block xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto"
            >
              <WizardHelpPanel />
            </aside>
          </div>
        </div>
      </div>
    </WizardHelpProvider>
  );
}
