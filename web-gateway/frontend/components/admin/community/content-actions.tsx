"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog, type ConfirmResult } from "@/components/admin/confirm-action-dialog";
import { useSelection } from "@/components/admin/community/selection";
import { bulkContent, bulkDeleteFiles } from "@/lib/community/admin-actions";
import { bulkFailure, nameList, nounFor, stateChangeSummary, type Noun } from "@/lib/community/admin-bulk";
import type { BulkResult } from "@/lib/community/types";
import type { ActionResult } from "@/lib/jobs/types";

/** A row as the actions know it: its id, and the name they use for it in a message. */
export interface Item {
  id: string;
  title: string;
}

/**
 * What a list does with its rows: the selection, show and hide
 * for any of them (the selection or one row), and the delete that first
 * asks. Show and hide toast their outcome, drop the rows they dealt with
 * from the selection and refresh; rows they could not change stay selected.
 */
export function useContentActions(noun: Exclude<Noun, "files">, items: Item[]) {
  const router = useRouter();
  const selection = useSelection(items.map((i) => i.id));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Item[] | null>(null);
  const titles = new Map(items.map((i) => [i.id, i.title]));
  const selectedItems = items.filter((i) => selection.has(i.id));

  const setState = async (targets: Item[], state: "published" | "draft") => {
    if (busy || targets.length === 0) return;
    setBusy(true);
    let result: ActionResult<BulkResult> | null = null;
    try {
      result = await bulkContent(noun, state === "published" ? "publish" : "draft", targets.map((t) => t.id));
    } catch {
      result = null;
    }
    setBusy(false);
    if (!result) {
      toast.error("Couldn't reach the service. Nothing may have changed; reload the page to check.");
      return;
    }
    if (!result.ok) {
      toast.error(bulkFailure(result, state === "published" ? "show" : "hide"));
      return;
    }
    const summary = stateChangeSummary(noun, state, result.data, titles);
    if (summary.ok) toast.success(summary.message);
    else toast.error(summary.message);
    selection.drop(result.data.done);
    router.refresh();
  };

  return {
    selection,
    selectedItems,
    busy,
    setState,
    deleting,
    askDelete: (targets: Item[]) => setDeleting(targets),
    closeDelete: () => setDeleting(null),
  };
}

/** Show and Hide for the selected rows, for a `SelectionBar`. */
export function StateButtons({
  count,
  busy,
  onShow,
  onHide,
}: {
  count: number;
  busy: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-8" disabled={busy || count === 0} onClick={onShow}>
        <Eye aria-hidden="true" />
        Show
      </Button>
      <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-8" disabled={busy || count === 0} onClick={onHide}>
        <EyeOff aria-hidden="true" />
        Hide
      </Button>
    </>
  );
}

/** The Delete button of a `SelectionBar`. It opens the confirmation. */
export function DeleteButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-10 text-destructive hover:text-destructive sm:min-h-8"
      disabled={busy}
      onClick={onClick}
    >
      <Trash2 aria-hidden="true" />
      Delete
    </Button>
  );
}

/**
 * The question before a delete, for one row or for several. It lists how many
 * and the first few names, and says what a file's deletion does to the pages
 * that use it. It is open while `targets` is set; `onDeleted` hears which ids
 * went (an id that was already gone counts: the aim is met).
 */
export function DeleteItemsDialog({
  noun,
  targets,
  onClose,
  onDeleted,
}: {
  noun: Noun;
  targets: Item[] | null;
  onClose: () => void;
  onDeleted: (ids: string[]) => void;
}) {
  const router = useRouter();
  // The wording outlives `targets` for the dialog's closing animation.
  const [shown, setShown] = useState<Item[]>([]);
  if (targets && targets !== shown) setShown(targets);
  const count = shown.length;
  const many = count !== 1;
  const word = nounFor(noun, count);
  const isFile = noun === "files";

  const description = isFile
    ? `${many ? "The files are" : "The file is"} gone for good. If a workshop, tutorial or page uses ${many ? "one of them" : "it"}, that page shows a broken image or link until you change it.`
    : `${many ? "They are" : "It is"} removed from ${noun === "news" ? "the site and the home page" : "the Community page"} and cannot be restored.`;

  return (
    <ConfirmActionDialog
      open={targets !== null}
      onOpenChange={(open) => !open && onClose()}
      title={many ? `Delete ${count} ${word}?` : `Delete this ${word}?`}
      description={description}
      detail={nameList(shown.map((t) => t.title))}
      confirmLabel={many ? `Delete ${count} ${word}` : `Delete ${word}`}
      pendingLabel="Deleting…"
      successMessage={many ? `${count} ${word} deleted.` : `${word[0].toUpperCase()}${word.slice(1)} deleted.`}
      failureMessage={`Couldn't delete the ${word}. Try again. If it keeps failing, the service may be unavailable.`}
      onConfirm={async (): Promise<ConfirmResult> => {
        if (!targets) return { ok: false };
        const ids = targets.map((t) => t.id);
        const result = await (isFile ? bulkDeleteFiles(ids) : bulkContent(noun, "delete", ids));
        if (!result.ok) return { ok: false, message: bulkFailure(result, "delete") };
        // What is not found is already gone: the same as deleted.
        onDeleted([...result.data.done, ...result.data.missing]);
        return { ok: true };
      }}
      onDone={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}
