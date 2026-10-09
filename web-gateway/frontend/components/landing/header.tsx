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

// One line each, always: the padding and the type size scale with the viewport (13.5 px with
// ~11 px of padding at `lg`, 15 px with 16 px from ~1360 px), and the links never wrap.
const NAV_LINK =
  "rounded-full px-[clamp(9px,1.1vw,16px)] py-2.5 text-[clamp(13.5px,1.1vw,15px)] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow";
const NAV_LINK_IDLE = "text-hero-foreground-muted hover:bg-white/8 hover:text-white";
// Same size as idle; only the weight (550) differs, which is too little to shift the row.
const NAV_LINK_ACTIVE = "bg-white font-[550] text-foreground";
// The current item in the phone menu, which is a light popover rather than the navy pill.
const MENU_ACTIVE = "bg-secondary font-semibold text-secondary-foreground";
// A row in the Resources and account popovers.
const POPOVER_ITEM =
  "flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium text-foreground transition-colors hover:bg-accent hover:text-primary";

/**
 * The site header. It is transparent and sits on the navy band behind it:
 *
 * - `variant="overlay"` (what `PageHero` passes): no background of its own, for use inside
 *   the band.
 * - `variant="standalone"` (the default): its own navy bar, sticky, for a page with no hero.
 *
 * From `lg` (1024 px) up the links sit in a centred pill and the account menu on the right;
 * below it they fold into one menu button, because the row needs about 905 px at its
 * tightest and a phone has 375. The links are `whitespace-nowrap`: a row that is too tight
 * overflows rather than breaking "Data Repository" onto two lines.
 */
export function Header({ variant = "standalone" }: { variant?: "overlay" | "standalone" }) {
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
    <header
      className={
        variant === "overlay"
          ? "relative z-20 text-white"
          : "sticky top-0 z-50 border-b border-white/10 bg-hero text-white"
      }
    >
      <div className="mx-auto flex h-[72px] w-full max-w-[1360px] items-center gap-5 px-4 sm:px-7 lg:h-[88px]">
        <Link href="/" className="flex shrink-0 items-center">
          <Image
            src="/images/logo_dark_new.webp"
            alt="OpenGHM Logo"
            width={400}
            height={147}
            className="h-[clamp(46px,4.4vw,60px)] w-auto"
            priority
          />
        </Link>

        <nav
          aria-label="Main"
          className="mx-auto hidden items-center gap-0.5 rounded-full border border-white/10 bg-white/6 p-[5px] backdrop-blur-sm lg:flex"
        >
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
            <button
              aria-expanded={resourcesOpen}
              className={`flex items-center gap-1 ${NAV_LINK} ${NAV_LINK_IDLE}`}
            >
              Resources
              <ChevronDown
                size={15}
                className={`transition-transform duration-200 ${resourcesOpen ? "rotate-180" : ""}`}
              />
            </button>

            {resourcesOpen && (
              // The padding, not a margin, makes the gap under the button: the pointer
              // crosses it without leaving the wrapper, so the menu does not close.
              <div className="absolute left-0 top-full z-30 w-44 pt-2">
                <div className="rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
                  {RESOURCES_ITEMS.map((item) => (
                    <Link key={item.label} href={item.href} className={POPOVER_ITEM}>
                      {item.label}
                    </Link>
                  ))}
                </div>
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
            className="relative hidden shrink-0 lg:block"
            onMouseEnter={handleUserMenuEnter}
            onMouseLeave={handleUserMenuLeave}
          >
            <button
              aria-expanded={userMenuOpen}
              className="flex items-center gap-2 rounded-full border border-white/15 bg-white/6 py-[5px] pr-3.5 pl-[5px] text-[15px] font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
            >
              <UserAvatar
                name={session.user.name}
                email={session.user.email}
                tone="brand"
                className="size-[34px] text-[11px] font-bold"
              />
              <span className="max-w-24 truncate xl:max-w-[120px]">{session.user.name ?? session.user.email}</span>
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-full z-30 w-56 pt-2">
                <div className="rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
                  <div className="mb-1 border-b border-border px-3 py-2">
                    <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                    <p className="text-xs font-medium text-muted-foreground">{ROLE_LABELS[session.user.role]}</p>
                  </div>
                  <Link href="/dashboard/profile" className={POPOVER_ITEM}>
                    <UserCircle size={14} />
                    My Profile
                  </Link>
                  {(session.user.role === "admin" || session.user.role === "staff") && (
                    <Link href="/admin" className={POPOVER_ITEM}>
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
                    className={`${POPOVER_ITEM} w-full hover:text-destructive`}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/auth/signin"
            className="hidden shrink-0 items-center justify-center rounded-full bg-white px-5 py-3 text-[15px] font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow lg:inline-flex"
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
              className="ml-auto text-white hover:bg-white/10 hover:text-white focus-visible:border-white focus-visible:ring-white/50 lg:hidden"
            >
              <Menu aria-hidden="true" className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {NAV_ITEMS_BEFORE.map((item) => (
              <DropdownMenuItem
                key={item.label}
                asChild
                className={`min-h-10 text-[15px] ${isActive(pathname, item.href) ? MENU_ACTIVE : "font-medium"}`}
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
                className={`min-h-10 text-[15px] ${isActive(pathname, item.href) ? MENU_ACTIVE : "font-medium"}`}
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
                  <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                  <p className="text-xs font-medium text-muted-foreground">{ROLE_LABELS[session.user.role]}</p>
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
      </div>
    </header>
  );
}
