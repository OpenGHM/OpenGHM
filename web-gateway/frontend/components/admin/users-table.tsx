"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/lib/auth.types";
import type { AdminUser } from "@/lib/admin/types";
import { updateUser } from "@/lib/admin/actions";

const ROLE_OPTIONS: UserRole[] = ["admin", "staff", "user", "guest"];

function AdminUserRow({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUser;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Own row: role/active edits are blocked server-side too (see
  // PATCH /users/{user_id} in web-gateway/backend/app/api/v1/users.py) — disabling the
  // controls here just avoids a round-trip to learn that.
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
        toast.success(`${user.name}'s role updated to ${role}.`);
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
        toast.success(`${user.name} ${nextActive ? "activated" : "deactivated"}.`);
        router.refresh();
      }
    });
  }

  return (
    <Fragment>
      <TableRow>
        <TableCell className="font-medium">
          <Link href={`/admin/users/${user.id}`} className="text-primary hover:underline">
            {user.name}
          </Link>
        </TableCell>
        <TableCell>{user.email}</TableCell>
        <TableCell>{user.organization ?? "—"}</TableCell>
        <TableCell>
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
        </TableCell>
        <TableCell>
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
        </TableCell>
        <TableCell>
          <Badge variant={user.email_verified ? "secondary" : "outline"}>
            {user.email_verified ? "Verified" : "Unverified"}
          </Badge>
        </TableCell>
        <TableCell className="text-slate-500 text-xs">
          {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
        </TableCell>
      </TableRow>
      {error && (
        <TableRow>
          <TableCell colSpan={7} className="text-red-600 text-xs">
            {error}
          </TableCell>
        </TableRow>
      )}
    </Fragment>
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
    return <p className="text-sm text-slate-500 py-6 text-center">No users match these filters.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Organization</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Verified</TableHead>
          <TableHead>Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <AdminUserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentUserId}
            canManage={canManage}
          />
        ))}
      </TableBody>
    </Table>
  );
}
