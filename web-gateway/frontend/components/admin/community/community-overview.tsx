import Link from "next/link";
import { BookOpen, CalendarDays, FileStack, Settings2, Newspaper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const LINK_CLASS = "block h-full rounded-card focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** A count that could not be read is null and shows a dash, not a zero. */
export interface SectionFigures {
  total: number | null;
  drafts: number | null;
}

function SectionCard({
  href,
  title,
  description,
  icon: Icon,
  figures,
  unit,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  figures?: SectionFigures;
  unit?: string;
}) {
  return (
    <Link href={href} className={LINK_CLASS}>
      <Card className="h-full transition-shadow hover:shadow-raised">
        <CardContent className="flex h-full flex-col gap-3 py-1">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-secondary text-primary">
              <Icon className="size-4" />
            </span>
            <p className="text-[17px] font-semibold text-foreground">{title} →</p>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          {figures && (
            <p className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1">
              <span className="font-mono text-2xl font-semibold text-foreground">{figures.total ?? "—"}</span>
              <span className="text-xs text-muted-foreground">{unit}</span>
              {figures.drafts !== null && figures.drafts > 0 && (
                <span className={cn("rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground")}>
                  {figures.drafts} hidden
                </span>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * The Community admin's front page: one card for each section, with how many
 * items it holds and how many of them are hidden from the site.
 */
export function CommunityOverview({
  workshops,
  tutorials,
  publications,
  files,
}: {
  workshops: SectionFigures;
  tutorials: SectionFigures;
  publications: SectionFigures;
  files: number | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <SectionCard
        href="/admin/community/workshops"
        title="Workshops"
        description="Announcements and past events, with their materials."
        icon={CalendarDays}
        figures={workshops}
        unit="workshops"
      />
      <SectionCard
        href="/admin/community/tutorials"
        title="Tutorials"
        description="Cards that lead people into the gateway, a notebook or a video."
        icon={BookOpen}
        figures={tutorials}
        unit="tutorials"
      />
      <SectionCard
        href="/admin/community/publications"
        title="Publications"
        description="Papers, datasets, software and talks."
        icon={Newspaper}
        figures={publications}
        unit="publications"
      />
      <SectionCard
        href="/admin/community/settings"
        title="Page settings"
        description="The heading of the page and the Discussion groups section."
        icon={Settings2}
      />
      <SectionCard
        href="/admin/community/files"
        title="Files"
        description="Every image and document uploaded for the page."
        icon={FileStack}
        figures={{ total: files, drafts: 0 }}
        unit="files"
      />
    </div>
  );
}
