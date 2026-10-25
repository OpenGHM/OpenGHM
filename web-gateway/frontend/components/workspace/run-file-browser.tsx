"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, FolderOpen, Home, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectionBar } from "@/components/repository/selection-bar";
import { TreeBrowserTable } from "@/components/repository/tree-browser-table";
import { useTreeSelection } from "@/components/repository/use-tree-selection";
import { limitLabel, ZIP_LIMIT_BYTES } from "@/lib/repository/selection";
import { folderCrumbs, runListingRoute } from "@/lib/repository/tree-browse";
import type { ListedFile, RunListing, TreeFolder } from "@/lib/repository/types";

interface Listing {
  folders: TreeFolder[];
  files: ListedFile[];
  nextCursor: string | null;
}

/** What went wrong with a listing, in the backend's words when it gave any. */
interface Failure {
  message: string;
  /** Worth asking again: Anvil did not answer, or the gateway could not reach its backend. */
  retryable: boolean;
}

const UNAVAILABLE: Failure = {
  message: "The files could not be listed right now. Try again in a few minutes.",
  retryable: true,
};

/** The message of a refusal: `{ detail: { message } }` from the backend, `{ message }` from the gateway's own routes. */
async function failureOf(response: Response): Promise<Failure> {
  try {
    const body = (await response.json()) as { detail?: { message?: unknown }; message?: unknown };
    const message = body.detail?.message ?? body.message;
    if (typeof message === "string" && message !== "") {
      return { message, retryable: response.status >= 500 };
    }
  } catch {
    // not JSON: the generic message below
  }
  return response.status === 404
    ? { message: "This simulation has no output to show.", retryable: false }
    : UNAVAILABLE;
}

/**
 * The listing of `folder` of a run's output on Anvil scratch (ADR 0040), fetched the first
 * time it is shown and kept with all the pages loaded so far: a stopped run's output does not
 * change, so stepping back shows a folder at once. `requested` stops a folder being asked for
 * twice (a Strict Mode double effect, a listing still on its way).
 */
function useRunListing(jobId: string, folder: string) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  const [more, setMore] = useState<{ folder: string; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (requested.current.has(folder)) return;
    requested.current.add(folder);
    const fail = (failure: Failure) => {
      requested.current.delete(folder);
      setFailures((prev) => ({ ...prev, [folder]: failure }));
    };
    fetch(runListingRoute(jobId, folder)).then(async (response) => {
      if (!response.ok) return fail(await failureOf(response));
      try {
        const { folders, files, nextCursor } = (await response.json()) as RunListing;
        setListings((prev) => ({ ...prev, [folder]: { folders, files, nextCursor } }));
      } catch {
        fail(UNAVAILABLE);
      }
    }, () => fail(UNAVAILABLE));
    // `attempt` only runs this again after Retry has cleared `requested`.
  }, [jobId, folder, attempt]);

  const retry = () => {
    requested.current.delete(folder);
    setFailures((prev) => {
      const rest = { ...prev };
      delete rest[folder];
      return rest;
    });
    setAttempt((a) => a + 1);
  };

  const current = listings[folder];
  const loadingMore = more?.folder === folder && !more.failed;
  const loadMore = async () => {
    if (!current || current.nextCursor === null || loadingMore) return;
    setMore({ folder, failed: false });
    try {
      const response = await fetch(runListingRoute(jobId, folder, current.nextCursor));
      if (!response.ok) throw new Error("not ok");
      const page = (await response.json()) as RunListing;
      setListings((prev) => {
        const had = prev[folder];
        if (!had) return prev;
        return {
          ...prev,
          [folder]: {
            folders: [...had.folders, ...page.folders],
            files: [...had.files, ...page.files],
            nextCursor: page.nextCursor,
          },
        };
      });
      setMore(null);
    } catch {
      setMore({ folder, failed: true });
    }
  };

  return {
    listing: current ?? null,
    failure: current ? null : (failures[folder] ?? null),
    retry,
    loadMore,
    loadingMore,
    moreFailed: more?.folder === folder && more.failed,
  };
}

/**
 * A stopped run's output on Anvil scratch, a folder at a time, with a checkbox on every row and
 * **Download ZIP** for what is ticked (ADR 0040). The pieces are the published files page's
 * (`TreeBrowserTable`, `SelectionBar`, `useTreeSelection`), told the source is `"run"`: the
 * folder is kept in state and not in the URL, a ticked folder's size is asked of the gateway,
 * and a selection over the limit is marked before anyone clicks. The backend decides who may
 * read the run and says, in its own words, when it is still running, purged or has no output.
 */
export function RunFileBrowser({ jobId }: { jobId: string }) {
  const [folder, setFolder] = useState("");
  const { listing, failure, retry, loadMore, loadingMore, moreFailed } = useRunListing(jobId, folder);
  const selection = useTreeSelection("run", jobId, folder);
  const empty = listing !== null && listing.folders.length === 0 && listing.files.length === 0;

  return (
    <div className="w-full basis-full overflow-clip rounded-xl border border-border/70 bg-card">
      <div className="space-y-2 border-b border-border/70 px-4 py-3">
        <p className="text-[13px] text-muted-foreground">
          Tick files and folders, then download them as one ZIP of up to {limitLabel(ZIP_LIMIT_BYTES)}.
        </p>
        <nav aria-label="Folders of this simulation's output">
          <ol className="flex flex-wrap items-center gap-1 font-mono text-[13px]">
            <Crumb current={folder === ""} onOpen={() => setFolder("")}>
              <Home className="size-3.5" aria-hidden="true" />
              Output
            </Crumb>
            {folderCrumbs(folder).map((c) => (
              <Crumb key={c.path} current={c.path === folder} onOpen={() => setFolder(c.path)} separator>
                {c.name}
              </Crumb>
            ))}
          </ol>
        </nav>
      </div>

      {listing === null && failure === null && (
        <div className="space-y-3 px-4 py-5" role="status" aria-label="Loading folder">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" style={{ maxWidth: `${60 - i * 12}%` }} />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      )}

      {failure && (
        <div role="alert" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <AlertCircle className="size-7 text-warning" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{failure.message}</p>
          {failure.retryable ? (
            <Button variant="outline" size="sm" onClick={retry}>
              <RotateCw className="size-4" />
              Retry
            </Button>
          ) : (
            folder !== "" && (
              <Button variant="outline" size="sm" onClick={() => setFolder("")}>
                Back to the output
              </Button>
            )
          )}
        </div>
      )}

      {listing !== null && (
        <>
          {empty ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <FolderOpen className="size-4" aria-hidden="true" />
              This folder is empty.
            </p>
          ) : (
            <>
              <SelectionBar
                kind="run"
                id={jobId}
                folder={folder}
                files={listing.files}
                selection={selection}
                className="border-b border-border/70"
              />
              <div className="max-h-96 overflow-auto">
                <TreeBrowserTable
                  pathname=""
                  folder={folder}
                  folders={listing.folders}
                  files={listing.files}
                  onOpenFolder={setFolder}
                  selection={selection}
                />
              </div>
            </>
          )}
          {listing.nextCursor !== null && (
            <div className="flex flex-col items-center gap-2 border-t py-3">
              {moreFailed && (
                <p role="alert" className="text-xs text-destructive">
                  The next entries could not be loaded.
                </p>
              )}
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : moreFailed ? (
                  <RotateCw className="size-4" />
                ) : null}
                {moreFailed ? "Try again" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Crumb({
  current,
  onOpen,
  separator = false,
  children,
}: {
  current: boolean;
  onOpen: () => void;
  separator?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1">
      {separator && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />}
      {current ? (
        <span aria-current="page" className="inline-flex items-center gap-1 font-medium text-foreground">
          {children}
        </span>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 rounded text-primary outline-none hover:text-primary-hover hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {children}
        </button>
      )}
    </li>
  );
}

/**
 * The run's files on its page: a button that opens the browser, which asks Anvil for nothing
 * until it is opened. Two siblings for the parent's flex row, the toggle in the row and the
 * open browser on a line of its own under it.
 */
export function RunFiles({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={regionId}
        className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-muted px-3.5 text-[13.5px] font-semibold text-foreground outline-none transition-colors hover:bg-secondary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-9"
      >
        {open ? (
          <ChevronDown className="size-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4" aria-hidden="true" />
        )}
        {open ? "Hide files" : "Browse and download files"}
      </button>
      <div id={regionId} hidden={!open} className="w-full basis-full">
        {open && <RunFileBrowser jobId={jobId} />}
      </div>
    </>
  );
}
