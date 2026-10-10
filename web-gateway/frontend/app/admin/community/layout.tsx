import { auth } from "@/lib/auth";
import { AdminPage } from "@/components/admin/admin-page";
import { InlineError } from "@/components/admin/admin-states";

/**
 * Community content is written by admins only (Permission.CONTENT_MANAGE).
 * Staff can reach the admin console but not these pages: the nav hides the
 * item, and this answers a staff member who types the address. Defense in
 * depth, not the real gate; the backend refuses every request from anyone who
 * is not an admin.
 */
export default async function CommunityAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user.role !== "admin") {
    return (
      <AdminPage title="Community" description="The Community page and everything on it.">
        <InlineError title="Only admins can edit Community content.">
          Ask an admin to make the change, or to give your account the admin role.
        </InlineError>
      </AdminPage>
    );
  }
  return children;
}
