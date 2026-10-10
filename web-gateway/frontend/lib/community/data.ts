import { cache } from "react";
import { getApiClient } from "@/lib/api-client";
import { DEFAULT_COMMUNITY_SETTINGS } from "@/lib/community/settings";
import type { CommunityPage, Tutorial, Workshop } from "@/lib/community/types";

/**
 * Reads of the public Community content, for the server components of
 * `/community`. They are open to anonymous visitors. Not a server-action
 * module: nothing here is callable from the browser.
 */

/** A slug the backend could hold: anything else is a 404 without asking. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}

/** Fills what the backend left out, so the page never reads a missing list or a blank heading. */
export function withDefaults(data: Partial<CommunityPage> | null | undefined): CommunityPage {
  const settings = { ...DEFAULT_COMMUNITY_SETTINGS };
  for (const [key, value] of Object.entries(data?.settings ?? {})) {
    // A heading is never blank; an intro an admin cleared stays cleared.
    const blankHeading = value === "" && key.endsWith("_title");
    if (value !== null && value !== undefined && !blankHeading) {
      (settings as Record<string, unknown>)[key] = value;
    }
  }
  return {
    settings,
    workshops: data?.workshops ?? [],
    tutorials: data?.tutorials ?? [],
    publications: data?.publications ?? [],
  };
}

/** Everything the Community page lists. Throws when the backend cannot be reached; the page shows its error box. */
export async function fetchCommunityPage(): Promise<CommunityPage> {
  const client = await getApiClient({ allowAnonymous: true });
  const response = await client.get<CommunityPage>("/api/v1/community");
  return withDefaults(response.data);
}

/** One published workshop, or null when there is none by that slug. */
export async function fetchWorkshop(slug: string): Promise<Workshop | null> {
  if (!SLUG.test(slug)) return null;
  try {
    const client = await getApiClient({ allowAnonymous: true });
    const response = await client.get<Workshop>(
      `/api/v1/community/workshops/${encodeURIComponent(slug)}`,
    );
    return response.data;
  } catch (error: unknown) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** One published tutorial, or null when there is none by that slug. */
export async function fetchTutorial(slug: string): Promise<Tutorial | null> {
  if (!SLUG.test(slug)) return null;
  try {
    const client = await getApiClient({ allowAnonymous: true });
    const response = await client.get<Tutorial>(
      `/api/v1/community/tutorials/${encodeURIComponent(slug)}`,
    );
    return response.data;
  } catch (error: unknown) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** The page and `generateMetadata` both read the same item; `cache` makes that one request per render. */
export const getWorkshop = cache(fetchWorkshop);
export const getTutorial = cache(fetchTutorial);
