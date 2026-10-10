import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import { COMMUNITY_TABS, tabHref, type CommunityTab } from "@/lib/community/format";

/**
 * The switch between the Community page's sections, drawn on the navy band as
 * the Workspace's section switch is: a translucent track of rounded segments,
 * the current one white. Links, not tabs: each is the same page with `?tab=`
 * (All is the bare address), so a shared link opens the same section, and
 * `aria-current` marks the one you are on. Every target is 40 px tall and the
 * row wraps on a phone.
 */
export function CommunityTabs({ active, showGroups }: { active: CommunityTab; showGroups: boolean }) {
  const tabs = COMMUNITY_TABS.filter((t) => t.id !== "groups" || showGroups);
  return (
    <nav aria-label="Community sections" className="max-w-full">
      <ul className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-[14px] border border-white/12 bg-white/6 p-1">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <li key={tab.id} className="min-w-0">
              <Link
                href={tabHref(tab.id)}
                scroll={false}
                aria-current={selected ? "page" : undefined}
                className={`relative flex min-h-10 items-center rounded-[10px] px-3.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-hero-eyebrow focus-visible:outline-none sm:px-4 ${
                  selected
                    ? "bg-white font-semibold text-foreground"
                    : "text-hero-foreground-muted hover:bg-white/8 hover:text-white"
                }`}
              >
                {tab.label}
                <LinkPending className="top-1 right-1 size-3.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
