import { auth } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminRoleProvider } from "@/components/admin/admin-nav";
import { AdminShell } from "@/components/admin/admin-shell";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth-redirect";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect(signInPath("/admin"));

  // Defense in depth, not the real gate — the backend enforces this on
  // every request below (Permission.USER_VIEW_ANY / USER_MANAGE / etc).
  // This only exists so a user/guest doesn't land on a page that would just
  // show them a wall of 403s; it says so, rather than sending them home unexplained.
  if (session.user.role !== "admin" && session.user.role !== "staff") {
    return (
      <div className="flex min-h-screen flex-col">
        <PageHero eyebrow="Admin console" title="Admin console" />
        <PageBody className="flex-1">
          <section className="rounded-card bg-card px-6 py-14 text-center shadow-raised">
            <h2 className="text-xl font-[650] tracking-[-0.01em] text-foreground">
              You do not have access to the admin console
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground text-pretty">
              It is for OpenGHM admins and staff. If you think you should have access, ask an administrator.
            </p>
            <Button asChild size="lg" className="mt-5">
              <Link href="/">Back to home</Link>
            </Button>
          </section>
        </PageBody>
        <Footer />
      </div>
    );
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
