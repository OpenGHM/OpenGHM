"use client";

import { useCallback, useEffect, useRef, useTransition, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { fetchSnapshots } from "@/lib/jobs/actions";
import type { RepositoryListResponse, Dataset } from "@/lib/repository/types";
import Link from "next/link";
import { Calendar, Grid3X3, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function SnapshotCard({ dataset }: { dataset: Dataset }) {
  const { start, end } = dataset.simulation.temporalCoverage;
  const { value, unit } = dataset.simulation.resolution;

  return (
    <Link href={`/workspace/new/review?snapshot_id=${dataset.id}`} className="block">
      <Card className="h-full gap-0 py-0 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-[#006994]/40">
        <CardContent className="flex h-full flex-col p-5">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold leading-snug text-foreground">
              {dataset.about.name}
            </h3>
            <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              Snapshot
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />
              {start} – {end}
            </span>
            <span className="inline-flex items-center gap-1">
              <Grid3X3 className="size-3" />
              {value} {unit}
            </span>
          </div>

          <p className="line-clamp-2 flex-1 text-xs text-muted-foreground leading-relaxed">
            {dataset.about.description}
          </p>

          <div className="mt-4 flex items-center justify-end">
            <span className="rounded-md bg-[#006994] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#005a7a]">
              Select →
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

export function SnapshotSelectionClient({
  initialData,
}: {
  initialData: RepositoryListResponse;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<RepositoryListResponse>(initialData);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(
    (query: string, p: number) => {
      startTransition(async () => {
        try {
          const data = await fetchSnapshots(query, p);
          setResult(data);
        } catch {
          setResult(EMPTY_RESULT);
        }
      });
    },
    []
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(searchQuery, page), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, page, doFetch]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-[1024px] px-10 py-8">
      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search snapshots by title or keyword…"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10"
        />
        {isPending && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Count */}
      <p className="mb-4 text-sm text-muted-foreground">
        {result.totalCount} snapshot{result.totalCount !== 1 ? "s" : ""} available
      </p>

      {/* Grid */}
      {result.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No snapshots found
              {searchQuery ? ` for "${searchQuery}"` : ""}.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((dataset) => (
            <SnapshotCard key={dataset.id} dataset={dataset} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="mr-1 size-4" />
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
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
