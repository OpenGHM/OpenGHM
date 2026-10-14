import { cn } from "@/lib/utils";

/**
 * Marks what needs the `openghm` toolkit, which is not released yet: a
 * command shown on a page can be read and copied, but there is nothing to
 * install that runs it. `tone="dark"` is for the navy band and panels. Take
 * it off a place when the toolkit is published (packages/openghm README,
 * "Install").
 */
export function ComingSoonChip({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <span
      title="The openghm toolkit is not released yet."
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
