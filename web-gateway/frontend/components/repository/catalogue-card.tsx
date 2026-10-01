import Link from "next/link";
import { Calendar, Check, Database, Download, Eye, Grid3X3, Quote, Scale, Tag, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeStamp } from "@/components/common/time-stamp";
import { cn } from "@/lib/utils";
import {
  cardKeywords,
  contentsLabel,
  creatorLabel,
  detailHref,
  kindLabel,
  periodLabel,
  resolutionLabels,
  spatialBox,
} from "@/lib/repository/catalogue-format";
import type { CatalogueItem } from "@/lib/repository/types";
import { CoverageThumbnail } from "./coverage-thumbnail";

/** A link in the card that sits above the title's stretched link and keeps its own focus ring. */
const ACTION_LINK =
  "relative z-10 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8";

function MetaItem({
  icon: Icon,
  children,
  title,
}: {
  icon: typeof Users;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <li className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={title}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </li>
  );
}

function Chip({
  children,
  strong = false,
  title,
}: {
  children: React.ReactNode;
  strong?: boolean;
  title?: string;
}) {
  return (
    <li
      title={title}
      className={cn(
        "max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-medium",
        strong ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </li>
  );
}

/**
 * A keyword as a filter control. It looks like a chip; on a phone the button
 * itself is 40 px tall (the chip is drawn inside it), so the hit area is big
 * enough without a big chip. It sits above the title's stretched link.
 */
function KeywordChip({
  keyword,
  selected,
  onToggle,
}: {
  keyword: string;
  selected: boolean;
  onToggle: (keyword: string) => void;
}) {
  return (
    <li className="max-w-full min-w-0">
      <button
        type="button"
        aria-label={`Filter by keyword ${keyword}`}
        aria-pressed={selected}
        onClick={() => onToggle(keyword)}
        className="group/keyword relative z-10 inline-flex min-h-10 max-w-full min-w-0 cursor-pointer items-center outline-none sm:min-h-0"
      >
        <span
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors group-focus-visible/keyword:ring-[3px] group-focus-visible/keyword:ring-ring/50",
            selected
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground group-hover/keyword:bg-primary/10 group-hover/keyword:text-primary"
          )}
        >
          {selected && <Check aria-hidden="true" className="size-3 shrink-0" />}
          <span className="truncate">{keyword}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * One catalogue row: a snapshot or a model input as a card. The title is a
 * stretched link, so the whole card opens the detail page, and View details,
 * Download and Cite sit above it as their own links. The keyword chips are
 * buttons that add (or, when already on, remove) that keyword as a filter.
 */
export function CatalogueCard({
  item,
  selectedKeywords = [],
  onToggleKeyword,
}: {
  item: CatalogueItem;
  /** The keyword filter in effect: those chips show as selected. */
  selectedKeywords?: readonly string[];
  /** Add the keyword to the filter, or take it off when it is already on. */
  onToggleKeyword: (keyword: string) => void;
}) {
  const { about } = item;
  const href = detailHref(item);
  const creator = creatorLabel(item);
  const period = periodLabel(item);
  const resolutions = resolutionLabels(item);
  const keywords = cardKeywords(item);
  const snapshot = item.kind === "snapshot";

  return (
    <Card className="group relative gap-0 overflow-hidden rounded-xl border-0 py-0 shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none sm:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-base leading-snug font-semibold break-words">
            <Link
              href={href}
              className="rounded-sm text-primary outline-none group-hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 after:absolute after:inset-0 after:content-['']"
            >
              {about.name}
            </Link>
          </h3>
          <Badge
            className={cn(
              "border-transparent",
              snapshot ? "bg-primary/10 text-primary" : "bg-info/10 text-info"
            )}
          >
            {kindLabel(item.kind)}
          </Badge>
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {creator && (
            <MetaItem icon={Users} title={about.creator.map((c) => c.name).join(", ")}>
              {creator.first}
              {creator.more > 0 && ` +${creator.more}`}
            </MetaItem>
          )}
          <MetaItem icon={Calendar}>{period ?? "Climatological"}</MetaItem>
          {resolutions.length > 0 && (
            <MetaItem icon={Grid3X3} title={resolutions.join(", ")}>
              {resolutions.slice(0, 2).join(", ")}
              {resolutions.length > 2 && ` +${resolutions.length - 2}`}
            </MetaItem>
          )}
          <MetaItem icon={snapshot ? Tag : Database}>{contentsLabel(item)}</MetaItem>
          <MetaItem icon={Scale}>{about.license}</MetaItem>
        </ul>

        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {about.description}
        </p>

        <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-0 sm:gap-y-1.5" aria-label="Category and keywords">
          <Chip strong>{about.category}</Chip>
          {keywords.shown.map((keyword) => (
            <KeywordChip
              key={keyword}
              keyword={keyword}
              selected={selectedKeywords.includes(keyword)}
              onToggle={onToggleKeyword}
            />
          ))}
          {keywords.more > 0 && <Chip title={keywords.hidden.join(", ")}>+{keywords.more} more</Chip>}
        </ul>

        <div className="mt-auto flex flex-wrap items-center gap-x-1 gap-y-1 border-t pt-2">
          <Link href={href} className={cn(ACTION_LINK, "text-primary hover:bg-primary/5")}>
            <Eye aria-hidden="true" className="size-4" />
            View details
            <span className="sr-only"> for {about.name}</span>
          </Link>
          <Link
            href={`${href}#download`}
            className={cn(ACTION_LINK, "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            <Download aria-hidden="true" className="size-4" />
            Download
            <span className="sr-only"> {about.name}</span>
          </Link>
          <Link
            href={`${href}#cite`}
            className={cn(ACTION_LINK, "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            <Quote aria-hidden="true" className="size-4" />
            Cite
            <span className="sr-only"> {about.name}</span>
          </Link>
          <span className="ml-auto pl-2 text-xs text-muted-foreground">
            Published <TimeStamp value={about.datePublished} format="date" />
          </span>
        </div>
      </div>

      <div className="relative order-first flex shrink-0 items-center justify-center bg-muted/40 p-3 sm:order-none sm:min-h-32 sm:w-60 sm:border-l sm:p-0">
        <CoverageThumbnail
          box={toBox(item)}
          className="w-56 max-w-full sm:absolute sm:inset-0 sm:aspect-auto sm:size-full sm:max-w-none sm:rounded-none sm:border-0"
        />
      </div>
    </Card>
  );
}

function toBox(item: CatalogueItem) {
  const s = spatialBox(item);
  return { north: s.northlimit, south: s.southlimit, east: s.eastlimit, west: s.westlimit };
}

/** The card's shape while the list loads. */
export function CatalogueCardSkeleton() {
  return (
    <Card
      aria-hidden="true"
      className="gap-0 overflow-hidden rounded-xl border-0 py-0 shadow-sm sm:flex-row"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <div className="mt-auto flex gap-3 border-t pt-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-12" />
        </div>
      </div>
      <div className="order-first flex shrink-0 items-center justify-center bg-muted/40 p-3 sm:order-none sm:w-60 sm:border-l">
        <Skeleton className="aspect-[2/1] w-56 max-w-full sm:w-full" />
      </div>
    </Card>
  );
}
