"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { FilterPills } from "@/components/community/filter-pills";
import {
  PUBLICATION_TYPES,
  PUBLICATION_TYPE_LABEL,
  citationText,
  countLabel,
} from "@/lib/community/format";
import { isExternalHref, safeHref } from "@/lib/community/links";
import type { Publication, PublicationType } from "@/lib/community/types";
import { cn } from "@/lib/utils";

type TypeFilter = "all" | PublicationType;

/** A type's colour: its pill (text on a 10% tint of the hue) and its dot. */
const TYPE_STYLE: Record<PublicationType, { pill: string; dot: string }> = {
  paper: { pill: "bg-compute/10 text-compute", dot: "bg-compute" },
  dataset: { pill: "bg-secondary text-secondary-foreground", dot: "bg-primary" },
  software: { pill: "bg-success/10 text-success", dot: "bg-success" },
  talk: { pill: "bg-highlight/10 text-highlight", dot: "bg-highlight" },
};

/** How long "Copied ✓" stays on a Cite button. */
const COPIED_MS = 1400;

/**
 * The Publications part of the Community page: a type filter (only the types
 * that exist, and not at all when there is one) and a list with the year and
 * a coloured type pill, title, authors, venue, a link button and Cite. Cite
 * copies the citation to the clipboard and says so on the button for a moment;
 * when the browser refuses, the button says "Copy failed".
 */
export function PublicationsSection({ publications }: { publications: Publication[] }) {
  const [type, setType] = useState<TypeFilter>("all");
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const present = PUBLICATION_TYPES.filter((t) => publications.some((p) => p.type === t));
  const shown = type === "all" ? publications : publications.filter((p) => p.type === type);

  async function cite(p: Publication) {
    let ok = true;
    try {
      await navigator.clipboard.writeText(citationText(p));
    } catch {
      ok = false;
    }
    setCopied({ id: p.id, ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  }

  return (
    <section aria-labelledby="publications-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="publications-heading" className="text-2xl font-bold tracking-[-0.025em]">
          Publications
        </h2>
        {present.length > 1 && (
          <FilterPills<TypeFilter>
            label="Filter publications by type"
            value={type}
            onChange={setType}
            options={[
              { id: "all", label: "All" },
              ...present.map((t) => ({
                id: t,
                label: PUBLICATION_TYPE_LABEL[t],
                mark: <span aria-hidden="true" className={cn("size-2 rounded-[2px]", type === t ? "bg-white" : TYPE_STYLE[t].dot)} />,
              })),
            ]}
          />
        )}
      </div>

      <p role="status" className="sr-only">
        {copied ? (copied.ok ? "Citation copied." : "The citation could not be copied.") : countLabel(shown.length, "publication")}
      </p>

      {shown.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card px-6 py-10 text-center text-[15px] text-muted-foreground">
          No publications of this type yet.
        </div>
      ) : (
        <ul className="rounded-card bg-card px-5 py-1.5 shadow-card sm:px-[26px]">
          {shown.map((p) => {
            const href = safeHref(p.link_url);
            const external = href ? isExternalHref(href) : false;
            const style = TYPE_STYLE[p.type];
            const mine = copied?.id === p.id ? copied : null;
            return (
              <li key={p.id} className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border py-[22px] first:border-t-0">
                <div className="flex flex-[0_0_76px] flex-col gap-2">
                  <span className="font-mono text-xl font-medium">{p.year}</span>
                  <span className={cn("flex w-fit items-center gap-1.5 rounded-full px-2 py-[3px] text-[11.5px] font-semibold", style.pill)}>
                    <span aria-hidden="true" className={cn("size-1.5 rounded-[2px]", style.dot)} />
                    {PUBLICATION_TYPE_LABEL[p.type]}
                  </span>
                </div>
                <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1.5">
                  <span className="text-base leading-[1.4] font-semibold tracking-[-0.01em] text-pretty">{p.title}</span>
                  {p.authors && <span className="text-[13.5px] leading-normal text-foreground/80">{p.authors}</span>}
                  {p.venue && <span className="text-[13.5px] text-muted-foreground italic">{p.venue}</span>}
                </div>
                <div className="flex flex-none items-start gap-1.5">
                  {href && (
                    <a
                      href={href}
                      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="inline-flex min-h-10 items-center gap-1 rounded-[10px] bg-muted px-3 font-mono text-[12.5px] transition-colors hover:bg-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {p.link_label?.trim() || "Link"}
                      <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      {external && <span className="sr-only"> (opens in a new tab)</span>}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void cite(p)}
                    aria-label={mine ? undefined : `Cite ${p.title}`}
                    className="min-h-10 rounded-[10px] bg-hero px-3 text-[13px] font-semibold text-white transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    {mine ? (mine.ok ? "Copied ✓" : "Copy failed") : "Cite"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
