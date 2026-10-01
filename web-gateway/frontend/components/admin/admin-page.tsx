import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** The padding every admin page shares: tight on a phone, roomy on a desktop. */
export const ADMIN_PAGE_CLASS = "mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10";

export function AdminPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(ADMIN_PAGE_CLASS, className)}>{children}</div>;
}

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
        "flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive",
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
        "rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center",
        className
      )}
    >
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {children && <p className="mt-1 text-sm text-slate-500">{children}</p>}
    </div>
  );
}
