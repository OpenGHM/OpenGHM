"use client";

import { createContext, useContext, useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Cpu,
  FileStack,
  Globe,
  LayoutDashboard,
  Newspaper,
  ScrollText,
  ServerCog,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/auth.types";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Current only on this exact path; otherwise it is current on every path below it too. */
  exact?: boolean;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  /** A group staff must not see at all (the Community admin needs `content:manage`). */
  adminOnly?: boolean;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Console",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/jobs", label: "Jobs", icon: Cpu },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText },
      { href: "/admin/system", label: "System", icon: ServerCog, adminOnly: true },
    ],
  },
  {
    label: "Community",
    adminOnly: true,
    items: [
      { href: "/admin/community", label: "Overview", icon: Globe, exact: true },
      { href: "/admin/community/workshops", label: "Workshops", icon: CalendarDays },
      { href: "/admin/community/tutorials", label: "Tutorials", icon: BookOpen },
      { href: "/admin/community/publications", label: "Publications", icon: Newspaper },
      { href: "/admin/community/settings", label: "Page settings", icon: Settings2 },
      { href: "/admin/community/files", label: "Files", icon: FileStack },
    ],
  },
];

function isCurrent(item: NavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The groups and items a role may see; an empty group is dropped. */
function visibleGroups(role: UserRole | null): NavGroup[] {
  const isAdmin = role === "admin";
  return NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin)
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.adminOnly || isAdmin) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The name of the section a path belongs to ("Users", "Community · Workshops"),
 * for the phone top bar. A path that is in no group (the console's own error or
 * not-found page) is just "Admin console".
 */
export function currentSectionLabel(pathname: string): string {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => isCurrent(candidate, pathname));
    if (item) return group.label === "Console" ? item.label : `${group.label} · ${item.label}`;
  }
  return "Admin console";
}

/** Who is signed in, read by the admin layout on the server. */
export interface AdminUser {
  role: UserRole;
  name?: string | null;
  email?: string | null;
}

const UserContext = createContext<AdminUser | null>(null);

/**
 * Hands the signed-in user (read by the admin layout on the server) to the
 * sidebar, so it needs no session fetch of its own and does not flash the
 * admin-only items in or out.
 */
export function AdminRoleProvider({
  role,
  name,
  email,
  children,
}: AdminUser & { children: React.ReactNode }) {
  return <UserContext.Provider value={{ role, name, email }}>{children}</UserContext.Provider>;
}

/** The signed-in user, or null outside the provider (a test). */
export function useAdminUser(): AdminUser | null {
  return useContext(UserContext);
}

const ITEM_BASE =
  "relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow";

/**
 * The console's sections in groups, for the navy sidebar (and the sheet that
 * holds it on a phone). The current item has a lighter fill and a teal edge;
 * `onNavigate` lets the sheet close when a link is followed.
 */
export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  // usePathname() is null outside the app router (a test, a pages-router render).
  const pathname = usePathname() ?? "";
  const role = useAdminUser()?.role ?? null;
  const labelPrefix = useId();

  return (
    <nav aria-label="Admin" className="space-y-6">
      {visibleGroups(role).map((group) => {
        const labelId = `${labelPrefix}-${group.label}`;
        return (
          <div key={group.label} role="group" aria-labelledby={labelId}>
            <p
              id={labelId}
              className="mb-2 px-3 font-mono text-[11px] tracking-[0.08em] text-hero-faint uppercase"
            >
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isCurrent(item, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        ITEM_BASE,
                        active
                          ? "bg-white/10 font-[550] text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-hero-eyebrow"
                          : "text-hero-foreground-muted hover:bg-white/8 hover:text-white"
                      )}
                    >
                      <Icon
                        size={16}
                        aria-hidden="true"
                        className={cn("shrink-0", active && "text-hero-eyebrow")}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
