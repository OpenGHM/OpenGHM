import { humanizeTag } from "@/lib/repository/catalogue";
import { cn } from "@/lib/utils";

const TONES = {
  success: "bg-success/10 text-success",
  primary: "bg-primary/10 text-primary",
  /** On the dark detail-page hero. */
  hero: "bg-white/20 text-white",
} as const;

const SIZES = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-0.5 text-xs",
} as const;

/**
 * An artifact's tags as read-only chips, in the order the metadata lists them.
 * The catalogue card has its own chips, which are filter buttons; this is for
 * every place that only shows the tags.
 */
export function TagChips({
  tags,
  tone = "success",
  size = "md",
  className,
}: {
  tags: readonly string[];
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn("max-w-full rounded-full font-medium break-words", TONES[tone], SIZES[size])}
        >
          {humanizeTag(tag)}
        </span>
      ))}
    </div>
  );
}
