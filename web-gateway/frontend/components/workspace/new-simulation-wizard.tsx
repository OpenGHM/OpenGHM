"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardProgress } from "@/components/workspace/wizard-progress";
import { WizardSnapshotStep } from "@/components/workspace/wizard-snapshot-step";
import { WizardModelInputStep } from "@/components/workspace/wizard-model-input-step";
import { WizardParametersStep } from "@/components/workspace/wizard-parameters-step";
import { WizardReviewStep } from "@/components/workspace/wizard-review-step";
import type { RepositoryListResponse, Dataset } from "@/lib/repository/types";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";
import {
  WIZARD_STEPS,
  type WizardStep,
  type ModelInputChoice,
  defaultParametersFor,
  defaultSlurmConfigFor,
} from "@/lib/workspace/wizard-types";

/**
 * The whole `/workspace/new` flow, as one route: nothing here is real until
 * the Review step's Submit button — everything before it is local state
 * over the real catalogue (`fetchSnapshots`, `fetchModelInputs`), staged so
 * the user can move back and forth without creating a draft on every click.
 */
export function NewSimulationWizard({
  initialSnapshots,
}: {
  initialSnapshots: RepositoryListResponse;
}) {
  const [step, setStep] = useState<WizardStep>("snapshot");
  const [snapshot, setSnapshot] = useState<Dataset | null>(null);
  const [modelInputChoice, setModelInputChoice] = useState<ModelInputChoice>({ mode: "inherit" });
  const [parameters, setParameters] = useState<JobParameters | null>(null);
  const [slurmConfig, setSlurmConfig] = useState<SlurmConfig | null>(null);

  const stepIndex = WIZARD_STEPS.indexOf(step);

  const handleSelectSnapshot = (ds: Dataset) => {
    setSnapshot(ds);
    // Re-derive defaults whenever the base snapshot changes — a different
    // snapshot means a different real temporal range, variable list and
    // recommended compute, and any earlier model-input override no longer
    // applies to it.
    setParameters(defaultParametersFor(ds));
    setSlurmConfig(defaultSlurmConfigFor(ds));
    setModelInputChoice({ mode: "inherit" });
  };

  const canGoNext =
    (step === "snapshot" && snapshot !== null) ||
    step === "model-input" ||
    (step === "parameters" &&
      parameters !== null &&
      parameters.temporal_range_start <= parameters.temporal_range_end &&
      parameters.variables.length > 0);

  const goNext = () => {
    const next = WIZARD_STEPS[stepIndex + 1];
    if (next) setStep(next);
  };
  const goBack = () => {
    const prev = WIZARD_STEPS[stepIndex - 1];
    if (prev) setStep(prev);
  };

  return (
    <>
      <WizardProgress step={step} />

      <div className="bg-slate-50">
        {step === "snapshot" && (
          <WizardSnapshotStep
            initialData={initialSnapshots}
            selectedId={snapshot?.id ?? null}
            onSelect={handleSelectSnapshot}
          />
        )}

        {step === "model-input" && snapshot && (
          <WizardModelInputStep
            snapshot={snapshot}
            choice={modelInputChoice}
            onChoiceChange={setModelInputChoice}
          />
        )}

        {step === "parameters" && snapshot && parameters && slurmConfig && (
          <WizardParametersStep
            snapshot={snapshot}
            parameters={parameters}
            slurmConfig={slurmConfig}
            onParametersChange={setParameters}
            onSlurmConfigChange={setSlurmConfig}
          />
        )}

        {step === "review" && snapshot && parameters && slurmConfig && (
          <WizardReviewStep
            snapshot={snapshot}
            modelInputChoice={modelInputChoice}
            parameters={parameters}
            slurmConfig={slurmConfig}
          />
        )}

        {/* Back / Next — the Review step has its own Submit button instead. */}
        {step !== "review" && (
          <div className="mx-auto flex max-w-[1024px] items-center justify-between px-10 pb-10">
            <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0}>
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
