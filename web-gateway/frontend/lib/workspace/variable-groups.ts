/**
 * Output variables, searched and grouped for the Run settings list.
 *
 * Grouping is mechanical, not a classification: a variable's base is its name
 * up to the first underscore (`runoff_ps`, `runoff_pu` and `runoff` share the
 * base `runoff`; `IrrFlow_mm_pg` is `IrrFlow`; `glMelt` is its own base). A
 * base with one variable in it is not a group: those are listed together,
 * after the groups, as "Other variables". Nothing here knows what a variable
 * means, so a snapshot's own names decide everything.
 */

/** A list this short is shown flat, with no search and no groups. */
export const FLAT_LIST_LIMIT = 12;

/** Something to tick: a variable's name, and the snapshot's longer name for it. */
export interface VariableItem {
  name: string;
  title: string | null;
}

export interface VariableGroup<T extends VariableItem = VariableItem> {
  /** The shared base, or null for the trailing "Other variables". */
  base: string | null;
  items: T[];
}

/** The part of the name before its first underscore. */
export function baseVariable(name: string): string {
  const cut = name.indexOf("_");
  return cut > 0 ? name.slice(0, cut) : name;
}

/** Whether `query` (case-insensitive, any part of it) matches a variable's
 *  name or its longer title. An empty query matches everything. */
export function matchesVariable(item: VariableItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return item.name.toLowerCase().includes(q) || (item.title?.toLowerCase().includes(q) ?? false);
}

/**
 * Groups of two or more variables with the same base, in the order each base
 * first appears, then one group with a null base for the rest. The items keep
 * the order they were given inside each group. An empty group is left out.
 */
export function groupVariables<T extends VariableItem>(items: readonly T[]): VariableGroup<T>[] {
  const byBase = new Map<string, T[]>();
  for (const item of items) {
    const base = baseVariable(item.name);
    byBase.set(base, [...(byBase.get(base) ?? []), item]);
  }
  const groups: VariableGroup<T>[] = [];
  const others: T[] = [];
  for (const [base, members] of byBase) {
    if (members.length > 1) groups.push({ base, items: members });
    else others.push(...members);
  }
  // Singles keep the order they came in, not the order of their bases.
  const order = new Map(items.map((item, i) => [item.name, i]));
  others.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  if (others.length > 0) groups.push({ base: null, items: others });
  return groups;
}
