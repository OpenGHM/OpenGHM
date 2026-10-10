"use client";

import Link from "next/link";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SELECT_CLASS, SectionHeading } from "@/components/admin/community/form-bits";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { cn } from "@/lib/utils";
import type { ContentState } from "@/lib/community/types";

/** One card of an editor: a heading in the card recipe, then its fields. */
export function EditorSection({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: React.ComponentProps<typeof SectionHeading>["icon"];
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <SectionHeading icon={icon} title={title} description={description} />
      </CardHeader>
      <CardContent className={cn("space-y-4 pt-1", className)}>{children}</CardContent>
    </Card>
  );
}

/** What a failed save says: the ended session, or the backend's sentences. */
export function SaveNotices({ expired, general }: { expired: boolean; general: string[] }) {
  if (!expired && general.length === 0) return null;
  return (
    <div className="space-y-3">
      {expired && <SessionExpiredBanner />}
      {general.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            {general.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The state select: Draft stays off the site, Published is on it. */
export function StateSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ContentState;
  onChange: (value: ContentState) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ContentState)}
      className={cn(SELECT_CLASS, "w-auto min-w-36")}
    >
      <option value="draft">Draft: not on the site</option>
      <option value="published">Published: on the site</option>
    </select>
  );
}

/**
 * The bar that stays at the foot of an editor: the state, where saving stands
 * and the Save button. `extra` holds the actions beside Save (Delete, View on
 * site); `cancelHref` is where Cancel leaves to, the list the editor was opened
 * from (the unsaved-changes guard asks first when there is anything to lose). The words beside the button are the one place the save status is read
 * out (`role="status"`), only when it changes.
 */
export function SaveBar({
  stateId,
  state,
  onStateChange,
  dirty,
  saving,
  saveLabel = "Save",
  extra,
  cancelHref,
}: {
  /** Omit `state` for a form that has none (the page settings). */
  stateId?: string;
  state?: ContentState;
  onStateChange?: (state: ContentState) => void;
  dirty: boolean;
  saving: boolean;
  saveLabel?: string;
  extra?: React.ReactNode;
  cancelHref?: string;
}) {
  return (
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-border/70 bg-card p-3 shadow-raised sm:px-4">
      {state && stateId && onStateChange && (
        <>
          <label htmlFor={stateId} className="sr-only">
            State
          </label>
          <StateSelect id={stateId} value={state} onChange={onStateChange} />
        </>
      )}
      <p role="status" className="min-w-0 text-[13px] text-muted-foreground">
        {saving ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
            Saving…
          </span>
        ) : dirty ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
            Unsaved changes
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3.5" aria-hidden="true" />
            All changes saved
          </span>
        )}
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {extra}
        {cancelHref && (
          <Button asChild variant="ghost" className="min-h-10 sm:min-h-9">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        )}
        <Button type="submit" disabled={saving} className="min-h-10 sm:min-h-9">
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
