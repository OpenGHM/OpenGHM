import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import { MY_DATA_PATH } from "@/lib/workspace/my-data";

export type WorkspaceSection = "drafts" | "data";

/** The Workspace's sections, in the order the header shows them. */
export const WORKSPACE_SECTIONS: readonly { id: WorkspaceSection; label: string; href: string }[] = [
  { id: "drafts", label: "Snapshot drafts", href: "/workspace" },
  { id: "data", label: "Snapshots & Inputs", href: MY_DATA_PATH },
];

/**
 * The switch between the Workspace's sections, drawn as the site header's pill
 * on the navy band: the current section is the white segment. Links, not tabs:
 * each section is its own page, and `aria-current` marks the one you are on.
 * Every target is 40 px tall, and the two labels fit a 375 px screen.
 */
export function WorkspaceSections({ active }: { active: WorkspaceSection }) {
  return (
    <nav aria-label="Workspace sections" className="max-w-full">
      <ul className="flex w-fit max-w-full gap-0.5 rounded-full border border-white/10 bg-white/6 p-[5px]">
        {WORKSPACE_SECTIONS.map((section) => {
          const selected = section.id === active;
          return (
            <li key={section.id} className="min-w-0">
              <Link
                href={section.href}
                aria-current={selected ? "page" : undefined}
                className={`relative flex min-h-10 items-center rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-hero-eyebrow focus-visible:outline-none sm:px-5 ${
                  selected
                    ? "bg-white font-[550] text-foreground"
                    : "text-hero-foreground-muted hover:bg-white/8 hover:text-white"
                }`}
              >
                {section.label}
                <LinkPending className="top-1 right-1 size-3.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
