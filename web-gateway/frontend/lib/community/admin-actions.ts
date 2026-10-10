"use server";

import { revalidatePath } from "next/cache";
import { getApiClient } from "@/lib/api-client";
import { adminFailure } from "@/lib/community/admin-failure";
import type { ActionResult } from "@/lib/jobs/types";
import type {
  BulkAction,
  BulkResult,
  CommunityFile,
  ContentKind,
  CommunitySettings,
  CommunitySettingsInput,
  NewsInput,
  NewsPost,
  Publication,
  PublicationInput,
  Tutorial,
  TutorialInput,
  Workshop,
  WorkshopInput,
} from "@/lib/community/types";

/**
 * The Community admin's reads and writes. Every route is gated server-side by
 * Permission.CONTENT_MANAGE (admin only, web-gateway/backend/app/api/v1/community.py);
 * these functions do not repeat that check, and a refusal comes back as data
 * (`session_expired`, `not_found`, or `error` with the backend's words and,
 * for a 422, a message per field). A write also drops the public pages' cache,
 * so the change shows on /community at once.
 */

const ADMIN = "/api/v1/admin/community";

/** The public pages show what an admin saved: refresh them. */
function refreshPublicPages() {
  try {
    revalidatePath("/community", "layout");
    // News posts feed the home page and have pages of their own.
    revalidatePath("/");
    revalidatePath("/news", "layout");
  } catch {
    // Outside a request (a test); the write itself succeeded.
  }
}

async function read<T>(path: string): Promise<ActionResult<T>> {
  try {
    const client = await getApiClient();
    const res = await client.get<T>(`${ADMIN}${path}`);
    return { ok: true, data: res.data };
  } catch (error: unknown) {
    return adminFailure(error);
  }
}

async function write<T>(
  method: "post" | "put" | "delete",
  path: string,
  body?: unknown
): Promise<ActionResult<T>> {
  try {
    const client = await getApiClient();
    const res = await client.request<T>({ method, url: `${ADMIN}${path}`, data: body });
    refreshPublicPages();
    // A 204 has no body; Axios hands back "".
    return { ok: true, data: (res.data === "" ? null : res.data) as T };
  } catch (error: unknown) {
    return adminFailure(error);
  }
}

// ─── Workshops ───────────────────────────────────────────────────────────────

export async function fetchAdminWorkshops(): Promise<ActionResult<Workshop[]>> {
  return read<Workshop[]>("/workshops");
}

export async function fetchAdminWorkshop(id: string): Promise<ActionResult<Workshop>> {
  return read<Workshop>(`/workshops/${encodeURIComponent(id)}`);
}

export async function createWorkshop(input: WorkshopInput): Promise<ActionResult<Workshop>> {
  return write<Workshop>("post", "/workshops", input);
}

export async function updateWorkshop(id: string, input: WorkshopInput): Promise<ActionResult<Workshop>> {
  return write<Workshop>("put", `/workshops/${encodeURIComponent(id)}`, input);
}

export async function deleteWorkshop(id: string): Promise<ActionResult<null>> {
  return write<null>("delete", `/workshops/${encodeURIComponent(id)}`);
}

// ─── Tutorials ───────────────────────────────────────────────────────────────

export async function fetchAdminTutorials(): Promise<ActionResult<Tutorial[]>> {
  return read<Tutorial[]>("/tutorials");
}

export async function fetchAdminTutorial(id: string): Promise<ActionResult<Tutorial>> {
  return read<Tutorial>(`/tutorials/${encodeURIComponent(id)}`);
}

export async function createTutorial(input: TutorialInput): Promise<ActionResult<Tutorial>> {
  return write<Tutorial>("post", "/tutorials", input);
}

export async function updateTutorial(id: string, input: TutorialInput): Promise<ActionResult<Tutorial>> {
  return write<Tutorial>("put", `/tutorials/${encodeURIComponent(id)}`, input);
}

export async function deleteTutorial(id: string): Promise<ActionResult<null>> {
  return write<null>("delete", `/tutorials/${encodeURIComponent(id)}`);
}

/** Sets each tutorial's position to its place in `ids`. */
export async function reorderTutorials(ids: string[]): Promise<ActionResult<null>> {
  return write<null>("post", "/tutorials/reorder", { ids });
}

// ─── News posts ──────────────────────────────────────────────────────────────

export async function fetchAdminNewsList(): Promise<ActionResult<NewsPost[]>> {
  return read<NewsPost[]>("/news");
}

export async function fetchAdminNews(id: string): Promise<ActionResult<NewsPost>> {
  return read<NewsPost>(`/news/${encodeURIComponent(id)}`);
}

export async function createNews(input: NewsInput): Promise<ActionResult<NewsPost>> {
  return write<NewsPost>("post", "/news", input);
}

export async function updateNews(id: string, input: NewsInput): Promise<ActionResult<NewsPost>> {
  return write<NewsPost>("put", `/news/${encodeURIComponent(id)}`, input);
}

export async function deleteNews(id: string): Promise<ActionResult<null>> {
  return write<null>("delete", `/news/${encodeURIComponent(id)}`);
}

// ─── Publications ────────────────────────────────────────────────────────────

export async function fetchAdminPublications(): Promise<ActionResult<Publication[]>> {
  return read<Publication[]>("/publications");
}

export async function createPublication(input: PublicationInput): Promise<ActionResult<Publication>> {
  return write<Publication>("post", "/publications", input);
}

export async function updatePublication(id: string, input: PublicationInput): Promise<ActionResult<Publication>> {
  return write<Publication>("put", `/publications/${encodeURIComponent(id)}`, input);
}

export async function deletePublication(id: string): Promise<ActionResult<null>> {
  return write<null>("delete", `/publications/${encodeURIComponent(id)}`);
}

/**
 * Delete, show or hide several items of a kind in one request.
 * The backend answers per id (`done`, `missing`) and audits each item as the
 * single-item route does; `publish` and `draft` change only the state.
 */
export async function bulkContent(
  kind: ContentKind,
  action: BulkAction,
  ids: string[]
): Promise<ActionResult<BulkResult>> {
  return write<BulkResult>("post", `/${kind}/bulk`, { action, ids });
}

// ─── Page settings and files ─────────────────────────────────────────────────

export async function fetchAdminSettings(): Promise<ActionResult<CommunitySettings>> {
  return read<CommunitySettings>("/settings");
}

export async function saveAdminSettings(input: CommunitySettingsInput): Promise<ActionResult<CommunitySettings>> {
  return write<CommunitySettings>("put", "/settings", input);
}

export async function fetchCommunityFiles(): Promise<ActionResult<CommunityFile[]>> {
  return read<CommunityFile[]>("/files");
}

export async function deleteCommunityFile(id: string): Promise<ActionResult<null>> {
  return write<null>("delete", `/files/${encodeURIComponent(id)}`);
}

/** Deletes several files in one request; answers per id like `bulkContent`. */
export async function bulkDeleteFiles(ids: string[]): Promise<ActionResult<BulkResult>> {
  return write<BulkResult>("post", "/files/bulk-delete", { ids });
}
