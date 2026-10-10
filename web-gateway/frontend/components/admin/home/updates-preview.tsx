import { Pin } from "lucide-react";
import { TimeStamp } from "@/components/common/time-stamp";
import { KIND_LABEL, TAG_CLASS, pinKey } from "@/lib/home/format";
import type { FeedItem } from "@/lib/home/types";
import { cn } from "@/lib/utils";

/**
 * What the home page shows now, in the order it shows it: the cards the
 * public feed returns for the saved settings. Each row says what it is, its
 * tag and date, and whether it is pinned. Read-only.
 */
export function UpdatesPreview({ items }: { items: FeedItem[] | null }) {
  if (items === null) {
    return (
      <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Couldn&apos;t load the preview. The settings below are not affected.
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing to show: no source has a published item. The home page leaves the section out.
      </p>
    );
  }
  return (
    <ol aria-label="What the home page shows now" className="space-y-2">
      {items.map((item, i) => (
        <li key={pinKey(item)} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5">
          <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className={cn("rounded-full px-2 py-0.5 font-semibold", TAG_CLASS[item.tag])}>{item.tag_label}</span>
              <span>{KIND_LABEL[item.kind]}</span>
              <TimeStamp value={item.date} format="date" />
            </p>
          </div>
          {item.pinned && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
              <Pin className="size-3" aria-hidden="true" />
              Pinned
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
