import Link from "next/link";
import { cn } from "@/lib/utils";
import type { UserLabels } from "@/lib/admin/types";

/** The actor of an event nobody did: the background sweep (app/core/audit.py). */
const SYSTEM_ACTOR = "system";

/**
 * Who a user id is: their name over their email, linked to their page. An id
 * the lookup did not find shows the email the record carries (`fallbackEmail`,
 * an audit event's actor) or, failing that, the id itself, unlinked: a deleted
 * account has no page, and a job id is not a user.
 */
export function Person({
  id,
  labels,
  fallbackEmail,
  className,
}: {
  id: string;
  labels: UserLabels;
  fallbackEmail?: string | null;
  className?: string;
}) {
  if (id === SYSTEM_ACTOR) return <span className={className}>System</span>;
  const person = labels[id];
  if (!person) {
    return (
      <span className={cn("break-all", className)} title={fallbackEmail ? id : undefined}>
        {fallbackEmail ?? id}
      </span>
    );
  }
  return (
    <span className={cn("block min-w-0", className)}>
      <Link
        href={`/admin/users/${encodeURIComponent(id)}`}
        className="block break-words font-medium text-foreground hover:underline"
      >
        {person.name || person.email}
      </Link>
      {person.name && <span className="block break-all text-xs text-muted-foreground">{person.email}</span>}
    </span>
  );
}
