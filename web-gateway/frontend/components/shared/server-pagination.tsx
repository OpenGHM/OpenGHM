import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Server-rendered Prev/Next pagination for pages that read `page` from
 * `searchParams` (no client state). `params` carries the other filters on
 * the page (role, q, category, ...) so paging doesn't silently drop them —
 * see the pre-existing bug this replaced at app/admin/page.tsx, where
 * `?page=` links dropped `auditCategory`.
 */
export function ServerPagination({
  page,
  totalPages,
  basePath,
  params,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  function hrefFor(targetPage: number) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) search.set(key, value);
    }
    search.set("page", String(targetPage));
    return `${basePath}?${search.toString()}`;
  }

  return (
    <div className="flex items-center justify-center gap-4 pt-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)}>
          <Button variant="ghost" size="sm">
            <ChevronLeft className="mr-1 size-4" />
            Previous
          </Button>
        </Link>
      ) : (
        <Button variant="ghost" size="sm" disabled>
          <ChevronLeft className="mr-1 size-4" />
          Previous
        </Button>
      )}
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)}>
          <Button variant="ghost" size="sm">
            Next
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </Link>
      ) : (
        <Button variant="ghost" size="sm" disabled>
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      )}
    </div>
  );
}
