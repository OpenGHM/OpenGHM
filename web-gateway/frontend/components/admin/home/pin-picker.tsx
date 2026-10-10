"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RowActions } from "@/components/admin/community/row-actions";
import { SELECT_CLASS } from "@/components/admin/community/form-bits";
import { TimeStamp } from "@/components/common/time-stamp";
import { fetchPinCandidates } from "@/lib/home/admin-actions";
import { KIND_LABEL, TAG_CLASS, pinKey } from "@/lib/home/format";
import type { FeedItem, FeedKind } from "@/lib/home/types";
import { cn } from "@/lib/utils";

const KIND_OPTIONS: { value: FeedKind | "all"; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "news", label: "News posts" },
  { value: "workshop", label: "Workshops" },
  { value: "dataset", label: "Datasets" },
];

/**
 * The items an admin can pin: a search box and a kind filter over the newest
 * visible posts, workshops and datasets, each with a Pin button. What is
 * pinned already (in the form, saved or not) is disabled, and so is every row
 * once the pins are full. Typing waits a moment before it asks the backend.
 */
export function PinPicker({
  pinned,
  full,
  onPin,
}: {
  /** `pinKey`s of what is pinned in the form now. */
  pinned: ReadonlySet<string>;
  full: boolean;
  onPin: (item: FeedItem) => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<FeedKind | "all">("all");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        let result: Awaited<ReturnType<typeof fetchPinCandidates>> | null = null;
        try {
          result = await fetchPinCandidates(q, kind);
        } catch {
          result = null;
        }
        // An answer to an earlier search is not the one on screen.
        if (request !== latest.current) return;
        setLoading(false);
        if (result?.ok) {
          setItems(result.data);
          setError(null);
        } else {
          setError(
            result && !result.ok && result.reason === "session_expired"
              ? "Your session has expired. Sign in again."
              : result && !result.ok && result.reason === "error"
                ? result.message
                : "Couldn't load the items. Try again in a moment."
          );
        }
      },
      q === "" ? 0 : 250
    );
    return () => clearTimeout(timer);
  }, [q, kind]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            autoComplete="off"
            aria-label="Search items to pin"
            placeholder="Search by title or summary"
            className="pl-9"
            onChange={(e) => setQ(e.target.value)}
            // Enter searches (it is already live); it must not save the form around it.
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          />
        </div>
        <select
          aria-label="Kind"
          value={kind}
          className={cn(SELECT_CLASS, "sm:w-44")}
          onChange={(e) => setKind(e.target.value as FeedKind | "all")}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div aria-live="polite" className="min-h-5 text-xs text-muted-foreground">
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
            Loading…
          </span>
        ) : error ? null : (
          `${items?.length ?? 0} ${items?.length === 1 ? "item" : "items"}`
        )}
        {full && !loading && " The pins are full: unpin one to add another."}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : items && items.length === 0 && !loading ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing matches. Only visible posts and workshops, and public datasets, can be pinned.
        </p>
      ) : (
        <ul aria-label="Items that can be pinned" aria-busy={loading} className={cn("space-y-2", loading && "opacity-60")}>
          {items?.map((item) => {
            const isPinned = pinned.has(pinKey(item));
            return (
              <li key={pinKey(item)} className="flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pr-1.5 pl-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className={cn("rounded-full px-2 py-0.5 font-semibold", TAG_CLASS[item.tag])}>{item.tag_label}</span>
                    <span>{KIND_LABEL[item.kind]}</span>
                    <TimeStamp value={item.date} format="date" />
                    {isPinned && <span className="font-medium text-primary">Pinned</span>}
                  </p>
                </div>
                <RowActions
                  actions={[
                    {
                      key: "pin",
                      label: isPinned ? "Already pinned" : "Pin",
                      name: `Pin ${item.title}`,
                      icon: Pin,
                      disabled: isPinned || full,
                      onSelect: () => onPin(item),
                    },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
