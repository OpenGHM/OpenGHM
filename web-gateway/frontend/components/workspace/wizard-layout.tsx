"use client";

import type { ReactNode } from "react";
import { WizardHelpPanel } from "@/components/workspace/wizard-help-panel";
import { WizardHelpProvider } from "@/components/workspace/wizard-help-context";
import { AsideLayout } from "@/components/workspace/aside-layout";
import type { HelpFacts, HelpStep } from "@/lib/workspace/wizard-help";

/**
 * The body of a draft wizard screen: the step's content and, from `xl` up, the
 * help panel in a column beside it (`AsideLayout`, which the job page uses too).
 * Below `xl` there is no column and nothing moves: `WizardHelpButton`, in the
 * step's heading, opens the same help in a sheet.
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
      <AsideLayout aside={<WizardHelpPanel />} label="Help" below="hidden" className={className}>
        {children}
      </AsideLayout>
    </WizardHelpProvider>
  );
}
