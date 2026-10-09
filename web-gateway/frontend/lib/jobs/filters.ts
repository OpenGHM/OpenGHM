import type { JobStatsResponse } from "@/lib/jobs/types";

/** One tab of the snapshot draft list. The filter is the backend's `status`
 *  query (`GET /jobs`), so a tab is a link, not client state. */
export interface StatusTab {
  label: string;
  /** The `?status=` value; undefined is the unfiltered list. */
  value: string | undefined;
  /** Which `/jobs/stats` field counts this tab. */
  count: keyof JobStatsResponse;
  /** The empty state: what is missing, and what to do about it. */
  empty: { title: string; hint: string };
}

export const STATUS_TABS: StatusTab[] = [
  {
    label: "All",
    value: undefined,
    count: "total",
    empty: {
      title: "No snapshot drafts yet",
      hint: "Select a model snapshot to start your first snapshot draft.",
    },
  },
  {
    label: "Editing",
    value: "DRAFT",
    count: "draft",
    empty: {
      title: "Nothing being edited",
      hint: "Snapshot drafts you are still editing are listed here. Start one from a model snapshot.",
    },
  },
  {
    label: "Active",
    value: "active",
    count: "running",
    empty: {
      title: "Nothing running",
      hint: "Submitted snapshot drafts wait and run here. Submit one, or start a new snapshot.",
    },
  },
  {
    label: "Completed",
    value: "COMPLETED",
    count: "completed",
    empty: {
      title: "Nothing has finished yet",
      hint: "Snapshot drafts whose simulation finished are listed here, with their results.",
    },
  },
  {
    label: "Failed",
    value: "FAILED",
    count: "failed",
    empty: {
      title: "No failed simulations",
      hint: "None of your simulations has failed.",
    },
  },
  {
    label: "Cancelled",
    value: "CANCELLED",
    count: "cancelled",
    empty: {
      title: "No cancelled simulations",
      hint: "Snapshot drafts whose simulation you cancel are listed here.",
    },
  },
];

/** The tab a `?status=` value selects. The backend reads the value
 *  case-insensitively, so this does too; an unknown value selects none. */
export function tabForStatus(status: string | undefined): StatusTab | undefined {
  const wanted = status?.toUpperCase();
  return STATUS_TABS.find((tab) => tab.value?.toUpperCase() === wanted);
}

/** The rows per page the list offers; the backend takes 1 to 100. */
export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 10;

/** What `GET /jobs?sort=` orders by: when a draft last changed, or when it was made. */
export type ListSort = "updated" | "created";
export const DEFAULT_SORT: ListSort = "updated";

/** How the list is laid out, apart from its filter and page. Both are in the
 *  URL, so a page and its order can be linked to or reloaded. */
export interface ListView {
  size?: number;
  sort?: ListSort;
}

/** The `?size=` value as a page size: one of `PAGE_SIZES`, else the default. */
export function parsePageSize(value: string | undefined): number {
  const wanted = Number(value);
  return PAGE_SIZES.find((size) => size === wanted) ?? DEFAULT_PAGE_SIZE;
}

/** The `?sort=` value as an order: a known one, else the default. */
export function parseSort(value: string | undefined): ListSort {
  return value === "created" ? "created" : DEFAULT_SORT;
}

/** The list's URL for a tab, a page and a view; a first page, the default page
 *  size and the default order leave no param. */
export function listHref(status: string | undefined, page = 1, view: ListView = {}): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  if (view.size && view.size !== DEFAULT_PAGE_SIZE) params.set("size", String(view.size));
  if (view.sort && view.sort !== DEFAULT_SORT) params.set("sort", view.sort);
  const query = params.toString();
  return query ? `/workspace?${query}` : "/workspace";
}
