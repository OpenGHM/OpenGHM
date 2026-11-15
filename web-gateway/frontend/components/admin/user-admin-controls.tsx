"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteUser, updateUser } from "@/lib/admin/actions";
import type { UserRole } from "@/lib/auth.types";

export const ROLE_OPTIONS: UserRole[] = ["admin", "staff", "user", "guest"];

/** How a role is named in the dropdown; the value sent stays the role itself. */
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  staff: "Staff",
  user: "User",
  guest: "Guest",
};

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
            {ROLE_LABEL[r]}
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

/** "Mark verified", beside an unverified address. Pressing it opens a dialog;
 *  nothing happens until it is confirmed. It only goes one way: the backend
 *  accepts `email_verified: true` and nothing else, and spends the emailed
 *  link so it cannot be used afterwards. */
export function EmailVerifiedControl({ user }: { user: { id: string; name: string; email: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-primary/30 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:min-h-10 max-sm:px-3"
      >
        Mark verified
      </button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Mark ${user.name}'s email as verified?`}
        description={`Do this only if you know ${user.email} belongs to them. The verification link already sent stops working, and this can't be undone here.`}
        confirmLabel="Mark verified"
        pendingLabel="Marking…"
        cancelLabel="Leave unverified"
        destructive={false}
        successMessage={`${user.name}'s email is now verified.`}
        failureMessage="Couldn't mark the email verified. Try again. If it keeps failing, the service may be unavailable."
        onConfirm={async () => {
          const result = await updateUser(user.id, { email_verified: true });
          return result.ok ? { ok: true } : { ok: false, message: result.message };
        }}
        onDone={() => router.refresh()}
      />
    </>
  );
}

/** "Edit", beside the profile: fixes the name, email and organization. The address is
 *  email, which is stored unverified when it changes. */
export function EditProfileControl({
  user,
  iconOnly = false,
}: {
  user: { id: string; name: string; email: string; organization: string | null };
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [organization, setOrganization] = useState(user.organization ?? "");
  const [email, setEmail] = useState(user.email);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed =
    name.trim() !== user.name ||
    email.trim().toLowerCase() !== user.email || organization.trim() !== (user.organization ?? "");

  const save = async () => {
    if (pending || !name.trim()) return;
    setPending(true);
    setError(null);
    const updates: { name?: string; organization?: string; email?: string } = {};
    if (email.trim().toLowerCase() !== user.email) updates.email = email.trim();
    if (name.trim() !== user.name) updates.name = name.trim();
    if (organization.trim() !== (user.organization ?? "")) updates.organization = organization.trim();
    const result = await updateUser(user.id, updates);
    setPending(false);
    if (!result.ok) {
      setError(result.message || "Couldn't save the changes. Try again.");
      return;
    }
    setOpen(false);
    toast.success("Profile updated.");
    router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={iconOnly ? "icon" : "sm"}
        aria-label={`Edit ${user.name}'s profile`}
        title="Edit profile"
        onClick={() => {
          setName(user.name);
          setOrganization(user.organization ?? "");
          setEmail(user.email);
          setError(null);
          setOpen(true);
        }}
      >
        {iconOnly ? <Pencil aria-hidden="true" /> : "Edit profile"}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {user.name}&apos;s profile</DialogTitle>
            <DialogDescription>
              Changing the email address marks it unverified until you mark it verified or the owner
              confirms it. Sign-in through CILogon is unaffected.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-name">Name</Label>
              <Input
                id="edit-user-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-email">Email</Label>
              <Input
                id="edit-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-org">Organization</Label>
              <Input
                id="edit-user-org"
                value={organization}
                maxLength={200}
                onChange={(e) => setOrganization(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !changed || !name.trim() || !email.trim()}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Delete account". Permanent, so it asks first and says what stays: the
 *  backend removes the account and signs it out everywhere, and leaves the
 *  person's snapshot drafts, published snapshots and the audit trail. After a
 *  delete from the user's own page it goes back to the list. */
export function DeleteUserControl({
  user,
  disabled,
  className,
  redirectTo,
  iconOnly = false,
}: {
  iconOnly?: boolean;
  user: { id: string; name: string; email: string };
  disabled: boolean;
  className?: string;
  /** Where to go after the delete, when the page being shown is the user's own. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={iconOnly ? "icon" : "sm"}
        disabled={disabled}
        aria-label={`Delete ${user.name}'s account`}
        onClick={() => setOpen(true)}
        title="Delete account"
        className={`border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive ${className ?? ""}`}
      >
        {iconOnly ? <Trash2 aria-hidden="true" /> : "Delete"}
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${user.name}'s account?`}
        description="The account is removed for good and signed out of every device. Their snapshot drafts, published snapshots and the activity log stay. To keep the account but block sign-in, deactivate it instead."
        detail={user.email}
        confirmLabel="Delete account"
        pendingLabel="Deleting…"
        cancelLabel="Keep account"
        destructive
        successMessage={`${user.name}'s account was deleted.`}
        failureMessage="Couldn't delete the account. Try again. If it keeps failing, the service may be unavailable."
        onConfirm={async () => {
          const result = await deleteUser(user.id);
          return result.ok ? { ok: true } : { ok: false, message: result.message };
        }}
        onDone={() => (redirectTo ? router.push(redirectTo) : router.refresh())}
      />
    </>
  );
}
