"use client";

import { useMemo, useState } from "react";
import { formatNumber, niceTicks, stepLabel } from "@/lib/output/view";

const W = 720;
const H = 300;
const M = { top: 20, right: 20, bottom: 36, left: 64 };
const INK = "#1f2937";
const MUTED = "#6b7280";
const GRID = "#e5e7eb";
const LINE = "#1d4ed8";
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function tickLabel(ms: number, spanDays: number): string {
  const iso = new Date(ms).toISOString().slice(0, 10);
  if (spanDays >= 365 * 3) return iso.slice(0, 4);
  if (spanDays >= 60) return stepLabel(iso.slice(0, 7));
  return stepLabel(iso).replace(/ \d{4}$/, "");
}

/**
 * The clicked cell's series as a hand-drawn SVG line chart (no chart library):
 * time across, value up, a gap where there is no data. It is drawn on a white
 * ground with explicit colours so the same markup, saved, reads on its own.
 * The SVG element is handed to the caller through `svgRef` for the PNG save.
 */
export function SeriesChart({
  times,
  values,
  units,
  title,
  svgRef,
}: {
  times: string[];
  values: (number | null)[];
  units: string | null;
  title: string;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const xs = times.map((t) => Date.parse(t));
    const real = values.filter((v): v is number => v !== null);
    if (real.length === 0 || xs.length === 0) return null;
    let lo = Math.min(...real);
    let hi = Math.max(...real);
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.1 || 1;
      hi += Math.abs(hi) * 0.1 || 1;
    }
    const yTicks = niceTicks(lo, hi, 5);
    const y0 = Math.min(lo, yTicks[0] ?? lo);
    const y1 = Math.max(hi, yTicks[yTicks.length - 1] ?? hi);
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const pw = W - M.left - M.right;
    const ph = H - M.top - M.bottom;
    const px = (x: number) => M.left + (x1 > x0 ? ((x - x0) / (x1 - x0)) * pw : pw / 2);
    const py = (y: number) => M.top + ph - ((y - y0) / (y1 - y0)) * ph;
    const spanDays = (x1 - x0) / 86_400_000;
    const xTicks = x1 > x0 ? Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4) : [x0];
    // A run of points between gaps is one path.
    const paths: string[] = [];
    let current = "";
    xs.forEach((x, i) => {
      const v = values[i];
      if (v === null) {
        if (current) paths.push(current);
        current = "";
      } else current += `${current ? "L" : "M"}${px(x).toFixed(1)},${py(v).toFixed(1)}`;
    });
    if (current) paths.push(current);
    return { xs, px, py, yTicks, xTicks, paths, spanDays };
  }, [times, values]);

  if (!geometry) {
    return <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">There is no data at this cell for the period.</p>;
  }
  const { xs, px, py, yTicks, xTicks, paths, spanDays } = geometry;
  const dots = times.length <= 80;
  const unitText = units ?? "";

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * W;
    let best = -1;
    let bestDistance = Infinity;
    xs.forEach((t, i) => {
      if (values[i] === null) return;
      const d = Math.abs(px(t) - x);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    setHover(best >= 0 ? best : null);
  };

  const hovered = hover !== null && values[hover] !== null ? hover : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`${title}: ${times.length} values`}
        className="h-auto w-full rounded-xl border border-border"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <rect width={W} height={H} fill="#ffffff" />
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={py(t)} y2={py(t)} stroke={GRID} />
            <text x={M.left - 8} y={py(t) + 4} textAnchor="end" fontSize="11" fill={MUTED} fontFamily={FONT}>
              {formatNumber(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={px(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize="11" fill={MUTED} fontFamily={FONT}>
            {tickLabel(t, spanDays)}
          </text>
        ))}
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke={MUTED} />
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke={MUTED} />
        <text x={M.left} y={13} fontSize="12" fontWeight="600" fill={INK} fontFamily={FONT}>
          {title}
          {unitText ? ` (${unitText})` : ""}
        </text>
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={LINE} strokeWidth="1.6" strokeLinejoin="round" />
        ))}
        {dots &&
          xs.map((x, i) => (values[i] === null ? null : <circle key={i} cx={px(x)} cy={py(values[i] as number)} r="2.4" fill={LINE} />))}
        {hovered !== null && (
          <g pointerEvents="none">
            <line x1={px(xs[hovered])} x2={px(xs[hovered])} y1={M.top} y2={H - M.bottom} stroke={MUTED} strokeDasharray="3 3" />
            <circle cx={px(xs[hovered])} cy={py(values[hovered] as number)} r="4" fill="#ffffff" stroke={LINE} strokeWidth="2" />
          </g>
        )}
      </svg>
      <p className="mt-1.5 h-5 font-mono text-xs text-muted-foreground" aria-live="polite">
        {hovered !== null ? `${times[hovered]}  ·  ${formatNumber(values[hovered] as number)}${unitText ? ` ${unitText}` : ""}` : ""}
      </p>
    </div>
  );
}

/** Saves the chart's SVG as a PNG: drawn onto a canvas at twice its size, so it is sharp when printed. */
export async function saveSvgAsPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const scale = 2;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const text = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The chart could not be drawn to an image."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The chart could not be drawn to an image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The chart could not be drawn to an image.");
    saveBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Hands a blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
