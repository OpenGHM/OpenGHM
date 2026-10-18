/**
 * A published snapshot's output, as the output dialog reads it: the inventory
 * (`GET /repository/datasets/{id}/output`, the toolkit's `openghm output
 * inventory` answer, documented in packages/openghm/README.md) and the
 * `.../output/subset` download. Only the fields the dialog uses are typed.
 */

export type OutputResolution = "daily" | "monthly" | "yearly";

export const OUTPUT_RESOLUTIONS: readonly OutputResolution[] = ["yearly", "monthly", "daily"];

export const RESOLUTION_LABELS: Record<OutputResolution, string> = {
  yearly: "Yearly",
  monthly: "Monthly",
  daily: "Daily",
};

export interface OutputBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface OutputVariable {
  name: string;
  longName: string | null;
  units: string | null;
  /** The resolutions the variable is written at, each with its years. */
  resolutions: Partial<Record<OutputResolution, { years: number[] }>>;
}

export interface OutputInventory {
  grid: { bounds: OutputBounds; cellSize: number; crs?: string };
  /** Each resolution's years, and its first and last time step, `YYYY-MM-DD`. */
  resolutions: Partial<Record<OutputResolution, { years: number[]; first: string; last: string }>>;
  variables: OutputVariable[];
}

// ─── The period ──────────────────────────────────────────────────────────────

/**
 * A period as the dialog picks it: a run of years and, for monthly and daily
 * data, a run of months from the first year's `monthFrom` to the last year's
 * `monthTo` (1-12). Yearly data ignores the months.
 */
export interface OutputPeriod {
  from: number;
  to: number;
  monthFrom: number;
  monthTo: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The `start` and `end` of a subset request. The toolkit reads `end` as the
 * last day it names (`2000-03` is to March 31), so whole months are asked.
 */
export function periodQuery(resolution: OutputResolution, p: OutputPeriod): { start: string; end: string } {
  if (resolution === "yearly") return { start: String(p.from), end: String(p.to) };
  return { start: `${p.from}-${pad(p.monthFrom)}`, end: `${p.to}-${pad(p.monthTo)}` };
}

/** How many time steps the period holds: years, months or days. */
export function periodSteps(resolution: OutputResolution, p: OutputPeriod): number {
  if (resolution === "yearly") return p.to - p.from + 1;
  const months = (p.to - p.from) * 12 + (p.monthTo - p.monthFrom) + 1;
  if (resolution === "monthly") return months;
  let days = 0;
  for (let y = p.from, m = p.monthFrom; y < p.to || (y === p.to && m <= p.monthTo); m === 12 ? (y++, (m = 1)) : m++) {
    days += daysIn(y, m);
  }
  return days;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** "2000 – 2009 · 10 years", "Jan – Mar 2000 · 3 months", "Jan 2000 · 31 days". */
export function periodLabel(resolution: OutputResolution, p: OutputPeriod): string {
  const steps = periodSteps(resolution, p);
  if (resolution === "yearly") {
    return `${p.from === p.to ? p.from : `${p.from} – ${p.to}`} · ${plural(steps, "year")}`;
  }
  const first = `${monthName(p.monthFrom)} ${p.from}`;
  const last = `${monthName(p.monthTo)} ${p.to}`;
  const span =
    first === last
      ? first
      : p.from === p.to
        ? `${monthName(p.monthFrom)} – ${monthName(p.monthTo)} ${p.to}`
        : `${first} – ${last}`;
  return `${span} · ${plural(steps, resolution === "monthly" ? "month" : "day")}`;
}

/**
 * Where the dialog starts for a resolution: every year of yearly data, the
 * first year of monthly data, the first month of daily data. Each fits one
 * call for a Global grid, which reads a whole map per step.
 */
export function defaultPeriod(years: number[], resolution: OutputResolution): OutputPeriod {
  const first = years[0] ?? new Date().getUTCFullYear();
  const last = years[years.length - 1] ?? first;
  if (resolution === "yearly") return { from: first, to: last, monthFrom: 1, monthTo: 12 };
  if (resolution === "monthly") return { from: first, to: first, monthFrom: 1, monthTo: 12 };
  return { from: first, to: first, monthFrom: 1, monthTo: 1 };
}

/**
 * The next range after a click: the first click picks a single value and
 * waits for the second, which closes the range on either side of it.
 */
export function pickRange(
  current: { from: number; to: number },
  value: number,
  waiting: boolean
): { from: number; to: number; waiting: boolean } {
  if (!waiting) return { from: value, to: value, waiting: true };
  return { from: Math.min(current.from, value), to: Math.max(current.from, value), waiting: false };
}

// ─── The region ──────────────────────────────────────────────────────────────

/** What is wrong with a box, or null: each edge a number, inside the grid, north above south and east of west. */
export function boxProblem(box: OutputBounds, grid: OutputBounds): string | null {
  const values = [box.west, box.south, box.east, box.north];
  if (values.some((v) => !Number.isFinite(v))) return "Give every edge of the box as a number of degrees.";
  const inside =
    box.west >= grid.west - 1e-6 &&
    box.east <= grid.east + 1e-6 &&
    box.south >= grid.south - 1e-6 &&
    box.north <= grid.north + 1e-6;
  if (box.south >= box.north || box.west >= box.east || !inside) {
    return "North must be above South and East must be east of West, inside the grid.";
  }
  return null;
}

/** The share of the grid's area a box covers, 0-1. */
export function boxFraction(box: OutputBounds, grid: OutputBounds): number {
  const area = (grid.north - grid.south) * (grid.east - grid.west);
  return area > 0 ? ((box.north - box.south) * (box.east - box.west)) / area : 1;
}

/** A box a quarter of the grid's area, in its middle, on quarter degrees: where the box fields start. */
export function middleBox(grid: OutputBounds): OutputBounds {
  const q = (v: number) => Math.round(v * 4) / 4;
  const dx = (grid.east - grid.west) / 4;
  const dy = (grid.north - grid.south) / 4;
  return { west: q(grid.west + dx), east: q(grid.east - dx), south: q(grid.south + dy), north: q(grid.north - dy) };
}

/** `28.92° N` */
export function degrees(value: number, positive: string, negative: string): string {
  return `${Math.abs(Math.round(value * 100) / 100)}° ${value >= 0 ? positive : negative}`;
}

export function boxLabel(box: OutputBounds): string {
  return `${degrees(box.south, "N", "S")} – ${degrees(box.north, "N", "S")}, ${degrees(box.west, "E", "W")} – ${degrees(box.east, "E", "W")}`;
}

// ─── Sizes ───────────────────────────────────────────────────────────────────

/**
 * The most a subset's file holds: steps x rows x cols x 4 bytes, the values
 * uncompressed. The file is deflated, so it is this or smaller (measured
 * 2026-10-14: a Wyoming box of yearly runoff came out at 96% of it, a Global
 * month of daily runoff at 43%); an average of the published files says less,
 * since how well a variable compresses varies by far more.
 */
export function maxSubsetBytes(steps: number, box: OutputBounds, cellSize: number): number {
  const rows = Math.max(1, Math.round((box.north - box.south) / cellSize));
  const cols = Math.max(1, Math.round((box.east - box.west) / cellSize));
  return steps * rows * cols * 4;
}

/**
 * What one download may hold uncompressed: the toolkit's `MAX_NC_BYTES`
 * (packages/openghm/src/openghm/output/limits.py), mirrored here only to warn
 * before asking. The toolkit decides, and its refusal is what the dialog shows.
 */
export const SUBSET_LIMIT_BYTES = 1024 ** 3;

/** Steps in a year at a resolution, for "up to N MB / year". */
export function stepsPerYear(resolution: OutputResolution): number {
  return resolution === "yearly" ? 1 : resolution === "monthly" ? 12 : 365;
}

// ─── The request ─────────────────────────────────────────────────────────────

/** The query of a subset download; `bbox` is left out for the whole grid. */
export function subsetQuery({
  variable,
  resolution,
  period,
  box,
}: {
  variable: string;
  resolution: OutputResolution;
  period: OutputPeriod;
  box: OutputBounds | null;
}): string {
  const query = new URLSearchParams({ variable, resolution, ...periodQuery(resolution, period) });
  if (box) query.set("bbox", [box.west, box.south, box.east, box.north].map(String).join(","));
  return query.toString();
}

/** The name the file is saved under: `runoff_monthly_2000-01_2000-12_box.nc`. */
export function subsetFilename(variable: string, resolution: OutputResolution, period: OutputPeriod, box: boolean): string {
  const { start, end } = periodQuery(resolution, period);
  const span = start === end ? start : `${start}_${end}`;
  return `${variable}_${resolution}_${span}${box ? "_box" : ""}.nc`.replace(/[^A-Za-z0-9._-]+/g, "_");
}

/** The same request as an `openghm output subset` command (packages/openghm README). */
export function subsetCommand({
  snapshotId,
  variable,
  resolution,
  period,
  box,
  filename,
}: {
  snapshotId: string;
  variable: string;
  resolution: OutputResolution;
  period: OutputPeriod;
  box: OutputBounds | null;
  filename: string;
}): string {
  const { start, end } = periodQuery(resolution, period);
  const bbox = box ? ` --bbox ${box.west},${box.south},${box.east},${box.north}` : "";
  return `openghm output subset --snapshot ${snapshotId} --var ${variable} --resolution ${resolution} --start ${start} --end ${end}${bbox} --format nc --out ${filename}`;
}

/** Text in double quotes, with the `\`, `"`, `$` and backtick that would still mean something to the shell escaped. */
function quoted(text: string): string {
  return `"${text.replace(/[\\"$`]/g, "\\$&")}"`;
}

/** A shell word as it can be pasted: bare when it is plain, else quoted. */
function shellWord(text: string): string {
  return /^[\w./@%+=:,-]+$/.test(text) ? text : quoted(text);
}

/**
 * Where a public path-style URL (`https://<endpoint>/<bucket>/<key>`) lives on
 * S3: the endpoint to name with `--endpoint-url`, the bucket, and the key as
 * the object store spells it, which is the URL's path with its escapes undone.
 * The one place a tree's URL is taken apart for an S3 command.
 */
function s3Location(url: string): { endpoint: string; bucket: string; key: string } {
  const parsed = new URL(url);
  const [bucket, ...key] = parsed.pathname.replace(/^\//, "").split("/");
  const unescape = (segment: string) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };
  return { endpoint: parsed.origin, bucket, key: key.map(unescape).join("/") };
}

/**
 * `aws s3 sync` of a folder of the tree, anonymously. `treeUrl` is the tree's
 * public path-style URL (`https://<endpoint>/<bucket>/snapshots/<id>/`) and
 * `path` the folder under it. `only` narrows the sync to the entries it names
 * (`daily/*`, `a.nc`): everything is excluded, then those are included, each
 * pattern in double quotes so the shell leaves its `*` and any odd character
 * in a name alone.
 */
export function s3SyncCommand(treeUrl: string, path: string, into: string, only: string[] = []): string {
  const { endpoint, bucket, key } = s3Location(treeUrl);
  const source = shellWord(`s3://${bucket}/${key}${path}`);
  const filters = only.length > 0 ? ` --exclude "*"${only.map((p) => ` --include ${quoted(p)}`).join("")}` : "";
  return `aws s3 sync --no-sign-request --endpoint-url ${endpoint} ${source} ${shellWord(into)}${filters}`;
}

// ─── Answers ─────────────────────────────────────────────────────────────────

/** The message of a refusal: the backend's `detail.message` (the toolkit's words), else the gateway proxy's. */
export function refusalMessage(body: unknown): string | null {
  const message = rawMessage(body);
  // The toolkit writes its messages in lower case, for a terminal line.
  return message ? message.charAt(0).toUpperCase() + message.slice(1) : null;
}

function rawMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { detail?: unknown; message?: unknown };
  if (record.detail && typeof record.detail === "object") {
    const message = (record.detail as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof record.detail === "string") return record.detail;
  return typeof record.message === "string" ? record.message : null;
}
