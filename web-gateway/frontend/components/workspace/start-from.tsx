"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { CopySimulationList, type CopyListPage } from "@/components/workspace/copy-simulation-list";
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
 *  was opened in the other mode. */
export interface PickerSeed {
  filters: FilterState;
  data: RepositoryListResponse;
  modelInputIds: Set<string> | null;
}

/**
 * Step 1 of the draft wizard (ADR 0028): where a new simulation starts from.
 * One choice, made on one screen: a switch between "Model snapshot" (a grid of
 * the repository's snapshots, the ones the user has used first and marked)
 * and "Copy a simulation" (a plain list of their own). Choosing a snapshot
 * creates the draft at once, and so does a row of the list; both open the new
 * draft's Run settings. With nothing to copy there is nothing to switch
 * between, so the switch is not shown.
 *
 * The mode is in the URL as `?from=copy` (the default, snapshot, is not
 * written), changed with `history.pushState`, so back and forward walk through
 * them. The picker keeps its own filters in the URL, so it is mounted only in
 * its own mode: the two never write the same query string.
 */
export function StartFrom({
  initialMode,
  usedIds,
  snapshotNames,
  copyInitial,
  picker,
}: {
  initialMode: StartMode;
  /** The snapshots the caller has based a simulation on. */
  usedIds: readonly string[];
  /** Short name by snapshot id (`snapshotName`), for the copy list. */
  snapshotNames: Readonly<Record<string, string>>;
  /** The first page of the caller's simulations; null when it could not be read. */
  copyInitial: CopyListPage | null;
  picker: PickerSeed;
}) {
  const searchParams = useSearchParams();
  const { pending, error, deriveFrom, duplicateFrom } = useCreateDraft();
  const used = useMemo(() => new Set(usedIds), [usedIds]);
  // What was last tried, so an error shows only in the mode it belongs to.
  const [attempt, setAttempt] = useState<{ mode: StartMode; id: string } | null>(null);

  // Nothing to copy: the mode is off, whatever the URL says.
  const canCopy = copyInitial === null || copyInitial.items.length > 0;
  const [mode, setModeState] = useState<StartMode>(initialMode);
  const urlMode = parseFrom(searchParams.get("from"));
  const [seenUrlMode, setSeenUrlMode] = useState(urlMode);
  if (urlMode !== seenUrlMode) {
    setSeenUrlMode(urlMode);
    setModeState(urlMode);
  }
  // Back/forward is also heard directly, so the mode does not wait for Next.
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

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-foreground">
            {active === "snapshot" ? "Choose a model snapshot" : "Choose a simulation to copy"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {active === "snapshot"
              ? "Your simulation starts from it. You can change its settings next."
              : "The new draft starts with its settings. You can change them next."}
          </p>
        </div>
        {canCopy && (
          <nav aria-label="Where to start from" className="shrink-0">
            <ul className="flex h-11 gap-0.5 rounded-xl bg-muted p-0.5">
              <li>
                <ModeLink
                  href={modeHref("snapshot")}
                  selected={active === "snapshot"}
                  onSelect={() => select("snapshot")}
                >
                  Model snapshot
                </ModeLink>
              </li>
              <li>
                <ModeLink href={modeHref("copy")} selected={active === "copy"} onSelect={() => select("copy")}>
                  Copy a simulation
                </ModeLink>
              </li>
            </ul>
          </nav>
        )}
      </header>

      {active === "snapshot" && (
        <PickerHost
          seed={picker}
          usedIds={used}
          onSelect={startFromSnapshot}
          pendingId={pendingId}
          disabled={pending}
        />
      )}

      {active === "copy" && (
        <CopySimulationList
          initial={copyInitial}
          snapshotNames={snapshotNames}
          onCopy={startFromCopy}
          pendingId={pendingId}
          disabled={pending}
          rowError={rowError}
        />
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
function PickerHost({
  seed,
  usedIds,
  onSelect,
  pendingId,
  disabled,
}: {
  seed: PickerSeed;
  usedIds: ReadonlySet<string>;
  onSelect: (dataset: Dataset) => void;
  pendingId: string | null;
  disabled: boolean;
}) {
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
      initialFilters={filters}
      initialData={data}
      initialModelInputIds={seed.modelInputIds}
      usedIds={usedIds}
      onSelect={onSelect}
      pendingId={pendingId}
      disabled={disabled}
    />
  );
}

/**
 * One side of the switch: a link to the mode's own URL, so a middle click or a
 * copied address works, and a plain click is handed to `onSelect`. The chosen
 * one is raised on the track and is `aria-current`.
 */
function ModeLink({
  children,
  selected,
  href,
  onSelect,
}: {
  children: string;
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
        // A plain click changes mode in place; the rest is the browser's.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "inline-flex h-10 items-center rounded-[10px] px-4 text-[13px] font-medium whitespace-nowrap text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none",
        selected ? "bg-card shadow-sm" : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
