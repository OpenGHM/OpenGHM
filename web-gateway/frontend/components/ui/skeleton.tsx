import { cn } from "@/lib/utils"

/**
 * A bar standing in for content that is on its way. A band of light sweeps
 * across it (`skeleton-sweep`), so it reads as loading rather than as
 * something that failed to draw. `tone="hero"` is for the dark band: a
 * translucent bar and a fainter light.
 */
function Skeleton({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"div"> & { tone?: "default" | "hero" }) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "skeleton-sweep rounded-md",
        tone === "hero"
          ? "bg-white/15 [--skeleton-shine:var(--skeleton-shine-hero)]"
          : "bg-skeleton",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
