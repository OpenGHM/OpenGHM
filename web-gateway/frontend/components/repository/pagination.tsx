import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | "ellipsis")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-center gap-1.5 pt-8"
    >
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Previous page"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="size-10 rounded-lg bg-card sm:size-9"
      >
        <ChevronLeft className="size-4" />
      </Button>
      {pages.map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e-${i}`} aria-hidden="true" className="px-1.5 font-mono text-sm text-muted-foreground">
            …
          </span>
        ) : (
          <Button
            key={p}
            variant="outline"
            size="sm"
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
            className={cn(
              "h-10 min-w-10 rounded-lg bg-card font-mono text-[13px] sm:h-9 sm:min-w-9",
              p === page &&
                "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background"
            )}
          >
            {p}
          </Button>
        )
      )}
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Next page"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        className="size-10 rounded-lg bg-card sm:size-9"
      >
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
