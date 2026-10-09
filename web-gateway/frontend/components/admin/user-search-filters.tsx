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
      <div className="relative sm:max-w-sm">
        <Search
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search users by name or email"
          className="pl-9 max-sm:h-10"
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
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
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
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground max-sm:min-h-10 sm:ml-2"
          >
            <X className="size-3" aria-hidden="true" />
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
      aria-pressed={isActive}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:min-h-10 max-sm:px-4 ${
        isActive
          ? "bg-primary text-primary-foreground shadow-sm"
          : "border bg-card text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
      }`}
    >
      {label}
    </button>
  );
}
