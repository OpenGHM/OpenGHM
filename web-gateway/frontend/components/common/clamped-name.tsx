import { cn } from "@/lib/utils";

/** How many lines a clamped name keeps. */
export type ClampLines = 1 | 2 | 3 | 4;

// Tailwind reads class names from the source text, so each one is written whole.
const CLAMP: Record<ClampLines, string> = {
  1: "block truncate",
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
};

/**
 * The classes that keep a snapshot's or model input's name to `lines` lines
 * wherever space is short, whatever its length (a name can be a paper title):
 * the ellipsis after the last line (`block truncate` for one), `min-w-0` so a flex or
 * grid item can shrink below its text, and `overflow-wrap: anywhere` so a long
 * unbroken token (`Global_tracking`) wraps instead of pushing the row wider.
 * For an element that is already a link or a button; `ClampedName` is the
 * element for the rest. The result is block-level (`truncate` and `line-clamp`
 * both are), so a name clamped in the middle of a sentence is not inline.
 */
export function clampClass(lines: ClampLines): string {
  return cn("min-w-0 max-w-full [overflow-wrap:anywhere]", CLAMP[lines]);
}

/**
 * A name in a compact place: clamped to `lines` lines (`clampClass`), with the
 * whole name in the `title` attribute so it is reachable on hover. The name
 * stays in the DOM whole, so a screen reader and a search still get all of it.
 * `title` defaults to the text itself; pass it when the children are not a
 * string, or `false` when an ancestor (a button) already carries it.
 */
export function ClampedName({
  lines,
  as: Tag = "span",
  title,
  id,
  className,
  children,
}: {
  lines: ClampLines;
  as?: "span" | "p" | "div" | "h3";
  title?: string | false;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const tooltip = title === false ? undefined : (title ?? (typeof children === "string" ? children : undefined));
  return (
    <Tag id={id} title={tooltip} className={cn(clampClass(lines), className)}>
      {children}
    </Tag>
  );
}
