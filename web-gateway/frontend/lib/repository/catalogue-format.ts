/**
 * What a catalogue card says about a snapshot or a model input, as plain data:
 * the card renders it and tests read it. Everything here comes from a field
 * the spec has; nothing is made up for the list.
 */
import type { CatalogueItem, ModelInput } from "./types";

type Resolution = { value: number; unit: string };
type SpatialBox = { northlimit: number; southlimit: number; eastlimit: number; westlimit: number };

export function detailHref(item: CatalogueItem): string {
  return item.kind === "snapshot"
    ? `/repository/${encodeURIComponent(item.id)}`
    : `/repository/model-inputs/${encodeURIComponent(item.id)}`;
}

export function kindLabel(kind: CatalogueItem["kind"]): string {
  return kind === "snapshot" ? "Model Snapshot" : "Model Input";
}

export function spatialBox(item: CatalogueItem): SpatialBox {
  return item.kind === "snapshot"
    ? item.simulation.spatialCoverage
    : item.coverage.spatialCoverage;
}

/** `2000-01-01` -> 2000, read off the text so no time zone moves it. */
function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** "2000 – 2009", "2001" for one year, `null` when the item has no calendar period. */
export function periodLabel(item: CatalogueItem): string | null {
  const period =
    item.kind === "snapshot" ? item.simulation.temporalCoverage : item.coverage.temporalCoverage;
  if (!period) return null;
  const start = yearOf(period.start);
  const end = yearOf(period.end);
  return start === end ? start : `${start} – ${end}`;
}

export function resolutionText(r: Resolution): string {
  return `${r.value} ${r.unit}`;
}

/**
 * A snapshot's own resolution; a model input's distinct network resolutions
 * (it has no single one). Empty when there is nothing to show.
 */
export function resolutionLabels(item: CatalogueItem): string[] {
  if (item.kind === "snapshot") return [resolutionText(item.simulation.resolution)];
  const seen = new Set<string>();
  for (const n of (item as ModelInput).networks ?? []) {
    if (n.resolution) seen.add(resolutionText(n.resolution));
  }
  return [...seen];
}

/** "Jane Doe", or "Jane Doe +2" when there are more creators. */
export function creatorLabel(item: CatalogueItem): { first: string; more: number } | null {
  const creators = item.about.creator;
  if (creators.length === 0) return null;
  return { first: creators[0].name, more: creators.length - 1 };
}

/** The version for a snapshot ("WBM 1.0.0"), the size for a model input. */
export function contentsLabel(item: CatalogueItem): string {
  if (item.kind === "snapshot") return `WBM ${item.uses.container.version}`;
  const datasets = item.datasets.length;
  const networks = item.networks?.length ?? 0;
  const d = `${datasets} dataset${datasets === 1 ? "" : "s"}`;
  return networks > 0 ? `${d} · ${networks} network${networks === 1 ? "" : "s"}` : d;
}

/**
 * The keywords a card shows as chips (the first `limit`), how many are left,
 * and the hidden ones' names for the "+N more" tooltip. Both kinds carry
 * `about.keywords`; the list is the author's, in the author's order.
 */
export function cardKeywords(
  item: CatalogueItem,
  limit = 4
): { shown: string[]; more: number; hidden: string[] } {
  const keywords = item.about.keywords;
  const hidden = keywords.slice(limit);
  return { shown: keywords.slice(0, limit), more: hidden.length, hidden };
}
