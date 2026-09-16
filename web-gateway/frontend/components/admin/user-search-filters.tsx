"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

const ROLE_TABS = [
  { label: "All roles", value: undefined },
  { label: "Admin", value: "admin" },
  { label: "Staff", value: "staff" },
  { label: "User", value: "user" },
  { label: "Guest", value: "guest" },
];

const STATUS_TABS = [
  { label: "All", value: undefined },
  { label: "Active", value: "true" },
  { label: "Deactivated", value: "false" },
];

export function UserSearchFilters({
  initialQuery,
  role,
  status,
}: {
  initialQuery?: string;
  role?: string;
  status?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    startTransition(() => {
      router.replace(`/admin/users?${params.toString()}`);
    });
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ q: query || undefined });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on query change; pushParams reads fresh searchParams each call.
  }, [query]);

  const hasFilters = Boolean(initialQuery || role || status);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ROLE_TABS.map((tab) => (
          <FilterPill
            key={tab.label}
            label={tab.label}
            isActive={role === tab.value || (!role && tab.value === undefined)}
            onClick={() => pushParams({ role: tab.value })}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {STATUS_TABS.map((tab) => (
          <FilterPill
            key={tab.label}
            label={tab.label}
            isActive={status === tab.value || (!status && tab.value === undefined)}
            onClick={() => pushParams({ is_active: tab.value })}
          />
        ))}
        {hasFilters && (
          <Link
            href="/admin/users"
            className="ml-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <X className="size-3" />
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        isActive ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}
