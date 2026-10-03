"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { SnapshotPicker } from "@/components/workspace/snapshot-picker";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";
import { EMPTY_CATALOGUE } from "@/lib/repository/catalogue";
import type { CatalogueFilterState, CatalogueResponse, Dataset } from "@/lib/repository/types";

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
 * (`SnapshotPicker`); choosing one creates the draft at once and opens its Run
 * settings. There is no other way in: copying a simulation is done from its own
 * page ("Duplicate", or "Try again with these settings"), where the simulation
 * is, not from here.
 */
export function StartFrom({ usedIds, picker }: { usedIds: readonly string[]; picker: PickerSeed }) {
  const { pending, error, deriveFrom } = useCreateDraft();
  const used = useMemo(() => new Set(usedIds), [usedIds]);
  // The snapshot whose draft was asked for last, for the card to say it is being made.
  const [attempt, setAttempt] = useState<string | null>(null);

  const startFromSnapshot = (dataset: Dataset) => {
    if (pending) return;
    setAttempt(dataset.id);
    void deriveFrom(dataset.id);
  };

  return (
    <div className="space-y-6">
      {error?.kind === "session-expired" && <SessionExpiredBanner />}
      {error?.kind === "error" && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="font-medium">{error.message}</p>
        </div>
      )}

      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-foreground">Choose a model snapshot</h2>
        <p className="text-sm text-muted-foreground">
          Your simulation starts from it. You can change its settings next.
        </p>
      </header>

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
