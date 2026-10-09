/**
 * The classes of the Workspace lists' filter: a row of buttons inside the
 * toolbar card, each a coloured dot, a label and a mono count, the selected
 * one filled navy. The list's status filter and the Snapshots & Inputs kind
 * filter both draw it, so they cannot drift apart. The row scrolls inside
 * itself on a phone (the page never does), without a scrollbar.
 */
export const SEGMENTED_TRACK = "max-w-full min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** One segment, at least 40 px tall. */
export function segmentClass(selected: boolean): string {
  return `relative flex min-h-10 items-center gap-2 rounded-[11px] px-3 py-[9px] text-[13.5px] font-semibold whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none ${
    selected ? "bg-hero text-white" : "text-foreground/80 hover:bg-secondary hover:text-secondary-foreground"
  }`;
}

/** The count after a segment's label. */
export function segmentCountClass(): string {
  return "font-mono text-xs font-normal tabular-nums opacity-70";
}

/** The small dot before a segment's label: `tone` is a `bg-*` class, and the
 *  selected segment's dot is white, whatever it was. */
export function segmentDotClass(selected: boolean, tone: string): string {
  return `size-[7px] shrink-0 rounded-full ${selected ? "bg-white" : tone}`;
}
