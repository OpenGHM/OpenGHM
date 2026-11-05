import { cn } from "@/lib/utils";
import { codeStateLabel, codeStateNote } from "@/lib/repository/wbm-code";
import type { CodeState } from "@/lib/repository/types";

/**
 * The state of a snapshot's WBM code, as a small pill beside the code's version:
 * "Legacy" in neutral (the snapshot works as published), a warning for withdrawn,
 * mismatched and unlisted code. `current` and `unknown` show nothing. The sentence
 * is the pill's hover text and what a screen reader hears after it; `reason` is why
 * a withdrawn version was withdrawn. `tone="dark"` is for the navy panels.
 */
export function WbmCodeChip({
  state,
  reason,
  tone = "light",
  spoken = true,
  className,
}: {
  state: CodeState;
  reason?: string | null;
  tone?: "light" | "dark";
  /** Read the sentence out after the label. Off where the page writes it out beside the chip. */
  spoken?: boolean;
  className?: string;
}) {
  const label = codeStateLabel(state);
  const note = codeStateNote(state, reason);
  if (label === null || note === null) return null;
  const neutral = state === "legacy";
  return (
    <span
      title={note}
      data-state={state}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-sans text-[11px] font-semibold whitespace-nowrap",
        neutral
          ? tone === "dark"
            ? "bg-white/10 text-hero-text"
            : "bg-muted text-muted-foreground"
          : tone === "dark"
            ? "bg-hero-attention/15 text-hero-attention-text"
            : "bg-warning/10 text-warning",
        className
      )}
    >
      {label}
      {spoken && <span className="sr-only">. {note}</span>}
    </span>
  );
}
