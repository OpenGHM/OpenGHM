"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FilterPills } from "@/components/community/filter-pills";
import { LevelGlyph } from "@/components/community/level-glyph";
import {
  KIND_LABEL,
  LEVEL_LABEL,
  TUTORIAL_LEVELS,
  countLabel,
  minutesLabel,
  tutorialActionLabel,
  tutorialLink,
} from "@/lib/community/format";
import type { TutorialCard, TutorialLevel } from "@/lib/community/types";

type LevelFilter = "all" | TutorialLevel;

/**
 * The Tutorials part of the Community page: a level filter and a grid of
 * cards. A card is a dark header (its kind and length, and the admin's
 * snippet), the level, the title and summary, and one action. With written
 * content the action opens the tutorial's own page; otherwise its link; with
 * neither the card has no action. The filter lists only the levels that
 * exist, and is left out when there is only one.
 */
export function TutorialsSection({ tutorials }: { tutorials: TutorialCard[] }) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const present = TUTORIAL_LEVELS.filter((l) => tutorials.some((t) => t.level === l));
  const shown = level === "all" ? tutorials : tutorials.filter((t) => t.level === level);

  return (
    <section aria-labelledby="tutorials-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tutorials-heading" className="text-2xl font-bold tracking-[-0.025em]">
          Tutorials
        </h2>
        {present.length > 1 && (
          <FilterPills<LevelFilter>
            label="Filter tutorials by level"
            value={level}
            onChange={setLevel}
            options={[
              { id: "all", label: "All" },
              ...present.map((l) => ({
                id: l,
                label: LEVEL_LABEL[l],
                mark: <LevelGlyph level={l} on={level === l} />,
              })),
            ]}
          />
        )}
      </div>

      <p role="status" className="sr-only">
        {countLabel(shown.length, "tutorial")}
      </p>

      {shown.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card px-6 py-10 text-center text-[15px] text-muted-foreground">
          No tutorials at this level yet.
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(290px,100%),1fr))] gap-3.5">
          {shown.map((t) => (
            <li key={t.id} className="flex">
              <TutorialCardView tutorial={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TutorialCardView({ tutorial: t }: { tutorial: TutorialCard }) {
  const link = tutorialLink(t);
  const minutes = minutesLabel(t.minutes);
  const label = tutorialActionLabel(t);
  const ActionIcon = link?.external ? ArrowUpRight : ArrowRight;
  return (
    <article className="relative flex w-full flex-col rounded-card bg-card p-2 shadow-card transition-[transform,box-shadow] hover:shadow-lift has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring motion-safe:hover:-translate-y-0.5">
      <div className="relative flex min-h-[132px] flex-col gap-3.5 overflow-hidden rounded-2xl bg-hero px-[18px] pt-[18px] pb-4">
        <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
        <div className="relative flex items-center justify-between gap-2 font-mono text-[11.5px]">
          <span className="tracking-[0.06em] text-hero-eyebrow">{KIND_LABEL[t.kind]}</span>
          {minutes && <span className="text-hero-faint">{minutes}</span>}
        </div>
        {t.snippet && (
          <code className="relative font-mono text-[12.5px] leading-[1.6] break-words whitespace-pre-wrap text-hero-text">
            {t.snippet}
          </code>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-[9px] px-3 pt-4 pb-2.5">
        <span className="flex items-center gap-[7px] text-xs font-semibold text-foreground/80">
          <LevelGlyph level={t.level} />
          {LEVEL_LABEL[t.level]}
        </span>
        <h3 className="text-[17px] leading-[1.3] font-semibold tracking-[-0.02em] text-pretty">{t.title}</h3>
        {t.summary && <p className="text-[13.5px] leading-[1.55] text-muted-foreground text-pretty">{t.summary}</p>}
        {link && (
          <Link
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="mt-auto flex items-center gap-1.5 pt-1.5 text-sm font-semibold text-primary after:absolute after:inset-0 after:rounded-[inherit] hover:text-primary-hover focus-visible:outline-none"
          >
            {label}
            <ActionIcon aria-hidden="true" className="size-3.5" />
            {link.external && <span className="sr-only"> (opens in a new tab)</span>}
          </Link>
        )}
      </div>
    </article>
  );
}
