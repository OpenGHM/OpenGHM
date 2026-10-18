import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminPage } from "@/components/admin/admin-page";
import { InlineError } from "@/components/admin/admin-states";
import { UsersTable } from "@/components/admin/users-table";
import { UserSearchFilters } from "@/components/admin/user-search-filters";
import { ServerPagination } from "@/components/shared/server-pagination";
import { fetchUsers } from "@/lib/admin/actions";
import { loadOrSignIn } from "@/lib/admin/load";
import { pathWithQuery } from "@/lib/auth-redirect";
import type { UserListResponse } from "@/lib/admin/types";

export const metadata: Metadata = { title: "Users | OpenGHM Admin" };

const EMPTY_USERS: UserListResponse = { items: [], total_count: 0, page: 1, total_pages: 1 };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; role?: string; q?: string; is_active?: string }>;
}) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const role =
    params.role === "admin" || params.role === "staff" || params.role === "user" || params.role === "guest"
      ? params.role
      : undefined;
  const q = params.q?.trim() || undefined;
  const isActive =
    params.is_active === "true" ? true : params.is_active === "false" ? false : undefined;

  const usersResult = await loadOrSignIn(pathWithQuery("/admin/users", params), () =>
    fetchUsers(page, role, { q, is_active: isActive })
  );
  const users = usersResult ?? EMPTY_USERS;

  return (
    <AdminPage
      title="Users"
      description={
        isAdmin
          ? "User directory — change roles or deactivate accounts."
          : "Read-only view — role and status changes require admin."
      }
    >
      <UserSearchFilters initialQuery={q} role={role} status={params.is_active} />

      <Card>
        <CardHeader>
          <CardTitle>{usersResult === null ? "Users" : `${users.total_count} users`}</CardTitle>
        </CardHeader>
        <CardContent>
          {usersResult === null ? (
            <InlineError title="Couldn't load users." />
          ) : (
            <>
              <UsersTable
                users={users.items}
                currentUserId={session?.user.id ?? ""}
                canManage={isAdmin}
              />
              <ServerPagination
                page={page}
                totalPages={users.total_pages}
                basePath="/admin/users"
                params={{ role, q, is_active: params.is_active }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
