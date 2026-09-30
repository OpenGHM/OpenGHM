"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { UserRole } from "@/lib/auth.types";
import type { AdminUserDetail } from "@/lib/admin/types";
import { updateUser } from "@/lib/admin/actions";

const ROLE_OPTIONS: UserRole[] = ["admin", "staff", "user", "guest"];

export function UserRoleStatusCard({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserDetail;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Same guard as UsersTable: role/status edits are blocked server-side too
  // (self-target and last-active-admin, see PATCH /users/{user_id}).
  const disabled = !canManage || isSelf || pending;

  function handleRoleChange(role: UserRole) {
    setError("");
    startTransition(async () => {
      const result = await updateUser(user.id, { role });
      if (!result.ok) {
        const message = result.message ?? "Failed to update role.";
        setError(message);
        toast.error(message);
      } else {
        toast.success(`Role updated to ${role}.`);
        router.refresh();
      }
    });
  }

  function handleToggleActive() {
    setError("");
    const nextActive = !user.is_active;
    startTransition(async () => {
      const result = await updateUser(user.id, { is_active: nextActive });
      if (!result.ok) {
        const message = result.message ?? "Failed to update status.";
        setError(message);
        toast.error(message);
      } else {
        toast.success(nextActive ? "Account activated." : "Account deactivated.");
        router.refresh();
      }
    });
  }

  // Admin and staff may always run; a guest never may (ADR 0024). Only a
  // `user` depends on the flag, so only a `user` gets a working switch.
  const runImplicit = user.role === "admin" || user.role === "staff";
  const runNever = user.role === "guest";
  const canRun = runImplicit || (!runNever && user.can_run_simulations);
  const runDisabled = disabled || runImplicit || runNever;

  function handleToggleRun() {
    setError("");
    const next = !user.can_run_simulations;
    startTransition(async () => {
      const result = await updateUser(user.id, { can_run_simulations: next });
      if (!result.ok) {
        const message = result.message ?? "Failed to update run permission.";
        setError(message);
        toast.error(message);
      } else {
        toast.success(next ? "Can now run simulations." : "Can no longer run simulations.");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <UserAvatar name={user.name} email={user.email} className="h-12 w-12 text-base" />
          <div>
            <p className="font-medium text-slate-900">{user.name}</p>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Email</dt>
            <dd>
              <Badge variant={user.email_verified ? "secondary" : "outline"}>
                {user.email_verified ? "Verified" : "Unverified"}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Organization</dt>
            <dd className="font-medium text-slate-900">{user.organization ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Member since</dt>
            {/* toLocaleDateString()/toLocaleString() below can render
                differently between SSR (server timezone) and hydration
                (browser timezone) — suppress rather than chase a match. */}
            <dd className="font-medium text-slate-900" suppressHydrationWarning>
              {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Last login</dt>
            <dd className="font-medium text-slate-900" suppressHydrationWarning>
              {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}
            </dd>
          </div>
          {user.sso_provider && (
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Sign-in method</dt>
              <dd className="font-medium text-slate-900 capitalize">{user.sso_provider}</dd>
            </div>
          )}
        </dl>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Role</span>
            <select
              value={user.role}
              disabled={disabled}
              onChange={(e) => handleRoleChange(e.target.value as UserRole)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-sm disabled:opacity-50"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Status</span>
            <button
              onClick={handleToggleActive}
              disabled={disabled}
              className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                user.is_active
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "bg-red-50 text-red-700 hover:bg-red-100"
              }`}
            >
              {user.is_active ? "Active" : "Deactivated"}
            </button>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span id="run-permission-label" className="text-sm text-slate-500">
                Can run simulations
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={canRun}
                aria-labelledby="run-permission-label"
                aria-describedby="run-permission-help"
                onClick={handleToggleRun}
                disabled={runDisabled}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                  canRun ? "bg-primary" : "bg-slate-300"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                    canRun ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p id="run-permission-help" className="text-xs text-slate-400">
              Admin and staff can always run simulations. A user needs this switch on. Each
              run spends the shared ees260008 allocation.
              {runImplicit && " Always permitted for this role."}
              {runNever && " A guest can never run simulations."}
            </p>
          </div>
          {isSelf && (
            <p className="text-xs text-slate-400">
              You can&apos;t change your own role, status or run permission.
            </p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
