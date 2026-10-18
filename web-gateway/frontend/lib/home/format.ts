import type { NewsTag } from "@/lib/community/types";
import type { FeedKind } from "@/lib/home/types";

/** Background and text colour of a card's tag pill. */
export const TAG_CLASS: Record<NewsTag, string> = {
  dataset: "bg-secondary text-secondary-foreground",
  event: "bg-success/10 text-success",
  announcement: "bg-info/10 text-info",
  other: "bg-muted text-muted-foreground",
};

/** The tags of a news post, in the order the editor lists them. */
export const NEWS_TAGS: { value: NewsTag; label: string }[] = [
  { value: "announcement", label: "Announcement" },
  { value: "dataset", label: "New snapshot" },
  { value: "event", label: "Community Event" },
  { value: "other", label: "News" },
];

export const KIND_LABEL: Record<FeedKind, string> = {
  news: "News post",
  workshop: "Workshop",
  dataset: "Dataset",
};

/** The picture of a card that has none of its own. */
export const FALLBACK_IMAGE: Record<FeedKind, string> = {
  dataset: "/images/update-dataset.jpg",
  workshop: "/images/update-workshop.jpg",
  news: "/images/update-api.jpg",
};

/** The pin of an item, as the backend names it. */
export const pinKey = (item: { kind: FeedKind; id: string }): string => `${item.kind}:${item.id}`;
