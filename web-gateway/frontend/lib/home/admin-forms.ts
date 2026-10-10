/**
 * The Latest updates form: what it holds while being edited, how it turns
 * into the request the backend takes, and the checks a person can see at once.
 * The backend validates again; a 422 comes back to the same field paths.
 */
import type { FormErrors } from "@/lib/community/admin-forms";
import { COUNT_MAX, COUNT_MIN, PINS_MAX } from "@/lib/home/settings";
import type {
  FeedItem,
  FeedKind,
  HomeSources,
  HomeUpdatesAdmin,
  HomeUpdatesSettingsInput,
  PinReason,
  PinStatus,
} from "@/lib/home/types";

export const TITLE_MAX = 200;
export const EYEBROW_MAX = 100;

/** A pin as the form lists it: what it points to, and why it does not show when it does not. */
export interface PinRow {
  kind: FeedKind;
  id: string;
  /** null once the item is gone. */
  title: string | null;
  tag_label: string | null;
  date: string | null;
  reason: PinReason | null;
}

export interface HomeForm {
  title: string;
  eyebrow: string;
  /** Typed, so a half-typed number is not thrown away. */
  count: string;
  sources: HomeSources;
  pins: PinRow[];
}

export function pinRowFromStatus(status: PinStatus): PinRow {
  return {
    kind: status.kind,
    id: status.id,
    title: status.title,
    tag_label: status.item?.tag_label ?? null,
    date: status.item?.date ?? null,
    reason: status.reason,
  };
}

export function pinRowFromItem(item: FeedItem): PinRow {
  return { kind: item.kind, id: item.id, title: item.title, tag_label: item.tag_label, date: item.date, reason: null };
}

export function homeToForm(settings: HomeUpdatesAdmin): HomeForm {
  return {
    title: settings.title,
    eyebrow: settings.eyebrow,
    count: String(settings.count),
    sources: { ...settings.sources },
    pins: settings.pins.map(pinRowFromStatus),
  };
}

export function homeToInput(f: HomeForm): HomeUpdatesSettingsInput {
  const count = f.count.trim();
  return {
    title: f.title.trim(),
    eyebrow: f.eyebrow.trim(),
    // A bad number is caught by `validateHome` before anything is sent.
    count: /^\d+$/.test(count) ? Number(count) : 0,
    sources: { ...f.sources },
    pins: f.pins.map((p) => ({ kind: p.kind, id: p.id })),
  };
}

export function validateHome(f: HomeForm): FormErrors {
  const e: FormErrors = {};
  if (!f.title.trim()) e.title = "Give the section a title.";
  else if (f.title.trim().length > TITLE_MAX) e.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (!f.eyebrow.trim()) e.eyebrow = "Give the section a label.";
  else if (f.eyebrow.trim().length > EYEBROW_MAX) e.eyebrow = `Keep the label under ${EYEBROW_MAX} characters.`;
  const count = f.count.trim();
  const n = Number(count);
  if (!/^\d+$/.test(count) || n < COUNT_MIN || n > COUNT_MAX) {
    e.count = `Use a whole number from ${COUNT_MIN} to ${COUNT_MAX}.`;
  }
  if (f.pins.length > PINS_MAX) e.pins = `At most ${PINS_MAX} items can be pinned.`;
  return e;
}

/** Words for a pin that does not show. */
export const PIN_REASON_LABEL: Record<PinReason, string> = {
  missing: "No longer exists",
  unpublished: "Hidden",
  private: "Private",
};
