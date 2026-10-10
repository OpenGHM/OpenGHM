import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CoverImage } from "@/components/community/cms-image";
import { FormatPill, StatusPill } from "@/components/community/workshop-pills";
import { dateBadge, formatLongDate, splitWorkshops, whenLabel, workshopHints } from "@/lib/community/format";
import { safeImageSrc } from "@/lib/community/links";
import type { WorkshopCard } from "@/lib/community/types";
import { cn } from "@/lib/utils";

/**
 * The Workshops part of the Community page: the next upcoming workshop as a
 * large card, any later upcoming ones as rows, then the past ones as rows with
 * a date block. It always starts with a card (the workshop, or a note that
 * none is scheduled), because the page pulls its first card up into the navy
 * band. Each card or row has one link, its title, stretched over the whole
 * surface.
 */
export function WorkshopsSection({ workshops }: { workshops: WorkshopCard[] }) {
  const { upcoming, past } = splitWorkshops(workshops);
  const [next, ...later] = upcoming;

  if (workshops.length === 0) {
    return (
      <section aria-labelledby="workshops-heading" className="flex flex-col gap-4">
        <h2 id="workshops-heading" className="sr-only">
          Workshops
        </h2>
        <EmptyCard>No workshops are listed yet. When one is announced, it appears here.</EmptyCard>
      </section>
    );
  }

  return (
    <section aria-labelledby="workshops-heading" className="flex flex-col gap-4">
      <h2 id="workshops-heading" className="sr-only">
        Workshops
      </h2>

      {next ? (
        <FeaturedWorkshop workshop={next} />
      ) : (
        <EmptyCard>No workshop is scheduled right now. New dates are announced here.</EmptyCard>
      )}

      {later.length > 0 && (
        <>
          <SubHeading>More upcoming workshops</SubHeading>
          <ul className="flex flex-col gap-2.5">
            {later.map((w) => (
              <WorkshopRow key={w.id} workshop={w} />
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <>
          <SubHeading>Past workshops</SubHeading>
          <ul className="flex flex-col gap-2.5">
            {past.map((w) => (
              <WorkshopRow key={w.id} workshop={w} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SubHeading({ children }: { children: string }) {
  return <h3 className="mt-5 text-2xl font-bold tracking-[-0.025em]">{children}</h3>;
}

function EmptyCard({ children }: { children: string }) {
  return (
    <div className="rounded-card border border-dashed border-border bg-card px-6 py-10 text-center text-[15px] text-muted-foreground shadow-raised">
      {children}
    </div>
  );
}

const CARD_LINK =
  "after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none";

function FeaturedWorkshop({ workshop: w }: { workshop: WorkshopCard }) {
  const cover = w.cover && safeImageSrc(w.cover.url) ? w.cover : null;
  const where = w.location?.trim() || w.format?.trim() || null;
  return (
    <article className="group relative flex flex-col gap-2.5 rounded-card border border-transparent bg-card p-2.5 shadow-raised transition-colors hover:border-primary/25 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      {cover && (
        // Above the text, never cropped: a cover is often a wide banner,
        // which a side column would cut to its middle.
        <CoverImage src={cover.url} alt={cover.alt} imgClassName="max-h-[420px]" />
      )}
      <div className="flex flex-col justify-center gap-4 px-5 py-6 sm:px-[30px] sm:py-7">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status="upcoming" label="Next workshop" />
          {w.format && <FormatPill>{w.format}</FormatPill>}
        </div>
        <h3 className="text-[clamp(24px,2.6vw,32px)] leading-[1.15] font-bold tracking-[-0.03em] text-balance">
          <Link href={`/community/workshops/${w.slug}`} className={CARD_LINK}>
            {w.title}
          </Link>
        </h3>
        {w.summary && <p className="max-w-[620px] text-[15px] leading-[1.6] text-muted-foreground text-pretty">{w.summary}</p>}
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          <Fact label="When" mono>
            {whenLabel(w)}
          </Fact>
          {where && <Fact label="Where">{where}</Fact>}
        </dl>
        <span aria-hidden="true" className="text-sm font-semibold text-primary transition-colors group-hover:text-primary-hover">
          View details →
        </span>
      </div>
    </article>
  );
}

function Fact({ label, mono, children }: { label: string; mono?: boolean; children: string }) {
  return (
    <div className="flex flex-col gap-[3px] rounded-xl bg-muted px-3.5 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm", mono && "font-mono")}>{children}</dd>
    </div>
  );
}

function WorkshopRow({ workshop: w }: { workshop: WorkshopCard }) {
  const badge = dateBadge(w.date);
  const upcoming = w.status === "upcoming";
  const hints = workshopHints(w);
  return (
    <li className="group relative flex flex-wrap items-center gap-x-[22px] gap-y-3.5 rounded-[18px] border border-transparent bg-card py-3.5 pr-5 pl-3.5 transition-colors hover:border-primary/25 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <time
        dateTime={w.date}
        aria-label={formatLongDate(w.date)}
        className={cn(
          "flex size-[72px] shrink-0 flex-col items-center justify-center gap-px rounded-[14px]",
          upcoming ? "bg-hero text-white" : "bg-muted text-foreground/80",
        )}
      >
        <span className="font-mono text-[11.5px] tracking-[0.06em]">{badge.month}</span>
        <span className="text-2xl leading-none font-bold tracking-[-0.03em]">{badge.day}</span>
        <span className="font-mono text-[10.5px] opacity-75">{badge.year}</span>
      </time>
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1.5">
        <Link
          href={`/community/workshops/${w.slug}`}
          className={cn(CARD_LINK, "text-base font-semibold tracking-[-0.01em] text-pretty")}
        >
          {w.title}
        </Link>
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          {w.format && <FormatPill small>{w.format}</FormatPill>}
          {w.location && <span>{w.location}</span>}
          {w.when_label && <span className="font-mono text-xs">{w.when_label}</span>}
        </span>
      </div>
      {hints.length > 0 && <span className="text-[12.5px] text-muted-foreground">{hints.join(" · ")}</span>}
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" />
    </li>
  );
}
