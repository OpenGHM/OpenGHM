"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Search, Loader2, Database, Waves, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchModelInputById, fetchModelInputs } from "@/lib/repository/actions";
import { UNSUPPORTED_REASON } from "@/lib/jobs/compute";
import type { Dataset, ModelInput, ModelInputListResponse } from "@/lib/repository/types";
import type { ModelInputChoice } from "@/lib/workspace/wizard-types";

const EMPTY_RESULT: ModelInputListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

function ModelInputMiniCard({
  modelInput,
  selected,
  disabled,
  onSelect,
}: {
  modelInput: ModelInput;
  selected: boolean;
  /** The card is shown for browsing but cannot be chosen (see the step). */
  disabled: boolean;
  onSelect: () => void;
}) {
  const datasetCount = modelInput.datasets.length;
  const networkCount = modelInput.networks?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="block h-full w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Card
        className={`h-full gap-0 py-0 transition-all ${
          selected ? "border-[#006994] ring-2 ring-[#006994]/30" : ""
        } ${disabled ? "" : "hover:-translate-y-0.5 hover:border-[#006994]/40 hover:shadow-md"}`}
      >
        <CardContent className="p-4">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold leading-snug text-foreground">
              {modelInput.about.name}
            </h4>
            <span className="shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">
              {modelInput.about.category}
            </span>
          </div>
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Database className="size-3" />
              {datasetCount} dataset{datasetCount !== 1 ? "s" : ""}
            </span>
            {networkCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Waves className="size-3" />
                {networkCount} network{networkCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
            {modelInput.about.description}
          </p>
          {selected && (
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-[#006994]">
              <CheckCircle2 className="size-3.5" />
              Selected
            </p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

export function WizardModelInputStep({
  snapshot,
  choice,
  onChoiceChange,
}: {
  snapshot: Dataset;
  choice: ModelInputChoice;
  onChoiceChange: (choice: ModelInputChoice) => void;
}) {
  const inheritedId = snapshot.uses.modelInput.id;

  // The base snapshot's own model input, resolved against the catalogue —
  // real lookup, same rule the backend's _resolve_effective_model_input
  // (app/api/v1/jobs.py) applies once a draft exists. `undefined` = still
  // loading, `null` = the catalogue does not hold it (inherited-missing).
  const [inherited, setInherited] = useState<ModelInput | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setInherited(undefined);
    fetchModelInputById(inheritedId)
      .then((mi) => {
        if (!cancelled) setInherited(mi);
      })
      .catch(() => {
        if (!cancelled) setInherited(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inheritedId]);

  // Catalogue browser, for choosing a different model input.
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ModelInputListResponse>(EMPTY_RESULT);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  const doFetch = useCallback((query: string, p: number) => {
    startTransition(async () => {
      try {
        const data = await fetchModelInputs({ searchQuery: query, sortBy: "relevance", page: p });
        setResult(data);
      } catch {
        setResult(EMPTY_RESULT);
      }
    });
  }, []);

  useEffect(() => {
    doFetch("", 1);
    // Fetch once on mount — the browser is opt-in, not shown by default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(searchQuery, page), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, page, doFetch]);

  return (
    <div className="mx-auto max-w-[1024px] px-10 py-8">
      {/* Current resolution */}
      <Card className="mb-6 overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardContent className="space-y-3 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            The base snapshot cites
          </p>

          {choice.mode === "chosen" ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-[#006994]/30 bg-[#006994]/5 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#006994]" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Chosen: {choice.modelInput.about.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Overrides the base snapshot&apos;s own model input.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChoiceChange({ mode: "inherit" })}
              >
                <RotateCcw className="mr-1 size-3.5" />
                Revert to inherit
              </Button>
            </div>
          ) : inherited === undefined ? (
            <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Resolving against the model-inputs catalogue…
            </div>
          ) : inherited ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Inherited: {inherited.about.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Model input{" "}
                  <Link
                    href={`/repository/model-inputs/${inheritedId}`}
                    className="font-mono text-[#006994] hover:underline"
                  >
                    {inheritedId.slice(0, 12)}…
                  </Link>{" "}
                  — found in the catalogue.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Inherited — but not in the catalogue
                </p>
                <p className="text-xs text-muted-foreground">
                  The snapshot cites model input{" "}
                  <code className="font-mono">{inheritedId.slice(0, 12)}…</code>, which the
                  model-inputs catalogue does not hold. This is common, not an error: the run
                  fetches it by id.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Catalogue browser */}
      {/* The toolkit has no option for a model input other than the
          snapshot's own, so a submit refuses an override (ADR 0025). The
          catalogue can still be browsed. */}
      <div className="mb-3 space-y-1">
        <p className="text-sm font-medium text-foreground">Model inputs in the catalogue</p>
        <p id="model-input-override-reason" className="text-xs text-muted-foreground">
          {UNSUPPORTED_REASON.modelInput}
        </p>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search model inputs…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          className="pl-10"
        />
        {isPending && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {result.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No model inputs found{searchQuery ? ` for "${searchQuery}"` : ""}.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {result.items.map((mi) => (
            <ModelInputMiniCard
              key={mi.id}
              modelInput={mi}
              selected={choice.mode === "chosen" && choice.modelInput.id === mi.id}
              disabled
              onSelect={() => onChoiceChange({ mode: "chosen", modelInput: mi })}
            />
          ))}
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {result.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= result.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
