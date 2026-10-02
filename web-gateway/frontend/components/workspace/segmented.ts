/**
 * The classes of the Workspace lists' filter control: the Data Repository's
 * List / Grid switch, in links. A quiet pill track with the selected segment
 * lifted onto the card colour. The list's status filter and the Snapshots &
 * Inputs kind filter both draw it, so they cannot drift apart. The track
 * scrolls inside itself on a phone (the page never does), without a scrollbar.
 */
export const SEGMENTED_TRACK =
  "max-w-full overflow-x-auto rounded-xl bg-muted p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** One segment, 40 px tall. */
export function segmentClass(selected: boolean): string {
  return `relative flex min-h-10 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium whitespace-nowrap text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none ${
    selected ? "bg-card shadow-sm" : "hover:bg-card/60"
  }`;
}

/** The count after a segment's label. */
export function segmentCountClass(selected: boolean): string {
  return `text-xs tabular-nums ${selected ? "text-foreground/70" : "text-muted-foreground"}`;
}
