/**
 * The states the design preview can show. `/dev/workspace/<key>`
 * (`app/dev/workspace/[state]`) renders the job detail page from a fixture
 * (`previewDraftJob` in lib/workspace/fixtures.ts) instead of a fetch, so each
 * status and each verdict cause can be reviewed without making Anvil produce
 * it. The fixtures are the preview's and the tests' data: only that route
 * uses them, and it answers 404 in production. No real page imports them.
 *
 * A DRAFT is not here: it is the draft wizard's page, and its state is the
 * person's own (`components/workspace/draft-wizard.tsx`).
 *
 * Keys are lower case, `<status>` or `<status>:<variant>`. A bare upper-case
 * status (`/dev/workspace/FAILED`) still works.
 */
import type { FailureCause, JobStatus, PublishFailureCause } from "@/lib/jobs/types";

/** The causes a FAILED job can carry. The two cancels belong to CANCELLED. */
export const FAILED_CAUSES: readonly FailureCause[] = [
  "fetch_failed",
  "gateway_setup",
  "run_refused",
  "wbm_error",
  "post_processing_failed",
  "wbm_silent_failure",
  "timeout",
  "out_of_memory",
  "node_failure",
  "lost",
  "outcome_missing",
];

/** The causes a failed publish can carry (`PublishFailureCause` in the
 *  backend's app/models/job.py). */
export const PUBLISH_FAILED_CAUSES: readonly PublishFailureCause[] = [
  "publish_bad_input",
  "publish_output_incomplete",
  "publish_conflict",
  "publish_setup",
  "publish_upload_failed",
  "publish_verify_failed",
  "publish_job_failed",
  "publish_submit_interrupted",
  "anvil_not_configured",
  "anvil_unreachable",
  "sbatch_rejected",
  "internal_error",
];

export interface PreviewOption {
  key: string;
  label: string;
  status: JobStatus;
}

export interface PreviewGroup {
  title: string;
  options: PreviewOption[];
}

const plain = (status: JobStatus): PreviewOption => ({
  key: status.toLowerCase(),
  label: status,
  status,
});

/** Every fixture the switcher offers, in the order it shows them. */
export const PREVIEW_GROUPS: readonly PreviewGroup[] = [
  {
    title: "Status",
    options: [
      plain("PENDING"),
      plain("SUBMITTED"),
      plain("RUNNING"),
      { key: "cancelling", label: "CANCELLING", status: "RUNNING" },
      plain("COMPLETING"),
    ],
  },
  {
    title: "Completed",
    options: [
      { key: "completed", label: "manifest", status: "COMPLETED" },
      { key: "completed:purged", label: "purged", status: "COMPLETED" },
      { key: "completed:legacy", label: "no record", status: "COMPLETED" },
    ],
  },
  {
    title: "Publish",
    options: [
      { key: "publish:publishing", label: "publishing", status: "COMPLETED" },
      { key: "publish:published", label: "published", status: "COMPLETED" },
      ...PUBLISH_FAILED_CAUSES.map((cause) => ({
        key: `publish:${cause}`,
        label: cause.replace(/^publish_/, "").replace(/_/g, " "),
        status: "COMPLETED" as const,
      })),
    ],
  },
  {
    title: "Failed",
    options: FAILED_CAUSES.map((cause) => ({
      key: `failed:${cause}`,
      label: cause,
      status: "FAILED" as const,
    })),
  },
  {
    title: "Cancelled",
    options: [
      { key: "cancelled:user", label: "by you", status: "CANCELLED" },
      { key: "cancelled:other", label: "by someone else", status: "CANCELLED" },
      { key: "cancelled:system", label: "by Anvil", status: "CANCELLED" },
    ],
  },
];

const ALIASES: Record<string, string> = {
  failed: "failed:wbm_error",
  cancelled: "cancelled:user",
};

const BY_KEY = new Map(PREVIEW_GROUPS.flatMap((g) => g.options).map((o) => [o.key, o]));

/** The preview a state key names, or null: unknown, or production. */
export function resolvePreview(raw: string | undefined): PreviewOption | null {
  if (!raw) return null;
  if (process.env.NODE_ENV === "production") return null;
  const lower = raw.toLowerCase();
  return BY_KEY.get(ALIASES[lower] ?? lower) ?? null;
}
