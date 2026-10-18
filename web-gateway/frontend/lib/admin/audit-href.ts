import type { AuditFilters } from "@/lib/admin/types";

/** The audit log's address for `filters`: only what is set, never a page (a
 *  page offset from one filter rarely means anything under another). */
export function auditHref(basePath: string, filters: AuditFilters): string {
  const search = new URLSearchParams();
  if (filters.category) search.set("category", filters.category);
  if (filters.actor_id) search.set("actor_id", filters.actor_id);
  if (filters.date_from) search.set("date_from", filters.date_from);
  if (filters.date_to) search.set("date_to", filters.date_to);
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` from the address bar, or undefined for anything else: the
 *  backend answers 422 to a malformed day, which the page would show as a failure. */
export function parseDay(raw: string | undefined): string | undefined {
  if (!raw || !DAY.test(raw)) return undefined;
  return Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? undefined : raw;
}
