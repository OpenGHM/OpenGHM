"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import type { UserProfile } from "@/lib/account/types";
import { connectCilogon, disconnectCilogon } from "@/lib/account/actions";

const NO_PASSWORD_REASON =
  "This account has no password, so CILogon is its only way to sign in. Set a password first.";

// The same hairline-separated rows as the account details above it.
const ROW =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border py-3 first:border-t-0 first:pt-0";

/**
 * How the account signs in: whether a password is set, and, on a server where
 * CILogon is configured, whether CILogon is connected.
 *
 * Connecting is two steps: a server action records the intent and sets its
 * cookie, then the browser goes to CILogon with `prompt=login`, so a CILogon
 * session someone else left open in this browser is not what gets connected.
 * The callback attaches the identity to this account and returns here with
 * `?sso=` (see `SsoResultToast`); the account's email does not have to match
 * the one CILogon gives.
 */
export function SignInMethods({
  profile,
  cilogonEnabled,
}: {
  profile: UserProfile;
  cilogonEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const connected = profile.sso_provider !== null;

  function handleConnect() {
    startTransition(async () => {
      const result = await connectCilogon();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      await signIn("cilogon", { redirectTo: "/dashboard/profile" }, { prompt: "login" });
    });
  }

  return (
    <div className="space-y-1">
      <h3 className="pb-2 text-sm font-semibold text-foreground">Sign-in methods</h3>
      <div>
        <div className={ROW}>
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Password</span>
            {!profile.has_password && (
              <p className="text-xs text-muted-foreground">
                <Link href="/auth/forgot-password" className="font-medium text-primary hover:underline">
                  Set a password
                </Link>{" "}
                to be able to sign in without CILogon.
              </p>
            )}
          </div>
          <Badge variant={profile.has_password ? "secondary" : "outline"}>
            {profile.has_password ? "Set" : "Not set"}
          </Badge>
        </div>

        {cilogonEnabled && (
          <div className={ROW}>
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">CILogon</span>
              {connected && profile.sso_email && (
                // The address it gave, which can differ from the account's own.
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  as {profile.sso_email}
                </p>
              )}
            </div>
            {connected ? (
              <div className="flex items-center gap-3">
                <Badge variant="secondary">Connected</Badge>
                <ConfirmActionDialog
                  open={confirmOpen}
                  onOpenChange={setConfirmOpen}
                  trigger={
                    <Button size="sm" variant="outline" disabled={!profile.has_password}>
                      Disconnect
                    </Button>
                  }
                  title="Disconnect CILogon?"
                  description="You will no longer be able to sign in with CILogon, only with your email and password. You can connect it again whenever you like."
                  detail={profile.sso_email ?? undefined}
                  confirmLabel="Disconnect"
                  pendingLabel="Disconnecting…"
                  successMessage="CILogon disconnected."
                  failureMessage="Couldn't disconnect CILogon. Try again."
                  onConfirm={disconnectCilogon}
                  onDone={() => router.refresh()}
                />
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleConnect} disabled={pending}>
                {pending ? "Connecting…" : "Connect CILogon"}
              </Button>
            )}
            {connected && !profile.has_password && (
              <p className="basis-full text-xs text-muted-foreground">{NO_PASSWORD_REASON}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
