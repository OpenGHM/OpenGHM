"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { updateUser } from "@/lib/admin/actions";
import type { UserRole } from "@/lib/auth.types";

export const ROLE_OPTIONS: UserRole[] = ["admin", "staff", "user", "guest"];

/** What each role can do, as the end of a sentence. Matches the backend's
 *  role permissions (web-gateway/backend/app/core/roles.py). */
const ROLE_CAN: Record<UserRole, string> = {
  guest: "A guest can browse the repository but can't create simulations.",
  user: "A user can create and manage their own simulations, and run them while their run permission is on.",
  staff:
    "Staff can do what a user can, and also see everyone's simulations and cancel them, but can't change accounts.",
  admin: "An admin can do everything staff can, and also change roles and accounts and see system status.",
};

/** The role dropdown. Choosing a role does not apply it: it opens a dialog
 *  that names the old and the new role, and the dropdown goes back to the old
 *  one unless the change is confirmed. */
export function RoleControl({
  user,
  disabled,
  className,
  ariaLabel,
}: {
  user: { id: string; name: string; role: UserRole };
  disabled: boolean;
  className?: string;
  ariaLabel: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<{ from: UserRole; to: UserRole } | null>(null);
  const [open, setOpen] = useState(false);
  const confirmed = useRef(false);

  // Show the choice while the dialog is open, and until the refreshed page
  // brings the new role, so the dropdown does not flicker back.
  const shown = choice && choice.from === user.role ? choice.to : user.role;

  return (
    <>
      <select
        value={shown}
        disabled={disabled}
        onChange={(e) => {
          setChoice({ from: user.role, to: e.target.value as UserRole });
          setOpen(true);
        }}
        aria-label={ariaLabel}
        className={className}
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {choice && (
        <ConfirmActionDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            // Closed without confirming: back to the old role. A confirmed
            // change keeps `choice` until the page refreshes.
            if (!next && !confirmed.current) setChoice(null);
          }}
          title={`Change ${user.name}'s role to ${choice.to}?`}
          description={`Their role changes from ${choice.from} to ${choice.to}. ${ROLE_CAN[choice.to]}`}
          confirmLabel="Change role"
          pendingLabel="Changing…"
          cancelLabel="Keep current role"
          destructive={false}
          successMessage={`${user.name}'s role is now ${choice.to}.`}
          failureMessage="Couldn't change the role. Try again. If it keeps failing, the service may be unavailable."
          onConfirm={async () => {
            const result = await updateUser(user.id, { role: choice.to });
            if (!result.ok) return { ok: false, message: result.message };
            confirmed.current = true;
            return { ok: true };
          }}
          onDone={() => {
            confirmed.current = false;
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** The Active / Deactivated button. Pressing it opens a dialog that says what
 *  the change does; nothing happens until it is confirmed. What each side
 *  says is what the backend does: deactivating signs the user out of every
 *  device at once and refuses their sign-in until the account is reactivated. */
export function StatusControl({
  user,
  disabled,
  className,
}: {
  user: { id: string; name: string; is_active: boolean };
  disabled: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const next = !user.is_active;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={user.is_active ? "Deactivate this account" : "Reactivate this account"}
        className={`${className ?? ""} ${
          user.is_active
            ? "border-success/25 bg-success/10 text-success hover:border-success/50"
            : "border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/50"
        }`}
      >
        {user.is_active ? "Active" : "Deactivated"}
      </button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={next ? `Reactivate ${user.name}?` : `Deactivate ${user.name}?`}
        description={
          next
            ? "They can sign in again. Their devices stay signed out until they do."
            : "They are signed out of every device and can't sign in until the account is reactivated."
        }
        confirmLabel={next ? "Reactivate account" : "Deactivate account"}
        pendingLabel={next ? "Reactivating…" : "Deactivating…"}
        cancelLabel={next ? "Keep deactivated" : "Keep active"}
        destructive={!next}
        successMessage={next ? `${user.name} reactivated.` : `${user.name} deactivated.`}
        failureMessage="Couldn't change the account. Try again. If it keeps failing, the service may be unavailable."
        onConfirm={async () => {
          const result = await updateUser(user.id, { is_active: next });
          return result.ok ? { ok: true } : { ok: false, message: result.message };
        }}
        onDone={() => router.refresh()}
      />
    </>
  );
}
