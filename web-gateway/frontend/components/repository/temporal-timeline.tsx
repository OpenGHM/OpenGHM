import { cn } from "@/lib/utils";

/** The coverage's bar and the years under it. `left` and `width` are percentages of the bar. */
export interface TimelineAxis {
  ticks: number[];
  left: number;
  width: number;
  /** The ticks that fall inside the coverage, which are lit. */
  lit: ReadonlySet<number>;
}

// Five ticks a step apart, with the coverage starting two steps in. The first
// step that holds the whole coverage is the one used.
const STEPS = [10, 25, 50, 100];
const TICK_COUNT = 5;

/** `2009-12-31` as 2009.997; null when it is not a date. */
function yearFraction(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const from = Date.UTC(year, 0, 1);
  const to = Date.UTC(year + 1, 0, 1);
  return year + (date.getTime() - from) / (to - from);
}

const clampPercent = (n: number) => Math.min(100, Math.max(0, n));

/** Where a coverage from `start` to `end` falls on the bar; null when either is not a date. */
export function timelineAxis(start: string, end: string): TimelineAxis | null {
  const from = yearFraction(start);
  const to = yearFraction(end);
  if (from === null || to === null) return null;
  const firstTick = (step: number) => Math.floor(from / step) * step - 2 * step;
  const step =
    STEPS.find((s) => to <= firstTick(s) + (TICK_COUNT - 1) * s) ?? STEPS[STEPS.length - 1];
  const first = firstTick(step);
  const span = (TICK_COUNT - 1) * step;
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => first + i * step);
  const left = clampPercent(((from - first) / span) * 100);
  const right = clampPercent(((to - first) / span) * 100);
  return {
    ticks,
    left,
    width: Math.max(0, right - left),
    lit: new Set(ticks.filter((t) => t >= Math.floor(from) && t <= Math.ceil(to))),
  };
}

/**
 * The coverage as a bar on a decade scale, on the hero band. It repeats the
 * Coverage chip next to it, so it is hidden from assistive technology.
 */
export function TemporalTimeline({ start, end, className }: { start: string; end: string; className?: string }) {
  const axis = timelineAxis(start, end);
  if (!axis) return null;
  return (
    <div aria-hidden="true" className={cn("mt-1 flex max-w-[560px] flex-col gap-2", className)}>
      <div className="relative h-2.5 rounded-full bg-white/[0.08]">
        <div
          style={{ left: `${axis.left}%`, width: `${axis.width}%` }}
          className="absolute inset-y-0 min-w-1.5 rounded-full bg-gradient-to-r from-hero-glow to-hero-lit"
        />
      </div>
      <div className="flex justify-between font-mono text-[11.5px] text-hero-faint">
        {axis.ticks.map((tick) => (
          <span key={tick} className={cn(axis.lit.has(tick) && "text-hero-lit")}>
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}
