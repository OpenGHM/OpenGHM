"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CONFIRM_BYTES, limitLabel, selectionS3Command, selectionTotals } from "@/lib/repository/selection";
import { S3Command } from "@/components/repository/s3-command";
import { useDownload } from "@/components/download/download-provider";
import type { DownloadJob } from "@/lib/download/engine";
import { archiveRoute } from "@/lib/repository/tree-browse";
import { useFileDownload } from "@/components/repository/tree-file-actions";
import type { FileSource, ListedFile } from "@/lib/repository/types";
import type { TreeSelection } from "@/components/repository/use-tree-selection";
import { formatBytes } from "@/lib/workspace/format";
import { cn } from "@/lib/utils";

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The bar over a folder's table while anything is ticked: how many entries and
 * how big they are, and **Download ZIP** for them (**Clear** unticks them). The
 * total is the files' listed sizes and each ticked folder's summary, "checking
 * size…" until it comes. Over the limit (before compression) the button is off
 * and the reason is written right here, before anyone clicks, with the S3
 * command that brings down just what is ticked, for as long as the viewed
 * folder's URL is known to write it. A run's output (`kind` `"run"`, ADR 0040) is on
 * Anvil scratch and has no S3 command: the reason is all the bar gives.
 *
 * From `CONFIRM_BYTES` (1 GB) the click first opens a dialog that says how big the ZIP is and
 * that an interrupted one starts over; the form is submitted when it is confirmed.
 *
 * The download goes through the shared download dialog (`useDownload`): it opens when the
 * button is pressed, says the ZIP is being prepared, then shows its progress. A single
 * ticked file is not zipped: it comes as it is, a published one from its S3 URL (CORS), a run's
 * from the gateway.
 */
export function SelectionBar({
  kind,
  id,
  folder,
  files,
  selection,
  className,
}: {
  kind: FileSource;
  id: string;
  /** The folder viewed, as in `?path=`: what the names are entries of. */
  folder: string;
  /** What is loaded of it, for the files' sizes. */
  files: ListedFile[];
  selection: TreeSelection;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const { start } = useDownload();
  const downloadFile = useFileDownload();
  const { names, sizes, clear, retry } = selection;
  if (names.length === 0) return null;

  const totals = selectionTotals(names, files, sizes);
  const onlyName = names.length === 1 && !names[0].endsWith("/") ? names[0] : null;
  const onlyFile = onlyName ? (files.find((f) => f.name === onlyName) ?? null) : null;
  const begin = () => {
    if (onlyFile) {
      downloadFile(kind, id, folder, onlyFile);
      return;
    }
    const job: DownloadJob = {
      title: `${names.length.toLocaleString("en-US")} ${names.length === 1 ? "entry" : "entries"} · ${formatBytes(totals.bytes)} as one ZIP`,
      filename: `${id}-${names.length === 1 ? names[0].replace(/\/$/, "") : "files"}.zip`,
      url: archiveRoute(kind, id),
      method: "POST",
      fields: [["folder", folder], ...names.map((name): [string, string] => ["names", name])],
      expectedBytes: totals.bytes,
      native: true,
    };
    start(job);
  };
  const limit = limitLabel(totals.limit);
  const size = formatBytes(totals.bytes);
  const tooBig = totals.status === "incomplete" || totals.status === "over";
  // A run's output is not in S3: there is no command, and nothing else to offer (ADR 0040).
  const command = tooBig && kind !== "run" ? selectionS3Command({ id, folder, names, files, sizes }) : null;
  const advice = command
    ? "Select less, or use the S3 command below."
    : kind === "run"
      ? "Select less."
      : "Select less, or use an S3 tool.";
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
        <button
          type="button"
          onClick={() => (totals.bytes >= CONFIRM_BYTES && !onlyFile ? setConfirming(true) : begin())}
          disabled={totals.status !== "ok"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition-colors",
            FOCUS,
            totals.status === "ok"
              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          )}
        >
          {totals.status === "checking" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-3.5" aria-hidden="true" />
          )}
          {onlyFile ? "Download" : "Download ZIP"}
        </button>
        <button
          type="button"
          onClick={clear}
          className={cn(
            "rounded px-1 text-[13px] font-semibold text-primary hover:text-primary-hover hover:underline",
            FOCUS,
          )}
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
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Download a {size} ZIP?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes as one file and cannot be resumed: if the connection drops, the download starts over. Only a few
              ZIPs are prepared at a time, so it can be refused while others are downloading.
              {kind !== "run" && " To resume an interrupted download, use an S3 tool such as aws s3 sync."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={begin}>Download ZIP</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
