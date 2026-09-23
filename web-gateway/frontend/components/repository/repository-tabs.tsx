"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RepositoryClient } from "./repository-client";
import { ModelInputsClient } from "./model-inputs-client";
import {
  RepositoryListResponse,
  ModelInputListResponse,
  FilterState,
  ModelInputFilterState,
} from "@/lib/repository/types";

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
 *
 * `tab` lives in the URL too (`?tab=model-inputs`), same reasoning as the
 * filters each sub-client syncs (open item 16) — but a tab switch replaces
 * the history entry rather than pushing one, since it isn't a "search" a
 * back button should step back through.
 */
export function RepositoryTabs({
  initialTab,
  initialDatasetFilters,
  initialModelInputFilters,
  initialDatasets,
  initialModelInputs,
}: {
  initialTab: Tab;
  initialDatasetFilters: FilterState;
  initialModelInputFilters: ModelInputFilterState;
  initialDatasets: RepositoryListResponse;
  initialModelInputs: ModelInputListResponse;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "model-inputs" ? "model-inputs" : initialTab;

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "snapshots") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

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
        <RepositoryClient initialFilters={initialDatasetFilters} initialData={initialDatasets} />
      ) : (
        <ModelInputsClient initialFilters={initialModelInputFilters} initialData={initialModelInputs} />
      )}
    </>
  );
}
