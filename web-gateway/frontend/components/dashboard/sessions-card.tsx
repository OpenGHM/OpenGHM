"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Monitor } from "lucide-react";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { revokeMySession, logoutAllSessions } from "@/lib/account/actions";
import type { SessionEntry } from "@/lib/account/types";

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/android/i.test(userAgent)) return "Android device";
  if (/macintosh/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows PC";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Unknown device";
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * The signed-in devices. `sessions` is `null` when the list could not be
 * loaded, which is not the same as having none: the card then says so and
 * offers to try again, instead of claiming there are no active sessions.
 */
export function SessionsCard({ sessions }: { sessions: SessionEntry[] | null }) {
  const router = useRouter();

  if (sessions === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Signed-in devices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t load your sessions.
          </p>
          <Button size="sm" variant="outline" onClick={() => router.refresh()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <SessionList sessions={sessions} />;
}

function SessionList({ sessions }: { sessions: SessionEntry[] }) {
  const [items, setItems] = useState(sessions);
  // The device a "Sign out" is about to act on, until the dialog is answered.
  const [revokeTarget, setRevokeTarget] = useState<SessionEntry | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Signed-in devices</CardTitle>
        {items.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => setLogoutAllOpen(true)}>
            Sign out everywhere
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          items.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <Monitor className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {describeDevice(s.user_agent)}
                    {s.current && (
                      <Badge variant="secondary" className="ml-2 align-middle">
                        This device
                      </Badge>
                    )}
                  </p>
                  {/* relativeTime() reads Date.now(), which differs by
                      construction between the server render and the
                      client hydration pass — suppress the resulting text
                      mismatch rather than chase an exact-millisecond match. */}
                  <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                    Last used {relativeTime(s.last_used_at)}
                  </p>
                </div>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRevokeTarget(s);
                    setRevokeOpen(true);
                  }}
                  className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  Sign out
                </Button>
              )}
            </div>
          ))
        )}
        {items.length === 1 && (
          <p className="text-xs text-muted-foreground">You&apos;re only signed in on this device.</p>
        )}
      </CardContent>

      <ConfirmActionDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Sign out this device?"
        description="Whoever is using it will need to sign in again."
        detail={revokeTarget ? describeDevice(revokeTarget.user_agent) : undefined}
        confirmLabel="Sign out device"
        pendingLabel="Signing out…"
        successMessage="Device signed out."
        failureMessage="Failed to sign out that device."
        onConfirm={async () => (revokeTarget ? revokeMySession(revokeTarget.id) : { ok: false })}
        onDone={() => {
          if (revokeTarget) setItems((prev) => prev.filter((s) => s.id !== revokeTarget.id));
        }}
      />
      <ConfirmActionDialog
        open={logoutAllOpen}
        onOpenChange={setLogoutAllOpen}
        title="Sign out everywhere?"
        description="Every device, including this one, is signed out. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        pendingLabel="Signing out…"
        successMessage="Signed out of every device."
        failureMessage="Couldn't sign out of every device. Try again."
        onConfirm={logoutAllSessions}
        // logout-all kills the current session too, so router.refresh() would
        // just hit a dead token — sign out client-side instead.
        onDone={() => void signOut({ callbackUrl: "/" })}
      />
    </Card>
  );
}
