"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertOctagon, CheckCircle2, ExternalLink, Loader2, RefreshCw, UploadCloud, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeStamp } from "@/components/common/time-stamp";
import { ActionError } from "@/components/workspace/action-error";
import { CopyButton } from "@/components/workspace/copy-button";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { PublishSheet } from "@/components/workspace/publish-sheet";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { publishDraft } from "@/lib/jobs/actions";
import { HUE } from "@/lib/jobs/status-hue";
import type { Job, PartialAbout, PublishAbout, PublishRecord, PublishRetry } from "@/lib/jobs/types";
import { PUBLISH_RETRY_COPY, publishFailureCopyFor } from "@/lib/workspace/failure-copy";
import {
  aboutFromRecord,
  canPublish,
  formFromAbout,
  isValid,
  validatePublishForm,
} from "@/lib/workspace/publish";

/** What `retry` of a failure means here: a value this page has no wording for
 *  is treated as the most careful one. */
function retryOf(retry: string | undefined): PublishRetry {
  return retry === "same" || retry === "edit" ? retry : "none";
}

/**
 * Says "Publishing" or "Published as a snapshot" to a screen reader when the
 * publish changes state, and nothing when the page first renders.
 */
function PublishAnnouncer({ state }: { state: string }) {
  const [seen, setSeen] = useState(state);
  const [message, setMessage] = useState("");
  // Compared while rendering, not in an effect, so the first render says nothing.
  if (state !== seen) {
    setSeen(state);
    setMessage(
      state === "publishing"
        ? "Publishing started"
        : state === "published"
          ? "Published as a snapshot"
          : state === "failed"
            ? "Publishing failed"
            : ""
    );
  }
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}

/**
 * Publishing a snapshot draft as a snapshot (ADR 0031), under the status card
 * of a completed one. The card has four faces, by the draft's `publish` record:
 * - none, and the draft is publishable: the explanation and **Publish as
 *   snapshot**, which opens the form (`PublishSheet`);
 * - `publishing`: the publish job is on Anvil. The page follows it (the live
 *   hook keeps polling after the run has ended) and says which SLURM job it is;
 * - `published`: the snapshot's id, to copy, and the way to its page;
 * - `failed`: the failure's sentence, and the action its `retry` allows:
 *   `same` is **Try again** (the same `about`), `edit` reopens the form, and
 *   `none` says an administrator has to look.
 *
 * It shows nothing for a draft that cannot be published and has no publish:
 * one that has not completed, failed, or whose files Anvil's purge removed.
 * Render it inside a `LiveJobProvider`.
 */
export function PublishCard({ job, preview = false }: { job: Job; preview?: boolean }) {
  const { jobId, status, view, applyPublish, refresh, gone, lastError, retryInSeconds } = useLiveJobContext();
  // The sheet is open for the attempt it was opened at: a publish record that
  // moves on under it (a submit that failed after claiming the draft, another
  // tab) closes it, because the backend would no longer compose from what it holds.
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const publish = view.publish;
  const open = openAt !== null && openAt === (publish?.attempts ?? 0);
  const setOpen = (next: boolean) => setOpenAt(next ? (publish?.attempts ?? 0) : null);
  const failure = view.failure ?? job.failure;
  const files = view.files ?? job.files;
  const offered = canPublish({ status, failure, files, publish });
  if (status !== "COMPLETED" || gone || (!offered && !publish)) return null;

  // What the form starts from: the words a failed publish was composed from, else the draft's own.
  const stored: PartialAbout | null = aboutFromRecord(publish) ?? job.about;

  const taken = (next: PublishRecord) => {
    setProblem(null);
    setExpired(false);
    applyPublish(next);
  };

  /** "Try again": the same `about` as the attempt that failed. A record that
   *  holds none that passes the form's own checks opens the form instead. */
  const tryAgain = async () => {
    if (retrying) return;
    setProblem(null);
    setExpired(false);
    if (!isValid(validatePublishForm(formFromAbout(stored)))) {
      setOpen(true);
      return;
    }
    if (preview) {
      setProblem("Preview data — there is no real snapshot draft to publish.");
      return;
    }
    setRetrying(true);
    try {
      const result = await publishDraft(jobId, stored as unknown as PublishAbout);
      if (result.ok) taken(result.data.publish);
      else if (result.reason === "session_expired") setExpired(true);
      else if (result.reason === "not_found") setProblem("This snapshot draft no longer exists.");
      else {
        setProblem(result.message || "Could not start the publish.");
        // A 409 means the page is out of date; a 422, that the words need editing.
        if (result.status === 409) refresh();
        if (result.status === 422) setOpen(true);
      }
    } catch {
      setProblem("Could not start the publish. Nothing was changed; try again.");
    } finally {
      setRetrying(false);
    }
  };

  const state = publish?.state ?? "none";
  const failed = state === "failed" ? publish?.failure : null;
  const retry = retryOf(failed?.retry);
  const copy = publishFailureCopyFor(failed);
  const hue = HUE[state === "publishing" ? "RUNNING" : state === "failed" ? "FAILED" : "COMPLETED"];

  const title =
    state === "publishing"
      ? "Publishing"
      : state === "published"
        ? "Published as a snapshot"
        : state === "failed"
          ? copy.title
          : "Publish as snapshot";
  const Icon =
    state === "publishing" ? Loader2 : state === "published" ? CheckCircle2 : state === "failed" ? AlertOctagon : UploadCloud;

  const openForm = (
    <Button
      ref={opener}
      type="button"
      className="min-h-10 shrink-0 gap-2 font-semibold"
      onClick={() => {
        setProblem(null);
        setOpen(true);
      }}
    >
      <UploadCloud aria-hidden="true" />
      Publish as snapshot
    </Button>
  );

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="publish-heading"
      className={`rounded-xl border border-l-4 bg-card p-5 shadow-sm outline-none sm:p-6 ${hue.border}`}
    >
      <PublishAnnouncer state={state} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="publish-heading" className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
            <Icon
              className={`size-5 shrink-0 ${hue.icon} ${state === "publishing" ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">{title}</span>
          </h2>

          {state === "none" && (
            <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
              Add this snapshot draft&apos;s results to the Data Repository as a snapshot. It will be
              public, and it cannot be changed after it is published.
            </p>
          )}

          {state === "publishing" && publish && (
            <div className="mt-1.5 space-y-1 text-sm text-muted-foreground">
              <p>
                {publish.slurm_job_id ? (
                  <>
                    Uploading the results from Anvil in SLURM job{" "}
                    <span className="font-mono text-xs text-foreground">#{publish.slurm_job_id}</span>. This
                    takes a few minutes, and keeps going if you leave this page.
                  </>
                ) : (
                  "Submitting the publish job to Anvil…"
                )}
              </p>
              <p className="text-xs">
                {publish.attempts > 1 && <>Attempt {publish.attempts} · </>}
                {publish.submitted_at && (
                  <>
                    Started <TimeStamp value={publish.submitted_at} format="relative" />
                  </>
                )}
              </p>
            </div>
          )}

          {state === "published" && publish && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              It is public in the Data Repository, and it cannot be changed.
              {publish.finished_at && (
                <>
                  {" "}
                  Published <TimeStamp value={publish.finished_at} format="relative" />.
                </>
              )}
            </p>
          )}

          {failed && (
            <div className="mt-1.5 space-y-1 text-sm">
              <p className="break-words text-muted-foreground">{failed.message || copy.body}</p>
              <p className="text-foreground">{PUBLISH_RETRY_COPY[retry]}</p>
            </div>
          )}
        </div>

        {state === "none" && openForm}

        {state === "failed" && retry === "same" && (
          <Button
            type="button"
            variant="outline"
            disabled={retrying}
            onClick={() => void tryAgain()}
            className="min-h-10 shrink-0 gap-2 font-semibold"
          >
            {retrying ? (
              <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {retrying ? "Starting…" : "Try again"}
          </Button>
        )}
        {state === "failed" && retry === "edit" && (
          <Button
            ref={opener}
            type="button"
            variant="outline"
            onClick={() => {
              setProblem(null);
              setOpen(true);
            }}
            className="min-h-10 shrink-0 gap-2 font-semibold"
          >
            <UploadCloud aria-hidden="true" />
            Edit and publish again
          </Button>
        )}
      </div>

      {state === "published" && publish && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Snapshot id</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
                {publish.snapshot_id}
              </code>
              <CopyButton text={publish.snapshot_id} label="snapshot id" />
            </div>
          </div>
          <Button asChild variant="outline" className="min-h-10 gap-2">
            <Link href={`/repository/${publish.snapshot_id}`}>
              <ExternalLink aria-hidden="true" />
              Open in the Data Repository
            </Link>
          </Button>
        </div>
      )}

      {state === "publishing" && publish && (
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          <span className="font-sans">Snapshot id </span>
          {publish.snapshot_id}
        </p>
      )}

      {failed && retry === "none" && publish && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Tell them this snapshot draft&apos;s id:</span>
          <code className="min-w-0 break-all font-mono text-xs text-foreground">{jobId}</code>
          <CopyButton text={jobId} label="snapshot draft id" />
        </div>
      )}

      {state === "publishing" && lastError !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <WifiOff className="size-3.5 shrink-0 text-status-cancelling" aria-hidden="true" />
          <span>
            {lastError} — retrying in {retryInSeconds ?? 0} s
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            className="min-h-10 px-3 text-xs sm:min-h-8"
          >
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            Retry now
          </Button>
        </div>
      )}

      {expired && <SessionExpiredBanner className="mt-4" />}
      {problem && (
        <div className="mt-4">
          <ActionError>{problem}</ActionError>
        </div>
      )}

      <PublishSheet
        open={open}
        onOpenChange={setOpen}
        jobId={jobId}
        about={stored}
        preview={preview}
        onPublished={taken}
        onRefused={refresh}
        // Back to the button that opened it; once publishing has started the
        // button is gone, and focus goes to the card.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (opener.current ?? sectionRef.current)?.focus();
        }}
      />
    </section>
  );
}
