"use server";

import { revalidatePath } from "next/cache";
import { getApiClient } from "@/lib/api-client";
import { adminFailure } from "@/lib/community/admin-failure";
import type { ActionResult } from "@/lib/jobs/types";
import type {
  FeedItem,
  FeedKind,
  HomeUpdatesAdmin,
  HomeUpdatesSettingsInput,
} from "@/lib/home/types";

/**
 * The home page section's admin reads and writes. Every route is gated
 * server-side by Permission.CONTENT_MANAGE (admin only,
 * web-gateway/backend/app/api/v1/home.py); a refusal comes back as data like
 * the Community admin's. A write drops the cache of the home page and `/news`.
 */

const ADMIN = "/api/v1/admin/home";

function refreshPublicPages() {
  try {
    revalidatePath("/");
    revalidatePath("/news", "layout");
  } catch {
    // Outside a request (a test); the write itself succeeded.
  }
}

async function read<T>(path: string, params?: Record<string, string>): Promise<ActionResult<T>> {
  try {
    const client = await getApiClient();
    const res = await client.get<T>(`${ADMIN}${path}`, { params });
    return { ok: true, data: res.data };
  } catch (error: unknown) {
    return adminFailure(error);
  }
}

async function write<T>(method: "post" | "put" | "delete", path: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    const client = await getApiClient();
    const res = await client.request<T>({ method, url: `${ADMIN}${path}`, data: body });
    refreshPublicPages();
    return { ok: true, data: res.data };
  } catch (error: unknown) {
    return adminFailure(error);
  }
}

export async function fetchHomeSettings(): Promise<ActionResult<HomeUpdatesAdmin>> {
  return read<HomeUpdatesAdmin>("/settings");
}

export async function saveHomeSettings(input: HomeUpdatesSettingsInput): Promise<ActionResult<HomeUpdatesAdmin>> {
  return write<HomeUpdatesAdmin>("put", "/settings", input);
}

/** Recent items an admin may pin, newest first; `q` searches title and summary. */
export async function fetchPinCandidates(q: string, kind: FeedKind | "all"): Promise<ActionResult<FeedItem[]>> {
  const params: Record<string, string> = {};
  if (q.trim()) params.q = q.trim();
  if (kind !== "all") params.kind = kind;
  return read<FeedItem[]>("/candidates", params);
}

/** Pins an item at the end of the pins, and saves at once. */
export async function pinItem(kind: FeedKind, id: string): Promise<ActionResult<HomeUpdatesAdmin>> {
  return write<HomeUpdatesAdmin>("post", "/pins", { kind, id });
}

/** Unpins an item, and saves at once. */
export async function unpinItem(kind: FeedKind, id: string): Promise<ActionResult<HomeUpdatesAdmin>> {
  return write<HomeUpdatesAdmin>("delete", `/pins/${kind}/${encodeURIComponent(id)}`);
}
