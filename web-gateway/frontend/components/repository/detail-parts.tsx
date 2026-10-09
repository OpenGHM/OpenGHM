import Link from "next/link";
import { BoundingBoxMap } from "@/components/repository/bounding-box-map-dynamic";
import { DetailSection } from "@/components/repository/detail-section";
import { Badge } from "@/components/ui/badge";
import { clampClass, type ClampLines } from "@/components/common/clamped-name";
import type { Dataset } from "@/lib/repository/types";
import { cn } from "@/lib/utils";

type About = Dataset["about"];

export function DescriptionSection({ description }: { description: string }) {
  return (
    <DetailSection title="Description" heading="eyebrow" raised>
      <p className="text-[17px] leading-[1.6] text-pretty text-foreground/90">{description}</p>
    </DetailSection>
  );
}

/** The map beside the box's four limits and its projection. */
export function SpatialCoverageSection({
  north,
  south,
  east,
  west,
  projection,
}: {
  north: number;
  south: number;
  east: number;
  west: number;
  projection: string;
}) {
  const limits = [
    { label: "N", value: north },
    { label: "S", value: south },
    { label: "E", value: east },
    { label: "W", value: west },
  ];
  return (
    <section className="isolate grid items-center gap-x-6 gap-y-4 rounded-card bg-card p-3.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <BoundingBoxMap north={north} south={south} east={east} west={west} />
      <div className="flex min-w-0 flex-col gap-2 px-1 pb-1 md:pr-4 md:pb-0">
        <div className="flex items-center justify-between gap-2.5">
          <h2 className="text-base font-semibold tracking-[-0.02em]">Spatial Coverage</h2>
          <span className="rounded-full bg-muted px-[9px] py-[3px] font-mono text-[11.5px] text-muted-foreground">
            {projection}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-5">
          {limits.map((l) => (
            <div key={l.label} className="flex justify-between gap-2.5 border-t border-border/60 py-[7px]">
              <dt className="text-[12.5px] text-muted-foreground">{l.label}</dt>
              <dd className="font-mono text-[13px] font-medium">{l.value}°</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// The data colours for the process chips (a dot, and the colour at 12% as the chip), taken in turn: a
// chip's colour tells the chips apart, it does not say what the process is.
const PROCESS_COLOURS = [
  "var(--data-1)",
  "var(--data-3)",
  "var(--data-6)",
  "var(--data-4)",
  "var(--data-2)",
  "var(--data-5)",
] as const;

export function ActiveProcessesSection({ processes }: { processes: readonly string[] }) {
  return (
    <DetailSection title="Active Processes">
      <ul className="flex flex-wrap gap-2">
        {processes.map((process, i) => {
          const colour = PROCESS_COLOURS[i % PROCESS_COLOURS.length];
          return (
            <li
              key={process}
              style={{ backgroundColor: `color-mix(in srgb, ${colour} 12%, transparent)` }}
              className="flex items-center gap-2 rounded-full px-[13px] py-2 text-[13.5px] text-foreground"
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: colour }}
                className="size-2 shrink-0 rounded-full"
              />
              {process}
            </li>
          );
        })}
      </ul>
    </DetailSection>
  );
}

/** One bordered link card per link; the title is the link and its box is the click target. */
export function RelatedLinksSection({ links }: { links: NonNullable<About["relatedLink"]> }) {
  return (
    <DetailSection title="Related Links">
      <ul className="flex flex-col gap-3.5">
        {links.map((link) => (
          <li
            key={link.url}
            className="relative flex items-center justify-between gap-4 rounded-[14px] border border-border px-[18px] py-4 transition-colors hover:border-primary has-[a:focus-visible]:border-primary has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15.5px] font-semibold text-primary outline-none after:absolute after:inset-0 after:content-['']"
              >
                {link.roleName ?? link.relation}
              </a>
              {link.description && (
                <p className="text-[13.5px] text-muted-foreground">{link.description}</p>
              )}
              {link.doi && (
                <p className="font-mono text-xs break-all text-muted-foreground">DOI: {link.doi}</p>
              )}
            </div>
            <span aria-hidden="true" className="shrink-0 text-lg text-primary">
              ↗
            </span>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

export interface InfoRowData {
  label: string;
  value: string;
  /** An external link (a licence). */
  href?: string;
  /** A page of this site. */
  internalHref?: string;
  /** A tooltip for the value, for what does not fit the row (a hash). */
  title?: string;
  /** Keep the value to this many lines, the whole of it on hover: for a name, which can be any length. */
  clamp?: ClampLines;
  /** Set a code, a number or a range in the mono face. */
  mono?: boolean;
}

/** The side column's label-over-value card; `rows` in the order they are listed. */
export function InfoSection({ title, rows }: { title: string; rows: InfoRowData[] }) {
  return (
    <DetailSection title={title} heading="side" raised className="gap-2 pb-2.5">
      <dl className="flex flex-col">
        {rows.map((row) => (
          <InfoRow key={row.label} {...row} />
        ))}
      </dl>
    </DetailSection>
  );
}

const LINK_CLASS = "text-primary transition-colors hover:text-primary-hover";

function InfoRow({ label, value, href, internalHref, title, clamp, mono }: InfoRowData) {
  return (
    <div className="flex flex-col gap-[3px] border-t border-border/60 py-[11px]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn("text-sm leading-snug font-medium text-pretty", mono && "font-mono")}
        title={title ?? (clamp ? value : undefined)}
      >
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("[overflow-wrap:anywhere]", LINK_CLASS)}
          >
            {value}
          </a>
        ) : internalHref ? (
          <Link
            href={internalHref}
            className={cn(clamp ? clampClass(clamp) : "[overflow-wrap:anywhere]", LINK_CLASS)}
          >
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export function KeywordsSection({ keywords }: { keywords: readonly string[] }) {
  return (
    <DetailSection title="Keywords" heading="side">
      <ul className="flex flex-wrap gap-1.5">
        {keywords.map((keyword) => (
          <li key={keyword} className="max-w-full">
            <Badge
              variant="mono"
              className="max-w-full px-[11px] py-[5px] text-xs font-normal whitespace-normal text-foreground [overflow-wrap:anywhere]"
            >
              {keyword}
            </Badge>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

export function CreatorsSection({ creators }: { creators: About["creator"] }) {
  return (
    <DetailSection title="Creators" heading="side">
      <ul className="flex flex-col">
        {creators.map((creator, i) => (
          <li
            key={i}
            className="flex items-center gap-3 border-t border-border/60 py-3 first:border-t-0 first:pt-0 last:pb-0"
          >
            <div
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground"
            >
              {creator.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14.5px] font-semibold [overflow-wrap:anywhere]">{creator.name}</span>
              {creator.email && (
                <a
                  href={`mailto:${creator.email}`}
                  className={cn("text-[13px] [overflow-wrap:anywhere]", LINK_CLASS)}
                >
                  {creator.email}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}
