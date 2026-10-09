/**
 * The classes of the Workspace lists' filter control: the Data Repository's
 * List / Grid switch, in links. A quiet track (`bg-muted`) with the selected
 * segment filled navy. The list's status filter and the Snapshots & Inputs kind
 * filter both draw it, so they cannot drift apart. The track scrolls inside
 * itself on a phone (the page never does), without a scrollbar.
 */
export const SEGMENTED_TRACK =
  "max-w-full overflow-x-auto rounded-[11px] bg-muted p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** One segment, 40 px tall. */
export function segmentClass(selected: boolean): string {
  return `relative flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none ${
    selected ? "bg-hero text-white" : "text-foreground/80 hover:bg-card"
  }`;
}

/** The count after a segment's label. */
export function segmentCountClass(selected: boolean): string {
  return `font-mono text-[11.5px] font-normal tabular-nums ${selected ? "text-hero-eyebrow" : "text-muted-foreground"}`;
}
