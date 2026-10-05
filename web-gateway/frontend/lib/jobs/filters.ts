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
      hint: "Submitted snapshot drafts wait and run here. Submit one, or start a new snapshot draft.",
    },
  },
  {
    label: "Completed",
    value: "COMPLETED",
    count: "completed",
    empty: {
      title: "Nothing has finished yet",
      hint: "Snapshot drafts whose run finished are listed here, with their results.",
    },
  },
  {
    label: "Failed",
    value: "FAILED",
    count: "failed",
    empty: {
      title: "No failed runs",
      hint: "None of your runs has failed.",
    },
  },
  {
    label: "Cancelled",
    value: "CANCELLED",
    count: "cancelled",
    empty: {
      title: "No cancelled runs",
      hint: "Runs you cancel are listed here.",
    },
  },
];

/** The tab a `?status=` value selects. The backend reads the value
 *  case-insensitively, so this does too; an unknown value selects none. */
export function tabForStatus(status: string | undefined): StatusTab | undefined {
  const wanted = status?.toUpperCase();
  return STATUS_TABS.find((tab) => tab.value?.toUpperCase() === wanted);
}

/** The list's URL for a tab and a page; a first page has no `page` param. */
export function listHref(status: string | undefined, page = 1): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/workspace?${query}` : "/workspace";
}
