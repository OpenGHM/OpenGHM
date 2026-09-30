import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { PREVIEW_GROUPS } from "@/lib/workspace/preview";

/**
 * Dev-only. `?preview=<key>` swaps in a fixture (`previewSimulation`, see
 * lib/workspace/preview.ts) so every status and every verdict cause renders
 * on this page without making Anvil produce it. Never rendered in
 * production, and unmistakably not real data when it is.
 */
export function DevPreviewSwitcher({
  jobId,
  active,
}: {
  jobId: string;
  /** The key of the preview on screen, or null for the real job. */
  active: string | null;
}) {
  return (
    <div className="border-b border-dashed border-status-draft/40 bg-status-draft/5">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-1.5 px-10 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-medium text-status-draft">
            <FlaskConical className="size-3.5" aria-hidden="true" />
            Dev preview
          </span>
          {active && (
            <Link
              href={`/workspace/${jobId}`}
              className="ml-auto text-status-draft underline-offset-2 hover:underline"
            >
              Exit preview
            </Link>
          )}
        </div>
        {PREVIEW_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-muted-foreground">{group.title}</span>
            {group.options.map((o) => (
              <Link
                key={o.key}
                href={`/workspace/${jobId}?preview=${o.key}`}
                className={`rounded-full border px-2 py-0.5 transition-colors ${
                  active === o.key
                    ? "border-status-draft bg-status-draft text-white"
                    : "border-status-draft/25 bg-white text-status-draft hover:bg-status-draft/10"
                }`}
              >
                {o.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
