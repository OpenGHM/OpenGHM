import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * An auth form while its search parameters are read: two labelled fields and
 * a button, in the shape of what replaces them. Announced once, as busy, and
 * invisible for the first 300 ms, so a fast load shows none.
 */
export function AuthFormSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="reveal-delayed space-y-5">
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}

/**
 * A request in flight on a page that has no form, such as checking a
 * verification link: a turning spinner beside what is being done.
 */
export function AuthPending({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      {children}
    </p>
  );
}
