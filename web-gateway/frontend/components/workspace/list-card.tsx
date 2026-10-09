import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The look both Workspace lists share: each row is a white card of its own on
 * the page, 18 px round, lifting a little on hover and on keyboard focus. The
 * row is a grid whose columns are the list's (`columns`), a `<li>` that
 * carries a stretched link (`after:absolute after:inset-0` on the name).
 */
export const ROW_CARD =
  "relative rounded-[18px] border border-transparent bg-card text-card-foreground transition-[box-shadow,border-color,transform] hover:-translate-y-px hover:border-primary/25 hover:shadow-lift has-[a:focus-visible]:border-primary/25 has-[a:focus-visible]:shadow-lift has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** The mono column heads above the row cards, from `sm` up. */
export const HEADER_ROW =
  "hidden gap-x-4 px-5 pt-2 font-mono text-[11.5px] tracking-[0.06em] text-muted-foreground uppercase sm:grid";

/**
 * The 46 px tile at the start of a row: an icon in a tinted square. `tone` is
 * the tile's classes (a status's `HUE[...].tile` + `.icon`, or a pair of
 * tokens), so the tile takes the colour of what the row is.
 */
export function GlyphTile({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid size-10 shrink-0 place-items-center rounded-[14px] sm:size-[46px]", tone)}
    >
      {children}
    </span>
  );
}

/**
 * A list with nothing to show: a white card with a tinted icon tile, a title,
 * a line under it and, when there is something to do, its buttons. `dashed`
 * is for "none yet", as the lists drew it before; a filter that matches
 * nothing is a plain card.
 */
export function ListEmptyCard({
  icon,
  title,
  hint,
  dashed = false,
  className,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  dashed?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3.5 rounded-[18px] bg-card px-6 py-14 text-center text-card-foreground sm:py-16",
        dashed && "border border-dashed",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-[52px] place-items-center rounded-2xl bg-secondary text-primary [&_svg]:size-5"
      >
        {icon}
      </span>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {hint && <p className="-mt-1.5 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {children && <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">{children}</div>}
    </div>
  );
}
