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

/** The shape of the panel a thumbnail fills: a wide strip (about 2.2:1) or a tall block (about 0.7:1: the list card panel is 260 wide and 295 to 430 high). */
export type ThumbnailAspect = "wide" | "tall";

/** Width : height of the window framed for each panel shape. */
const ASPECT_RATIO: Record<ThumbnailAspect, number> = { wide: 2.2, tall: 0.7 };

/** A regional box is framed with this much room around it: the window is 1.6 times the box. */
const WINDOW_PADDING = 1.6;

/** The narrowest window, in degrees, so a tiny box still shows the land around it. */
const MIN_WINDOW_WIDTH = 40;

export interface ViewWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A window of `size` centred on `middle`: kept inside [0, limit] when it fits, centred on the axis when it does not. */
function placeWindow(middle: number, size: number, limit: number): number {
  if (size >= limit) return (limit - size) / 2;
  return clamp(middle - size / 2, 0, limit - size);
}

/**
 * The part of the panel's 360 x 180 grid the SVG shows: the whole grid for a
 * global box or one that crosses the antimeridian, otherwise a window of the
 * panel's shape (`aspect`) centred on the box and 1.6 times its size on the
 * axis that needs more. The window slides to stay inside the world, so a box
 * near a pole or the date line is framed off-centre rather than off the map.
 * The SVG draws it with "slice", so a panel that differs a little from the
 * window's shape crops the long axis slightly and the box stays in view. The
 * whole grid is drawn with "meet" instead, so the world is never cropped.
 */
export function viewWindow(box: CoverageBox, aspect: ThumbnailAspect = "wide"): ViewWindow {
  if (coverageLabel(box) === "Global" || box.west > box.east) {
    return { x: 0, y: 0, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT };
  }
  const ratio = ASPECT_RATIO[aspect];
  const boxWidth = box.east - box.west;
  const boxHeight = Math.abs(box.north - box.south);
  const width = Math.max(boxWidth * WINDOW_PADDING, boxHeight * WINDOW_PADDING * ratio, MIN_WINDOW_WIDTH);
  const height = width / ratio;
  const middleX = (box.west + box.east) / 2 + 180;
  const middleY = 90 - (box.north + box.south) / 2;
  return {
    x: placeWindow(middleX, width, THUMBNAIL_WIDTH),
    y: placeWindow(middleY, height, THUMBNAIL_HEIGHT),
    width,
    height,
  };
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
  aspect,
  className,
  showLabel = true,
}: {
  box: CoverageBox;
  /** The shape of the panel it fills, which sets how the map is framed around the box. */
  aspect: ThumbnailAspect;
  className?: string;
  /** The "Global" / "Regional" chip in the corner; off for a thumbnail too small to carry it. */
  showLabel?: boolean;
}) {
  const label = coverageLabel(box);
  const rects = boxRects(box);
  const window = viewWindow(box, aspect);
  const whole = window.width === THUMBNAIL_WIDTH && window.height === THUMBNAIL_HEIGHT;

  return (
    <div
      className={cn(
        "relative aspect-[2/1] overflow-hidden rounded-md border border-border bg-slate-100",
        className
      )}
    >
      <svg
        viewBox={`${window.x} ${window.y} ${window.width} ${window.height}`}
        preserveAspectRatio={whole ? "xMidYMid meet" : "xMidYMid slice"}
        role="img"
        aria-label={`Coverage: north ${box.north}°, south ${box.south}°, east ${box.east}°, west ${box.west}° (${label})`}
        className="absolute inset-0 size-full origin-center transition-transform duration-700 ease-out motion-safe:group-hover/card:scale-[1.06] motion-safe:group-has-[a:focus-visible]/card:scale-[1.06]"
      >
        <path
          data-testid="coverage-land"
          d={WORLD_LAND_PATH}
          className="fill-white stroke-slate-400/70"
          strokeWidth={0.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <g className="stroke-slate-300/60" strokeWidth={1}>
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
            className="fill-highlight/[0.22] stroke-highlight"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {showLabel && (
        <span
          aria-hidden="true"
          className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-0.5 text-[11.5px] font-medium text-foreground shadow-sm"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-highlight" />
          {label}
        </span>
      )}
    </div>
  );
}
