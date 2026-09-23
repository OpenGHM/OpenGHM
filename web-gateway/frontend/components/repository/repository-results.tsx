import { Dataset, SortOption } from "@/lib/repository/types";
import { DatasetTable } from "./dataset-table";
import { Pagination } from "./pagination";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest First" },
  { value: "title-az", label: "Title A-Z" },
  { value: "title-za", label: "Title Z-A" },
];

function DatasetTableSkeleton() {
  return (
    <div className="animate-pulse space-y-2 rounded-xl border bg-card p-5 shadow-sm">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-muted" />
      ))}
    </div>
  );
}

export function RepositoryResults({
  datasets,
  modelInputIds,
  totalCount,
  sortBy,
  onSortChange,
  page,
  totalPages,
  onPageChange,
  isLoading = false,
}: {
  datasets: Dataset[];
  modelInputIds: Set<string> | null;
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
        <DatasetTableSkeleton />
      ) : (
        <DatasetTable datasets={datasets} modelInputIds={modelInputIds} />
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}
