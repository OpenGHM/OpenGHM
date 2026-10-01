"use client";

import { useState } from "react";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { revokeAllUserSessions, revokeUserSession } from "@/lib/admin/actions";

const COPY = {
  device: {
    title: "Sign this device out?",
    description:
      "It is signed out immediately, and its next request is refused. The user has to sign in again on this device. Their other devices stay signed in.",
    confirm: "Sign out device",
    success: "Device signed out.",
    failure: "Couldn't sign this device out. Try again. If it keeps failing, the service may be unavailable.",
  },
  all: {
    title: "Sign out every device?",
    description:
      "Every device signed in as this user is signed out immediately, and they have to sign in again on each of them.",
    confirm: "Sign out all devices",
    success: "Signed out of every device.",
    failure: "Couldn't sign out every device. Try again. If it keeps failing, the service may be unavailable.",
  },
} as const;

/**
 * The confirmation before ending a user's session, wrapped around the button
 * that opens it. `scope="device"` ends one session, `scope="all"` ends every
 * one. The behaviour (open while pending, failure inline and as a toast) is
 * `ConfirmActionDialog`'s.
 */
export function SignOutDialog({
  scope,
  userId,
  sessionId,
  device,
  onSignedOut,
  children,
}: {
  scope: "device" | "all";
  userId: string;
  /** Required for `scope="device"`. */
  sessionId?: string;
  /** What the user will recognise the device by, shown in the dialog. */
  device?: string;
  /** The sessions are gone; the caller updates its list. */
  onSignedOut: () => void;
  /** The button that opens the dialog. */
  children: React.ReactNode;
}) {
  const copy = COPY[scope];
  const [open, setOpen] = useState(false);

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={setOpen}
      trigger={children}
      title={copy.title}
      description={copy.description}
      detail={scope === "device" ? device : undefined}
      confirmLabel={copy.confirm}
      pendingLabel="Signing out…"
      cancelLabel="Keep signed in"
      successMessage={copy.success}
      failureMessage={copy.failure}
      onConfirm={async () =>
        scope === "device" && sessionId
          ? await revokeUserSession(userId, sessionId)
          : await revokeAllUserSessions(userId)
      }
      onDone={onSignedOut}
    />
  );
}
