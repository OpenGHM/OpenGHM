/**
 * The catalogue's region filter: a bounding box in decimal degrees (EPSG:4326)
 * that matches an item whose spatial coverage overlaps it. Pure, so the filter
 * control, the URL parser and the tests share one definition of what a valid box
 * is. The backend (`parse_box` in `app/services/catalogue.py`) enforces the same
 * rules and answers 422 for anything else, so the client never sends a box that
 * would make the whole page fail.
 */

/** The four edges, in the order the form lists them; also the names the query parameters carry. */
export const REGION_EDGES = ["north", "south", "west", "east"] as const;
export type RegionEdge = (typeof REGION_EDGES)[number];

/** A box. `west` greater than `east` crosses the antimeridian. */
export interface Region {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** The inclusive range each edge may take. */
export const REGION_LIMITS: Record<RegionEdge, { min: number; max: number }> = {
  north: { min: -90, max: 90 },
  south: { min: -90, max: 90 },
  west: { min: -180, max: 180 },
  east: { min: -180, max: 180 },
};

export const EDGE_LABELS: Record<RegionEdge, string> = {
  north: "North",
  south: "South",
  west: "West",
  east: "East",
};

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** A typed edge as a number, or `null` for text that is not a plain decimal number (empty included). */
export function parseEdge(text: string): number | null {
  const t = text.trim();
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** What is wrong with one typed edge, or `null`. Empty is not an error: it is incomplete. */
export function edgeError(edge: RegionEdge, text: string): string | null {
  if (text.trim() === "") return null;
  const n = parseEdge(text);
  if (n === null) return "Enter a number";
  const { min, max } = REGION_LIMITS[edge];
  if (n < min || n > max) return `Must be between ${min} and ${max}`;
  return null;
}

/**
 * The edge-by-edge problems of four typed values. `south` also carries the
 * cross-field one: a south edge above the north. West above east is not one, it
 * is a box across the antimeridian.
 */
export function regionErrors(text: Record<RegionEdge, string>): Partial<Record<RegionEdge, string>> {
  const errors: Partial<Record<RegionEdge, string>> = {};
  for (const edge of REGION_EDGES) {
    const message = edgeError(edge, text[edge]);
    if (message) errors[edge] = message;
  }
  if (!errors.north && !errors.south) {
    const n = parseEdge(text.north);
    const s = parseEdge(text.south);
    if (n !== null && s !== null && s > n) errors.south = "Must not be above North";
  }
  return errors;
}

/** The box four typed values make, or `null` while one is missing or invalid. */
export function regionFromText(text: Record<RegionEdge, string>): Region | null {
  if (Object.keys(regionErrors(text)).length > 0) return null;
  const parsed = REGION_EDGES.map((e) => parseEdge(text[e]));
  if (parsed.some((v) => v === null)) return null;
  const [north, south, west, east] = parsed as number[];
  return { north, south, west, east };
}

/** A box from four optional numbers (the filter state's, a URL's): all four valid, or `null`. */
export function regionFromNumbers(
  north: number | null,
  south: number | null,
  east: number | null,
  west: number | null
): Region | null {
  if (north === null || south === null || east === null || west === null) return null;
  return regionFromText({
    north: String(north),
    south: String(south),
    east: String(east),
    west: String(west),
  });
}

function hemisphere(value: number, positive: string, negative: string): string {
  const abs = Number(Math.abs(value).toFixed(4));
  return `${abs}°${value < 0 ? negative : abs === 0 ? "" : positive}`;
}

/** "45°N", "10°S", "0°". */
export function formatLatitude(value: number): string {
  return hemisphere(value, "N", "S");
}

/** "110°W", "5°E", "0°", "180°". */
export function formatLongitude(value: number): string {
  return Math.abs(value) === 180 ? "180°" : hemisphere(value, "E", "W");
}

/** A box for a chip: "40°N – 45°N, 110°W – 100°W", south to north then west to east. */
export function formatRegion(region: Region): string {
  return `${formatLatitude(region.south)} – ${formatLatitude(region.north)}, ${formatLongitude(
    region.west
  )} – ${formatLongitude(region.east)}`;
}
