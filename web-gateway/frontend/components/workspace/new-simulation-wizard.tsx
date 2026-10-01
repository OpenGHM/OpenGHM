"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardProgress } from "@/components/workspace/wizard-progress";
import { WizardModelInputStep } from "@/components/workspace/wizard-model-input-step";
import { WizardParametersStep } from "@/components/workspace/wizard-parameters-step";
import { WizardReviewStep } from "@/components/workspace/wizard-review-step";
import type { Dataset } from "@/lib/repository/types";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";
import { validateSlurmConfig } from "@/lib/jobs/compute";
import { checkRunStartFor, runStartBlockedReason } from "@/lib/jobs/run-start";
import { useInheritedModelInput } from "@/lib/workspace/use-inherited-model-input";
import {
  type WizardStep,
  type ModelInputChoice,
  defaultParametersFor,
  defaultSlurmConfigFor,
  recommendedComputeFor,
} from "@/lib/workspace/wizard-types";

// This component only ever owns steps 2–4 — "snapshot" (step 1) is the
// picker route, not a state this component's `step` can be in. Indexing
// against the full `WIZARD_STEPS` (which still has 4 entries, for
// `WizardProgress`'s "step N of 4" display) would let `goBack` land on
// "snapshot" with nothing to render for it — exactly the bug this local
// order avoids: "model-input" has nothing before it in this list.
const OWNED_STEPS: WizardStep[] = ["model-input", "parameters", "review"];

/**
 * Steps 2–4 of the new-simulation flow: nothing here is real until the
 * Review step's "Save as draft" or "Submit" — everything before it is local
 * state over the real catalogue (`fetchModelInputs`), staged so the user can
 * move back and forth without creating a draft on every click.
 *
 * Step 1 (choosing the base snapshot) is no longer part of this component —
 * it is the picker route (`/workspace/new/pick`), which is the repository's
 * own search rather than a second one. `snapshot` arrives already chosen,
 * from `/workspace/new/configure`'s server-side fetch.
 */
export function NewSimulationWizard({
  snapshot,
  submitBlockedReason,
}: {
  snapshot: Dataset;
  /** Why this user cannot submit (ADR 0024), or null. Saving a draft stays open. */
  submitBlockedReason: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("model-input");
  const [modelInputChoice, setModelInputChoice] = useState<ModelInputChoice>({ mode: "inherit" });
  const [parameters, setParameters] = useState<JobParameters>(() => defaultParametersFor(snapshot));
  const [slurmConfig, setSlurmConfig] = useState<SlurmConfig>(() => defaultSlurmConfigFor());
  // Looked up here, not in step 2, so the review step knows what step 2 found.
  const inheritedModelInput = useInheritedModelInput(snapshot.uses.modelInput.id);

  const stepIndex = OWNED_STEPS.indexOf(step);

  // Why Next is off for the start date; the field says the rest.
  const startBlocked =
    step === "parameters"
      ? runStartBlockedReason(checkRunStartFor(snapshot, parameters.temporal_range_start))
      : null;

  const canGoNext =
    step === "model-input" ||
    (step === "parameters" &&
      startBlocked === null &&
      parameters.temporal_range_start <= parameters.temporal_range_end &&
      parameters.variables.length > 0 &&
      Object.keys(validateSlurmConfig(slurmConfig)).length === 0);

  const goNext = () => {
    const next = OWNED_STEPS[stepIndex + 1];
    if (next) setStep(next);
  };
  const goBack = () => {
    const prev = OWNED_STEPS[stepIndex - 1];
    if (prev) {
      setStep(prev);
    } else {
      // Nothing before "model-input" in this component — leaving it means
      // leaving the wizard for the picker, where the base snapshot itself
      // is chosen.
      router.push("/workspace/new/pick");
    }
  };

  return (
    <>
      <WizardProgress step={step} />

      <div className="bg-slate-50">
        {step === "model-input" && (
          <WizardModelInputStep
            snapshot={snapshot}
            choice={modelInputChoice}
            inherited={inheritedModelInput}
            onChoiceChange={setModelInputChoice}
          />
        )}

        {step === "parameters" && (
          <WizardParametersStep
            snapshot={snapshot}
            parameters={parameters}
            slurmConfig={slurmConfig}
            onParametersChange={setParameters}
            onSlurmConfigChange={setSlurmConfig}
          />
        )}

        {step === "review" && (
          <WizardReviewStep
            snapshot={snapshot}
            modelInputChoice={modelInputChoice}
            inheritedModelInput={inheritedModelInput}
            parameters={parameters}
            slurmConfig={slurmConfig}
            recommended={recommendedComputeFor(snapshot)}
            blockedReason={submitBlockedReason}
          />
        )}

        {/* Back / Next — the Review step has its own Save and Submit buttons instead.
            Back is never disabled: from the first step here it leaves for
            the picker instead of stopping. */}
        {step !== "review" && (
          <div className="mx-auto flex max-w-[1024px] flex-wrap items-center justify-between gap-y-2 px-10 pb-10">
            <Button variant="ghost" onClick={goBack}>
              <ArrowLeft className="mr-1.5 size-4" />
              Back
            </Button>
            <div className="flex flex-col items-end gap-1">
              {/* A disabled button gets no hover or focus, so the reason is
                  text beside it and in the title as well. */}
              <Button
                onClick={goNext}
                disabled={!canGoNext}
                title={startBlocked ?? undefined}
                aria-describedby={startBlocked ? "next-blocked-reason" : undefined}
                className="min-h-10 font-semibold sm:min-h-9"
              >
                Next
                <ArrowRight className="ml-1.5 size-4" />
              </Button>
              {startBlocked && (
                <p id="next-blocked-reason" className="max-w-[16rem] text-right text-xs text-muted-foreground">
                  {startBlocked}
                </p>
              )}
            </div>
          </div>
        )}
        {step === "review" && (
          <div className="mx-auto flex max-w-[1024px] items-center px-10 pb-10">
            <Button variant="ghost" onClick={goBack}>
              <ArrowLeft className="mr-1.5 size-4" />
              Back
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
