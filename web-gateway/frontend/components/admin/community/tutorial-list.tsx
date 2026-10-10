"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/admin-states";
import { StackedBody, StackedCell, StackedHeader, StackedRow, StackedTable } from "@/components/admin/stacked-table";
import { StatePill } from "@/components/admin/community/form-bits";
import { TimeStamp } from "@/components/common/time-stamp";
import { reorderTutorials } from "@/lib/community/admin-actions";
import { moveItem } from "@/lib/community/admin-format";
import { TUTORIAL_KINDS, TUTORIAL_LEVELS } from "@/lib/community/admin-forms";
import type { Tutorial } from "@/lib/community/types";

const kindLabel = (kind: Tutorial["kind"]) => TUTORIAL_KINDS.find((k) => k.value === kind)?.label ?? kind;
const levelLabel = (level: Tutorial["level"]) => TUTORIAL_LEVELS.find((l) => l.value === level)?.label ?? level;

/**
 * The tutorials in the order they appear on the Community page, with Move up
 * and Move down on each row. A move shows at once and is sent to the backend
 * as the whole new order (`reorder`); if the backend refuses, the list goes
 * back and says so. A move is announced to a screen reader.
 */
export function TutorialList({ tutorials }: { tutorials: Tutorial[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(tutorials);
  const [seen, setSeen] = useState(tutorials);
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // A refreshed page brings the stored order; show it.
  if (seen !== tutorials) {
    setSeen(tutorials);
    setOrder(tutorials);
  }

  const move = async (from: number, to: number) => {
    if (pending) return;
    const before = order;
    const next = moveItem(order, from, to);
    setOrder(next);
    setPending(true);
    let failure: string | null = null;
    try {
      const result = await reorderTutorials(next.map((t) => t.id));
      if (!result.ok) {
        failure =
          result.reason === "session_expired"
            ? "Your session has expired. Sign in again to change the order."
            : result.reason === "not_found"
              ? "A tutorial in the list no longer exists. Reload the page."
              : result.message;
      }
    } catch {
      failure = "Couldn't change the order. Nothing was changed; try again.";
    }
    setPending(false);
    if (failure) {
      setOrder(before);
      toast.error(failure);
      return;
    }
    setAnnouncement(`${before[from].title} moved to position ${to + 1} of ${next.length}.`);
    router.refresh();
  };

  if (order.length === 0) {
    return (
      <EmptyState title="No tutorials yet.">
        Add the first one with New tutorial. It stays a draft, off the site, until you publish it.
      </EmptyState>
    );
  }

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <StackedTable>
        <StackedHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-24">
              <span className="sr-only">Order</span>
            </TableHead>
          </TableRow>
        </StackedHeader>
        <StackedBody>
          {order.map((t, i) => (
            <StackedRow key={t.id}>
              <StackedCell label="Position" className="font-mono text-xs text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </StackedCell>
              <StackedCell className="min-w-0">
                <Link
                  href={`/admin/community/tutorials/${encodeURIComponent(t.id)}`}
                  className="font-medium text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {t.title}
                </Link>
                <p className="font-mono text-xs break-all text-muted-foreground">/{t.slug}</p>
              </StackedCell>
              <StackedCell label="Kind" className="text-sm">
                {kindLabel(t.kind)} · {levelLabel(t.level)}
                {t.minutes !== null && ` · ${t.minutes} min`}
              </StackedCell>
              <StackedCell label="State">
                <StatePill state={t.state} />
              </StackedCell>
              <StackedCell label="Updated" className="text-xs text-muted-foreground">
                <TimeStamp value={t.updated_at} format="relative" />
              </StackedCell>
              <StackedCell>
                <div className="flex justify-end gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 text-muted-foreground md:size-8"
                    disabled={pending || i === 0}
                    aria-label={`Move ${t.title} up`}
                    onClick={() => void move(i, i - 1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 text-muted-foreground md:size-8"
                    disabled={pending || i === order.length - 1}
                    aria-label={`Move ${t.title} down`}
                    onClick={() => void move(i, i + 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </div>
              </StackedCell>
            </StackedRow>
          ))}
        </StackedBody>
      </StackedTable>
    </>
  );
}
