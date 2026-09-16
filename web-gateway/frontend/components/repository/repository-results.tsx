import { Dataset, SortOption } from "@/lib/repository/types";
import { DatasetCard } from "./dataset-card";
import { Pagination } from "./pagination";
import { SearchX } from "lucide-react";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest First" },
  { value: "title-az", label: "Title A-Z" },
  { value: "title-za", label: "Title Z-A" },
];

function DatasetCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start gap-3">
        <div className="h-5 w-24 rounded-full bg-muted" />
        <div className="h-5 flex-1 rounded bg-muted" />
      </div>
      <div className="mb-2 h-4 w-3/4 rounded bg-muted" />
      <div className="mb-4 h-4 w-1/2 rounded bg-muted" />
      <div className="flex gap-4">
        <div className="h-3 w-20 rounded bg-muted" />
        <div className="h-3 w-20 rounded bg-muted" />
        <div className="h-3 w-20 rounded bg-muted" />
      </div>
    </div>
  );
}

export function RepositoryResults({
  datasets,
  totalCount,
  sortBy,
  onSortChange,
  page,
  totalPages,
  onPageChange,
  isLoading = false,
}: {
  datasets: Dataset[];
  totalCount: number;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Repository</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading ? (
              <span className="inline-block h-4 w-24 animate-pulse rounded bg-muted" />
            ) : (
              <>
                {totalCount} dataset{totalCount !== 1 ? "s" : ""} found
              </>
            )}
          </p>
        </div>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <DatasetCardSkeleton key={i} />
          ))}
        </div>
      ) : datasets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <SearchX className="mb-4 size-12 text-muted-foreground/40" />
          <h3 className="text-lg font-semibold text-foreground">No datasets found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Try adjusting your search or filters
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {datasets.map((d) => (
            <DatasetCard key={d.id} dataset={d} />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}
