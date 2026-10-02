/**
 * The kinds the Snapshots & Inputs list can be narrowed to, and the URL that
 * says which. The list is the caller's own handful of items, so the narrowing
 * happens in the browser; the URL (`?kind=`) only makes it linkable.
 */
import type { CatalogueKind, MineItem } from "@/lib/repository/types";

export const MY_DATA_PATH = "/workspace/data";

/** The selection: every kind, or one. */
export type KindFilter = "all" | CatalogueKind;

export const KIND_TABS: readonly { value: KindFilter; label: string; empty: string }[] = [
  { value: "all", label: "All", empty: "Nothing published yet" },
  { value: "snapshot", label: "Model Snapshots", empty: "No model snapshots yet" },
  { value: "model-input", label: "Model Inputs", empty: "No model inputs yet" },
];

/** The `?kind=` value read as a selection; anything but a kind is "all". */
export function kindFromParam(param: string | null | undefined): KindFilter {
  return param === "snapshot" || param === "model-input" ? param : "all";
}

/** The page's URL for a selection: no query for "all", the default. */
export function kindHref(kind: KindFilter): string {
  return kind === "all" ? MY_DATA_PATH : `${MY_DATA_PATH}?kind=${kind}`;
}

export function filterByKind(items: MineItem[], kind: KindFilter): MineItem[] {
  return kind === "all" ? items : items.filter((item) => item.kind === kind);
}

export function countByKind(items: MineItem[]): Record<KindFilter, number> {
  return {
    all: items.length,
    snapshot: items.filter((i) => i.kind === "snapshot").length,
    "model-input": items.filter((i) => i.kind === "model-input").length,
  };
}
