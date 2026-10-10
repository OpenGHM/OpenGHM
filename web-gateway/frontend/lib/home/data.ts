import { cache } from "react";
import { getApiClient } from "@/lib/api-client";
import { DEFAULT_HOME_SETTINGS } from "@/lib/home/settings";
import type { HomeUpdates, UpdatesArchive } from "@/lib/home/types";
import type { NewsPost } from "@/lib/community/types";

/**
 * Reads of the public feed, for the home page and `/news`. Open to anonymous
 * visitors. Not a server-action module: nothing here is callable from the browser.
 */

/** A slug the backend could hold: anything else is a 404 without asking. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}

/** Fills what the backend left out, so the section never reads a missing heading or count. */
export function withDefaults(data: Partial<HomeUpdates> | null | undefined): HomeUpdates {
  const settings = { ...DEFAULT_HOME_SETTINGS, sources: { ...DEFAULT_HOME_SETTINGS.sources } };
  for (const [key, value] of Object.entries(data?.settings ?? {})) {
    if (value !== null && value !== undefined && value !== "") (settings as Record<string, unknown>)[key] = value;
  }
  return { settings, items: data?.items ?? [] };
}

/** The cards of the home page. Throws when the backend cannot be reached; the section hides itself. */
export async function fetchHomeUpdates(): Promise<HomeUpdates> {
  // The home page waits for this: a short timeout, so a slow backend costs it seconds, not the default ten.
  const client = await getApiClient({ allowAnonymous: true, timeoutMs: 4000 });
  const response = await client.get<HomeUpdates>("/api/v1/home/updates");
  return withDefaults(response.data);
}

/** Everything `/news` lists, newest first. Throws when the backend cannot be reached; the page shows its error box. */
export async function fetchAllUpdates(): Promise<UpdatesArchive> {
  const client = await getApiClient({ allowAnonymous: true });
  const response = await client.get<UpdatesArchive>("/api/v1/home/updates/all");
  return { items: response.data?.items ?? [] };
}

/** One published news post that has page text, or null when there is none by that slug. */
export async function fetchNews(slug: string): Promise<NewsPost | null> {
  if (!SLUG.test(slug)) return null;
  try {
    const client = await getApiClient({ allowAnonymous: true });
    const response = await client.get<NewsPost>(`/api/v1/community/news/${encodeURIComponent(slug)}`);
    return response.data;
  } catch (error: unknown) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** The page and `generateMetadata` both read the same post; `cache` makes that one request per render. */
export const getNews = cache(fetchNews);
