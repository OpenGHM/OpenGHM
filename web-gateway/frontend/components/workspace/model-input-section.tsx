"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Search, Loader2, Database, Waves, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { fetchModelInputById, fetchModelInputs } from "@/lib/repository/actions";
import { UNSUPPORTED_REASON } from "@/lib/jobs/compute";
import type { ModelInput, ModelInputListResponse } from "@/lib/repository/types";

const EMPTY_RESULT: ModelInputListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

/** Which model input a draft will effectively use, as chosen locally in this
 * section (not yet necessarily saved — the caller decides when to PATCH).
 * Mirrors `ModelInputChoice` in `lib/workspace/wizard-types.ts`, the wizard's
 * equivalent shape (rule 4: one UI pattern for this three-state choice) —
 * `modelInput` is nullable in the "chosen" case only while the id carried
 * over from an already-saved override is still being resolved against the
 * catalogue, or turns out to no longer be in it. */
export type ModelInputSectionChoice =
  | { mode: "inherit" }
  | { mode: "chosen"; id: string; modelInput: ModelInput | null };

/** Same card as `wizard-model-input-step.tsx`'s local `ModelInputMiniCard`.
 * That file is wizard-only and this mission's spec says not to touch it, so
 * the JSX pattern is reused verbatim here rather than imported — the data
 * shape and look are identical, only the module differs. */
function ModelInputMiniCard({
  modelInput,
  selected,
  onSelect,
}: {
  modelInput: ModelInput;
  selected: boolean;
  onSelect: () => void;
}) {
  const datasetCount = modelInput.datasets.length;
  const networkCount = modelInput.networks?.length ?? 0;

  return (
    <button type="button" onClick={onSelect} className="block h-full w-full text-left">
      <Card
        className={`h-full gap-0 py-0 transition-all hover:-translate-y-0.5 hover:shadow-md ${
          selected ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/40"
        }`}
      >
        <CardContent className="p-4">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold leading-snug text-foreground">
              {modelInput.about.name}
            </h4>
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
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
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
              <CheckCircle2 className="size-3.5" />
              Selected
            </p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

export function ModelInputSection({
  inheritedId,
  choice,
  onChoiceChange,
}: {
  /** The base snapshot's `uses.modelInput.id` — null when the base snapshot
   *  itself could not be loaded (the workspace page's fetch is best-effort). */
  inheritedId: string | null;
  choice: ModelInputSectionChoice;
  onChoiceChange: (choice: ModelInputSectionChoice) => void;
}) {
  // Resolve the inherited id against the catalogue only while inheriting —
  // same lookup `WizardModelInputStep` does, `undefined` = loading, `null` =
  // not in the catalogue (or no id to resolve at all).
  const [inherited, setInherited] = useState<ModelInput | null | undefined>(undefined);

  useEffect(() => {
    if (choice.mode !== "inherit") return;
    if (!inheritedId) {
      setInherited(null);
      return;
    }
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
  }, [choice.mode, inheritedId]);

  // Catalogue browser, opt-in — a draft's own page shouldn't dump the whole
  // catalogue on screen unless the user actually wants to change something.
  const [browsing, setBrowsing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ModelInputListResponse>(EMPTY_RESULT);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (browsing) doFetch(searchQuery, page);
    // Fetch once when the browser opens — same pattern as the wizard's mount fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing]);

  useEffect(() => {
    if (!browsing) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(searchQuery, page), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, page, browsing, doFetch]);

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Database className="size-4 text-primary" />
            </div>
            Model Input
          </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        {choice.mode === "chosen" ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Chosen: {choice.modelInput ? choice.modelInput.about.name : "resolving…"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {choice.modelInput
                    ? "Overrides the base model snapshot's own model input."
                    : `Model input ${choice.id.slice(0, 12)}… no longer resolves against the catalogue.`}
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
          <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold text-foreground">Inherited: {inherited.about.name}</p>
              <p className="text-xs text-muted-foreground">From the base model snapshot — found in the catalogue.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {inheritedId ? "Inherited — but not in the catalogue" : "Base model snapshot unavailable"}
              </p>
              <p className="text-xs text-muted-foreground">
                {inheritedId ? (
                  <>
                    The model snapshot cites model input{" "}
                    <code className="font-mono">{inheritedId.slice(0, 12)}…</code>, which the
                    model-inputs catalogue does not hold. This is common, not an error: the run
                    fetches it by id.
                  </>
                ) : (
                  "Could not resolve the base model snapshot to check what it cites."
                )}
              </p>
            </div>
          </div>
        )}

        {!browsing ? (
          <div className="space-y-1.5">
            {/* The toolkit has no option for a model input other than the
                snapshot's own, so a submit refuses an override (ADR 0025).
                An existing one can still be reverted above. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              aria-describedby="model-input-override-reason"
              className="min-h-10 sm:min-h-8"
              onClick={() => setBrowsing(true)}
            >
              {choice.mode === "chosen" ? "Choose a different model input" : "Choose a model input"}
            </Button>
            <p id="model-input-override-reason" className="text-xs text-muted-foreground">
              {UNSUPPORTED_REASON.modelInput}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="relative">
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
              <p className="py-6 text-center text-sm text-muted-foreground">
                No model inputs found{searchQuery ? ` for "${searchQuery}"` : ""}.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {result.items.map((mi) => (
                  <ModelInputMiniCard
                    key={mi.id}
                    modelInput={mi}
                    selected={choice.mode === "chosen" && choice.id === mi.id}
                    onSelect={() => {
                      onChoiceChange({ mode: "chosen", id: mi.id, modelInput: mi });
                      setBrowsing(false);
                    }}
                  />
                ))}
              </div>
            )}

            {result.totalPages > 1 && (
              <div className="flex items-center justify-center gap-4">
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

            <Button type="button" variant="ghost" size="sm" onClick={() => setBrowsing(false)}>
              Close
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
