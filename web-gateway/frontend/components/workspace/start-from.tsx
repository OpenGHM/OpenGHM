"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { CopySimulationList, type CopyListPage } from "@/components/workspace/copy-simulation-list";
import { RecentSnapshots } from "@/components/workspace/recent-snapshots";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { SnapshotPicker } from "@/components/workspace/snapshot-picker";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";
import { fetchDatasets } from "@/lib/repository/actions";
import { datasetFiltersToParams, parseDatasetFilters } from "@/lib/repository/url-filters";
import type { Dataset, FilterState, RepositoryListResponse } from "@/lib/repository/types";
import type { Job } from "@/lib/jobs/types";
import { modeHref, parseFrom, type StartMode } from "@/lib/workspace/start-mode";
import { cn } from "@/lib/utils";

const EMPTY_RESULT: RepositoryListResponse = { items: [], totalCount: 0, totalPages: 1, page: 1 };

/** What the server read for the picker, which is the default one when the page
 *  was opened on another card. */
export interface PickerSeed {
  filters: FilterState;
  data: RepositoryListResponse;
  modelInputIds: Set<string> | null;
}

/**
 * Step 1 of the draft wizard (ADR 0028): where a new simulation starts from.
 * Two choices. "Model snapshot" shows the snapshots the user has used and the
 * repository's own search; choosing one creates the draft at once, and so does
 * Copy on a row of "Copy one of my simulations"; both open the new draft's
 * Run settings. With nothing to copy there is nothing to choose between, so the
 * choice is not shown.
 *
 * The card is in the URL as `?from=copy` (the default, snapshot, is not
 * written), changed with `history.pushState`, so back and forward walk through
 * them. The picker keeps its own filters in the URL, so it is mounted only on
 * its own card: the two never write the same query string.
 */
export function StartFrom({
  initialMode,
  recentSnapshots,
  copyInitial,
  picker,
}: {
  initialMode: StartMode;
  recentSnapshots: Dataset[];
  /** The first page of the caller's simulations; null when it could not be read. */
  copyInitial: CopyListPage | null;
  picker: PickerSeed;
}) {
  const searchParams = useSearchParams();
  const { pending, error, deriveFrom, duplicateFrom } = useCreateDraft();
  // What was last tried, so an error shows only on the card it belongs to.
  const [attempt, setAttempt] = useState<{ mode: StartMode; id: string } | null>(null);

  // Nothing to copy: the card is off, whatever the URL says.
  const canCopy = copyInitial === null || copyInitial.items.length > 0;
  const [mode, setModeState] = useState<StartMode>(initialMode);
  const urlMode = parseFrom(searchParams.get("from"));
  const [seenUrlMode, setSeenUrlMode] = useState(urlMode);
  if (urlMode !== seenUrlMode) {
    setSeenUrlMode(urlMode);
    setModeState(urlMode);
  }
  // Back/forward is also heard directly, so the card does not wait for Next.
  useEffect(() => {
    const onPopState = () =>
      setModeState(parseFrom(new URLSearchParams(window.location.search).get("from")));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const active: StartMode = mode === "copy" && !canCopy ? "snapshot" : mode;

  const select = (next: StartMode) => {
    const url = modeHref(next);
    // A native pushState adds an entry even for the URL we are on.
    if (url !== window.location.pathname + window.location.search) {
      window.history.pushState(null, "", url);
    }
    setModeState(next);
  };

  const startFromSnapshot = (dataset: Dataset) => {
    if (pending) return;
    setAttempt({ mode: "snapshot", id: dataset.id });
    void deriveFrom(dataset.id);
  };
  const startFromCopy = (job: Job) => {
    if (pending) return;
    setAttempt({ mode: "copy", id: job.id });
    void duplicateFrom(job.id);
  };

  // A snapshot that is gone is told on the row it came from; the rest is up here.
  const rowError =
    error?.kind === "error" && error.code === "snapshot_not_found" && attempt?.mode === "copy"
      ? { jobId: attempt.id, message: error.message }
      : null;
  const shownError = attempt?.mode === active && !rowError ? error : null;
  const pendingId = pending && attempt?.mode === active ? attempt.id : null;

  return (
    <div className="space-y-6">
      {shownError?.kind === "session-expired" && <SessionExpiredBanner />}
      {shownError?.kind === "error" && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="font-medium">{shownError.message}</p>
        </div>
      )}

      {canCopy && (
        <nav aria-label="Where to start from">
          <ul className="grid gap-3 sm:grid-cols-2">
            <li>
              <OptionCard
                title="Model snapshot"
                selected={active === "snapshot"}
                onSelect={() => select("snapshot")}
                href={modeHref("snapshot")}
              >
                Pick a published model snapshot and adjust its settings.
              </OptionCard>
            </li>
            <li>
              <OptionCard
                title="Copy one of my simulations"
                selected={active === "copy"}
                onSelect={() => select("copy")}
                href={modeHref("copy")}
              >
                Start with the settings of a simulation you already made.
              </OptionCard>
            </li>
          </ul>
        </nav>
      )}

      {active === "snapshot" && (
        <div className="space-y-6">
          {pending && attempt?.mode === "snapshot" && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              Creating your draft…
            </p>
          )}
          {recentSnapshots.length > 0 && (
            <section aria-labelledby="start-recent-heading">
              <h2 id="start-recent-heading" className="mb-3 text-base font-semibold text-foreground">
                Model snapshots you&apos;ve used
              </h2>
              <RecentSnapshots
                snapshots={recentSnapshots}
                onSelect={startFromSnapshot}
                pendingId={pendingId}
                disabled={pending}
              />
            </section>
          )}
          <section
            aria-labelledby="start-browse-heading"
            aria-busy={pending ? "true" : undefined}
            className={cn(pending && "pointer-events-none opacity-60")}
          >
            <h2 id="start-browse-heading" className="mb-3 text-base font-semibold text-foreground">
              Browse model snapshots
            </h2>
            <PickerHost seed={picker} onSelect={startFromSnapshot} />
          </section>
        </div>
      )}

      {active === "copy" && (
        <section aria-labelledby="start-copy-heading">
          <h2 id="start-copy-heading" className="mb-3 text-base font-semibold text-foreground">
            Your simulations
          </h2>
          <CopySimulationList
            initial={copyInitial}
            onCopy={startFromCopy}
            pendingId={pendingId}
            disabled={pending}
            rowError={rowError}
          />
        </section>
      )}
    </div>
  );
}

/**
 * The picker, seeded with what the server read when the URL's filters are the
 * ones it read for, and with a fetch of its own otherwise (the card was opened
 * after the page loaded, or by back/forward, onto other filters). The filters
 * are taken once, when the card opens: from then on the picker owns them.
 */
function PickerHost({ seed, onSelect }: { seed: PickerSeed; onSelect: (dataset: Dataset) => void }) {
  const searchParams = useSearchParams();
  const [filters] = useState(() => parseDatasetFilters(searchParams));
  const matches =
    datasetFiltersToParams(filters).toString() === datasetFiltersToParams(seed.filters).toString();
  const [data, setData] = useState<RepositoryListResponse | null>(matches ? seed.data : null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetchDatasets(filters)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      // As on the server: an empty table, and the picker's own controls to retry.
      .catch(() => {
        if (!cancelled) setData(EMPTY_RESULT);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading model snapshots…
      </p>
    );
  }
  return (
    <SnapshotPicker
      embedded
      initialFilters={filters}
      initialData={data}
      initialModelInputIds={seed.modelInputIds}
      onSelect={onSelect}
    />
  );
}

/**
 * One of the two choices: a link to the card's own URL, so a middle click or a
 * copied address works, and a plain click is handed to `onSelect`. The chosen
 * one has a border in the primary colour and a check, and is `aria-current`.
 */
function OptionCard({
  title,
  children,
  selected,
  href,
  onSelect,
}: {
  title: string;
  children: ReactNode;
  selected: boolean;
  href: string;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={selected ? "true" : undefined}
      onClick={(event) => {
        // A plain click changes card in place; the rest is the browser's.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "block h-full min-h-10 rounded-xl border bg-card px-4 py-3 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/40"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
      </span>
      <span className="mt-0.5 block text-sm text-muted-foreground">{children}</span>
    </Link>
  );
}
