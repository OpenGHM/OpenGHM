import Link from "next/link";
import { FlaskConical } from "lucide-react";
import type { JobStatus } from "@/lib/jobs/types";
import { ALL_STATUSES } from "@/lib/workspace/preview";

/**
 * Dev-only. Real jobs in this database only ever reach DRAFT or FAILED —
 * nothing runs real WBM yet — so this is how every other `JobStatus`
 * renders on this page at all: `?preview=<STATUS>` swaps in
 * `fakeSimulation(status)` (see lib/workspace/preview.ts). Never rendered in
 * production, and unmistakably not real data when it is.
 */
export function DevPreviewSwitcher({
  jobId,
  active,
}: {
  jobId: string;
  active: JobStatus | null;
}) {
  return (
    <div className="border-b border-dashed border-violet-300 bg-violet-50">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-10 py-2 text-xs">
        <span className="flex items-center gap-1 font-medium text-violet-700">
          <FlaskConical className="size-3.5" />
          Dev preview:
        </span>
        {ALL_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/workspace/${jobId}?preview=${s}`}
            className={`rounded-full border px-2 py-0.5 transition-colors ${
              active === s
                ? "border-violet-500 bg-violet-500 text-white"
                : "border-violet-200 bg-white text-violet-700 hover:bg-violet-100"
            }`}
          >
            {s}
          </Link>
        ))}
        {active && (
          <Link
            href={`/workspace/${jobId}`}
            className="ml-auto text-violet-600 underline-offset-2 hover:underline"
          >
            Exit preview
          </Link>
        )}
      </div>
    </div>
  );
}
