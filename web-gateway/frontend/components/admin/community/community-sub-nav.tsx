"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const COMMUNITY_SECTIONS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/admin/community", label: "Overview", exact: true },
  { href: "/admin/community/workshops", label: "Workshops" },
  { href: "/admin/community/tutorials", label: "Tutorials" },
  { href: "/admin/community/publications", label: "Publications" },
  { href: "/admin/community/settings", label: "Page settings" },
  { href: "/admin/community/files", label: "Files" },
];

/**
 * The sections of the Community admin as a row of pills, in the language of the
 * audit log's category tabs. The row scrolls inside its own strip, so six
 * items fit a phone without the page scrolling sideways.
 */
export function CommunitySubNav() {
  // usePathname() is null outside the app router (a test).
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Community sections" className="flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {COMMUNITY_SECTIONS.map((section) => {
        const active = section.exact
          ? pathname === section.href
          : pathname === section.href || pathname.startsWith(`${section.href}/`);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center rounded-full px-4 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-0",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border bg-card text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
