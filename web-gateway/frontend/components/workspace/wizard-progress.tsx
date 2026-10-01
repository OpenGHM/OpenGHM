import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { WIZARD_STEPS, STEP_LABELS, type WizardStep } from "@/lib/workspace/wizard-types";

const STEP_TITLES: Record<WizardStep, { title: string; subtitle: string }> = {
  snapshot: {
    title: "Select a Base Model Snapshot",
    subtitle: "Choose a published model snapshot to use as the basis for your simulation",
  },
  "model-input": {
    title: "Model Input",
    subtitle: "Runs use the base model snapshot's own model input",
  },
  parameters: {
    title: "Parameters",
    subtitle: "Run period, output variables, cores and walltime",
  },
  review: {
    title: "Review & Submit",
    subtitle: "Save it as a draft, or submit it to run on Anvil",
  },
};

export function WizardProgress({ step }: { step: WizardStep }) {
  const index = WIZARD_STEPS.indexOf(step);
  const { title, subtitle } = STEP_TITLES[step];

  return (
    <div className="bg-gradient-to-br from-hero to-primary px-10 py-12">
      <div className="mx-auto max-w-[1024px]">
        {/* Breadcrumb */}
        <nav className="mb-4 flex items-center gap-1.5 text-xs text-white/60">
          <Link href="/workspace" className="hover:text-white/90 transition-colors">
            My Simulations
          </Link>
          <ChevronRight className="size-3" />
          <span className="text-white/90">New Simulation</span>
        </nav>

        <div className="mb-6">
          <p className="mb-1 text-sm font-medium text-white/60 uppercase tracking-wider">
            Step {index + 1} of {WIZARD_STEPS.length}
          </p>
          <h1 className="text-3xl font-bold text-white">{title}</h1>
          <p className="mt-2 text-sm text-white/70">{subtitle}</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {WIZARD_STEPS.map((s, i) => {
            const isDone = i < index;
            const isCurrent = i === index;
            return (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isCurrent
                      ? "bg-white text-primary"
                      : isDone
                        ? "bg-white/30 text-white"
                        : "bg-white/10 text-white/50"
                  }`}
                >
                  {isDone ? <Check className="size-3.5" /> : i + 1}
                </div>
                <span
                  className={`hidden text-xs font-medium sm:inline ${
                    isCurrent ? "text-white" : "text-white/50"
                  }`}
                >
                  {STEP_LABELS[s]}
                </span>
                {i < WIZARD_STEPS.length - 1 && (
                  <div className="mx-1 h-px w-6 bg-white/20 sm:w-10" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
