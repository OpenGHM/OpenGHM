import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { PREVIEW_GROUPS } from "@/lib/workspace/preview";

/**
 * Dev-only. The links of `/dev/workspace/<key>`, one per state the design
 * preview can show (lib/workspace/preview.ts), so every status and every
 * verdict cause renders without making Anvil produce it. Only that route
 * renders it, and it answers 404 in production.
 */
export function DevPreviewSwitcher({
  active,
}: {
  /** The key of the preview on screen. */
  active: string;
}) {
  return (
    <div className="border-b border-dashed border-status-draft/40 bg-status-draft/5">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-1.5 px-4 py-2 text-xs sm:px-10">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-medium text-status-draft">
            <FlaskConical className="size-3.5" aria-hidden="true" />
            Dev preview
          </span>
          <Link
            href="/workspace"
            className="ml-auto text-status-draft underline-offset-2 hover:underline"
          >
            Exit preview
          </Link>
        </div>
        {PREVIEW_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-muted-foreground">{group.title}</span>
            {group.options.map((o) => (
              <Link
                key={o.key}
                href={`/dev/workspace/${encodeURIComponent(o.key)}`}
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
