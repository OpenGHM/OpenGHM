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
 * The switch between the Workspace's sections, drawn as an underlined tab row
 * on the header's bottom edge. Links, not tabs: each section is its own page,
 * and `aria-current` marks the one you are on. Every target is 40 px tall, and
 * the two labels fit a 375 px screen.
 */
export function WorkspaceSections({ active }: { active: WorkspaceSection }) {
  return (
    <nav aria-label="Workspace sections" className="border-b">
      <ul className="flex gap-6">
        {WORKSPACE_SECTIONS.map((section) => {
          const selected = section.id === active;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={selected ? "page" : undefined}
                className={`relative -mb-px flex min-h-10 items-center border-b-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  selected
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {section.label}
                <LinkPending className="top-1 -right-4 size-3.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
