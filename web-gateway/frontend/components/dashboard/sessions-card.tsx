"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Monitor } from "lucide-react";
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

export function SessionsCard({ sessions }: { sessions: SessionEntry[] }) {
  const [items, setItems] = useState(sessions);
  const [pending, startTransition] = useTransition();
  const [signingOutAll, setSigningOutAll] = useState(false);

  function handleRevoke(sessionId: string) {
    startTransition(async () => {
      const result = await revokeMySession(sessionId);
      if (result.ok) {
        setItems((prev) => prev.filter((s) => s.id !== sessionId));
        toast.success("Device signed out.");
      } else {
        toast.error("Failed to sign out that device.");
      }
    });
  }

  async function handleLogoutAll() {
    setSigningOutAll(true);
    await logoutAllSessions();
    toast.success("Signed out of every device.");
    // logout-all kills the current session too, so router.refresh() would
    // just hit a dead token — sign out client-side instead.
    await signOut({ callbackUrl: "/" });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Signed-in devices</CardTitle>
        {items.length > 1 && (
          <Button variant="ghost" size="sm" onClick={handleLogoutAll} disabled={signingOutAll}>
            {signingOutAll ? "Signing out..." : "Sign out everywhere"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">No active sessions.</p>
        ) : (
          items.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
              <div className="flex items-center gap-3 min-w-0">
                <Monitor className="size-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
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
                  <p className="text-xs text-slate-500" suppressHydrationWarning>
                    Last used {relativeTime(s.last_used_at)}
                  </p>
                </div>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => handleRevoke(s.id)}
                  className="shrink-0 text-red-600 hover:text-red-700"
                >
                  Sign out
                </Button>
              )}
            </div>
          ))
        )}
        {items.length === 1 && (
          <p className="text-xs text-slate-400">You&apos;re only signed in on this device.</p>
        )}
      </CardContent>
    </Card>
  );
}
