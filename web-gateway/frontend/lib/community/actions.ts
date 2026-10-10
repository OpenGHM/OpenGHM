"use server";

import { getApiClient } from "@/lib/api-client";
import { describeFailure } from "@/lib/action-failure";
import type { ActionResult } from "@/lib/jobs/types";

/**
 * Records that the signed-in visitor wants an email when discussion groups
 * open (`interested: true`), or withdraws that. Needs a session: without one
 * `getApiClient` throws its 401 and the answer is `session_expired`, for the
 * button to turn into a sign-in prompt.
 */
export async function setGroupInterest(
  interested: boolean,
): Promise<ActionResult<{ interested: boolean }>> {
  try {
    const client = await getApiClient();
    if (interested) await client.post("/api/v1/community/group-interest");
    else await client.delete("/api/v1/community/group-interest");
    return { ok: true, data: { interested } };
  } catch (error) {
    return describeFailure(error, []);
  }
}
