"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ModelInputMiniCard } from "@/components/workspace/model-input-mini-card";
import { UNSUPPORTED_REASON } from "@/lib/jobs/compute";
import { fetchModelInputs } from "@/lib/repository/actions";
import type { ModelInputListResponse } from "@/lib/repository/types";

const EMPTY: ModelInputListResponse = { items: [], totalCount: 0, totalPages: 1, page: 1 };

/** How long typing pauses before the catalogue is asked. */
const SEARCH_PAUSE_MS = 300;

/**
 * The model-inputs catalogue, for looking at. It is collapsed until asked for
 * (a draft's own page should not put the whole catalogue on screen), and choosing
 * one is off: the toolkit has no option for a model input other than the
 * snapshot's own, so a submit refuses an override (ADR 0025). `currentId` is the
 * one the draft runs against, marked in the list when it is there.
 */
export function ModelInputBrowser({ currentId = null }: { currentId?: string | null }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [page, setPage] = useState(1);
  // The answer is kept with the question it answers, so "loading" is the
  // question having moved on, not a flag set inside the effect.
  const [answer, setAnswer] = useState<{ key: string; data: ModelInputListResponse } | null>(null);
  const wanted = `${searched}\u0000${page}`;
  const result = answer?.data ?? EMPTY;
  const loading = open && answer?.key !== wanted;

  // Typing is asked about after a pause, from the first page; a page change or
  // the first open at once.
  useEffect(() => {
    if (query === searched) return;
    const timer = setTimeout(() => {
      setSearched(query);
      setPage(1);
    }, SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, searched]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const key = `${searched}\u0000${page}`;
    fetchModelInputs({ searchQuery: searched, sortBy: "relevance", page })
      .then((data) => {
        if (!cancelled) setAnswer({ key, data });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ key, data: EMPTY });
      });
    return () => {
      cancelled = true;
    };
  }, [open, searched, page]);

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="min-h-10 sm:min-h-8"
        >
          <Chevron className="size-4" aria-hidden="true" />
          Browse model inputs
        </Button>
        <p className="text-xs text-muted-foreground">{UNSUPPORTED_REASON.modelInput}</p>
      </div>

      {open && (
        <div id={panelId} className="space-y-3">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search model inputs"
              placeholder="Search model inputs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 pl-10 md:h-9"
            />
            {loading && (
              <Loader2
                className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
          </div>

          {result.items.length === 0 ? (
            !loading && (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No model inputs found{searched ? ` for "${searched}"` : ""}.
                </CardContent>
              </Card>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {result.items.map((mi) => (
                <ModelInputMiniCard
                  key={mi.id}
                  modelInput={mi}
                  selected={mi.id === currentId}
                  selectedLabel="In use by this draft"
                />
              ))}
            </div>
          )}

          {result.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="min-h-10 sm:min-h-8"
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {result.totalPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page >= result.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-10 sm:min-h-8"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
