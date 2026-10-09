"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STEP_TITLE, StepHeaderCard } from "@/components/workspace/draft-step-heading";
import { SnapshotPicker } from "@/components/workspace/snapshot-picker";
import { WizardHelpButton } from "@/components/workspace/wizard-help-panel";
import { EMPTY_CATALOGUE } from "@/lib/repository/catalogue";
import type { CatalogueFilterState, CatalogueResponse, Dataset } from "@/lib/repository/types";
import { newStepHref } from "@/lib/workspace/draft-wizard";

/** What the server read for the picker: the URL's filters, the answer to them
 *  (`null` when it could not be read), and which model inputs exist. */
export interface PickerSeed {
  filters: CatalogueFilterState;
  data: CatalogueResponse | null;
  modelInputIds: Set<string> | null;
}

/**
 * Step 1 of the draft wizard (ADR 0028): choose a model snapshot. A grid of the
 * repository's snapshots under the repository's search and filters
 * (`SnapshotPicker`); choosing one opens Run settings for a new snapshot draft
 * (`/workspace/new/<snapshot id>?step=run`). Nothing is created or saved by
 * choosing: the snapshot draft exists only in the browser until "Save as draft" or
 * Submit. There is no other way in: copying a snapshot draft is done from its own
 * page ("Duplicate", or "Try again with these settings"), where the snapshot draft
 * is, not from here.
 */
export function StartFrom({ usedIds, picker }: { usedIds: readonly string[]; picker: PickerSeed }) {
  const router = useRouter();
  const used = useMemo(() => new Set(usedIds), [usedIds]);
  // Pending until the next page has rendered (it reads the snapshot's defaults
  // first), so a second click cannot start a second navigation.
  const [pending, startTransition] = useTransition();
  // The snapshot asked for last, for its card to say it is opening.
  const [attempt, setAttempt] = useState<string | null>(null);

  const startFromSnapshot = (dataset: Dataset) => {
    if (pending) return;
    setAttempt(dataset.id);
    startTransition(() => router.push(newStepHref(dataset.id, "run")));
  };

  return (
    <div className="space-y-5">
      <StepHeaderCard>
        <div className="flex items-center justify-between gap-3">
          <h2 className={STEP_TITLE}>Choose a model snapshot</h2>
          <WizardHelpButton />
        </div>
        <p className="text-sm text-muted-foreground">
          Your snapshot draft starts from it. You can change its settings next.
        </p>
      </StepHeaderCard>

      <SnapshotPicker
        initialFilters={picker.filters}
        initialData={picker.data ?? EMPTY_CATALOGUE}
        initialError={picker.data === null}
        initialModelInputIds={picker.modelInputIds}
        usedIds={used}
        onSelect={startFromSnapshot}
        pendingId={pending ? attempt : null}
        disabled={pending}
      />
    </div>
  );
}
