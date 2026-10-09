import { cn } from "@/lib/utils";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
/** No more year ticks than this fit in a phone's card in mono type. */
const MAX_TICKS = 6;
/** Candidate gaps between ticks, in years. */
const TICK_STEPS = [1, 2, 5, 10, 25, 50, 100];

/** The UTC time of an ISO date (`2000-01-31`), or null when it is not one that exists. */
function dayMs(iso: string): number | null {
  const match = ISO.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const date = new Date(ms);
  return date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
    ? ms
    : null;
}

/** The part of the coverage a run period takes, as fractions of the axis (0 to
 *  1), and the years to label it with. */
export interface PeriodBarLayout {
  /** The selected period; null when the dates do not make one. */
  fill: { from: number; to: number } | null;
  ticks: { year: number; at: number }[];
}

/**
 * Where a run period sits on the coverage of its snapshot. The axis runs from
 * the first coverage day to the day after the last, so a coverage of
 * 2000-01-01 → 2009-12-31 spans 2000 to 2010, and the period 2000-01-01 →
 * 2000-12-31 is a tenth of it. A period is clipped to the coverage. Null when
 * the coverage itself is not made of two dates that exist, in that order.
 */
export function periodBarLayout(
  coverage: { start: string; end: string },
  start: string,
  end: string
): PeriodBarLayout | null {
  const lo = dayMs(coverage.start);
  const hiDay = dayMs(coverage.end);
  if (lo === null || hiDay === null || hiDay < lo) return null;
  const hi = hiDay + DAY_MS;
  const at = (ms: number) => (Math.min(Math.max(ms, lo), hi) - lo) / (hi - lo);

  const from = dayMs(start);
  const to = dayMs(end);
  const fill =
    from !== null && to !== null && from <= to && to + DAY_MS > lo && from < hi
      ? { from: at(from), to: at(to + DAY_MS) }
      : null;

  // January 1 of every year inside the axis, thinned until few enough remain.
  const first =
    new Date(lo).getUTCFullYear() + (lo === Date.UTC(new Date(lo).getUTCFullYear(), 0, 1) ? 0 : 1);
  const last = new Date(hi).getUTCFullYear() - (hi < Date.UTC(new Date(hi).getUTCFullYear(), 0, 1) ? 1 : 0);
  const years: number[] = [];
  for (let y = first; y <= last; y++) years.push(y);
  const step =
    TICK_STEPS.find((s) => Math.ceil(years.length / s) <= MAX_TICKS) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks = years
    .filter((_, i) => i % step === 0)
    .map((year) => ({ year, at: at(Date.UTC(year, 0, 1)) }));
  return { fill, ticks };
}

/**
 * The selected run period drawn over the snapshot's coverage: a light track
 * for the coverage, the period as a solid segment on it, and year ticks in
 * mono under it. It is a picture of the two date fields above it and says
 * nothing they do not (the line under it states the coverage in words), so it
 * is hidden from assistive technology. Nothing is drawn when the coverage is
 * unknown.
 */
export function RunPeriodBar({
  coverage,
  start,
  end,
  className,
}: {
  coverage: { start: string; end: string } | null;
  start: string;
  end: string;
  className?: string;
}) {
  const layout = coverage ? periodBarLayout(coverage, start, end) : null;
  if (!layout) return null;
  const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
  return (
    <div aria-hidden="true" data-testid="run-period-bar" className={cn("space-y-2", className)}>
      <div className="relative h-3 rounded-full bg-primary/20">
        {layout.fill && (
          <div
            data-testid="run-period-fill"
            className="absolute inset-y-0 min-w-1.5 rounded-full bg-primary"
            style={{ left: pct(layout.fill.from), width: pct(layout.fill.to - layout.fill.from) }}
          />
        )}
      </div>
      <div className="relative h-4 font-mono text-[11.5px] leading-4 text-muted-foreground">
        {layout.ticks.map(({ year, at }) => (
          <span
            key={year}
            className={cn(
              "absolute top-0",
              at < 0.03 ? "" : at > 0.97 ? "-translate-x-full" : "-translate-x-1/2"
            )}
            style={{ left: pct(at) }}
          >
            {year}
          </span>
        ))}
      </div>
    </div>
  );
}
