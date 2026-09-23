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
import {
  type WizardStep,
  type ModelInputChoice,
  defaultParametersFor,
  defaultSlurmConfigFor,
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
 * Review step's Submit button — everything before it is local state over
 * the real catalogue (`fetchModelInputs`), staged so the user can move
 * back and forth without creating a draft on every click.
 *
 * Step 1 (choosing the base snapshot) is no longer part of this component —
 * it is the picker route (`/workspace/new/pick`), which is the repository's
 * own search rather than a second one. `snapshot` arrives already chosen,
 * from `/workspace/new/configure`'s server-side fetch.
 */
export function NewSimulationWizard({
  snapshot,
}: {
  snapshot: Dataset;
}) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("model-input");
  const [modelInputChoice, setModelInputChoice] = useState<ModelInputChoice>({ mode: "inherit" });
  const [parameters, setParameters] = useState<JobParameters>(() => defaultParametersFor(snapshot));
  const [slurmConfig, setSlurmConfig] = useState<SlurmConfig>(() => defaultSlurmConfigFor(snapshot));

  const stepIndex = OWNED_STEPS.indexOf(step);

  const canGoNext =
    step === "model-input" ||
    (step === "parameters" &&
      parameters.temporal_range_start <= parameters.temporal_range_end &&
      parameters.variables.length > 0);

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
            parameters={parameters}
            slurmConfig={slurmConfig}
          />
        )}

        {/* Back / Next — the Review step has its own Submit button instead.
            Back is never disabled: from the first step here it leaves for
            the picker instead of stopping. */}
        {step !== "review" && (
          <div className="mx-auto flex max-w-[1024px] items-center justify-between px-10 pb-10">
            <Button variant="ghost" onClick={goBack}>
              <ArrowLeft className="mr-1.5 size-4" />
              Back
            </Button>
            <Button
              onClick={goNext}
              disabled={!canGoNext}
              className="bg-[#006994] hover:bg-[#005a7a] font-semibold"
            >
              Next
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
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
