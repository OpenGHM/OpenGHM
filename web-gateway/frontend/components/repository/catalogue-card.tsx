import Link from "next/link";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeStamp } from "@/components/common/time-stamp";
import { cn } from "@/lib/utils";
import {
  cardKeywords,
  contentsLine,
  coverageLine,
  creatorLabel,
  detailHref,
  kindLabel,
  periodLabel,
  resolutionSummary,
  spatialBox,
} from "@/lib/repository/catalogue-format";
import type { CatalogueItem, CatalogueView } from "@/lib/repository/types";
import { CoverageThumbnail } from "./coverage-thumbnail";

/** The dark button, and the plain ones beside it. All sit above the title's stretched link and keep their own focus ring. */
const ACTION_BASE =
  "relative z-10 inline-flex min-h-10 items-center rounded-lg px-3 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none sm:min-h-9";
const ACTION_PRIMARY = `${ACTION_BASE} bg-foreground px-3.5 text-background hover:bg-foreground/85 focus-visible:ring-offset-2`;
const ACTION_PLAIN = `${ACTION_BASE} text-foreground/80 hover:bg-muted hover:text-foreground`;

/** "Model Snapshot" in the brand tint, "Model Input" in the compute tint. */
function KindBadge({ kind }: { kind: CatalogueItem["kind"] }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
        kind === "snapshot" ? "bg-primary/10 text-primary" : "bg-compute/10 text-compute"
      )}
    >
      {kindLabel(kind)}
    </span>
  );
}

function CategoryChip({ children }: { children: React.ReactNode }) {
  return (
    <li className="max-w-full truncate rounded-md bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">
      {children}
    </li>
  );
}

function MoreChip({ count, hidden }: { count: number; hidden: string[] }) {
  return (
    <li title={hidden.join(", ")} className="px-1 text-[11.5px] text-muted-foreground">
      +{count} more
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
            "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11.5px] transition-colors group-focus-visible/keyword:ring-[3px] group-focus-visible/keyword:ring-ring/50 motion-reduce:transition-none",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted/60 text-foreground/80 group-hover/keyword:border-primary/40 group-hover/keyword:text-primary"
          )}
        >
          {selected && <Check aria-hidden="true" className="size-3 shrink-0" />}
          <span className="truncate">{keyword}</span>
        </span>
      </button>
    </li>
  );
}

function MetaCell({ label, title, mono = false, children }: { label: string; title?: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd title={title} className={cn("text-[13px] break-words text-foreground", mono && "font-mono")}>
        {children}
      </dd>
    </div>
  );
}

function toBox(item: CatalogueItem) {
  const s = spatialBox(item);
  return { north: s.northlimit, south: s.southlimit, east: s.eastlimit, west: s.westlimit };
}

/** The title as the card's stretched link: the whole card opens the detail page. */
function TitleLink({ href, name, className }: { href: string; name: string; className?: string }) {
  return (
    <h3 className={cn("min-w-0 leading-snug font-semibold break-words text-foreground", className)}>
      <Link
        href={href}
        className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {name}
      </Link>
    </h3>
  );
}

/**
 * One catalogue entry: a snapshot or a model input as a card, in a list or a
 * grid. The title is a stretched link, so the whole card opens the detail
 * page, and the View, Download and Cite links sit above it. The keyword chips
 * of the list card are buttons that add (or, when already on, remove) that
 * keyword as a filter.
 */
export function CatalogueCard({
  item,
  view = "list",
  selectedKeywords = [],
  onToggleKeyword,
}: {
  item: CatalogueItem;
  view?: CatalogueView;
  /** The keyword filter in effect: those chips show as selected. */
  selectedKeywords?: readonly string[];
  /** Add the keyword to the filter, or take it off when it is already on. */
  onToggleKeyword: (keyword: string) => void;
}) {
  const { about } = item;
  const href = detailHref(item);
  const grid = view === "grid";

  const links = (
    <>
      <Link href={href} className={ACTION_PRIMARY}>
        {grid ? "View" : "View details"}{" "}
        <span className="sr-only">
          {grid && "details "}for {about.name}
        </span>
      </Link>
      <Link href={`${href}#download`} className={ACTION_PLAIN}>
        Download{" "}
        <span className="sr-only">{about.name}</span>
      </Link>
      {!grid && (
        <Link href={`${href}#cite`} className={ACTION_PLAIN}>
          Cite{" "}
          <span className="sr-only">{about.name}</span>
        </Link>
      )}
    </>
  );

  if (grid) {
    return (
      <Card className="group relative h-full gap-0 overflow-hidden rounded-xl border py-0 shadow-none transition-shadow hover:shadow-md motion-reduce:transition-none">
        <div className="relative h-[150px] shrink-0 border-b bg-primary/10">
          <CoverageThumbnail box={toBox(item)} aspect="wide" className="absolute inset-0 aspect-auto rounded-none border-0" />
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <KindBadge kind={item.kind} />
          <TitleLink href={href} name={about.name} className="line-clamp-4 text-base" />
          <p className="font-mono text-xs text-muted-foreground">{coverageLine(item)}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-1 gap-y-1 border-t pt-3">
            {links}
            <span className="ml-auto pl-2 text-xs text-muted-foreground">
              <TimeStamp value={about.datePublished} format="date" />
            </span>
          </div>
        </div>
      </Card>
    );
  }

  const creator = creatorLabel(item);
  const keywords = cardKeywords(item);

  return (
    <Card className="group relative gap-0 overflow-hidden rounded-xl border py-0 shadow-none transition-shadow hover:shadow-md motion-reduce:transition-none md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 md:px-6 md:pt-[22px] md:pb-[18px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <KindBadge kind={item.kind} />
          <span className="font-mono text-[11.5px] text-muted-foreground">{contentsLine(item)}</span>
        </div>

        <TitleLink href={href} name={about.name} className="text-lg" />

        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{about.description}</p>

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3 border-y py-3">
          <MetaCell label="Authors" title={about.creator.map((c) => c.name).join(", ")}>
            {creator ? `${creator.first}${creator.more > 0 ? ` +${creator.more}` : ""}` : "—"}
          </MetaCell>
          <MetaCell label="Coverage" mono>
            {periodLabel(item) ?? "Climatological"}
          </MetaCell>
          <MetaCell label="Resolution" mono>
            {resolutionSummary(item)}
          </MetaCell>
        </dl>

        <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-0 sm:gap-y-1.5" aria-label="Category and keywords">
          <CategoryChip>{about.category}</CategoryChip>
          {keywords.shown.map((keyword) => (
            <KeywordChip
              key={keyword}
              keyword={keyword}
              selected={selectedKeywords.includes(keyword)}
              onToggle={onToggleKeyword}
            />
          ))}
          {keywords.more > 0 && <MoreChip count={keywords.more} hidden={keywords.hidden} />}
        </ul>

        <div className="mt-auto flex flex-wrap items-center gap-x-1 gap-y-1">
          {links}
          <span className="basis-full text-[12.5px] text-muted-foreground sm:ml-auto sm:basis-auto sm:pl-2">
            Published <TimeStamp value={about.datePublished} format="date" />
          </span>
        </div>
      </div>

      <div className="relative h-36 shrink-0 border-t bg-primary/10 md:h-auto md:w-[260px] md:border-t-0 md:border-l">
        <CoverageThumbnail
          box={toBox(item)}
          aspect="wide"
          className="absolute inset-0 aspect-auto rounded-none border-0 md:hidden"
        />
        <CoverageThumbnail
          box={toBox(item)}
          aspect="tall"
          className="absolute inset-0 hidden aspect-auto rounded-none border-0 md:block"
        />
      </div>
    </Card>
  );
}

/** The card's shape while the list or grid loads. */
export function CatalogueCardSkeleton({ view = "list" }: { view?: CatalogueView }) {
  if (view === "grid") {
    return (
      <Card aria-hidden="true" className="h-full gap-0 overflow-hidden rounded-xl border py-0 shadow-none">
        <Skeleton className="h-[150px] shrink-0 rounded-none" />
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3.5 w-32" />
          <div className="mt-auto flex gap-3 border-t pt-3">
            <Skeleton className="h-8 w-14" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card aria-hidden="true" className="gap-0 overflow-hidden rounded-xl border py-0 shadow-none md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 md:px-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3.5 w-36" />
        </div>
        <Skeleton className="h-5 w-2/3" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <div className="grid grid-cols-3 gap-3 border-y py-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-12" />
        </div>
      </div>
      <Skeleton className="h-36 shrink-0 rounded-none md:h-auto md:w-[260px]" />
    </Card>
  );
}
