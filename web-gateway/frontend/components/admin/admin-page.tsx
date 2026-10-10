import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AdminBreadcrumbItem {
  label: string;
  /** Omit on the last item, which is the current page and is not a link. */
  href?: string;
}

/**
 * One admin page: a header (an optional breadcrumb, the title, a description
 * and the page's actions at the right) and the content under it. The frame
 * around it (sidebar, `<main>`, width and padding) is the layout's, so every
 * page of the console, its loading, error and not-found states included, sits
 * on the same light ground.
 */
export function AdminPage({
  title,
  description,
  breadcrumb,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: string;
  breadcrumb?: AdminBreadcrumbItem[];
  /** Buttons for the page itself ("New workshop"), at the right of the title; below it on a phone. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Extra classes for the content under the header. */
  className?: string;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-pretty text-foreground [overflow-wrap:anywhere] sm:text-3xl">
              {title}
            </h1>
            {description && <p className="max-w-2xl text-sm text-pretty text-muted-foreground sm:text-base">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      <div className={cn("space-y-6", className)}>{children}</div>
    </div>
  );
}

/**
 * The trail on one line, small and muted. Every crumb but the last shrinks and
 * ends in an ellipsis (its full label in `title`), so a long name never runs
 * onto a second line on a phone.
 */
function Breadcrumb({ items }: { items: AdminBreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-[13px]">
      <ol className="flex min-w-0 items-center gap-1.5">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className={cn("flex items-center gap-1.5", last ? "min-w-0" : "min-w-0 shrink-[4]")}>
              {item.href && !last ? (
                <Link
                  href={item.href}
                  title={item.label}
                  className="min-w-0 truncate rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  title={item.label}
                  className={cn("min-w-0 truncate", last ? "text-foreground" : "text-muted-foreground")}
                >
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/60" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
