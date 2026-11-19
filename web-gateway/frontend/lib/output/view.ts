/**
 * The pure logic of the Output card: what the view's state is and how it
 * travels in the URL, which choices the inventory offers, the time steps,
 * the series filter, CSV, chart ticks and the friendly words for the API's
 * refusals. No React, no fetch: the card (components/output/) calls these.
 */

import {
  OUTPUT_RESOLUTIONS,
  periodSteps,
  type OutputBounds,
  type OutputInventory,
  type OutputPeriod,
  type OutputResolution,
  type OutputVariable,
} from "@/lib/repository/output";

export type OutputSourceRef = { kind: "job" | "dataset"; id: string };

/** The root of a source's API routes. */
export function outputBase(source: OutputSourceRef): string {
  return source.kind === "job"
    ? `/api/jobs/${encodeURIComponent(source.id)}/output`
    : `/api/repository/datasets/${source.id}/output`;
}

// ─── State and URL ───────────────────────────────────────────────────────────

export interface ViewPoint {
  lon: number;
  lat: number;
}

/** What a person has chosen. `null`: not chosen, so the card's default (or the MT's legend) applies. */
export interface ViewState {
  variable: string | null;
  resolution: OutputResolution | null;
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, matching `resolution`. */
  date: string | null;
  ramp: string | null;
  min: number | null;
  max: number | null;
  log: boolean | null;
  point: ViewPoint | null;
  /** The series filter: from the `offset`th point (0-based), every `step`th. */
  offset: number;
  step: number;
}

export const EMPTY_VIEW: ViewState = {
  variable: null,
  resolution: null,
  date: null,
  ramp: null,
  min: null,
  max: null,
  log: null,
  point: null,
  offset: 0,
  step: 1,
};

/** The query keys, prefixed so they never meet a page's own (`?step=` of the draft wizard). */
const KEYS = {
  variable: "ovar",
  resolution: "ores",
  date: "odate",
  ramp: "oramp",
  min: "omin",
  max: "omax",
  log: "olog",
  point: "opoint",
  offset: "ooff",
  step: "ostep",
} as const;

const DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const VARIABLE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const RAMP = /^[A-Za-z][A-Za-z0-9]*$/;

function number(text: string | null): number | null {
  if (text === null || text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function whole(text: string | null, fallback: number, min: number): number {
  const n = number(text);
  return n !== null && Number.isInteger(n) && n >= min ? n : fallback;
}

/** The state a URL holds; anything malformed is dropped rather than trusted. */
export function parseView(params: URLSearchParams): ViewState {
  const variable = params.get(KEYS.variable);
  const resolution = params.get(KEYS.resolution);
  const date = params.get(KEYS.date);
  const ramp = params.get(KEYS.ramp);
  const log = params.get(KEYS.log);
  let point: ViewPoint | null = null;
  const rawPoint = params.get(KEYS.point);
  if (rawPoint) {
    const [lon, lat, ...rest] = rawPoint.split(",").map(number);
    if (rest.length === 0 && lon != null && lat != null && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
      point = { lon, lat };
    }
  }
  return {
    variable: variable && VARIABLE.test(variable) ? variable : null,
    resolution: (OUTPUT_RESOLUTIONS as readonly string[]).includes(resolution ?? "") ? (resolution as OutputResolution) : null,
    date: date && DATE.test(date) ? date : null,
    ramp: ramp && RAMP.test(ramp) ? ramp : null,
    min: number(params.get(KEYS.min)),
    max: number(params.get(KEYS.max)),
    log: log === "1" ? true : log === "0" ? false : null,
    point,
    offset: whole(params.get(KEYS.offset), 0, 0),
    step: whole(params.get(KEYS.step), 1, 1),
  };
}

/** A point on the URL: four decimals (about 10 m) is more than any grid needs. */
export function formatPoint(p: ViewPoint): string {
  return `${Math.round(p.lon * 1e4) / 1e4},${Math.round(p.lat * 1e4) / 1e4}`;
}

/** `params` with the view's keys set (or removed when at their default); other keys are kept. */
export function writeView(state: ViewState, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null) => (value === null ? next.delete(key) : next.set(key, value));
  set(KEYS.variable, state.variable);
  set(KEYS.resolution, state.resolution);
  set(KEYS.date, state.date);
  set(KEYS.ramp, state.ramp);
  set(KEYS.min, state.min === null ? null : String(state.min));
  set(KEYS.max, state.max === null ? null : String(state.max));
  set(KEYS.log, state.log === null ? null : state.log ? "1" : "0");
  set(KEYS.point, state.point ? formatPoint(state.point) : null);
  set(KEYS.offset, state.offset === 0 ? null : String(state.offset));
  set(KEYS.step, state.step === 1 ? null : String(state.step));
  return next;
}

// ─── What the inventory offers ───────────────────────────────────────────────

/** The resolutions a variable is written at, in the order the card lists them. */
export function offeredResolutions(variable: OutputVariable): OutputResolution[] {
  return OUTPUT_RESOLUTIONS.filter((r) => (variable.resolutions[r]?.years.length ?? 0) > 0);
}

/** The climatology kinds a variable has files for (listed, not drawn: the map and series routes take no climatology). */
export function climatologyKinds(variable: OutputVariable): OutputResolution[] {
  const have = variable.resolutions.climatology ?? {};
  return OUTPUT_RESOLUTIONS.filter((r) => r in have);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Every time step a variable has at a resolution, in order, as `YYYY`,
 * `YYYY-MM` or `YYYY-MM-DD`: its years, clipped to the first and last stamp of
 * the resolution's time axis (a run may start in March, or end in June).
 */
export function stepsFor(resolution: OutputResolution, years: number[], first?: string, last?: string): string[] {
  const steps: string[] = [];
  for (const y of [...years].sort((a, b) => a - b)) {
    if (resolution === "yearly") steps.push(String(y));
    else
      for (let m = 1; m <= 12; m++) {
        if (resolution === "monthly") steps.push(`${y}-${pad(m)}`);
        else for (let d = 1; d <= daysIn(y, m); d++) steps.push(`${y}-${pad(m)}-${pad(d)}`);
      }
  }
  const length = resolution === "yearly" ? 4 : resolution === "monthly" ? 7 : 10;
  const lo = first?.slice(0, length);
  const hi = last?.slice(0, length);
  return steps.filter((s) => (!lo || s >= lo) && (!hi || s <= hi));
}

/** The steps of `variable` at `resolution` in `inventory`. */
export function variableSteps(inventory: OutputInventory, variable: OutputVariable, resolution: OutputResolution): string[] {
  const years = variable.resolutions[resolution]?.years ?? [];
  const axis = inventory.resolutions[resolution];
  return stepsFor(resolution, years, axis?.first, axis?.last);
}

/**
 * The step to show after the resolution changes from a date of another length:
 * the first step of the same year (or month), else the nearest one after,
 * else the last.
 */
export function convertDate(date: string | null, steps: string[]): string | null {
  if (steps.length === 0) return null;
  if (!date) return steps[steps.length - 1];
  if (steps.includes(date)) return date;
  const same = steps.find((s) => s.startsWith(date.slice(0, 4)) && s.startsWith(date.slice(0, Math.min(date.length, s.length))));
  if (same) return same;
  return steps.find((s) => s >= date.slice(0, s.length)) ?? steps[steps.length - 1];
}

export interface Resolved {
  variable: OutputVariable;
  resolution: OutputResolution;
  steps: string[];
  date: string;
}

/**
 * The choices a state means for an inventory: its variable if the inventory
 * has it (else the first), its resolution if the variable has it (else yearly,
 * monthly, daily), its date if it is a step (else the nearest; the latest
 * when none was chosen). Null when the inventory holds nothing to show.
 */
export function resolveView(state: ViewState, inventory: OutputInventory): Resolved | null {
  const variable = inventory.variables.find((v) => v.name === state.variable) ?? inventory.variables.find((v) => offeredResolutions(v).length > 0);
  if (!variable) return null;
  const offered = offeredResolutions(variable);
  const resolution = state.resolution && offered.includes(state.resolution) ? state.resolution : offered[0];
  const steps = variableSteps(inventory, variable, resolution);
  const date = convertDate(state.date, steps);
  return date ? { variable, resolution, steps, date } : null;
}

/** `2000`, `Mar 2000`, `1 Mar 2000`. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function stepLabel(step: string): string {
  const [y, m, d] = step.split("-");
  if (!m) return y;
  const month = MONTHS[Number(m) - 1] ?? m;
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}

export const MONTH_NAMES = MONTHS;

// ─── The map's request ───────────────────────────────────────────────────────

/** What is wrong with the style a person typed, or null. `legendMin` is what the MT drew with, for a log scale whose min was not typed. */
export function styleProblem(
  style: { min: number | null; max: number | null; log: boolean | null },
  legend: { min: number; max: number; log: boolean } | null
): string | null {
  const min = style.min ?? legend?.min ?? null;
  const max = style.max ?? legend?.max ?? null;
  if (min !== null && max !== null && !(min < max)) return "The minimum must be below the maximum.";
  const log = style.log ?? legend?.log ?? false;
  if (log && min !== null && min <= 0) return "A log scale needs a minimum above 0.";
  return null;
}

/** The query of a map request: a style is sent only for the parts the person set. */
export function mapQuery(
  r: { variable: string; resolution: OutputResolution; date: string },
  s: ViewState,
  width: number | null = null
): string {
  // Mercator rows: the image is laid over Leaflet's web-Mercator tiles, which stretch it linearly in
  // Mercator y, so rows in equal steps of latitude would drift from the coast lines away from the edges.
  const q = new URLSearchParams({
    variable: r.variable,
    resolution: r.resolution,
    start: r.date,
    image: "webp",
    projection: "mercator",
  });
  if (width !== null) q.set("width", String(width));
  if (s.ramp) q.set("ramp", s.ramp);
  if (s.min !== null) q.set("min", String(s.min));
  if (s.max !== null) q.set("max", String(s.max));
  if (s.log !== null) q.set("log", String(s.log));
  return q.toString();
}

/** The widest map the card asks for, in image pixels. */
export const MAP_WIDTH_CAP = 2048;
/** Widths are rounded up to this, so a small resize does not ask for a new image. */
const MAP_WIDTH_STEP = 512;

/**
 * The width to ask the map for: what the map shows on screen (CSS pixels times
 * the pixel ratio), rounded up to a step and capped. Null, which asks for the
 * grid's own width, when the grid is no wider than that: a CONUS grid is drawn
 * cell for cell, a Global one (4320 cells, a 2.2 MB PNG) at about screen size.
 */
export function mapWidth(grid: OutputBounds, cellSize: number, screenPixels: number): number | null {
  if (!(screenPixels > 0) || !(cellSize > 0)) return null;
  const cells = Math.round((grid.east - grid.west) / cellSize);
  const wanted = Math.min(MAP_WIDTH_CAP, Math.ceil(screenPixels / MAP_WIDTH_STEP) * MAP_WIDTH_STEP);
  return cells > wanted ? wanted : null;
}

export function hasStyle(s: ViewState): boolean {
  return s.ramp !== null || s.min !== null || s.max !== null || s.log !== null;
}

// ─── The series ──────────────────────────────────────────────────────────────

export interface Series {
  point: { lon: number; lat: number; cellLon: number; cellLat: number };
  units: string | null;
  times: string[];
  values: (number | null)[];
}

/**
 * The query of a series request. Daily output is read for the calendar year of
 * the chosen date (the API refuses much more than a year of days); monthly and
 * yearly for their whole span.
 */
export function seriesQuery(r: { variable: string; resolution: OutputResolution; date: string }, point: ViewPoint): string {
  const q = new URLSearchParams({ variable: r.variable, resolution: r.resolution, point: formatPoint(point), display: "true" });
  if (r.resolution === "daily") {
    q.set("start", r.date.slice(0, 4));
    q.set("end", r.date.slice(0, 4));
  }
  return q.toString();
}

/** The points of a series that the offset/step filter keeps: the `offset`th, then every `step`th. */
export function filterSeries<T>(items: T[], offset: number, step: number): T[] {
  const every = Math.max(1, Math.floor(step));
  const from = Math.max(0, Math.floor(offset));
  return items.filter((_, i) => i >= from && (i - from) % every === 0);
}

function cell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The plotted values as CSV: a `time` column and one for the variable (with units), empty where there is no data. */
export function seriesCsv(times: string[], values: (number | null)[], name: string, units: string | null): string {
  const head = `time,${cell(units ? `${name} (${units})` : name)}`;
  const rows = times.map((t, i) => `${cell(t)},${values[i] === null || values[i] === undefined ? "" : String(values[i])}`);
  return `${[head, ...rows].join("\n")}\n`;
}

/** The file name of a saved chart or table: `runoff_monthly_-89.5_40.25.csv`. */
export function seriesFilename(variable: string, resolution: string, point: ViewPoint, extension: string): string {
  return `${variable}_${resolution}_${formatPoint(point).replace(",", "_")}.${extension}`.replace(/[^A-Za-z0-9._-]+/g, "_");
}

/** About `count` round tick values covering min..max (1, 2, 5 times a power of ten). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const rough = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 5, 10].map((m) => m * magnitude).find((u) => u >= rough) ?? 10 * magnitude;
  const ticks: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(unit)) + 1);
  for (let i = Math.ceil(min / unit - 1e-9); i * unit <= max + unit * 1e-9; i++) {
    ticks.push(Number((i * unit).toFixed(decimals)));
  }
  return ticks;
}

/** A tick value without float noise or needless digits. */
export function formatNumber(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(2).replace(/\.?0+e/, "e");
  if (a >= 1000) return String(Math.round(v));
  return String(Number(v.toPrecision(4)));
}

// ─── The NetCDF download ─────────────────────────────────────────────────────

export type DownloadScope = "step" | "year" | "all";

export interface DownloadOption {
  scope: DownloadScope;
  label: string;
  period: OutputPeriod;
  steps: number;
}

/**
 * The periods "Download NetCDF" offers for a date: the step shown, its year,
 * and every year the variable has. Yearly data has no step smaller than its
 * year, so it offers two.
 */
export function downloadOptions(resolution: OutputResolution, date: string, years: number[]): DownloadOption[] {
  const [y, m = "1", d] = date.split("-");
  const year = Number(y);
  const month = Number(m);
  const first = years[0] ?? year;
  const last = years[years.length - 1] ?? year;
  const make = (scope: DownloadScope, label: string, period: OutputPeriod): DownloadOption => ({
    scope,
    label,
    period,
    steps: periodSteps(resolution, period),
  });
  const options: DownloadOption[] = [];
  if (resolution === "yearly") options.push(make("step", `${year}`, { from: year, to: year, monthFrom: 1, monthTo: 12 }));
  else if (resolution === "monthly")
    options.push(make("step", stepLabel(date), { from: year, to: year, monthFrom: month, monthTo: month }));
  else
    // A daily request names whole months, so the smallest period is the month.
    options.push(make("step", `${MONTHS[month - 1]} ${year}${d ? " (whole month)" : ""}`, { from: year, to: year, monthFrom: month, monthTo: month }));
  if (resolution !== "yearly") options.push(make("year", `All of ${year}`, { from: year, to: year, monthFrom: 1, monthTo: 12 }));
  if (first !== last) options.push(make("all", `${first} – ${last}`, { from: first, to: last, monthFrom: 1, monthTo: 12 }));
  return options;
}

/**
 * Where a published snapshot keeps its output, for "Download NetCDF" to hand over a file that
 * is already there instead of cutting one: the tree's URL (`…/snapshots/<id>/`) and the runs
 * under its `wbm_output/`.
 */
export interface PublishedOutput {
  treeUrl: string;
  runs: string[];
}

/**
 * The published file that is exactly the download asked for, if there is one: a yearly
 * variable's year is `yearly/<variable>/wbm_<year>.nc`, a monthly variable's whole year
 * `monthly/<variable>/wbm_<year>.nc`. Anything else (a month, daily data, which is one file of
 * every variable, a run of years) has to be cut. Only for a snapshot with one run.
 */
export function publishedFileUrl(
  published: PublishedOutput | undefined,
  variable: string,
  resolution: OutputResolution,
  option: DownloadOption
): string | null {
  if (!published || published.runs.length !== 1) return null;
  const whole =
    (resolution === "yearly" && option.scope === "step") || (resolution === "monthly" && option.scope === "year");
  if (!whole || option.period.from !== option.period.to) return null;
  const base = published.treeUrl.endsWith("/") ? published.treeUrl : `${published.treeUrl}/`;
  const parts = ["wbm_output", published.runs[0], resolution, variable, `wbm_${option.period.from}.nc`];
  return base + parts.map(encodeURIComponent).join("/");
}

// ─── Refusals ────────────────────────────────────────────────────────────────

export type OutputProblem =
  | { kind: "purged"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "signed-out"; message: string }
  | { kind: "limit"; message: string }
  | { kind: "error"; message: string };

function field(body: unknown, name: "code" | "message"): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { detail?: unknown; code?: unknown; message?: unknown };
  const detail = record.detail;
  if (detail && typeof detail === "object") {
    const v = (detail as Record<string, unknown>)[name];
    if (typeof v === "string") return v;
  }
  if (name === "message" && typeof detail === "string") return detail;
  const own = record[name];
  return typeof own === "string" ? own : null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The words for a refusal of the output API: purged scratch and no output are
 * answers, not failures; a 422 carries the toolkit's own message (a limit, an
 * unknown variable, a missing year), shown as it is.
 */
export function describeProblem(status: number, body: unknown): OutputProblem {
  const code = field(body, "code");
  const message = field(body, "message");
  if (status === 410 || code === "output_purged") {
    return {
      kind: "purged",
      message: "Anvil deletes a run's files 30 days after it ran, and this run's output is gone. Its snapshot draft and logs are still here.",
    };
  }
  if (status === 404 && (code === "output_missing" || code === null)) {
    return { kind: "missing", message: "This has no output to show yet." };
  }
  if (status === 401) return { kind: "signed-out", message: "Your session has expired. Sign in again to see this output." };
  if (status === 422) return { kind: "limit", message: message ? capitalise(message) : "The request was refused." };
  switch (code) {
    case "anvil_unreachable":
      return { kind: "error", message: "Anvil could not be reached to read the output. Try again in a moment." };
    case "anvil_not_configured":
      return { kind: "error", message: "This gateway is not set up to read output from Anvil." };
    case "output_busy":
      return { kind: "error", message: "Anvil is busy with other output requests. Try again in a moment." };
    default:
      return { kind: "error", message: message ? capitalise(message) : "The output could not be read. Try again." };
  }
}
