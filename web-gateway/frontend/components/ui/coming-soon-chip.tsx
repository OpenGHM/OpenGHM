import { cn } from "@/lib/utils";

/** The chip's hover text on what needs the `openghm` toolkit. */
export const TOOLKIT_NOT_RELEASED = "The openghm toolkit is not released yet.";

/**
 * Marks what is not available yet: a command of the `openghm` toolkit, which
 * can be read and copied but has nothing released to run it (pass
 * `title={TOOLKIT_NOT_RELEASED}`; take it off when the toolkit is published,
 * packages/openghm README "Install"), or a part of the site with no pages
 * yet. `tone="dark"` is for the navy band and panels.
 */
export function ComingSoonChip({
  tone = "light",
  title = "Not available yet.",
  className,
}: {
  tone?: "light" | "dark";
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tone === "dark" ? "bg-hero-attention/15 text-hero-attention-text" : "bg-warning/10 text-warning",
        className
      )}
    >
      Coming soon
    </span>
  );
}
