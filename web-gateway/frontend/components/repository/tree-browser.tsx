"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertCircle, ChevronRight, FolderOpen, Home, Loader2, RotateCw } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TreeBrowserTable } from "@/components/repository/tree-browser-table";
import { TreePreviewSheet, type PreviewView } from "@/components/repository/tree-preview-sheet";
import { pushOnPlainClick } from "@/components/workspace/my-data-kind-tabs";
import { fetchTreeListing, fetchTreePreview } from "@/lib/repository/actions";
import {
  folderCrumbs,
  normalizeFolder,
  parentFolder,
  treeBaseUrl,
  treeHref,
} from "@/lib/repository/tree-browse";
import type {
  TreeErrorCode,
  TreeFile,
  TreeFolder,
  TreeKind,
  TreePreview,
  TreeResult,
} from "@/lib/repository/types";

interface Listing {
  folders: TreeFolder[];
  files: TreeFile[];
  nextCursor: string | null;
}

/**
 * Walks a published tree, folder by folder (`/repository/[id]/files` and its
 * model-input twin). The URL is the state: `?path=` is the folder and `?file=`
 * the open file, so a reload, back and forward and a pasted link all land
 * where they were. A click on a folder or a file only pushes the URL
 * (`history.pushState`, which Next's router follows), and the listing comes
 * from a server action, so no server page renders again for a step.
 *
 * Each folder's pages are kept as they were loaded, so going back to a folder
 * is instant. A published tree does not change (rule 1), so nothing goes stale.
 * The bucket has no CORS headers: the browser never reads S3 itself, it only
 * follows a file's public URL as a link.
 */
export function TreeBrowser({
  kind,
  id,
  name,
}: {
  kind: TreeKind;
  id: string;
  /** The artifact's name, for the accessible names. */
  name: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const file = searchParams.get("file") || null;
  // A link with only `?file=` lists the file's own folder.
  const folder = searchParams.has("path")
    ? normalizeFolder(searchParams.get("path"))
    : file
      ? parentFolder(file)
      : "";
  const rootHref = treeHref(pathname, "");

  const listings = useFolderListing(kind, id, folder);
  const { view } = listings;
  const loadedFiles = view.status === "ready" ? view.listing.files : [];
  const open = file ? loadedFiles.find((f) => f.path === file) : undefined;
  // The file is not in what is loaded when it is on a later page of the folder:
  // the tree's root, and so its URL, is read off a file that is.
  const base = treeBaseUrl(loadedFiles);
  const url = open?.url ?? (file && base ? `${base}${file}` : null);
  // A file the listing does not hold is asked of the backend, which says
  // `binary` for what it will not show.
  const preview = useFilePreview(kind, id, file, open ? open.previewable : true);

  const close = () => {
    const href = treeHref(pathname, folder);
    window.history.pushState(null, "", href);
  };

  return (
    <>
      <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-cyan-500/5 to-transparent !py-3 !gap-0 grid-rows-1 items-center">
          <nav aria-label={`Folders of ${name}`}>
            <ol className="flex flex-wrap items-center gap-1 text-sm">
              <Crumb
                href={rootHref}
                current={folder === ""}
                label={
                  <>
                    <Home className="size-3.5" aria-hidden="true" />
                    Root
                  </>
                }
              />
              {folderCrumbs(folder).map((c) => (
                <Crumb
                  key={c.path}
                  href={treeHref(pathname, c.path)}
                  current={c.path === folder}
                  label={c.name}
                  separator
                />
              ))}
            </ol>
          </nav>
        </CardHeader>
        <CardContent className="px-0 py-0">
          {view.status === "loading" && <ListingSkeleton />}
          {view.status === "error" && (
            <ListingError code={view.code} rootHref={rootHref} onRetry={listings.retry} />
          )}
          {view.status === "ready" && (
            <>
              {view.listing.folders.length === 0 && view.listing.files.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <FolderOpen className="size-4" aria-hidden="true" />
                  This folder is empty.
                </p>
              ) : (
                <TreeBrowserTable
                  pathname={pathname}
                  folder={folder}
                  folders={view.listing.folders}
                  files={view.listing.files}
                />
              )}
              {view.listing.nextCursor !== null && (
                <div className="flex flex-col items-center gap-2 border-t py-4">
                  {listings.moreFailed && (
                    <p role="alert" className="text-xs text-destructive">
                      The next entries could not be loaded.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={listings.loadMore}
                    disabled={listings.loadingMore}
                  >
                    {listings.loadingMore ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : listings.moreFailed ? (
                      <RotateCw className="size-4" />
                    ) : null}
                    {listings.moreFailed ? "Try again" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <TreePreviewSheet
        file={file}
        url={url}
        view={preview.view}
        rootHref={rootHref}
        onClose={close}
        onRetry={preview.retry}
      />
    </>
  );
}

function Crumb({
  href,
  current,
  label,
  separator = false,
}: {
  href: string;
  current: boolean;
  label: React.ReactNode;
  separator?: boolean;
}) {
  return (
    <li className="flex items-center gap-1">
      {separator && <ChevronRight className="size-3.5 text-slate-400" aria-hidden="true" />}
      {current ? (
        <span aria-current="page" className="inline-flex items-center gap-1 font-medium text-foreground">
          {label}
        </span>
      ) : (
        <a
          href={href}
          onClick={pushOnPlainClick(href)}
          className="inline-flex items-center gap-1 text-[#006994] hover:underline"
        >
          {label}
        </a>
      )}
    </li>
  );
}

function ListingSkeleton() {
  return (
    <div className="space-y-3 px-6 py-5" role="status" aria-label="Loading folder">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 flex-1" style={{ maxWidth: `${60 - i * 7}%` }} />
          <Skeleton className="ml-auto h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

function ListingError({
  code,
  rootHref,
  onRetry,
}: {
  code: TreeErrorCode;
  rootHref: string;
  onRetry: () => void;
}) {
  const retryable = code === "listing_unavailable";
  const message = retryable
    ? "The file listing is unavailable right now. The storage service did not answer."
    : code === "invalid_path"
      ? "That is not a valid folder path."
      : code === "not_found"
        ? "This tree is not in the catalogue."
        : "This folder is not in the tree.";
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <AlertCircle className="size-8 text-amber-500" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {retryable ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="size-4" />
          Retry
        </Button>
      ) : (
        <a
          href={rootHref}
          onClick={pushOnPlainClick(rootHref)}
          className="text-sm text-[#006994] hover:underline"
        >
          Back to the root of the tree
        </a>
      )}
    </div>
  );
}

type ListingView =
  | { status: "loading" }
  | { status: "ready"; listing: Listing }
  | { status: "error"; code: TreeErrorCode };

/**
 * The listing of `folder`, fetched the first time it is shown and kept: every
 * folder visited stays in `listings` with all the pages loaded so far, so
 * stepping back shows it at once. `requested` stops a folder being asked for
 * twice (a Strict Mode double effect, a listing that is still on its way).
 */
function useFolderListing(kind: TreeKind, id: string, folder: string) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [failures, setFailures] = useState<Record<string, TreeErrorCode>>({});
  const [more, setMore] = useState<{ folder: string; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (requested.current.has(folder)) return;
    requested.current.add(folder);
    fetchTreeListing(kind, id, folder).then(
      (result) => {
        if (result.ok) {
          const { folders, files, nextCursor } = result.data;
          setListings((prev) => ({ ...prev, [folder]: { folders, files, nextCursor } }));
        } else {
          requested.current.delete(folder);
          setFailures((prev) => ({ ...prev, [folder]: result.code }));
        }
      },
      () => {
        requested.current.delete(folder);
        setFailures((prev) => ({ ...prev, [folder]: "listing_unavailable" }));
      }
    );
    // `attempt` only runs this again after Retry has cleared `requested`.
  }, [kind, id, folder, attempt]);

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
    let result: TreeResult<{ folders: TreeFolder[]; files: TreeFile[]; nextCursor: string | null }>;
    try {
      result = await fetchTreeListing(kind, id, folder, current.nextCursor);
    } catch {
      result = { ok: false, code: "listing_unavailable" };
    }
    if (!result.ok) {
      setMore({ folder, failed: true });
      return;
    }
    const page = result.data;
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
  };

  const view: ListingView = current
    ? { status: "ready", listing: current }
    : failures[folder]
      ? { status: "error", code: failures[folder] }
      : { status: "loading" };
  return {
    view,
    retry,
    loadMore,
    loadingMore,
    moreFailed: more?.folder === folder && more.failed,
  };
}

/**
 * The preview of `file`, asked of the backend when one is open. Not kept: a
 * preview is up to 256 KiB, and reopening a file asks again. `previewable` is
 * the listing's word; a file it marks not previewable is not asked for.
 */
function useFilePreview(kind: TreeKind, id: string, file: string | null, previewable: boolean) {
  const [entry, setEntry] = useState<{ file: string; result: TreeResult<TreePreview> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!file || !previewable) return;
    let cancelled = false;
    const done = (result: TreeResult<TreePreview>) => {
      if (!cancelled) setEntry({ file, result });
    };
    fetchTreePreview(kind, id, file).then(done, () =>
      done({ ok: false, code: "preview_unavailable" })
    );
    return () => {
      cancelled = true;
    };
  }, [kind, id, file, previewable, attempt]);

  const retry = () => {
    setEntry(null);
    setAttempt((a) => a + 1);
  };

  let view: PreviewView = { status: "loading" };
  if (file && !previewable) {
    view = { status: "skipped" };
  } else if (file && entry?.file === file) {
    view = entry.result.ok
      ? { status: "ready", preview: entry.result.data }
      : { status: "error", code: entry.result.code };
  }
  return { view, retry };
}
