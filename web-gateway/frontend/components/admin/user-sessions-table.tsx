"use client";

import { useState } from "react";
import { Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/admin-states";
import { SignOutDialog } from "@/components/admin/sign-out-dialog";
import { TimeStamp } from "@/components/common/time-stamp";
import type { SessionEntry } from "@/lib/account/types";

/** How many sessions show before "Show all". A user can have dozens, and the
 *  newest are the ones an admin is looking for. */
export const COLLAPSED_SESSIONS = 10;

export function UserSessionsTable({
  userId,
  sessions,
}: {
  userId: string;
  sessions: SessionEntry[];
}) {
  const [items, setItems] = useState(sessions);
  const [expanded, setExpanded] = useState(false);

  // Most recently used first, so the collapsed list is the 10 that matter.
  const sorted = [...items].sort((a, b) => Date.parse(b.last_used_at) - Date.parse(a.last_used_at));
  const collapsible = sorted.length > COLLAPSED_SESSIONS;
  const visible = collapsible && !expanded ? sorted.slice(0, COLLAPSED_SESSIONS) : sorted;

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Sessions ({items.length})</CardTitle>
        {items.length > 0 && (
          <SignOutDialog scope="all" userId={userId} onSignedOut={() => setItems([])}>
            <Button variant="ghost" size="sm" className="min-h-10 sm:min-h-8">
              Sign out all devices
            </Button>
          </SignOutDialog>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <EmptyState title="No active sessions.">
            This user is not signed in on any device.
          </EmptyState>
        ) : (
          visible.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-foreground/80 [overflow-wrap:anywhere] sm:truncate">
                    {s.user_agent ?? "Unknown device"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last used <TimeStamp value={s.last_used_at} format="relative" />
                  </p>
                </div>
              </div>
              <SignOutDialog
                scope="device"
                userId={userId}
                sessionId={s.id}
                device={s.user_agent ?? "Unknown device"}
                onSignedOut={() => setItems((prev) => prev.filter((x) => x.id !== s.id))}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Sign out ${s.user_agent ?? "unknown device"}`}
                  className="min-h-10 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive sm:min-h-8"
                >
                  Sign out
                </Button>
              </SignOutDialog>
            </div>
          ))
        )}
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="min-h-10 w-full sm:min-h-8"
          >
            {expanded
              ? `Show only the ${COLLAPSED_SESSIONS} most recent`
              : `Show all ${sorted.length} sessions`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
