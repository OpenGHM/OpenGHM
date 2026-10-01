import { cn } from "@/lib/utils";
import { WORLD_LAND_PATH } from "@/lib/repository/world-land";

/** The panel is drawn on a 360 x 180 grid: one unit per degree, so x = longitude + 180 and y = 90 - latitude. */
export const THUMBNAIL_WIDTH = 360;
export const THUMBNAIL_HEIGHT = 180;

/** The graticule is drawn every 30 degrees. */
const GRATICULE_STEP = 30;

/** A box this wide or wider reads as the whole world. */
const GLOBAL_LONGITUDE_SPAN = 340;

/** A box smaller than this many units is drawn this big, so it stays visible. */
const MIN_RECT_SIZE = 3;

export interface CoverageBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ThumbnailRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Degrees of longitude a box covers; a west edge east of the east edge crosses the antimeridian. */
export function longitudeSpan(box: CoverageBox): number {
  return box.west <= box.east ? box.east - box.west : 360 - (box.west - box.east);
}

/**
 * "Global" or "Regional". This is a label for the thumbnail, worked out from
 * how wide the box is; it is not a field of the spec and says nothing the four
 * limits do not.
 */
export function coverageLabel(box: CoverageBox): "Global" | "Regional" {
  return longitudeSpan(box) >= GLOBAL_LONGITUDE_SPAN ? "Global" : "Regional";
}

/** A span on one axis, grown to `MIN_RECT_SIZE` around its middle without leaving [0, limit]. */
function growSpan(start: number, size: number, limit: number): [number, number] {
  if (size >= MIN_RECT_SIZE) return [start, size];
  const grown = Math.min(MIN_RECT_SIZE, limit);
  const middle = start + size / 2;
  return [clamp(middle - grown / 2, 0, limit - grown), grown];
}

/**
 * The rectangles that draw a bounding box on the panel: one, or two when the
 * box crosses the antimeridian (west is east of east), one on each side of the
 * panel. Limits outside the globe are clamped to it.
 */
export function boxRects(box: CoverageBox): ThumbnailRect[] {
  const west = clamp(box.west, -180, 180);
  const east = clamp(box.east, -180, 180);
  const north = clamp(Math.max(box.north, box.south), -90, 90);
  const south = clamp(Math.min(box.north, box.south), -90, 90);

  const [y, height] = growSpan(90 - north, north - south, THUMBNAIL_HEIGHT);

  const spans: [number, number][] =
    west <= east
      ? [[west + 180, east - west]]
      : [
          [west + 180, 180 - west],
          [0, east + 180],
        ];

  return spans.map(([start, size]) => {
    const [x, width] = growSpan(start, size, THUMBNAIL_WIDTH);
    return { x, y, width, height };
  });
}

/** A regional box is framed in a window this wide (of 360), or wider when the box needs it. */
const MIN_WINDOW_WIDTH = 240;

/** Breathing room, in degrees of longitude, around a box that sets the window width. */
const WINDOW_MARGIN = 20;

/**
 * The part of the panel's 360 x 180 grid the SVG shows, as `x width`: the whole
 * grid for a global box or one that crosses the antimeridian, otherwise a window
 * centred on the box's longitude. With `preserveAspectRatio="slice"` a panel
 * that is taller than the window crops its sides rather than leaving empty
 * bands above and below. The whole grid is drawn with "meet" instead, so the
 * world is never cropped; a tall panel then shows plain ocean above and below it.
 */
export function viewWindow(box: CoverageBox): { x: number; width: number } {
  if (coverageLabel(box) === "Global" || box.west > box.east) {
    return { x: 0, width: THUMBNAIL_WIDTH };
  }
  const span = box.east - box.west;
  const width = clamp(Math.max(MIN_WINDOW_WIDTH, span + 2 * WINDOW_MARGIN), 0, THUMBNAIL_WIDTH);
  const middle = (box.west + box.east) / 2 + 180;
  return { x: clamp(middle - width / 2, 0, THUMBNAIL_WIDTH - width), width };
}

function graticule(): { vertical: number[]; horizontal: number[] } {
  const vertical: number[] = [];
  for (let x = GRATICULE_STEP; x < THUMBNAIL_WIDTH; x += GRATICULE_STEP) vertical.push(x);
  const horizontal: number[] = [];
  for (let y = GRATICULE_STEP; y < THUMBNAIL_HEIGHT; y += GRATICULE_STEP) horizontal.push(y);
  return { vertical, horizontal };
}

const GRID = graticule();

/**
 * Where a snapshot or a model input lies, as a small equirectangular panel:
 * land (Natural Earth 1:110m, see `world-land.ts`), a graticule and the
 * bounding box. An SVG with no map tiles and no network
 * request, so a list can show one on every card. The "Global" / "Regional"
 * label in the corner is derived from the box (see `coverageLabel`).
 */
export function CoverageThumbnail({
  box,
  className,
}: {
  box: CoverageBox;
  className?: string;
}) {
  const label = coverageLabel(box);
  const rects = boxRects(box);
  const window = viewWindow(box);

  return (
    <div
      className={cn(
        "relative aspect-[2/1] overflow-hidden rounded-md border border-border bg-primary/10",
        className
      )}
    >
      <svg
        viewBox={`${window.x} 0 ${window.width} ${THUMBNAIL_HEIGHT}`}
        preserveAspectRatio={window.width === THUMBNAIL_WIDTH ? "xMidYMid meet" : "xMidYMid slice"}
        role="img"
        aria-label={`Coverage: north ${box.north}°, south ${box.south}°, east ${box.east}°, west ${box.west}° (${label})`}
        className="absolute inset-0 size-full"
      >
        <path
          data-testid="coverage-land"
          d={WORLD_LAND_PATH}
          className="fill-muted stroke-foreground/25"
          strokeWidth={0.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <g className="stroke-foreground/10" strokeWidth={1}>
          {GRID.vertical.map((x) => (
            <line
              key={`x${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={THUMBNAIL_HEIGHT}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {GRID.horizontal.map((y) => (
            <line
              key={`y${y}`}
              x1={0}
              y1={y}
              x2={THUMBNAIL_WIDTH}
              y2={y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        {rects.map((r, i) => (
          <rect
            key={i}
            data-testid="coverage-rect"
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            className="fill-primary/25 stroke-primary"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span aria-hidden="true" className="absolute right-1.5 bottom-1.5 rounded bg-card/90 px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm">
        {label}
      </span>
    </div>
  );
}
