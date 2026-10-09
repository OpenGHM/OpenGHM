/**
 * The pure parts of publishing a snapshot draft as a snapshot (ADR 0031): when
 * the action is offered, the form's values and their checks, and how a refusal
 * of the backend maps onto the form's fields. `publish-sheet.tsx` and
 * `publish-card.tsx` wire them to the screen.
 */
import type {
  ActionFieldError,
  FilesState,
  JobFailure,
  JobStatus,
  PartialAbout,
  PublishAbout,
  PublishRecord,
} from "@/lib/jobs/types";
import { ABOUT_TAGS, type AboutTag } from "@/lib/repository/catalogue";

/** The `about` fields a person writes, in the order the form lists them. */
export type PublishField = "name" | "description" | "creator" | "license" | "keywords" | "tags";

export const PUBLISH_FIELDS: readonly PublishField[] = [
  "name",
  "description",
  "creator",
  "license",
  "keywords",
  "tags",
];

/** Licenses the form suggests: bare SPDX identifiers (`about.license` is not a
 *  URL). The field takes any identifier. */
export const LICENSE_SUGGESTIONS: readonly string[] = [
  "GPL-3.0-only",
  "CC-BY-4.0",
  "CC0-1.0",
  "MIT",
  "Apache-2.0",
];

/**
 * Whether a draft is offered "Publish as snapshot": its simulation completed,
 * nothing failed, no publish is under way or done, and its output is still on
 * Anvil. The backend decides again (`POST /jobs/{id}/publish`, 409
 * `not_publishable`): a draft that a published snapshot answered cannot be
 * told from here, because it is never run, so it never reaches COMPLETED unless
 * its owner asked for a rerun.
 */
export function canPublish(job: {
  status: JobStatus;
  failure: JobFailure | null;
  files: FilesState | null;
  publish: PublishRecord | null | undefined;
}): boolean {
  if (job.status !== "COMPLETED" || job.failure) return false;
  if (job.files === "purged") return false;
  return !job.publish || job.publish.state === "failed";
}

// ─── The form ────────────────────────────────────────────────────────────────

export interface CreatorRow {
  name: string;
  email: string;
  orcid: string;
}

/** What the form holds. Keywords are one line of text, split on commas. */
export interface PublishFormValues {
  name: string;
  description: string;
  creators: CreatorRow[];
  license: string;
  keywords: string;
  tags: AboutTag[];
}

const emptyCreator = (): CreatorRow => ({ name: "", email: "", orcid: "" });

export function newCreatorRow(): CreatorRow {
  return emptyCreator();
}

/** The form filled from a stored `about` (the draft's own, or the one a failed
 *  publish was composed from). Missing parts start empty, and a tag that is
 *  not on the spec's closed list is dropped rather than shown as a choice. */
export function formFromAbout(about: PartialAbout | null | undefined): PublishFormValues {
  const known = new Set<string>(ABOUT_TAGS);
  return {
    name: about?.name ?? "",
    description: about?.description ?? "",
    creators:
      about?.creator && about.creator.length > 0
        ? about.creator.map((c) => ({ name: c.name ?? "", email: c.email ?? "", orcid: c.orcid ?? "" }))
        : [emptyCreator()],
    license: about?.license ?? "",
    keywords: (about?.keywords ?? []).join(", "),
    tags: (about?.tags ?? []).filter((t): t is AboutTag => known.has(t)),
  };
}

/**
 * What the form starts from: `own` (the failed attempt's words, else the
 * draft's `about`), with what it lacks filled from the base snapshot's `about`
 * (`base`). A derived draft may carry none of its own, so a form that opened
 * empty would make the person retype what the base already says.
 *
 * Only what carries over to a rerun is taken from the base: `creator`,
 * `license`, `keywords` and `tags`. `name` and `description` are the draft's own
 * or empty, because a rerun must not silently be published under the base's
 * title and description. `relatedLink` is not taken either: the form does not
 * show it, so nothing the person has not seen is sent. Null when there is
 * nothing to start from.
 */
export function prefillAbout(
  own: PartialAbout | null | undefined,
  base: PartialAbout | null | undefined
): PartialAbout | null {
  if (!own && !base) return null;
  const pick = <K extends "creator" | "license" | "keywords" | "tags">(key: K): PartialAbout[K] | undefined => {
    const mine = own?.[key];
    const has = Array.isArray(mine) ? mine.length > 0 : Boolean(mine);
    return has ? mine : base?.[key];
  };
  const filled: PartialAbout = { ...own };
  for (const key of ["creator", "license", "keywords", "tags"] as const) {
    const value = pick(key);
    if (value !== undefined) (filled as Record<string, unknown>)[key] = value;
  }
  return filled;
}

/** The keywords typed on one line, trimmed, without blanks or repeats. */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const word = part.trim();
    if (word && !seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  }
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORCID = /^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/;

/** One message per field that is not fit to send, and one per creator row. The
 *  backend checks again; these are the ones a person can see at once, in the
 *  spec's own terms (`schemas/common/about/1.0.0.json`). */
export interface PublishFormErrors {
  fields: Partial<Record<PublishField, string>>;
  /** By row of `creators`. */
  creators: Record<number, { name?: string; email?: string; orcid?: string }>;
}

export function validatePublishForm(values: PublishFormValues): PublishFormErrors {
  const fields: PublishFormErrors["fields"] = {};
  const creators: PublishFormErrors["creators"] = {};

  if (!values.name.trim()) fields.name = "Give the snapshot a name.";
  if (!values.description.trim()) fields.description = "Describe what the snapshot holds.";

  const named = values.creators.filter((c) => c.name.trim() || c.email.trim() || c.orcid.trim());
  if (named.length === 0) fields.creator = "Name at least one creator.";
  values.creators.forEach((c, i) => {
    const touched = c.name.trim() || c.email.trim() || c.orcid.trim();
    if (!touched) return;
    const row: { name?: string; email?: string; orcid?: string } = {};
    if (!c.name.trim()) row.name = "A creator needs a name.";
    if (c.email.trim() && !EMAIL.test(c.email.trim())) row.email = "Not an email address.";
    if (c.orcid.trim() && !ORCID.test(c.orcid.trim())) row.orcid = "Use the form 0000-0002-1825-0097.";
    if (Object.keys(row).length > 0) creators[i] = row;
  });

  const license = values.license.trim();
  if (!license) fields.license = "Choose a license.";
  else if (/\s|:\/\//.test(license)) fields.license = "Use a bare SPDX identifier, such as CC-BY-4.0, not a URL.";

  if (parseKeywords(values.keywords).length === 0) fields.keywords = "Add at least one keyword.";
  if (values.tags.length === 0) fields.tags = "Pick at least one tag.";

  return { fields, creators };
}

/** Whether `validatePublishForm` found nothing. */
export function isValid(errors: PublishFormErrors): boolean {
  return Object.keys(errors.fields).length === 0 && Object.keys(errors.creators).length === 0;
}

/** The first field with a problem, in the form's order; null when none. A
 *  creator row's problem counts for `creator`. */
export function firstInvalid(errors: PublishFormErrors): PublishField | null {
  for (const field of PUBLISH_FIELDS) {
    if (errors.fields[field] || (field === "creator" && Object.keys(errors.creators).length > 0)) return field;
  }
  return null;
}

/**
 * The body of `POST /jobs/{id}/publish` from the form. `relatedLink` is not
 * edited here, so a draft's own list travels as it is stored. `datePublished`,
 * `url` and `isBasedOn` are the gateway's to set and are never sent.
 */
export function aboutFromForm(values: PublishFormValues, stored: PartialAbout | null | undefined): PublishAbout {
  const creator = values.creators
    .filter((c) => c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      ...(c.email.trim() ? { email: c.email.trim() } : {}),
      ...(c.orcid.trim() ? { orcid: c.orcid.trim() } : {}),
    }));
  const about = {
    name: values.name.trim(),
    description: values.description.trim(),
    creator,
    license: values.license.trim(),
    keywords: parseKeywords(values.keywords),
    tags: values.tags,
    ...(stored?.relatedLink && stored.relatedLink.length > 0 ? { relatedLink: stored.relatedLink } : {}),
  };
  return about as unknown as PublishAbout;
}

/**
 * The `about` a publish was composed from, read back from the `metadata.json`
 * the gateway stored at its first attempt (`publish.metadata`). It is what "Try
 * again" sends and what "edit" reopens the form on: the person's own words,
 * without the fields the gateway set. Null when the record holds none.
 */
export function aboutFromRecord(record: PublishRecord | null | undefined): PartialAbout | null {
  const about = record?.metadata?.about;
  if (!about || typeof about !== "object") return null;
  const written: Record<string, unknown> = { ...(about as Record<string, unknown>) };
  for (const key of ["datePublished", "url", "isBasedOn"]) delete written[key];
  return written as PartialAbout;
}

// ─── What the backend refused ────────────────────────────────────────────────

/** The form field a path names: `about.tags.0` is `tags`, `about.creator.1.email`
 *  is `creator`. Null when it names none of them. */
export function fieldOfPath(path: string | null): PublishField | null {
  if (!path) return null;
  for (const part of path.split(/[.[\]]+/)) {
    if (part === "creators") return "creator";
    if ((PUBLISH_FIELDS as readonly string[]).includes(part)) return part as PublishField;
  }
  return null;
}

/** A 422 `invalid_about` split into messages beside their fields and the
 *  rest, which the sheet shows at its foot. */
export function splitServerErrors(errors: ActionFieldError[] | undefined): {
  fields: Partial<Record<PublishField, string>>;
  general: string[];
} {
  const fields: Partial<Record<PublishField, string>> = {};
  const general: string[] = [];
  for (const error of errors ?? []) {
    const field = fieldOfPath(error.path);
    if (!field) general.push(error.message);
    else fields[field] = fields[field] ? `${fields[field]} ${error.message}` : error.message;
  }
  return { fields, general };
}

/** What the publish of a draft is showing as: nothing yet, or one of the
 *  record's three states. */
export type PublishPhase = "none" | PublishRecord["state"];

export function publishPhase(publish: PublishRecord | null | undefined): PublishPhase {
  return publish ? publish.state : "none";
}
