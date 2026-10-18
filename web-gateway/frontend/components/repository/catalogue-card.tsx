import Link from "next/link";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeStamp } from "@/components/common/time-stamp";
import { ClampedName } from "@/components/common/clamped-name";
import { cn } from "@/lib/utils";
import { humanizeTag } from "@/lib/repository/catalogue";
import {
  cardKeywords,
  contentsLine,
  coverageLine,
  creatorLabel,
  detailHref,
  periodLabel,
  resolutionSummary,
  spatialBox,
} from "@/lib/repository/catalogue-format";
import type { CatalogueItem, CatalogueView } from "@/lib/repository/types";
import { CoverageThumbnail } from "./coverage-thumbnail";
import { KindBadge } from "./kind-badge";

/** The grid the cards sit in, wherever they are listed in the grid view. */
export const CARD_GRID_CLASS = "grid gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]";

/**
 * The surface of a card the whole of which is one control (a link here, a
 * button in the Start screen's snapshot picker, which borrows it). It is
 * `relative` for the control's overlay and the `group/card` the hover effects
 * hang from: on hover it lifts 2px and its shadow deepens (the lift is
 * `motion-safe:`; the shadow still changes under reduced motion).
 */
export const CARD_SURFACE =
  "group/card relative cursor-pointer gap-0 overflow-hidden rounded-card border-0 py-0 shadow-card transition-[translate,box-shadow] duration-300 ease-out hover:shadow-lift motion-safe:hover:-translate-y-0.5";

/** `CARD_SURFACE`, and the focus ring on the card itself when the title link has keyboard focus. */
const CARD = `${CARD_SURFACE} has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50`;

/**
 * The card's call to action. It looks like the design's primary button, but the
 * card is the link (the title's stretched link covers it), so it is `aria-hidden`
 * text that takes no pointer events and darkens when the card is hovered or
 * its link has keyboard focus.
 */
function ViewButton({ children, className }: { children: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none inline-flex items-center rounded-[11px] bg-primary px-4 py-[9px] text-[13px] font-semibold whitespace-nowrap text-primary-foreground transition-colors group-hover/card:bg-primary-hover group-has-[a:focus-visible]/card:bg-primary-hover motion-reduce:transition-none",
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * A tag as a filter control, the emphasised chip of the row (outlined, no fill).
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
            "inline-flex max-w-full items-center gap-1 rounded-full border px-[9px] py-[3px] text-[11.5px] font-medium transition-colors group-focus-visible/tag:ring-[3px] group-focus-visible/tag:ring-ring/50 motion-reduce:transition-none",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-transparent text-foreground group-hover/tag:border-foreground/30"
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
            "inline-flex max-w-full items-center gap-1 rounded-full border px-[9px] py-[3px] font-mono text-[11.5px] transition-colors group-focus-visible/keyword:ring-[3px] group-focus-visible/keyword:ring-ring/50 motion-reduce:transition-none",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted/60 text-foreground/80 group-hover/keyword:border-foreground/30 group-hover/keyword:text-foreground"
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
    <div className="flex min-w-0 flex-col gap-[3px] rounded-xl bg-muted px-3 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd title={title} className={cn("text-[13px] font-medium break-words text-foreground", mono && "font-mono")}>
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
    <ClampedName
      as="h3"
      lines={3}
      title={name}
      className={cn("leading-snug font-semibold text-foreground", className)}
    >
      <Link
        href={href}
        className="outline-none after:absolute after:inset-0 after:content-['']"
      >
        {name}
      </Link>
    </ClampedName>
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
      <Card className={cn(CARD, "h-full p-2")}>
        <div className="relative h-40 shrink-0 overflow-hidden rounded-2xl bg-accent">
          <CoverageThumbnail box={toBox(item)} aspect="wide" className="absolute inset-0 aspect-auto rounded-none border-0" />
        </div>
        <div className="flex flex-1 flex-col gap-2.5 px-2.5 pt-3.5 pb-2">
          <KindBadge kind={item.kind} />
          <TitleLink href={href} name={about.name} className="text-[15.5px] tracking-[-0.015em]" />
          <p className="font-mono text-xs text-muted-foreground">{coverageLine(item)}</p>
          <div className="mt-auto flex items-center gap-1.5 pt-2">
            <ViewButton className="px-3.5 py-2">View details →</ViewButton>
            <span className="ml-auto text-xs text-muted-foreground">
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
    <Card className={cn(CARD, "gap-2.5 p-2.5 md:flex-row")}>
      <div className="relative h-44 shrink-0 overflow-hidden rounded-2xl bg-accent md:h-auto md:min-h-[200px] md:w-[260px]">
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

      <div className="flex min-w-0 flex-1 flex-col gap-3 px-3.5 pt-3.5 pb-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <KindBadge kind={item.kind} />
          <span className="font-mono text-[11.5px] text-muted-foreground">{contentsLine(item)}</span>
          <span className="text-xs text-muted-foreground sm:ml-auto">
            Published <TimeStamp value={about.datePublished} format="date" />
          </span>
        </div>

        <TitleLink href={href} name={about.name} className="text-[19px] tracking-[-0.02em]" />

        <p className="line-clamp-2 text-sm leading-[1.55] text-muted-foreground">{about.description}</p>

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
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

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <ul
            className="flex min-w-0 flex-[1_1_200px] flex-wrap items-center gap-x-1.5 gap-y-0 sm:gap-y-1.5"
            aria-label="Tags and keywords"
          >
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
          <ViewButton>View details →</ViewButton>
        </div>
      </div>
    </Card>
  );
}

/** The card's shape while the list or grid loads. */
export function CatalogueCardSkeleton({ view = "list" }: { view?: CatalogueView }) {
  if (view === "grid") {
    return (
      <Card aria-hidden="true" className="h-full gap-0 overflow-hidden rounded-card border-0 p-2 shadow-card">
        <Skeleton className="h-40 shrink-0 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2.5 px-2.5 pt-3.5 pb-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3.5 w-32" />
          <div className="mt-auto flex items-center justify-between pt-2">
            <Skeleton className="h-8 w-20 rounded-[11px]" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card aria-hidden="true" className="gap-2.5 overflow-hidden rounded-card border-0 p-2.5 shadow-card md:flex-row">
      <Skeleton className="h-44 shrink-0 rounded-2xl md:h-auto md:min-h-[200px] md:w-[260px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-3.5 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 w-28 sm:ml-auto" />
        </div>
        <Skeleton className="h-5 w-2/3" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="ml-auto h-9 w-28 rounded-[11px]" />
        </div>
      </div>
    </Card>
  );
}
