"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { revokeUserSession, revokeAllUserSessions } from "@/lib/admin/actions";
import type { SessionEntry } from "@/lib/account/types";

export function UserSessionsTable({
  userId,
  sessions,
}: {
  userId: string;
  sessions: SessionEntry[];
}) {
  const [items, setItems] = useState(sessions);
  const [pending, startTransition] = useTransition();
  const [confirmingAll, setConfirmingAll] = useState(false);

  function handleRevoke(sessionId: string) {
    if (!window.confirm("Sign this device out immediately?")) return;
    startTransition(async () => {
      const result = await revokeUserSession(userId, sessionId);
      if (result.ok) {
        setItems((prev) => prev.filter((s) => s.id !== sessionId));
        toast.success("Device signed out.");
      } else {
        toast.error("Failed to sign out that device.");
      }
    });
  }

  function handleRevokeAll() {
    startTransition(async () => {
      const result = await revokeAllUserSessions(userId);
      if (result.ok) {
        setItems([]);
        toast.success("Signed out of every device.");
      } else {
        toast.error("Failed to sign out all devices.");
      }
      setConfirmingAll(false);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sessions ({items.length})</CardTitle>
        {items.length > 0 &&
          (confirmingAll ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Sign out all devices?</span>
              <Button variant="destructive" size="sm" disabled={pending} onClick={handleRevokeAll}>
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingAll(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmingAll(true)}>
              Revoke all
            </Button>
          ))}
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">No active sessions.</p>
        ) : (
          items.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Monitor className="size-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-600">{s.user_agent ?? "Unknown device"}</p>
                  {/* toLocaleString() renders in the server's timezone during
                      SSR and the browser's timezone during hydration — those
                      can differ, so suppress rather than chase a match. */}
                  <p className="text-xs text-slate-400" suppressHydrationWarning>
                    Last used {new Date(s.last_used_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => handleRevoke(s.id)}
                className="shrink-0 text-red-600 hover:text-red-700"
              >
                Revoke
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
