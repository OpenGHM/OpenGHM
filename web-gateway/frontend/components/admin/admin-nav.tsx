"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Cpu, ScrollText, ServerCog } from "lucide-react";
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
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/system", label: "System", icon: ServerCog, adminOnly: true },
];

export function AdminNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");

  return (
    <>
      {/* Desktop: full-height sidebar. Sticky offset (81px) matches the
          Header's actual rendered height (px-10 py-4 padding + h-12 logo +
          1px border) — if header.tsx's padding changes, this needs to too. */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar sticky top-[81px] h-[calc(100vh-81px)] overflow-y-auto">
        <div className="px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/50">
            Console
          </p>
          <p className="text-sm font-medium text-sidebar-foreground">
            {role === "admin" ? "Admin" : "Staff (read-only)"}
          </p>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
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
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile: horizontally scrollable pill row above the content. */}
      <nav className="flex md:hidden gap-2 overflow-x-auto border-b border-sidebar-border bg-sidebar px-4 py-2">
        {items.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
