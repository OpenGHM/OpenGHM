import { Mail } from "lucide-react";
import type { PartialAbout } from "@/lib/jobs/types";
import { TagChips } from "@/components/repository/tag-chips";

/** Read-only display of a simulation's `about` block, once it can no
 * longer be edited (past DRAFT). Renders nothing if the simulation was
 * never given a description — about is optional right up to submission. */
export function AboutSummaryCard({ about }: { about: PartialAbout | null }) {
  if (!about || Object.keys(about).length === 0) return null;

  return (
    <section aria-labelledby="about-heading">
      <h2 id="about-heading" className="mb-3 text-lg font-semibold text-foreground">
        About
      </h2>
      <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        {about.name && <p className="text-base font-semibold text-foreground">{about.name}</p>}
        {about.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{about.description}</p>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          {about.tags && about.tags.length > 0 && <TagChips tags={about.tags} />}
          {about.license && <span className="text-xs text-muted-foreground">License: {about.license}</span>}
        </div>
        {about.keywords && about.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {about.keywords.map((kw) => (
              <span
                key={kw}
                className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
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
      </div>
    </section>
  );
}
