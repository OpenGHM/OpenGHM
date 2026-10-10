import { levelBars } from "@/lib/community/format";
import type { TutorialLevel } from "@/lib/community/types";
import { cn } from "@/lib/utils";

/**
 * The 1 to 3 bar glyph of a tutorial's level: filled bars for the level, faint
 * ones for the rest. Decorative; the level's name sits beside it. `on` is the
 * filled-pill state, where the filled bars are white.
 */
export function LevelGlyph({ level, on = false }: { level: TutorialLevel; on?: boolean }) {
  const filled = levelBars(level);
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-[3px] rounded-[1px]",
            i <= filled ? (on ? "bg-white" : "bg-primary") : on ? "bg-white/30" : "bg-primary/20",
          )}
        />
      ))}
    </span>
  );
}
