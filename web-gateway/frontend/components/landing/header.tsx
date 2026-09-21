"use client";

import Link from "next/link";
import Image from "next/image";
import { ChevronDown, LogOut, UserCircle, ShieldCheck } from "lucide-react";
import { useState, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import type { UserRole } from "@/lib/auth.types";
import { revokeSession } from "@/lib/auth-actions";
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

export function Header() {
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const resourcesTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: session } = useSession();

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
    <header className="sticky top-0 z-50 flex items-center justify-between bg-white px-10 py-4 border-b border-black/5">
      <Link href="/">
        <Image
          src="/images/logo_light4.webp"
          alt="OpenGHM Logo"
          width={180}
          height={48}
          className="h-12 w-auto"
          priority
        />
      </Link>

      <nav className="flex gap-8 items-center">
        {NAV_ITEMS_BEFORE.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="text-[15px] font-medium text-slate-700 transition-colors hover:text-primary"
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
          <button className="flex items-center gap-1 text-[15px] font-medium text-slate-700 transition-colors hover:text-primary">
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
            className="text-[15px] font-medium text-slate-700 transition-colors hover:text-primary"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Auth section */}
      {session?.user ? (
        <div
          className="relative"
          onMouseEnter={handleUserMenuEnter}
          onMouseLeave={handleUserMenuLeave}
        >
          <button className="flex items-center gap-2 rounded-md border border-black/10 pl-1.5 pr-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            <UserAvatar name={session.user.name} email={session.user.email} />
            <span className="max-w-[120px] truncate">{session.user.name ?? session.user.email}</span>
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
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
        >
          Sign In
        </Link>
      )}
    </header>
  );
}
