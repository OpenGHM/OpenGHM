import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminRoleProvider } from "@/components/admin/admin-nav";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  // Defense in depth, not the real gate — the backend enforces this on
  // every request below (Permission.USER_VIEW_ANY / USER_MANAGE / etc).
  // This redirect only exists so a user/guest doesn't land on a page that
  // would just show them a wall of 403s.
  if (session.user.role !== "admin" && session.user.role !== "staff") {
    redirect("/");
  }

  // The frame (sidebar, phone top bar) lives here, so it stays mounted while
  // the pages inside it change and a loading.tsx only has to cover the page.
  // The console has no site header and no marketing footer.
  return (
    <AdminRoleProvider role={session.user.role} name={session.user.name} email={session.user.email}>
      <AdminShell>{children}</AdminShell>
    </AdminRoleProvider>
  );
}
