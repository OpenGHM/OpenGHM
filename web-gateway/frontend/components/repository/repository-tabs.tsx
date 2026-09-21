"use client";

import { useState } from "react";
import { RepositoryClient } from "./repository-client";
import { ModelInputsClient } from "./model-inputs-client";
import { RepositoryListResponse, ModelInputListResponse } from "@/lib/repository/types";

type Tab = "snapshots" | "model-inputs";

const TABS: { value: Tab; label: string }[] = [
  { value: "snapshots", label: "Snapshots" },
  { value: "model-inputs", label: "Model Inputs" },
];

/**
 * Sibling tabs over the two published-artifact catalogues (ADR 0015,
 * spec.md Decision 2): a snapshot and a model input are both published,
 * immutable, citable artifacts under the Data Repository, so they share
 * this page rather than living in separate top-level sections.
 */
export function RepositoryTabs({
  initialDatasets,
  initialModelInputs,
}: {
  initialDatasets: RepositoryListResponse;
  initialModelInputs: ModelInputListResponse;
}) {
  const [tab, setTab] = useState<Tab>("snapshots");

  return (
    <>
      <div className="mx-auto max-w-[1280px] px-10 pt-8">
        <div
          role="tablist"
          aria-label="Data Repository catalogue"
          className="inline-flex rounded-lg border bg-muted/50 p-1"
        >
          {TABS.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.value
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "snapshots" ? (
        <RepositoryClient initialData={initialDatasets} />
      ) : (
        <ModelInputsClient initialData={initialModelInputs} />
      )}
    </>
  );
}
