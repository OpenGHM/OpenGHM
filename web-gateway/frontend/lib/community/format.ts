import type {
  PublicationType,
  TutorialKind,
  TutorialLevel,
  Workshop,
  WorkshopCard,
  WorkshopMaterial,
} from "@/lib/community/types";
import { COMMUNITY_FILE_PREFIX, safeHref } from "@/lib/community/links";

/**
 * Pure helpers for the Community pages: how a date, a tutorial's action or a
 * material is written. Dates are `YYYY-MM-DD` and are read as calendar days in
 * UTC, so the server and the browser print the same text.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseDay(date: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: Number(m[1]), month, day };
}

/** The date block of a workshop row: "DEC", "10", "2024". "TBA" with no date; blank parts for a date that is not one. */
export function dateBadge(date: string | null): { month: string; day: string; year: string } {
  if (date === null) return { month: "TBA", day: "", year: "" };
  const d = parseDay(date);
  if (!d) return { month: "", day: "", year: "" };
  return {
    month: MONTHS[d.month - 1].slice(0, 3).toUpperCase(),
    day: String(d.day),
    year: String(d.year),
  };
}

/** "December 10, 2024". */
export function formatLongDate(date: string): string {
  const d = parseDay(date);
  if (!d) return date;
  return `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
}

/** A run of days: "March 3–5, 2027", "February 28 – March 2, 2027", or one day. */
export function formatDateRange(start: string, end: string | null): string {
  const a = parseDay(start);
  const b = end ? parseDay(end) : null;
  if (!a) return start;
  if (!b || (a.year === b.year && a.month === b.month && a.day === b.day)) return formatLongDate(start);
  if (a.year !== b.year) return `${formatLongDate(start)} – ${formatLongDate(end as string)}`;
  if (a.month !== b.month) {
    return `${MONTHS[a.month - 1]} ${a.day} – ${MONTHS[b.month - 1]} ${b.day}, ${a.year}`;
  }
  return `${MONTHS[a.month - 1]} ${a.day}–${b.day}, ${a.year}`;
}

/** What a workshop says it happens: the admin's own wording, else the formatted date. */
export function whenLabel(w: Pick<Workshop, "when_label" | "date" | "end_date">): string {
  const own = w.when_label?.trim();
  if (own) return own;
  return w.date ? formatDateRange(w.date, w.end_date) : "Date to be announced";
}

/** The workshops split as the page shows them: the next first, then later ones; past ones newest first. */
export function splitWorkshops<T extends Pick<WorkshopCard, "status" | "date" | "end_date" | "title">>(
  workshops: T[],
): { upcoming: T[]; past: T[] } {
  // A workshop with no date yet comes after the dated upcoming ones.
  const byDateAsc = (a: T, b: T) =>
    Number(a.date === null) - Number(b.date === null) ||
    (a.date ?? "").localeCompare(b.date ?? "") ||
    a.title.localeCompare(b.title);
  const byDateDesc = (a: T, b: T) =>
    (b.end_date ?? b.date ?? "").localeCompare(a.end_date ?? a.date ?? "") || a.title.localeCompare(b.title);
  return {
    upcoming: workshops.filter((w) => w.status === "upcoming").sort(byDateAsc),
    past: workshops.filter((w) => w.status !== "upcoming").sort(byDateDesc),
  };
}

/** "Materials": what a past workshop has to download, from its count. */
export function workshopHints(w: Pick<WorkshopCard, "material_count">): string[] {
  return w.material_count > 0 ? ["Materials"] : [];
}

/** "1 file", "12 files". */
export function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---- Tutorials -------------------------------------------------------------

export const TUTORIAL_LEVELS: readonly TutorialLevel[] = ["beginner", "intermediate", "advanced"];

export const LEVEL_LABEL: Record<TutorialLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** How many of the three bars of the level glyph are filled. */
export function levelBars(level: TutorialLevel): 1 | 2 | 3 {
  return level === "advanced" ? 3 : level === "intermediate" ? 2 : 1;
}

/** The mono label in a tutorial card's dark header. */
export const KIND_LABEL: Record<TutorialKind, string> = {
  gateway: "GATEWAY",
  notebook: "NOTEBOOK",
  video: "VIDEO",
  guide: "GUIDE",
};

/** "20 min", or null when the tutorial does not say. */
export function minutesLabel(minutes: number | null): string | null {
  return minutes && minutes > 0 ? `${minutes} min` : null;
}

/** What a tutorial's action says when the admin wrote no label of their own. */
export function defaultActionLabel(kind: TutorialKind): string {
  if (kind === "notebook") return "Open notebook";
  if (kind === "video") return "Watch video";
  return "Start tutorial";
}

export function tutorialActionLabel(t: { kind: TutorialKind; action_label: string | null }): string {
  return t.action_label?.trim() || defaultActionLabel(t.kind);
}

/**
 * Where a tutorial card goes: its own page when it has written content, else
 * its link, else nowhere. `external` links leave the site and open in a new tab.
 */
export function tutorialLink(t: {
  slug: string;
  has_body: boolean;
  url: string | null;
}): { href: string; external: boolean } | null {
  if (t.has_body) return { href: `/community/tutorials/${t.slug}`, external: false };
  const href = safeHref(t.url);
  if (!href) return null;
  return { href, external: /^https?:\/\//i.test(href) };
}

// ---- Publications ----------------------------------------------------------

export const PUBLICATION_TYPES: readonly PublicationType[] = ["paper", "dataset", "software", "talk"];

export const PUBLICATION_TYPE_LABEL: Record<PublicationType, string> = {
  paper: "Paper",
  dataset: "Dataset",
  software: "Software",
  talk: "Talk",
};

/** The text the Cite button copies: the admin's citation, else "<authors> (<year>). <title>. <venue>.". */
export function citationText(p: {
  citation: string | null;
  authors: string;
  year: number;
  title: string;
  venue: string;
}): string {
  const own = p.citation?.trim();
  if (own) return own;
  return `${p.authors} (${p.year}). ${p.title}. ${p.venue}.`;
}

// ---- Materials -------------------------------------------------------------

export type MaterialTag = "PDF" | "PPT" | "DOC" | "XLS" | "ZIP" | "IPYNB" | "VIDEO" | "IMG" | "LINK";

const EXTENSION_TAG: Record<string, MaterialTag> = {
  pdf: "PDF",
  ppt: "PPT", pptx: "PPT", key: "PPT",
  doc: "DOC", docx: "DOC", txt: "DOC", md: "DOC",
  xls: "XLS", xlsx: "XLS", csv: "XLS",
  zip: "ZIP", gz: "ZIP", tar: "ZIP",
  ipynb: "IPYNB",
  mp4: "VIDEO", mov: "VIDEO", webm: "VIDEO",
  jpg: "IMG", jpeg: "IMG", png: "IMG", webp: "IMG", gif: "IMG",
};

/** The extension of the last path segment, without a query or fragment, lower case. */
function extensionOf(value: string): string | null {
  const path = value.split(/[?#]/)[0];
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/**
 * What a material is: the tag drawn in its tile and whether it is a file to
 * download or a link to open. The tag comes from the extension of the address;
 * an uploaded file's address is `/api/community/files/<id>` and has none, so
 * its name ("Slides.pdf") stands in, then the first word of the note the CMS
 * fills in on upload ("PDF · 6.1 MB"). A file the tag does not know, and any
 * address that is not an upload, is a link (LINK, "Open ↗").
 */
export function materialKind(m: Pick<WorkshopMaterial, "name" | "url" | "note">): {
  tag: MaterialTag;
  download: boolean;
} {
  const upload = m.url.startsWith(COMMUNITY_FILE_PREFIX);
  const fromUrl = upload ? null : extensionOf(m.url);
  const fromNote = m.note?.split("·")[0].trim().toLowerCase() || null;
  const ext = fromUrl ?? (upload ? (extensionOf(m.name) ?? fromNote) : null);
  const tag = (ext && EXTENSION_TAG[ext]) || "LINK";
  return { tag, download: upload || tag !== "LINK" };
}

// ---- The page's tabs -------------------------------------------------------

export type CommunityTab = "all" | "workshops" | "tutorials" | "publications" | "groups";

export const COMMUNITY_TABS: readonly { id: CommunityTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "workshops", label: "Workshops" },
  { id: "tutorials", label: "Tutorials" },
  { id: "publications", label: "Publications" },
  { id: "groups", label: "Groups" },
];

/** `?tab=`, as one of the tabs; anything else is All, and so is Groups when the groups band is off. */
export function parseTab(raw: string | string[] | undefined, showGroups: boolean): CommunityTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const tab = COMMUNITY_TABS.find((t) => t.id === value)?.id ?? "all";
  return tab === "groups" && !showGroups ? "all" : tab;
}

/** The URL of a tab: All is the bare page. */
export function tabHref(tab: CommunityTab): string {
  return tab === "all" ? "/community" : `/community?tab=${tab}`;
}
