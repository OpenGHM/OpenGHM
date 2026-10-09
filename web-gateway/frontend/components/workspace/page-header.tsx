import type { ReactNode } from "react";
import { PageHero, type HeroBreadcrumbItem } from "@/components/layout/page-hero";

/**
 * "My snapshot drafts / <current>": where a snapshot draft's own page (and the
 * wizard) sits. The first part links to the list; the last is the page, which
 * is the current one and is not a link.
 */
export function draftBreadcrumb(current: string): HeroBreadcrumbItem[] {
  return [{ label: "My snapshot drafts", href: "/workspace" }, { label: current }];
}

/**
 * The navy band of a Workspace page: the site header, then a breadcrumb or an
 * eyebrow, the title with, under it, a status chip and a muted line (`meta`),
 * whatever the page does (`actions`: buttons, the save status) and anything that
 * belongs to the band's bottom edge (`children`: the section switch, the
 * wizard's steps). It is `PageHero` at `size="page"`, so it carries the Header
 * itself; the content under it goes in `PageBody`, which overlaps the band.
 *
 * The chip is drawn on a white pill so a status colour (made for a light
 * surface) stays readable on the navy.
 */
export function PageHeader({
  eyebrow,
  breadcrumb,
  title,
  badge,
  meta,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  breadcrumb?: HeroBreadcrumbItem[];
  title: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const subtitle =
    badge || meta ? (
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {badge && <span className="inline-flex shrink-0 rounded-full bg-white">{badge}</span>}
        {meta}
      </span>
    ) : undefined;
  return (
    <PageHero
      size="page"
      eyebrow={eyebrow}
      breadcrumb={breadcrumb}
      title={<span className="[overflow-wrap:anywhere]">{title}</span>}
      subtitle={subtitle}
      actions={actions}
    >
      {children}
    </PageHero>
  );
}
