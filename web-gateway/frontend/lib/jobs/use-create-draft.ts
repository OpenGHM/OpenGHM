"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deriveSimulation, duplicateSimulation } from "@/lib/jobs/actions";
import type { ActionResult, Job } from "@/lib/jobs/types";
import { stepHref } from "@/lib/workspace/draft-wizard";

export type CreateDraftError =
  /** Show `SessionExpiredBanner`. */
  | { kind: "session-expired" }
  /** `code` is the backend's, when it sent one (`snapshot_not_found`). */
  | { kind: "error"; message: string; code?: string };

/**
 * The two ways to start a draft, as the Start screen and the repository page
 * use them: from a snapshot (`deriveFrom`) or from one of the caller's own
 * simulations (`duplicateFrom`). Success opens the new draft's first step;
 * failures are returned in `error`, never thrown.
 *
 * One request at a time: a call while another is pending is ignored, so a
 * double click cannot create two drafts. `pending` stays true after a success,
 * through the navigation, for the same reason.
 */
export function useCreateDraft() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CreateDraftError | null>(null);
  // The state above lags a click by a render; this does not.
  const busy = useRef(false);

  const create = useCallback(
    async (call: () => Promise<ActionResult<Job>>, notFound: string) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await call();
        if (result.ok) {
          router.push(stepHref(result.data.id, "model"));
          return;
        }
        busy.current = false;
        setPending(false);
        if (result.reason === "session_expired") setError({ kind: "session-expired" });
        else if (result.reason === "not_found") setError({ kind: "error", message: notFound });
        else setError({ kind: "error", message: result.message, code: result.code });
      } catch (thrown) {
        busy.current = false;
        setPending(false);
        setError({
          kind: "error",
          message: thrown instanceof Error ? thrown.message : "Couldn't create the simulation.",
        });
      }
    },
    [router]
  );

  const deriveFrom = useCallback(
    (datasetId: string) =>
      create(() => deriveSimulation(datasetId), "That model snapshot is no longer in the repository."),
    [create]
  );
  const duplicateFrom = useCallback(
    (jobId: string) => create(() => duplicateSimulation(jobId), "That simulation no longer exists."),
    [create]
  );

  return { pending, error, deriveFrom, duplicateFrom };
}
