import type { ReactNode } from "react";
import { PageHero, type HeroBreadcrumbItem } from "@/components/layout/page-hero";
import { TagChips } from "@/components/repository/tag-chips";
import { TemporalTimeline } from "@/components/repository/temporal-timeline";
import { kindLabel } from "@/lib/repository/catalogue-format";
import type { CatalogueKind } from "@/lib/repository/types";

/** A label and its value on the band, the value in mono: "Coverage 2000-01-01 – 2009-12-31". */
export function HeroChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl bg-white/[0.07] px-3.5 py-[9px] font-mono text-[13.5px] text-hero-text">
      <span className="font-sans text-xs text-hero-eyebrow">{label}</span>
      {children}
    </span>
  );
}

/**
 * The band of a snapshot's or model input's page, and of its files page: the
 * trail back to the repository, what kind of artifact it is and its tags (above
 * the title), the name as the title (the whole of it, a paper title included),
 * the coverage as a bar, then the chips on the left and the actions on the right.
 *
 * It sits under `PageBody`'s pull-up like any `PageHero`; the page's first card
 * overlaps it.
 */
export function DetailHero({
  kind,
  name,
  tags,
  breadcrumb,
  title,
  timeline,
  chips,
  actions,
}: {
  kind: CatalogueKind;
  name: string;
  tags?: readonly string[];
  /** The trail after "Data Repository"; the last item is the current page. */
  breadcrumb: HeroBreadcrumbItem[];
  /** The h1 when it is not the name (the files page says "Files of the name"). */
  title?: ReactNode;
  /** The coverage to draw; none for an artifact with no calendar period. */
  timeline?: { start: string; end: string };
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PageHero
      breadcrumb={[{ label: "Data Repository", href: "/repository" }, ...breadcrumb]}
      meta={
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-[11px] py-[5px] text-[12.5px] font-semibold text-secondary-foreground">
            {kindLabel(kind)}
          </span>
          {tags && <TagChips tags={tags} tone="hero" className="gap-2" />}
        </div>
      }
      title={title ?? <span className="[overflow-wrap:anywhere]">{name}</span>}
    >
      {timeline && <TemporalTimeline start={timeline.start} end={timeline.end} />}
      {(chips || actions) && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-7 gap-y-3">
          {chips && <div className="flex flex-wrap gap-2">{chips}</div>}
          {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
      )}
    </PageHero>
  );
}
