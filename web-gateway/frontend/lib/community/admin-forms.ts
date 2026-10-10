/**
 * The Community editors' forms: what each one holds while it is being edited,
 * how it turns into the request the backend takes (and back), and the checks a
 * person can see at once. The backend validates again; a 422 comes back to the
 * same field paths (`title`, `details.0.label`) these checks use.
 *
 * Optional text is "" in a form and null on the wire; rows that were added and
 * left blank are not sent.
 */
import {
  isValidImageUrl,
  isValidLinkUrl,
  isValidSlug,
  MAX_SLUG_LENGTH,
} from "@/lib/community/admin-format";
import { isRichTextTooLarge, normalizeDoc } from "@/lib/community/admin-richtext";
import type {
  CommunitySettings,
  CommunitySettingsInput,
  ContentState,
  Publication,
  PublicationInput,
  PublicationType,
  RichTextDoc,
  Tutorial,
  TutorialInput,
  TutorialKind,
  TutorialLevel,
  Workshop,
  WorkshopInput,
} from "@/lib/community/types";

/** Problems by field path; the empty object is a form fit to send. */
export type FormErrors = Record<string, string>;

/** Limits the backend enforces (docs in the spec), repeated so a form says so before it sends. */
export const LIMITS = {
  workshopTitle: 200,
  workshopSummary: 500,
  maxDetails: 20,
  maxPhotos: 60,
  maxMaterials: 40,
  tutorialSummary: 400,
  tutorialSnippet: 600,
  publicationTitle: 400,
  publicationAuthors: 1000,
  publicationVenue: 400,
  publicationLinkLabel: 40,
  publicationCitation: 2000,
  whenLabel: 100,
  format: 60,
  location: 200,
  coverText: 300,
  signupLabel: 80,
  detailLabel: 80,
  detailValue: 300,
  photoCaption: 300,
  materialName: 200,
  materialNote: 300,
  actionLabel: 60,
  heroIntro: 1000,
  settingsTitle: 200,
} as const;

/** "Keep X under N characters." when `value` is over `max`; undefined otherwise. */
function over(value: string, max: number, what: string): string | undefined {
  return value.trim().length > max ? `Keep ${what} under ${max} characters.` : undefined;
}

let rowCounter = 0;
/** A key for a row in a list a person can reorder; never sent. */
export function newRowKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const orNull = (text: string): string | null => (text.trim() ? text.trim() : null);

function checkBody(body: RichTextDoc | null, errors: FormErrors) {
  if (isRichTextTooLarge(body)) errors.body = "The text is too long. Shorten it or move parts to another page.";
}

// ─── Workshop ────────────────────────────────────────────────────────────────

export interface WorkshopForm {
  state: ContentState;
  slug: string;
  /** Once the slug is typed by hand, the title no longer rewrites it. */
  slugTouched: boolean;
  title: string;
  summary: string;
  date: string;
  endDate: string;
  whenLabel: string;
  format: string;
  location: string;
  cover: { url: string; alt: string; caption: string };
  signup: { label: string; url: string };
  details: { key: string; label: string; value: string }[];
  photos: { key: string; url: string; caption: string }[];
  materials: { key: string; name: string; url: string; note: string }[];
  body: RichTextDoc | null;
}

export function emptyWorkshopForm(): WorkshopForm {
  return {
    state: "draft",
    slug: "",
    slugTouched: false,
    title: "",
    summary: "",
    date: "",
    endDate: "",
    whenLabel: "",
    format: "",
    location: "",
    cover: { url: "", alt: "", caption: "" },
    signup: { label: "", url: "" },
    details: [],
    photos: [],
    materials: [],
    body: null,
  };
}

export function workshopToForm(w: Workshop): WorkshopForm {
  return {
    state: w.state,
    slug: w.slug,
    slugTouched: true,
    title: w.title,
    summary: w.summary,
    date: w.date,
    endDate: w.end_date ?? "",
    whenLabel: w.when_label ?? "",
    format: w.format ?? "",
    location: w.location ?? "",
    cover: { url: w.cover?.url ?? "", alt: w.cover?.alt ?? "", caption: w.cover?.caption ?? "" },
    signup: { label: w.signup?.label ?? "", url: w.signup?.url ?? "" },
    details: w.details.map((d) => ({ key: newRowKey(), label: d.label, value: d.value })),
    photos: w.photos.map((p) => ({ key: newRowKey(), url: p.url, caption: p.caption ?? "" })),
    materials: w.materials.map((m) => ({ key: newRowKey(), name: m.name, url: m.url, note: m.note ?? "" })),
    body: w.body,
  };
}

export function workshopToInput(f: WorkshopForm): WorkshopInput {
  const cover = f.cover.url.trim()
    ? { url: f.cover.url.trim(), alt: f.cover.alt.trim(), caption: orNull(f.cover.caption) }
    : null;
  const signup =
    f.signup.label.trim() || f.signup.url.trim()
      ? { label: f.signup.label.trim(), url: f.signup.url.trim() }
      : null;
  return {
    state: f.state,
    slug: f.slug.trim(),
    title: f.title.trim(),
    summary: f.summary.trim(),
    date: f.date.trim(),
    end_date: orNull(f.endDate),
    when_label: orNull(f.whenLabel),
    format: orNull(f.format),
    location: orNull(f.location),
    cover,
    signup,
    details: f.details
      .filter((d) => d.label.trim() || d.value.trim())
      .map((d) => ({ label: d.label.trim(), value: d.value.trim() })),
    photos: f.photos.filter((p) => p.url.trim()).map((p) => ({ url: p.url.trim(), caption: orNull(p.caption) })),
    materials: f.materials
      .filter((m) => m.name.trim() || m.url.trim())
      .map((m) => ({ name: m.name.trim(), url: m.url.trim(), note: orNull(m.note) })),
    body: normalizeDoc(f.body),
  };
}

/** Paths in the errors are indexes into the *sent* rows, which skip blank
 *  rows; the form validates its own rows, so blank ones are skipped here too
 *  and the indexes are those of the form. */
export function validateWorkshop(f: WorkshopForm): FormErrors {
  const e: FormErrors = {};
  if (!f.title.trim()) e.title = "Give the workshop a title.";
  else if (f.title.trim().length > LIMITS.workshopTitle) e.title = `Keep the title under ${LIMITS.workshopTitle} characters.`;

  const slug = f.slug.trim();
  if (!slug) e.slug = "A workshop needs a slug: the last part of its web address.";
  else if (!isValidSlug(slug)) {
    e.slug = `Use lower-case letters, numbers and single hyphens, at most ${MAX_SLUG_LENGTH} characters.`;
  }

  if (f.summary.trim().length > LIMITS.workshopSummary) e.summary = `Keep the summary under ${LIMITS.workshopSummary} characters.`;
  const whenLabel = over(f.whenLabel, LIMITS.whenLabel, "this");
  if (whenLabel) e.when_label = whenLabel;
  const format = over(f.format, LIMITS.format, "the format");
  if (format) e.format = format;
  const location = over(f.location, LIMITS.location, "the location");
  if (location) e.location = location;

  if (!f.date.trim()) e.date = "Choose the first day.";
  else if (!isDate(f.date.trim())) e.date = "Use a date like 2027-02-15.";
  if (f.endDate.trim()) {
    if (!isDate(f.endDate.trim())) e.end_date = "Use a date like 2027-03-31.";
    else if (isDate(f.date.trim()) && f.endDate.trim() < f.date.trim()) e.end_date = "The end can't be before the first day.";
  }

  if (f.cover.url.trim()) {
    if (!isValidImageUrl(f.cover.url.trim())) e["cover.url"] = "Upload an image, or paste an https:// address.";
    if (!f.cover.alt.trim()) e["cover.alt"] = "Describe the image for people who can't see it.";
    else {
      const alt = over(f.cover.alt, LIMITS.coverText, "the description");
      if (alt) e["cover.alt"] = alt;
    }
    const caption = over(f.cover.caption, LIMITS.coverText, "the caption");
    if (caption) e["cover.caption"] = caption;
  } else if (f.cover.alt.trim() || f.cover.caption.trim()) {
    e["cover.url"] = "Add the image, or clear its description.";
  }

  if (f.signup.label.trim() || f.signup.url.trim()) {
    if (!f.signup.label.trim()) e["signup.label"] = "Say what the link is for.";
    else {
      const label = over(f.signup.label, LIMITS.signupLabel, "the button text");
      if (label) e["signup.label"] = label;
    }
    if (!f.signup.url.trim()) e["signup.url"] = "Add the address the link opens.";
    else if (!isValidLinkUrl(f.signup.url.trim())) e["signup.url"] = "Use an https:// address, with no spaces.";
  }

  f.details.forEach((d, i) => {
    if (!d.label.trim() && !d.value.trim()) return;
    if (!d.label.trim()) e[`details.${i}.label`] = "Name this row.";
    else {
      const label = over(d.label, LIMITS.detailLabel, "the label");
      if (label) e[`details.${i}.label`] = label;
    }
    if (!d.value.trim()) e[`details.${i}.value`] = "Say what it is.";
    else {
      const value = over(d.value, LIMITS.detailValue, "the value");
      if (value) e[`details.${i}.value`] = value;
    }
  });
  if (f.details.length > LIMITS.maxDetails) e.details = `At most ${LIMITS.maxDetails} rows.`;

  f.photos.forEach((p, i) => {
    if (p.url.trim() && !isValidImageUrl(p.url.trim())) e[`photos.${i}.url`] = "Upload an image, or paste an https:// address.";
    else {
      const caption = over(p.caption, LIMITS.photoCaption, "the caption");
      if (caption) e[`photos.${i}.url`] = caption;
    }
  });
  if (f.photos.length > LIMITS.maxPhotos) e.photos = `At most ${LIMITS.maxPhotos} photos.`;

  f.materials.forEach((m, i) => {
    if (!m.name.trim() && !m.url.trim()) return;
    if (!m.name.trim()) e[`materials.${i}.name`] = "Name this material.";
    else {
      const name = over(m.name, LIMITS.materialName, "the name");
      if (name) e[`materials.${i}.name`] = name;
    }
    const note = over(m.note, LIMITS.materialNote, "the note");
    if (note) e[`materials.${i}.note`] = note;
    if (!m.url.trim()) e[`materials.${i}.url`] = "Upload a file or add a link.";
    else if (!isValidLinkUrl(m.url.trim())) e[`materials.${i}.url`] = "Use an https:// address, or upload the file.";
  });
  if (f.materials.length > LIMITS.maxMaterials) e.materials = `At most ${LIMITS.maxMaterials} materials.`;

  checkBody(f.body, e);
  return e;
}

/** A form path (`details.2.label`) as the path of the row actually sent, when blank rows are skipped. */
export function sentPathToFormPath(
  path: string,
  f: Pick<WorkshopForm, "details" | "photos" | "materials">
): string {
  const m = /^(details|photos|materials)\.(\d+)(\..*)?$/.exec(path);
  if (!m) return path;
  const [, list, index, rest = ""] = m;
  const rows: { [key: string]: string }[] = f[list as "details" | "photos" | "materials"];
  const kept = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => Object.entries(row).some(([k, v]) => k !== "key" && v.trim()));
  const target = kept[Number(index)];
  return target ? `${list}.${target.i}${rest}` : path;
}

// ─── Tutorial ────────────────────────────────────────────────────────────────

export const TUTORIAL_KINDS: { value: TutorialKind; label: string }[] = [
  { value: "gateway", label: "In the gateway" },
  { value: "notebook", label: "Notebook" },
  { value: "video", label: "Video" },
  { value: "guide", label: "Guide" },
];

export const TUTORIAL_LEVELS: { value: TutorialLevel; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export interface TutorialForm {
  state: ContentState;
  slug: string;
  slugTouched: boolean;
  title: string;
  summary: string;
  kind: TutorialKind;
  minutes: string;
  level: TutorialLevel;
  snippet: string;
  actionLabel: string;
  url: string;
  body: RichTextDoc | null;
}

export function emptyTutorialForm(): TutorialForm {
  return {
    state: "draft",
    slug: "",
    slugTouched: false,
    title: "",
    summary: "",
    kind: "gateway",
    minutes: "",
    level: "beginner",
    snippet: "",
    actionLabel: "",
    url: "",
    body: null,
  };
}

export function tutorialToForm(t: Tutorial): TutorialForm {
  return {
    state: t.state,
    slug: t.slug,
    slugTouched: true,
    title: t.title,
    summary: t.summary,
    kind: t.kind,
    minutes: t.minutes === null ? "" : String(t.minutes),
    level: t.level,
    snippet: t.snippet,
    actionLabel: t.action_label ?? "",
    url: t.url ?? "",
    body: t.body,
  };
}

export function tutorialToInput(f: TutorialForm): TutorialInput {
  const minutes = f.minutes.trim();
  return {
    state: f.state,
    slug: f.slug.trim(),
    title: f.title.trim(),
    summary: f.summary.trim(),
    kind: f.kind,
    minutes: minutes && /^\d+$/.test(minutes) ? Number(minutes) : null,
    level: f.level,
    snippet: f.snippet,
    action_label: orNull(f.actionLabel),
    url: orNull(f.url),
    body: normalizeDoc(f.body),
  };
}

export function validateTutorial(f: TutorialForm): FormErrors {
  const e: FormErrors = {};
  if (!f.title.trim()) e.title = "Give the tutorial a title.";
  const slug = f.slug.trim();
  if (!slug) e.slug = "A tutorial needs a slug: the last part of its web address.";
  else if (!isValidSlug(slug)) {
    e.slug = `Use lower-case letters, numbers and single hyphens, at most ${MAX_SLUG_LENGTH} characters.`;
  }
  if (f.summary.trim().length > LIMITS.tutorialSummary) e.summary = `Keep the summary under ${LIMITS.tutorialSummary} characters.`;
  const minutes = f.minutes.trim();
  if (minutes) {
    const n = Number(minutes);
    if (!/^\d+$/.test(minutes) || n < 1 || n > 600) e.minutes = "Use a whole number of minutes, 1 to 600.";
  }
  const action = over(f.actionLabel, LIMITS.actionLabel, "the button text");
  if (action) e.action_label = action;
  if (f.title.trim().length > LIMITS.workshopTitle) e.title = `Keep the title under ${LIMITS.workshopTitle} characters.`;
  if (f.snippet.length > LIMITS.tutorialSnippet) e.snippet = `Keep the snippet under ${LIMITS.tutorialSnippet} characters.`;
  if (f.url.trim() && !isValidLinkUrl(f.url.trim())) e.url = "Use an https:// address or a path on this site, like /workspace.";
  checkBody(f.body, e);
  return e;
}

// ─── Publication ─────────────────────────────────────────────────────────────

export const PUBLICATION_TYPES: { value: PublicationType; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "dataset", label: "Dataset" },
  { value: "software", label: "Software" },
  { value: "talk", label: "Talk" },
];

export interface PublicationForm {
  state: ContentState;
  year: string;
  type: PublicationType;
  title: string;
  authors: string;
  venue: string;
  linkLabel: string;
  linkUrl: string;
  citation: string;
}

export function emptyPublicationForm(year: number = new Date().getUTCFullYear()): PublicationForm {
  return {
    state: "draft",
    year: String(year),
    type: "paper",
    title: "",
    authors: "",
    venue: "",
    linkLabel: "",
    linkUrl: "",
    citation: "",
  };
}

export function publicationToForm(p: Publication): PublicationForm {
  return {
    state: p.state,
    year: String(p.year),
    type: p.type,
    title: p.title,
    authors: p.authors,
    venue: p.venue,
    linkLabel: p.link_label ?? "",
    linkUrl: p.link_url ?? "",
    citation: p.citation ?? "",
  };
}

export function publicationToInput(f: PublicationForm): PublicationInput {
  return {
    state: f.state,
    year: Number(f.year.trim()),
    type: f.type,
    title: f.title.trim(),
    authors: f.authors.trim(),
    venue: f.venue.trim(),
    link_label: orNull(f.linkLabel),
    link_url: orNull(f.linkUrl),
    citation: orNull(f.citation),
  };
}

export function validatePublication(f: PublicationForm): FormErrors {
  const e: FormErrors = {};
  const year = f.year.trim();
  if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2100) e.year = "Use a four-digit year, 1900 to 2100.";
  if (!f.title.trim()) e.title = "Give the publication a title.";
  else if (f.title.trim().length > LIMITS.publicationTitle) e.title = `Keep the title under ${LIMITS.publicationTitle} characters.`;
  if (f.authors.trim().length > LIMITS.publicationAuthors) e.authors = `Keep the authors under ${LIMITS.publicationAuthors} characters.`;
  if (f.venue.trim().length > LIMITS.publicationVenue) e.venue = `Keep the venue under ${LIMITS.publicationVenue} characters.`;
  const linkLabel = over(f.linkLabel, LIMITS.publicationLinkLabel, "the link text");
  if (linkLabel) e.link_label = linkLabel;
  const citation = over(f.citation, LIMITS.publicationCitation, "the citation");
  if (citation) e.citation = citation;
  if (f.linkUrl.trim() && !isValidLinkUrl(f.linkUrl.trim())) e.link_url = "Use an https:// address, with no spaces.";
  if (f.linkLabel.trim() && !f.linkUrl.trim()) e.link_url = "Add the address the link opens, or clear its label.";
  return e;
}

// ─── Page settings ───────────────────────────────────────────────────────────

export function settingsToForm(s: CommunitySettings): CommunitySettingsInput {
  return {
    hero_title: s.hero_title,
    hero_intro: s.hero_intro,
    show_groups: s.show_groups,
    groups_title: s.groups_title,
    groups_intro: s.groups_intro,
  };
}

export function validateSettings(f: CommunitySettingsInput): FormErrors {
  const e: FormErrors = {};
  if (!f.hero_title.trim()) e.hero_title = "The page needs a title.";
  const heroTitle = over(f.hero_title, LIMITS.settingsTitle, "the title");
  if (heroTitle && !e.hero_title) e.hero_title = heroTitle;
  const heroIntro = over(f.hero_intro, LIMITS.heroIntro, "the introduction");
  if (heroIntro) e.hero_intro = heroIntro;
  if (f.show_groups && !f.groups_title.trim()) e.groups_title = "Name the section, or hide it.";
  const groupsTitle = over(f.groups_title, LIMITS.settingsTitle, "the title");
  if (groupsTitle && !e.groups_title) e.groups_title = groupsTitle;
  const groupsIntro = over(f.groups_intro, LIMITS.heroIntro, "the introduction");
  if (groupsIntro) e.groups_intro = groupsIntro;
  return e;
}

export function settingsToInput(f: CommunitySettingsInput): CommunitySettingsInput {
  return {
    hero_title: f.hero_title.trim(),
    hero_intro: f.hero_intro.trim(),
    show_groups: f.show_groups,
    groups_title: f.groups_title.trim(),
    groups_intro: f.groups_intro.trim(),
  };
}

/** A stable text of what would be sent, to tell whether a form changed. */
export function fingerprint(input: unknown): string {
  return JSON.stringify(input);
}
