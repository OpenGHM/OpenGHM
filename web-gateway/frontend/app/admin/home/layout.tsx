import { auth } from "@/lib/auth";
import { AdminPage } from "@/components/admin/admin-page";
import { InlineError } from "@/components/admin/admin-states";

/**
 * The home page's content is written by admins only (Permission.CONTENT_MANAGE).
 * Staff can reach the admin console but not these pages: the nav hides the
 * group, and this answers a staff member who types the address. Defense in
 * depth, not the real gate; the backend refuses every request from anyone who
 * is not an admin.
 */
export default async function HomeAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user.role !== "admin") {
    return (
      <AdminPage title="Home" description="What the home page shows.">
        <InlineError title="Only admins can edit the home page.">
          Ask an admin to make the change, or to give your account the admin role.
        </InlineError>
      </AdminPage>
    );
  }
  return children;
}
