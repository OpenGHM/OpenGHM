import type { FeedItem } from "@/lib/home/types";

/** Feed items as the backend's `/home/updates` sends them, for the home feed's tests. */
export function feedItem(over: Partial<FeedItem> = {}): FeedItem {
  return {
    kind: "news",
    id: "n-1",
    title: "Python API v2.0 Released",
    summary: "Major performance improvements.",
    tag: "announcement",
    tag_label: "Announcement",
    image: null,
    coverage: null,
    href: null,
    link_label: null,
    date: "2026-10-10",
    pinned: false,
    ...over,
  };
}
