import Link from "next/link";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeStamp } from "@/components/common/time-stamp";
import { cn } from "@/lib/utils";
import { humanizeTag } from "@/lib/repository/catalogue";
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

/**
 * A card the whole surface of which is one link (see TitleLink). It is
 * `relative` for the link's overlay; it lifts on hover and, when the title link
 * has keyboard focus, wears the focus ring itself.
 */
const CARD =
  "relative cursor-pointer gap-0 overflow-hidden rounded-xl border py-0 shadow-none transition-shadow hover:shadow-md has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50 motion-reduce:transition-none";

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

/**
 * A tag as a filter control, the emphasised chip of the row (primary tint).
 * Like a keyword chip, the button is 40 px tall on a phone and the chip is
 * drawn inside it; it sits above the title's stretched link.
 */
function TagChip({
  tag,
  selected,
  onToggle,
}: {
  tag: string;
  selected: boolean;
  onToggle: (tag: string) => void;
}) {
  const label = humanizeTag(tag);
  return (
    <li className="max-w-full min-w-0">
      <button
        type="button"
        aria-label={`Filter by tag ${label}`}
        aria-pressed={selected}
        onClick={() => onToggle(tag)}
        className="group/tag relative z-10 inline-flex min-h-10 max-w-full min-w-0 cursor-pointer items-center outline-none sm:min-h-0"
      >
        <span
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition-colors group-focus-visible/tag:ring-[3px] group-focus-visible/tag:ring-ring/50 motion-reduce:transition-none",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-transparent bg-primary/10 text-primary group-hover/tag:border-primary/40"
          )}
        >
          {selected && <Check aria-hidden="true" className="size-3 shrink-0" />}
          <span className="truncate">{label}</span>
        </span>
      </button>
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

/**
 * The title as the card's stretched link: its `after` layer covers the card
 * (which is `relative`), so the whole card opens the detail page and the title
 * is the only link. The card shows the focus ring, not the title text.
 */
function TitleLink({ href, name, className }: { href: string; name: string; className?: string }) {
  return (
    <h3 className={cn("min-w-0 leading-snug font-semibold break-words text-foreground", className)}>
      <Link
        href={href}
        className="outline-none after:absolute after:inset-0 after:content-['']"
      >
        {name}
      </Link>
    </h3>
  );
}

/**
 * One catalogue entry: a snapshot or a model input as a card, in a list or a
 * grid. The title is a stretched link, so the whole card opens the detail
 * page and there is no other link. The tag and keyword chips of the list card
 * are buttons, above the link, that add (or, when already on, remove) that tag
 * or keyword as a filter.
 */
export function CatalogueCard({
  item,
  view = "list",
  selectedTags = [],
  selectedKeywords = [],
  onToggleTag,
  onToggleKeyword,
}: {
  item: CatalogueItem;
  view?: CatalogueView;
  /** The tag filter in effect: those chips show as selected. */
  selectedTags?: readonly string[];
  /** The keyword filter in effect: those chips show as selected. */
  selectedKeywords?: readonly string[];
  /** Add the tag to the filter, or take it off when it is already on. */
  onToggleTag: (tag: string) => void;
  /** Add the keyword to the filter, or take it off when it is already on. */
  onToggleKeyword: (keyword: string) => void;
}) {
  const { about } = item;
  const href = detailHref(item);
  const grid = view === "grid";

  if (grid) {
    return (
      <Card className={cn(CARD, "h-full")}>
        <div className="relative h-[150px] shrink-0 border-b bg-primary/10">
          <CoverageThumbnail box={toBox(item)} aspect="wide" className="absolute inset-0 aspect-auto rounded-none border-0" />
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <KindBadge kind={item.kind} />
          <TitleLink href={href} name={about.name} className="line-clamp-4 text-base" />
          <p className="font-mono text-xs text-muted-foreground">{coverageLine(item)}</p>
          <p className="mt-auto border-t pt-3 text-right text-xs text-muted-foreground">
            <TimeStamp value={about.datePublished} format="date" />
          </p>
        </div>
      </Card>
    );
  }

  const creator = creatorLabel(item);
  const keywords = cardKeywords(item);

  return (
    <Card className={cn(CARD, "md:flex-row")}>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 md:px-6 md:pt-[22px] md:pb-[18px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <KindBadge kind={item.kind} />
          <span className="font-mono text-[11.5px] text-muted-foreground">{contentsLine(item)}</span>
          <span className="text-[12.5px] text-muted-foreground sm:ml-auto">
            Published <TimeStamp value={about.datePublished} format="date" />
          </span>
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

        <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-0 sm:gap-y-1.5" aria-label="Tags and keywords">
          {about.tags.map((tag) => (
            <TagChip key={tag} tag={tag} selected={selectedTags.includes(tag)} onToggle={onToggleTag} />
          ))}
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
          <div className="mt-auto flex justify-end border-t pt-3">
            <Skeleton className="h-3.5 w-20" />
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
          <Skeleton className="h-3.5 w-28 sm:ml-auto" />
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
      </div>
      <Skeleton className="h-36 shrink-0 rounded-none md:h-auto md:w-[260px]" />
    </Card>
  );
}
