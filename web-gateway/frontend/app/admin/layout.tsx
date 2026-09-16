import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/landing/header";
import { AdminNav } from "@/components/admin/admin-nav";

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

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1 flex-col md:flex-row">
        <AdminNav role={session.user.role} />
        <main className="min-w-0 flex-1 bg-slate-50">{children}</main>
      </div>
    </div>
  );
}
