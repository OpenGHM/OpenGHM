/**
 * The home page's "Latest Datasets & News" section, as the backend's `/home`
 * and `/admin/home` routes send it (web-gateway/backend/app/api/v1/home.py).
 */
import type { NewsTag } from "@/lib/community/types";

export type FeedKind = "news" | "workshop" | "dataset";

export interface FeedImage {
  url: string;
  alt: string;
}

/** One card: a news post, a workshop or a dataset. */
export interface FeedItem {
  kind: FeedKind;
  id: string;
  title: string;
  summary: string;
  /** Colours the tag pill; `tag_label` is its words. */
  tag: NewsTag;
  tag_label: string;
  /** null: the kind's own picture. */
  image: FeedImage | null;
  /** null: the card is not a link. */
  href: string | null;
  link_label: string | null;
  /** YYYY-MM-DD. */
  date: string;
  pinned: boolean;
}

export interface Pin {
  kind: FeedKind;
  id: string;
}

export interface HomeSources {
  news: boolean;
  workshops: boolean;
  datasets: boolean;
}

/** What an admin writes; the shape of the save request. */
export interface HomeUpdatesSettingsInput {
  title: string;
  eyebrow: string;
  /** 1 to 12. */
  count: number;
  sources: HomeSources;
  /** In the order they show. At most 12. */
  pins: Pin[];
}

export type PinReason = "missing" | "unpublished" | "private";

/** A pin as the admin page lists it: what it points to, or why it does not show. */
export interface PinStatus extends Pin {
  available: boolean;
  reason: PinReason | null;
  /** The item's own title while it exists. */
  title: string | null;
  item: FeedItem | null;
}

export interface HomeUpdatesAdmin extends Omit<HomeUpdatesSettingsInput, "pins"> {
  pins: PinStatus[];
  updated_at: string | null;
  updated_by: string | null;
}

/** What the home page reads: the words, and the cards. */
export interface HomeUpdates {
  settings: Omit<HomeUpdatesSettingsInput, "pins">;
  items: FeedItem[];
}

export interface UpdatesArchive {
  items: FeedItem[];
}
