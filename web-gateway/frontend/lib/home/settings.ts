import type { HomeUpdatesSettingsInput } from "@/lib/home/types";

/** What the section says until an admin writes their own words (and when the backend leaves a field out). */
export const DEFAULT_HOME_SETTINGS: Omit<HomeUpdatesSettingsInput, "pins"> = {
  title: "Latest Snapshots & News",
  eyebrow: "What's New",
  count: 3,
  sources: { news: true, workshops: true, datasets: true },
};

export const COUNT_MIN = 1;
export const COUNT_MAX = 12;
/** At most this many pins. */
export const PINS_MAX = 12;
