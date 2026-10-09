"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, Menu, UserCircle, ShieldCheck } from "lucide-react";
import { useState, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import type { UserRole } from "@/lib/auth.types";
import { revokeSession } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/user-avatar";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  staff: "Staff",
  user: "User",
  guest: "Guest",
};

const NAV_ITEMS_BEFORE = [
  { label: "Home", href: "/" },
  { label: "Data Repository", href: "/repository" },
  { label: "Workspace", href: "/workspace" },
];

const NAV_ITEMS_AFTER = [
  { label: "Community", href: "#" },
  { label: "About", href: "/about" },
];

const RESOURCES_ITEMS = [
  { label: "Models", href: "#" },
  { label: "Toolkit", href: "#" },
];

/**
 * Whether `href` is the page the visitor is on. A section keeps its tab lit on
 * the pages below it (`/repository/abc` is still Data Repository); Home is
 * only the exact root, and a `#` placeholder is never current.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname || href.startsWith("#")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// One line each, always: at `lg` the row is the tightest it gets (the links at 14 px with 8 px
// of padding), and from `xl` it has the room for 15 px and 12 px.
const NAV_LINK =
  "rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:px-3 xl:text-[15px]";
const NAV_LINK_IDLE = "font-medium text-slate-700 hover:bg-muted hover:text-foreground";
// Same weight as idle: font-semibold is a few px wider and would shift the row.
const NAV_LINK_ACTIVE = "bg-slate-100 font-medium text-foreground";

/**
 * The site header. From `lg` (1024 px) up the links and the account menu sit in
 * the row; below it they fold into one menu button, because the row needs about
 * 905 px at its tightest (measured at 1024 px signed in: logo 189, links 525,
 * account button 159, two 16 px gaps) and a phone has 375. The links are
 * `whitespace-nowrap`: a row that is too tight overflows rather than breaking
 * "Data Repository" onto two lines.
 */
export function Header() {
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const resourcesTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: session } = useSession();
  const pathname = usePathname();

  const handleResourcesEnter = () => {
    if (resourcesTimeoutRef.current) clearTimeout(resourcesTimeoutRef.current);
    setResourcesOpen(true);
  };
  const handleResourcesLeave = () => {
    resourcesTimeoutRef.current = setTimeout(() => setResourcesOpen(false), 100);
  };

  const handleUserMenuEnter = () => {
    if (userMenuTimeoutRef.current) clearTimeout(userMenuTimeoutRef.current);
    setUserMenuOpen(true);
  };
  const handleUserMenuLeave = () => {
    userMenuTimeoutRef.current = setTimeout(() => setUserMenuOpen(false), 100);
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between gap-4 bg-white px-4 py-3 sm:px-6 lg:px-10 lg:py-4 border-b border-black/5">
      <Link href="/" className="shrink-0">
        <Image
          src="/images/logo_light4.webp"
          alt="OpenGHM Logo"
          width={180}
          height={48}
          className="h-12 w-auto"
          priority
        />
      </Link>

      <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex xl:gap-1">
        {NAV_ITEMS_BEFORE.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            className={`${NAV_LINK} ${isActive(pathname, item.href) ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
          >
            {item.label}
          </Link>
        ))}

        {/* Resources dropdown */}
        <div
          className="relative"
          onMouseEnter={handleResourcesEnter}
          onMouseLeave={handleResourcesLeave}
        >
          <button className={`flex items-center gap-1 ${NAV_LINK} ${NAV_LINK_IDLE}`}>
            Resources
            <ChevronDown
              size={15}
              className={`transition-transform duration-200 ${resourcesOpen ? "rotate-180" : ""}`}
            />
          </button>

          {resourcesOpen && (
            <div className="absolute left-0 top-full mt-2 w-40 rounded-lg border border-black/5 bg-white py-1.5 shadow-lg">
              {RESOURCES_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="block px-4 py-2 text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-primary"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {NAV_ITEMS_AFTER.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            className={`${NAV_LINK} ${isActive(pathname, item.href) ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Auth section */}
      {session?.user ? (
        <div
          className="relative hidden lg:block"
          onMouseEnter={handleUserMenuEnter}
          onMouseLeave={handleUserMenuLeave}
        >
          <button className="flex items-center gap-2 rounded-md border border-black/10 pl-1.5 pr-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            <UserAvatar name={session.user.name} email={session.user.email} />
            <span className="max-w-24 truncate xl:max-w-[120px]">{session.user.name ?? session.user.email}</span>
            <ChevronDown
              size={13}
              className={`transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-black/5 bg-white py-1.5 shadow-lg">
              <div className="px-4 py-2 border-b border-black/5">
                <p className="text-xs text-slate-500 truncate">{session.user.email}</p>
                <p className="text-xs font-medium text-slate-400">{ROLE_LABELS[session.user.role]}</p>
              </div>
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-primary"
              >
                <UserCircle size={14} />
                My Profile
              </Link>
              {(session.user.role === "admin" || session.user.role === "staff") && (
                <Link
                  href="/admin"
                  className="flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-primary"
                >
                  <ShieldCheck size={14} />
                  Admin
                </Link>
              )}
              <button
                onClick={() => {
                  // Best-effort backend revoke, then always clear the
                  // client session regardless of whether it succeeded.
                  void revokeSession().finally(() => signOut({ callbackUrl: "/" }));
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-red-600"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      ) : (
        <Link
          href="/auth/signin"
          className="hidden items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 lg:inline-flex"
        >
          Sign In
        </Link>
      )}

      {/* Below lg: the same links and account items in one menu. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Open menu"
            className="text-slate-700 lg:hidden"
          >
            <Menu aria-hidden="true" className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {NAV_ITEMS_BEFORE.map((item) => (
            <DropdownMenuItem
              key={item.label}
              asChild
              className={`min-h-10 text-[15px] ${isActive(pathname, item.href) ? NAV_LINK_ACTIVE : "font-medium"}`}
            >
              <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuLabel className="pt-3 text-xs font-medium text-muted-foreground">
            Resources
          </DropdownMenuLabel>
          {RESOURCES_ITEMS.map((item) => (
            <DropdownMenuItem key={item.label} asChild className="min-h-10 pl-4 text-[15px] font-medium">
              <Link href={item.href}>{item.label}</Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {NAV_ITEMS_AFTER.map((item) => (
            <DropdownMenuItem
              key={item.label}
              asChild
              className={`min-h-10 text-[15px] ${isActive(pathname, item.href) ? NAV_LINK_ACTIVE : "font-medium"}`}
            >
              <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {session?.user ? (
            <>
              <div className="px-2 py-1.5">
                <p className="truncate text-xs text-slate-500">{session.user.email}</p>
                <p className="text-xs font-medium text-slate-400">{ROLE_LABELS[session.user.role]}</p>
              </div>
              <DropdownMenuItem asChild className="min-h-10 text-[15px] font-medium">
                <Link href="/dashboard/profile">
                  <UserCircle />
                  My Profile
                </Link>
              </DropdownMenuItem>
              {(session.user.role === "admin" || session.user.role === "staff") && (
                <DropdownMenuItem asChild className="min-h-10 text-[15px] font-medium">
                  <Link href="/admin">
                    <ShieldCheck />
                    Admin
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                className="min-h-10 text-[15px] font-medium"
                onSelect={() => {
                  // As the desktop menu: best-effort backend revoke, then
                  // always clear the client session.
                  void revokeSession().finally(() => signOut({ callbackUrl: "/" }));
                }}
              >
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem asChild className="min-h-10 text-[15px] font-semibold text-primary">
              <Link href="/auth/signin">Sign In</Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
