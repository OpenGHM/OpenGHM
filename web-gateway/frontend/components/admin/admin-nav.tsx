"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Cpu, ScrollText, ServerCog, Newspaper } from "lucide-react";
import type { UserRole } from "@/lib/auth.types";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/jobs", label: "Jobs", icon: Cpu },
  { href: "/admin/community", label: "Community", icon: Newspaper, adminOnly: true },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/system", label: "System", icon: ServerCog, adminOnly: true },
];

const RoleContext = createContext<UserRole | null>(null);

/**
 * Hands the signed-in role (read by the admin layout on the server) to the nav
 * inside every page's band, so the nav needs no session fetch of its own and
 * does not flash the admin-only items in or out.
 */
export function AdminRoleProvider({ role, children }: { role: UserRole; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/**
 * The admin sections as a pill row for the navy band, in the header's pill
 * language. It scrolls inside its own strip, never the page, so six items
 * fit a phone.
 */
export function AdminNav() {
  // usePathname() is null outside the app router (a test, a pages-router render).
  const pathname = usePathname() ?? "";
  const role = useContext(RoleContext);
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
      <nav
        aria-label="Admin"
        className="flex max-w-full gap-0.5 overflow-x-auto rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border border-white/10 bg-white/6 p-[5px] backdrop-blur-sm"
      >
        {items.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow ${
                isActive
                  ? "bg-white font-[550] text-foreground"
                  : "text-hero-foreground-muted hover:bg-white/8 hover:text-white"
              }`}
            >
              <Icon size={15} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {role === "staff" && (
        <span className="font-mono text-xs tracking-[0.06em] text-hero-eyebrow uppercase">
          Staff (read-only)
        </span>
      )}
    </div>
  );
}
