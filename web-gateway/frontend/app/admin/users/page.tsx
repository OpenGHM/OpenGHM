import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/admin/section-header";
import { UsersTable } from "@/components/admin/users-table";
import { UserSearchFilters } from "@/components/admin/user-search-filters";
import { ServerPagination } from "@/components/shared/server-pagination";
import { fetchUsers } from "@/lib/admin/actions";
import type { UserListResponse } from "@/lib/admin/types";

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

  const usersResult = await fetchUsers(page, role, { q, is_active: isActive }).catch(() => null);
  const users = usersResult ?? EMPTY_USERS;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <SectionHeader
        title="Users"
        description={
          isAdmin
            ? "User directory — change roles or deactivate accounts."
            : "Read-only view — role and status changes require admin."
        }
      />

      <UserSearchFilters initialQuery={q} role={role} status={params.is_active} />

      <Card>
        <CardHeader>
          <CardTitle>{users.total_count} users</CardTitle>
        </CardHeader>
        <CardContent>
          {usersResult === null ? (
            <p className="text-red-600 text-sm">Failed to load users.</p>
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
    </div>
  );
}
