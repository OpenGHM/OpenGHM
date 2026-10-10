"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pin } from "lucide-react";
import type { RowAction } from "@/components/admin/community/row-actions";
import { pinItem, unpinItem } from "@/lib/home/admin-actions";
import type { FeedKind } from "@/lib/home/types";

/**
 * Pin and unpin from a list's rows. `pinned` is the ids of this kind that are
 * pinned to the home page now, or null when the pins could not be read: then
 * there is no pin action to offer. A pin or unpin saves at once (it does not
 * wait for the Latest updates page's Save) and toasts what happened.
 */
export function usePinToggle(kind: FeedKind, pinned: readonly string[] | null) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async (id: string, isPinned: boolean) => {
    if (busy) return;
    setBusy(true);
    let failure: string | null = null;
    try {
      const result = await (isPinned ? unpinItem(kind, id) : pinItem(kind, id));
      if (!result.ok) {
        failure =
          result.reason === "session_expired"
            ? "Your session has expired. Sign in again."
            : result.reason === "not_found"
              ? "That item no longer exists. Reload the page."
              : result.message;
      }
    } catch {
      failure = "Couldn't reach the service. Nothing may have changed; reload the page to check.";
    }
    setBusy(false);
    if (failure) {
      toast.error(failure);
      return;
    }
    toast.success(isPinned ? "Unpinned from the home page." : "Pinned to the home page.");
    router.refresh();
  };

  /** The row action for an item, or null when it cannot be pinned (hidden, or the pins are unknown). */
  const action = (item: { id: string; title: string; published: boolean }): RowAction | null => {
    if (pinned === null) return null;
    const isPinned = pinned.includes(item.id);
    // A hidden item is not on the site, so there is nothing to pin; one already pinned can still be unpinned.
    if (!item.published && !isPinned) return null;
    return {
      key: "pin",
      label: isPinned ? "Pinned to the home page — click to unpin" : "Pin to the home page",
      name: `${isPinned ? "Unpin" : "Pin"} ${item.title} ${isPinned ? "from" : "to"} the home page`,
      icon: Pin,
      tone: isPinned ? "pinned" : undefined,
      pressed: isPinned,
      disabled: busy,
      onSelect: () => void toggle(item.id, isPinned),
    };
  };

  return { action };
}
