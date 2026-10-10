"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, LogOut, Menu } from "lucide-react";
import { signOut } from "next-auth/react";
import { revokeSession } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AdminNav, currentSectionLabel, useAdminUser } from "@/components/admin/admin-nav";

// A footer row of the sidebar: the same item shape as the nav's, a step quieter.
const FOOTER_ITEM =
  "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-hero-foreground-muted transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow";

/**
 * The sidebar's whole content, which the fixed column (lg and up) and the
 * phone's sheet both render: the logo and the console's name, the nav, then
 * the way back to the site, who is signed in and Sign out. Sign out is the site
 * header's: end the session on the backend if it answers, then clear the
 * client's whatever happens.
 */
function SidebarPanel({ onNavigate }: { onNavigate?: () => void }) {
  const user = useAdminUser();
  const [signingOut, setSigningOut] = useState(false);
  const isStaff = user?.role === "staff";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-hero text-hero-foreground">
      <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-x-0 top-0 h-56" />
      <div aria-hidden="true" className="hero-glow pointer-events-none absolute -top-40 -left-32 size-96 rounded-full" />

      <div className="relative px-5 pt-5 pb-2">
        <Link
          href="/"
          onClick={onNavigate}
          className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
        >
          <Image
            src="/images/logo_dark_new.webp"
            alt="OpenGHM Logo"
            width={400}
            height={147}
            className="h-10 w-auto"
            priority
          />
        </Link>
        <p className="mt-4 flex items-center gap-2.5 font-mono text-xs tracking-[0.06em] text-hero-eyebrow uppercase">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-hero-eyebrow ring-4 ring-hero-eyebrow/20" />
          Admin console
        </p>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-5">
        <AdminNav onNavigate={onNavigate} />
      </div>

      <div className="relative space-y-1 border-t border-white/10 p-3">
        <Link href="/" onClick={onNavigate} className={FOOTER_ITEM}>
          <ArrowLeft size={16} aria-hidden="true" className="shrink-0" />
          Back to site
        </Link>

        {user && (
          <div className="flex items-center gap-3 px-3 py-2">
            <UserAvatar
              name={user.name}
              email={user.email}
              tone="brand"
              className="size-9 shrink-0 text-xs ring-2 ring-white/15"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white" title={user.email ?? undefined}>
                {user.name ?? user.email}
              </p>
              {isStaff ? (
                <span className="mt-0.5 inline-flex rounded-full border border-white/15 bg-white/6 px-2 py-0.5 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap text-hero-eyebrow uppercase">
                  Staff · read-only
                </span>
              ) : (
                <p className="text-xs text-hero-subtle">Admin</p>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void revokeSession().finally(() => signOut({ callbackUrl: "/" }));
          }}
          className={`${FOOTER_ITEM} hover:text-hero-error disabled:opacity-60`}
        >
          <LogOut size={16} aria-hidden="true" className="shrink-0" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

/**
 * The admin console's frame, which `app/admin/layout.tsx` puts around every
 * admin page so it stays mounted as the pages change. From `lg` the navy
 * sidebar is a fixed column and the page scrolls beside it. Below `lg` a slim
 * navy top bar carries the logo, the current section and a menu button that
 * opens the same sidebar in a sheet from the left; the sheet closes when a link
 * is followed. The page content is a `<main>` that a skip link jumps to.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  // The sheet remembers the path it was opened on, so it counts as closed on any
  // other path: following a link closes it, and so does the browser's Back.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuOpen = openedAt === pathname;

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#admin-main"
        className="sr-only z-[60] rounded-lg bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-float focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Skip to content
      </a>

      <aside aria-label="Admin sidebar" className="hidden lg:block">
        <div className="sticky top-0 h-dvh">
          <SidebarPanel />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-white/10 bg-hero px-4 text-white lg:hidden">
          <Link
            href="/"
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
          >
            <Image
              src="/images/logo_dark_new.webp"
              alt="OpenGHM Logo"
              width={400}
              height={147}
              className="h-8 w-auto"
              priority
            />
          </Link>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-white/20" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{currentSectionLabel(pathname)}</p>
          <Sheet open={menuOpen} onOpenChange={(next) => setOpenedAt(next ? pathname : null)}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="Open admin menu"
                className="-mr-2 shrink-0 text-white hover:bg-white/10 hover:text-white focus-visible:border-white focus-visible:ring-white/50"
              >
                <Menu aria-hidden="true" className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 max-w-[85vw] border-white/10 bg-hero p-0 text-hero-foreground sm:max-w-72 [&>[data-slot=sheet-close-button]]:text-hero-foreground-muted [&>[data-slot=sheet-close-button]]:hover:bg-white/10 [&>[data-slot=sheet-close-button]]:hover:text-white [&>[data-slot=sheet-close-button]]:focus-visible:ring-hero-eyebrow"
            >
              <SheetTitle className="sr-only">Admin menu</SheetTitle>
              <SheetDescription className="sr-only">The sections of the admin console.</SheetDescription>
              <SidebarPanel onNavigate={() => setOpenedAt(null)} />
            </SheetContent>
          </Sheet>
        </header>

        <main
          id="admin-main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1280px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
