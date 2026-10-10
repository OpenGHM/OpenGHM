import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countLabel, materialKind, type MaterialTag } from "@/lib/community/format";
import { COMMUNITY_FILE_PREFIX, isExternalHref, safeHref } from "@/lib/community/links";
import type { Workshop, WorkshopMaterial } from "@/lib/community/types";
import { cn } from "@/lib/utils";

/** The tile of a material: its type's tag, tinted in a hue (text on a 10% tint of the same hue). */
const TAG_STYLE: Record<MaterialTag, string> = {
  PDF: "bg-status-failed/10 text-status-failed",
  PPT: "bg-highlight/10 text-highlight",
  DOC: "bg-info/10 text-info",
  XLS: "bg-success/10 text-success",
  ZIP: "bg-muted text-foreground/70",
  IPYNB: "bg-secondary text-secondary-foreground",
  VIDEO: "bg-compute/10 text-compute",
  IMG: "bg-data-3/20 text-foreground",
  LINK: "bg-muted text-foreground/70",
};

/**
 * What a workshop hands out: a row per material with a coloured type tile, its
 * name and note, and "Download ↓" for a file or "Open ↗" for a link. An
 * uploaded file downloads from this site; any other address opens in a new
 * tab. A material whose address is not safe to link to is left out.
 */
export function MaterialsList({ materials }: { materials: WorkshopMaterial[] }) {
  const items = materials.flatMap((m) => {
    const href = safeHref(m.url);
    return href ? [{ m, href }] : [];
  });
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="materials-heading" className="flex flex-col gap-1.5 rounded-card bg-card p-6 shadow-card sm:px-[30px] sm:py-7">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 id="materials-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Materials
        </h2>
        <span className="font-mono text-[12.5px] text-muted-foreground">{countLabel(items.length, "file")}</span>
      </div>
      <ul>
        {items.map(({ m, href }, i) => {
          const { tag, download } = materialKind(m);
          const upload = href.startsWith(COMMUNITY_FILE_PREFIX);
          const external = isExternalHref(href);
          return (
            <li key={`${i}-${m.url}`} className="border-t border-border">
              <a
                href={href}
                {...(download && upload ? { download: "" } : {})}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="group flex items-center gap-3.5 rounded-lg px-1 py-3.5 text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-xl font-mono text-[10.5px] font-medium tracking-[0.04em]",
                    TAG_STYLE[tag],
                  )}
                >
                  {tag}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold break-words">{m.name}</span>
                  {m.note && <span className="text-[12.5px] text-muted-foreground">{m.note}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-muted px-3 py-2 text-[13px] font-semibold text-foreground">
                  {download ? "Download ↓" : "Open ↗"}
                  {external && <span className="sr-only"> (opens in a new tab)</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The "Details" card beside a workshop: When, Format and Location, then the
 * admin's own rows in the order they wrote them, then the sign-up button when
 * the workshop has a sign-up link.
 */
export function WorkshopDetails({ workshop: w, when }: { workshop: Workshop; when: string }) {
  const rows: { label: string; value: string }[] = [
    { label: "When", value: when },
    ...(w.format ? [{ label: "Format", value: w.format }] : []),
    ...(w.location ? [{ label: "Location", value: w.location }] : []),
    ...w.details.filter((d) => d.label.trim() && d.value.trim()),
  ];
  const signupHref = w.signup ? safeHref(w.signup.url) : null;
  return (
    <aside
      aria-labelledby="details-heading"
      className="min-w-0 rounded-card bg-card px-6 pt-6 pb-3.5 shadow-raised lg:sticky lg:top-5"
    >
      <h2 id="details-heading" className="mb-2 text-[17px] font-semibold tracking-[-0.02em]">
        Details
      </h2>
      <dl>
        {rows.map((row, i) => (
          <div key={`${i}-${row.label}`} className="flex flex-col gap-[3px] border-t border-border py-[11px]">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="text-sm leading-[1.45] break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      {w.signup && signupHref && (
        <div className="border-t border-border pt-3.5 pb-1.5">
          <Button asChild size="lg" className="h-11 w-full justify-between">
            <a
              href={signupHref}
              {...(isExternalHref(signupHref) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {w.signup.label}
              <ArrowUpRight aria-hidden="true" />
              {isExternalHref(signupHref) && <span className="sr-only"> (opens in a new tab)</span>}
            </a>
          </Button>
        </div>
      )}
    </aside>
  );
}
