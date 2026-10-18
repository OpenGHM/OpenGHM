"use client";

import { useId, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { limitLabel, selectionS3Command, selectionTotals } from "@/lib/repository/selection";
import { S3Command } from "@/components/repository/s3-command";
import { archiveRoute } from "@/lib/repository/tree-browse";
import type { TreeFile, TreeKind } from "@/lib/repository/types";
import type { TreeSelection } from "@/components/repository/use-tree-selection";
import { formatBytes } from "@/lib/workspace/format";
import { cn } from "@/lib/utils";

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The message of a refusal the hidden frame loaded in place of a download, if that is what it holds. */
function refusalIn(frame: HTMLIFrameElement): string | null {
  try {
    const text = frame.contentDocument?.body?.textContent;
    if (!text) return null;
    const body = JSON.parse(text) as { detail?: { message?: unknown }; message?: unknown };
    const message = body.detail?.message ?? body.message;
    return typeof message === "string" ? message : "The ZIP could not be prepared.";
  } catch {
    return null;
  }
}

/**
 * The bar over a folder's table while anything is ticked: how many entries and
 * how big they are, and **Download ZIP** for them (**Clear** unticks them). The
 * total is the files' listed sizes and each ticked folder's summary, "checking
 * size…" until it comes. Over the limit (before compression) the button is off
 * and the reason is written right here, before anyone clicks, with the S3
 * command that brings down just what is ticked, for as long as the viewed
 * folder's URL is known to write it.
 *
 * The download is a hidden form POSTed to the gateway, so the browser itself
 * takes the response to disk as it arrives (no `fetch`, no blob in memory) and
 * any number of names can go. It targets a hidden frame, so that a refusal the
 * backend still gives (another download's turn, a listing that changed) is read
 * there and shown here instead of replacing the page with JSON.
 */
export function SelectionBar({
  kind,
  id,
  folder,
  files,
  selection,
  className,
}: {
  kind: TreeKind;
  id: string;
  /** The folder viewed, as in `?path=`: what the names are entries of. */
  folder: string;
  /** What is loaded of it, for the files' sizes. */
  files: TreeFile[];
  selection: TreeSelection;
  className?: string;
}) {
  const frame = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const { names, sizes, clear, retry } = selection;
  if (names.length === 0) return null;

  const totals = selectionTotals(names, files, sizes);
  const limit = limitLabel(totals.limit);
  const size = formatBytes(totals.bytes);
  const tooBig = totals.status === "incomplete" || totals.status === "over";
  const command = tooBig ? selectionS3Command({ id, folder, names, files, sizes }) : null;
  const advice = command ? "Select less, or use the S3 command below." : "Select less, or use an S3 tool.";
  const note =
    totals.status === "incomplete"
      ? `The selection holds too many files to check against the ${limit} limit for a ZIP. ${advice}`
      : totals.status === "over"
        ? `The selection is ${size}, over the ${limit} limit for a ZIP. ${advice}`
        : null;

  return (
    <div className={cn("flex flex-col gap-1.5 bg-secondary px-5 py-2.5 sm:px-[26px]", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span role="status" className="text-[13px] font-semibold">
          {names.length.toLocaleString("en-US")} selected
          <span className="font-normal text-muted-foreground">
            {" · "}
            {totals.status === "checking" ? "checking size…" : totals.status === "incomplete" ? "too many files" : size}
          </span>
        </span>
        <form
          method="POST"
          action={archiveRoute(kind, id)}
          target={frame}
          onSubmit={() => setRefusal(null)}
          className="flex items-center gap-2"
        >
          <input type="hidden" name="folder" value={folder} />
          {names.map((name) => (
            <input key={name} type="hidden" name="names" value={name} />
          ))}
          <button
            type="submit"
            disabled={totals.status !== "ok"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition-colors",
              FOCUS,
              totals.status === "ok"
                ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            )}
          >
            {totals.status === "checking" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-3.5" aria-hidden="true" />
            )}
            Download ZIP
          </button>
        </form>
        <button
          type="button"
          onClick={clear}
          className={cn("rounded px-1 text-[13px] font-semibold text-primary hover:text-primary-hover hover:underline", FOCUS)}
        >
          Clear
        </button>
      </div>
      {note && <p className="text-[13px] text-pretty text-muted-foreground">{note}</p>}
      {command && <S3Command command={command} />}
      {totals.status === "failed" &&
        totals.failed.map((name) => (
          <p key={name} className="text-[13px] text-muted-foreground">
            The size of {name} could not be checked.{" "}
            <button
              type="button"
              onClick={() => retry(name)}
              className={cn("rounded text-primary hover:text-primary-hover hover:underline", FOCUS)}
            >
              Try again
            </button>
          </p>
        ))}
      {refusal && <p className="text-[13px] text-pretty text-muted-foreground">{refusal}</p>}
      <iframe
        name={frame}
        title="ZIP download"
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onLoad={(e) => setRefusal(refusalIn(e.currentTarget))}
      />
    </div>
  );
}
