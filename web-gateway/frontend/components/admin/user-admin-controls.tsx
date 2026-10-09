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
  guest: "A guest can browse the repository but can't create snapshot drafts.",
  user: "A user can create and manage their own snapshot drafts, and run them while their run permission is on.",
  staff:
    "Staff can do what a user can, and also see everyone's snapshot drafts and cancel them, but can't change accounts.",
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

/** The "Can run simulations" switch. Flipping it does not apply it: it opens a
 *  dialog that says what the change does, and the switch stays where it was
 *  unless the change is confirmed. What each side says is what the backend
 *  does: the flag is read when a job is submitted, so revoking it stops new
 *  submissions and leaves jobs already submitted alone. */
export function RunPermissionControl({
  user,
  checked,
  disabled,
  labelledBy,
  describedBy,
}: {
  user: { id: string; name: string };
  /** Whether the user may run now (true for admin and staff whatever the flag). */
  checked: boolean;
  disabled: boolean;
  labelledBy: string;
  describedBy?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<{ from: boolean; to: boolean } | null>(null);
  const grant = !checked;

  // Show the confirmed value until the refreshed page brings it, so the switch
  // does not flicker back. A dialog that is open or cancelled changes nothing.
  const shown = applied && applied.from === checked ? applied.to : checked;

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 shrink-0 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${
          shown ? "bg-primary" : "bg-input"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
            shown ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={grant ? `Let ${user.name} run simulations?` : `Stop ${user.name} from running simulations?`}
        description={
          grant
            ? "They can run simulations, and each one they run spends the shared compute allocation. They also need a verified email address."
            : "They can't run new simulations, but can still create and edit snapshot drafts. Simulations already submitted keep running."
        }
        confirmLabel={grant ? "Allow running" : "Stop running"}
        pendingLabel={grant ? "Allowing…" : "Stopping…"}
        cancelLabel={grant ? "Don't allow" : "Keep allowed"}
        destructive={!grant}
        successMessage={
          grant ? `${user.name} can now run simulations.` : `${user.name} can no longer run simulations.`
        }
        failureMessage="Couldn't change the run permission. Try again. If it keeps failing, the service may be unavailable."
        onConfirm={async () => {
          const result = await updateUser(user.id, { can_run_simulations: grant });
          if (!result.ok) return { ok: false, message: result.message };
          setApplied({ from: checked, to: grant });
          return { ok: true };
        }}
        onDone={() => router.refresh()}
      />
    </>
  );
}
