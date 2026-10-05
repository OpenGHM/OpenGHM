"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { TimeStamp } from "@/components/common/time-stamp";
import type { AdminUserDetail } from "@/lib/admin/types";
import { RoleControl, RunPermissionControl, StatusControl } from "@/components/admin/user-admin-controls";

export function UserRoleStatusCard({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserDetail;
  isSelf: boolean;
  canManage: boolean;
}) {
  // Same guard as UsersTable: role/status edits are blocked server-side too
  // (self-target and last-active-admin, see PATCH /users/{user_id}).
  const disabled = !canManage || isSelf;

  // Admin and staff may always run; a guest never may. Only a
  // `user` depends on the flag, so only a `user` gets a working switch.
  const runImplicit = user.role === "admin" || user.role === "staff";
  const runNever = user.role === "guest";
  const canRun = runImplicit || (!runNever && user.can_run_simulations);
  const runDisabled = disabled || runImplicit || runNever;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={user.name} email={user.email} className="h-12 w-12 shrink-0 text-base" />
          <div className="min-w-0">
            <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">{user.name}</p>
            <p className="text-sm text-slate-500 [overflow-wrap:anywhere]">{user.email}</p>
          </div>
        </div>

        <dl className="min-w-0 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="shrink-0 text-slate-500">Email</dt>
            <dd>
              <Badge variant={user.email_verified ? "secondary" : "outline"}>
                {user.email_verified ? "Verified" : "Unverified"}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="shrink-0 text-slate-500">Organization</dt>
            <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere] text-slate-900">{user.organization ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="shrink-0 text-slate-500">Member since</dt>
            <dd className="min-w-0 text-right font-medium text-slate-900">
              {user.created_at ? <TimeStamp value={user.created_at} format="date" /> : "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="shrink-0 text-slate-500">Last login</dt>
            <dd className="min-w-0 text-right font-medium text-slate-900">
              {user.last_login_at ? <TimeStamp value={user.last_login_at} format="relative" /> : "Never"}
            </dd>
          </div>
          {user.sso_provider && (
            <div className="flex items-center justify-between">
              <dt className="shrink-0 text-slate-500">Sign-in method</dt>
              <dd className="min-w-0 text-right font-medium text-slate-900 capitalize">{user.sso_provider}</dd>
            </div>
          )}
        </dl>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">Role</span>
            <RoleControl
              user={user}
              disabled={disabled}
              ariaLabel="Role"
              className="rounded border border-slate-200 bg-white px-2 py-1 text-sm disabled:opacity-50 max-sm:min-h-10"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Status</span>
            <StatusControl
              user={user}
              disabled={disabled}
              className="rounded border px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 max-sm:min-h-10 max-sm:px-3"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span id="run-permission-label" className="text-sm text-slate-500">
                Can submit runs
              </span>
              <RunPermissionControl
                user={user}
                checked={canRun}
                disabled={runDisabled}
                labelledBy="run-permission-label"
                describedBy="run-permission-help"
              />
            </div>
            <p id="run-permission-help" className="text-xs text-slate-500">
              Admin and staff can always submit runs. A user needs this switch on. Each
              run spends the shared compute allocation.
              {runImplicit && " Always permitted for this role."}
              {runNever && " A guest can never submit runs."}
            </p>
          </div>
          {isSelf && (
            <p className="text-xs text-slate-500">
              You can&apos;t change your own role, status or run permission.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
