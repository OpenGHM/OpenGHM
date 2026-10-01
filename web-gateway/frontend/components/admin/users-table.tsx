"use client";

import Link from "next/link";
import { TableHead, TableRow } from "@/components/ui/table";
import {
  StackedBody,
  StackedCell,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/admin/stacked-table";
import { EmptyState } from "@/components/admin/admin-page";
import { Badge } from "@/components/ui/badge";
import { TimeStamp } from "@/components/common/time-stamp";
import type { AdminUser } from "@/lib/admin/types";
import { RoleControl, StatusControl } from "@/components/admin/user-admin-controls";

function AdminUserRow({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUser;
  isSelf: boolean;
  canManage: boolean;
}) {
  // Own row: role/active edits are blocked server-side too (self-target and
  // last-active-admin on PATCH /users/{user_id}) — disabling the controls
  // here just avoids a round-trip to learn that.
  const disabled = !canManage || isSelf;

  return (
    <StackedRow>
      <StackedCell className="font-medium">
        <Link
          href={`/admin/users/${user.id}`}
          className="inline-flex min-h-10 items-center text-base text-primary hover:underline sm:min-h-0 sm:text-sm"
        >
          {user.name}
        </Link>
      </StackedCell>
      <StackedCell className="[overflow-wrap:anywhere] max-sm:-mt-2 max-sm:pb-2 max-sm:text-sm max-sm:text-slate-500">
        {user.email}
      </StackedCell>
      <StackedCell label="Organization">{user.organization ?? "—"}</StackedCell>
      <StackedCell label="Role">
        <RoleControl
          user={user}
          disabled={disabled}
          ariaLabel={`Role for ${user.name}`}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-sm disabled:opacity-50 max-sm:min-h-10"
        />
      </StackedCell>
      <StackedCell label="Status">
        <StatusControl
          user={user}
          disabled={disabled}
          className="rounded border px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 max-sm:min-h-10 max-sm:px-3"
        />
      </StackedCell>
      <StackedCell label="Verified">
        <Badge variant={user.email_verified ? "secondary" : "outline"}>
          {user.email_verified ? "Verified" : "Unverified"}
        </Badge>
      </StackedCell>
      <StackedCell label="Joined" className="text-xs text-slate-500">
        {user.created_at ? <TimeStamp value={user.created_at} format="date" /> : "—"}
      </StackedCell>
    </StackedRow>
  );
}

export function UsersTable({
  users,
  currentUserId,
  canManage,
}: {
  users: AdminUser[];
  currentUserId: string;
  canManage: boolean;
}) {
  if (users.length === 0) {
    return (
      <EmptyState title="No users match these filters.">
        Change the search or the filters, or clear them.
      </EmptyState>
    );
  }

  return (
    <StackedTable>
      <StackedHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Organization</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Verified</TableHead>
          <TableHead>Joined</TableHead>
        </TableRow>
      </StackedHeader>
      <StackedBody>
        {users.map((u) => (
          <AdminUserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentUserId}
            canManage={canManage}
          />
        ))}
      </StackedBody>
    </StackedTable>
  );
}
