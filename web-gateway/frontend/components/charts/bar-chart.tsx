import type { TimeSeriesPoint } from "@/lib/admin/types";

const WIDTH = 480;
const HEIGHT = 160;
const PADDING_BOTTOM = 20;

// Plain server-rendered SVG — no chart library needed for 1-3 simple bar
// charts, and it renders fully on the server with zero client JS (unlike
// recharts, which needs "use client" + a DOM-measuring ResponsiveContainer).
export function BarChart({
  points,
  colorVar = "var(--chart-1)",
  formatLabel,
}: {
  points: TimeSeriesPoint[];
  colorVar?: string;
  formatLabel?: (iso: string) => string;
}) {
  if (points.length === 0 || points.every((p) => p.count === 0)) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing in this period yet.
      </div>
    );
  }

  const max = Math.max(1, ...points.map((p) => p.count));
  const barWidth = WIDTH / points.length;
  const chartHeight = HEIGHT - PADDING_BOTTOM;

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Time series bar chart">
      {points.map((p, i) => {
        const barHeight = (p.count / max) * (chartHeight - 8);
        const x = i * barWidth;
        const y = chartHeight - barHeight;
        return (
          <g key={p.bucket}>
            <rect
              x={x + barWidth * 0.15}
              y={y}
              width={barWidth * 0.7}
              height={Math.max(barHeight, p.count > 0 ? 2 : 0)}
              fill={colorVar}
              rx={2}
            >
              <title>
                {p.count} on {new Date(p.bucket).toLocaleDateString()}
              </title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                x={x + barWidth / 2}
                y={HEIGHT - 4}
                textAnchor="middle"
                className="fill-muted-foreground font-mono"
                fontSize="9"
              >
                {formatLabel ? formatLabel(p.bucket) : new Date(p.bucket).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} y1={chartHeight} x2={WIDTH} y2={chartHeight} stroke="currentColor" className="text-border" strokeWidth={1} />
    </svg>
  );
}
