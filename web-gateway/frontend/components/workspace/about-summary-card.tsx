import { BookOpen, Mail } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { PartialAbout } from "@/lib/jobs/types";

/** Read-only display of a simulation's `about` block, once it can no
 * longer be edited (past DRAFT). Renders nothing if the simulation was
 * never given a description — about is optional right up to submission. */
export function AboutSummaryCard({ about }: { about: PartialAbout | null }) {
  if (!about || Object.keys(about).length === 0) return null;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <BookOpen className="size-4 text-primary" />
          </div>
          About
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        {about.name && <p className="text-base font-semibold text-foreground">{about.name}</p>}
        {about.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{about.description}</p>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          {about.category && (
            <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
              {about.category}
            </span>
          )}
          {about.license && <span className="text-xs text-muted-foreground">License: {about.license}</span>}
        </div>
        {about.keywords && about.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {about.keywords.map((kw) => (
              <span
                key={kw}
                className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {kw}
              </span>
            ))}
          </div>
        )}
        {about.creator && about.creator.length > 0 && (
          <ul className="space-y-1.5">
            {about.creator.map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                {c.name}
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:text-accent"
                  >
                    <Mail className="size-3" />
                    {c.email}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
