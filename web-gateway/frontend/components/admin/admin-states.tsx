import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Kept apart from admin-page.tsx, which pulls in the site header: these are
// used by the tables, and a table has no reason to depend on the header.

/** What failed and what to try, in `destructive`. */
export function InlineError({
  title,
  children,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive",
        className
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p>{children ?? "Reload the page to try again. If it keeps failing, the service may be unavailable."}</p>
      </div>
    </div>
  );
}

/** A dashed card that says what is missing. */
export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-input bg-card px-4 py-8 text-center",
        className
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
