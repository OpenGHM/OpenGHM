/**
 * The Community page's content, as the backend's `/community` and
 * `/admin/community` routes send it (web-gateway/backend/app/api/v1/community.py).
 * Every word on the page except its labels is written in the admin CMS.
 */

/** A Tiptap / ProseMirror document. The backend allows only the node and mark
 *  types listed in app/services/community_content.py and checks every link and
 *  image address before it stores one. */
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface RichTextDoc extends RichTextNode {
  type: "doc";
  content?: RichTextNode[];
}

export type ContentState = "draft" | "published";

interface ContentMeta {
  id: string;
  state: ContentState;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type WorkshopStatus = "upcoming" | "past";

export interface WorkshopCover {
  url: string;
  alt: string;
  caption: string | null;
}

export interface WorkshopLink {
  label: string;
  url: string;
}

export interface WorkshopDetail {
  label: string;
  value: string;
}

export interface WorkshopPhoto {
  url: string;
  caption: string | null;
}

export interface WorkshopMaterial {
  name: string;
  url: string;
  note: string | null;
}

/** What an admin writes; the shape of a create or update request. */
export interface WorkshopInput {
  state: ContentState;
  slug: string;
  title: string;
  summary: string;
  /** YYYY-MM-DD, the first day. */
  date: string;
  end_date: string | null;
  /** Shown instead of the formatted date, e.g. "February–March 2027". */
  when_label: string | null;
  format: string | null;
  location: string | null;
  cover: WorkshopCover | null;
  signup: WorkshopLink | null;
  details: WorkshopDetail[];
  photos: WorkshopPhoto[];
  materials: WorkshopMaterial[];
  body: RichTextDoc | null;
}

export interface Workshop extends WorkshopInput, ContentMeta {
  /** Derived by the backend: past once (end_date ?? date) is before today. */
  status: WorkshopStatus;
}

/** A workshop as the Community page lists it. */
export type WorkshopCard = Omit<Workshop, "body" | "photos" | "materials" | "details"> & {
  photo_count: number;
  material_count: number;
};

export type TutorialKind = "gateway" | "notebook" | "video" | "guide";
export type TutorialLevel = "beginner" | "intermediate" | "advanced";

export interface TutorialInput {
  state: ContentState;
  slug: string;
  title: string;
  summary: string;
  kind: TutorialKind;
  minutes: number | null;
  level: TutorialLevel;
  /** Plain text for the card's dark code header; may be "". */
  snippet: string;
  /** null → the kind's default ("Start tutorial", "Open notebook", "Watch video"). */
  action_label: string | null;
  url: string | null;
  body: RichTextDoc | null;
}

export interface Tutorial extends TutorialInput, ContentMeta {
  position: number;
}

/** A tutorial as the Community page lists it. */
export type TutorialCard = Omit<Tutorial, "body"> & { has_body: boolean };

export type PublicationType = "paper" | "dataset" | "software" | "talk";

export interface PublicationInput {
  state: ContentState;
  year: number;
  type: PublicationType;
  title: string;
  authors: string;
  venue: string;
  link_label: string | null;
  link_url: string | null;
  /** null → "<authors> (<year>). <title>. <venue>." */
  citation: string | null;
}

export interface Publication extends PublicationInput, ContentMeta {}

export interface CommunitySettingsInput {
  hero_title: string;
  hero_intro: string;
  show_groups: boolean;
  groups_title: string;
  groups_intro: string;
}

export interface CommunitySettings extends CommunitySettingsInput {
  updated_at: string | null;
  updated_by: string | null;
}

export interface CommunityPage {
  settings: CommunitySettings;
  workshops: WorkshopCard[];
  tutorials: TutorialCard[];
  publications: Publication[];
  /** Whether the signed-in visitor asked to hear when groups open. */
  group_interest: boolean;
}

export interface CommunityFile {
  id: string;
  /** `/api/community/files/<id>`, the address content stores. */
  url: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

export interface GroupInterest {
  user_id: string;
  email: string;
  created_at: string;
}
