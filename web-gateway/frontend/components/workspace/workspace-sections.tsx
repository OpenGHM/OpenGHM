import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import { MY_DATA_PATH } from "@/lib/workspace/my-data";

export type WorkspaceSection = "simulations" | "data";

/** The Workspace's sections, in the order the hero shows them. */
export const WORKSPACE_SECTIONS: readonly { id: WorkspaceSection; label: string; href: string }[] = [
  { id: "simulations", label: "Simulations", href: "/workspace" },
  { id: "data", label: "Snapshots & Inputs", href: MY_DATA_PATH },
];

/**
 * The switch between the Workspace's sections, drawn as an underlined tab row
 * for the bottom edge of the hero (white on the gradient). Links, not tabs:
 * each section is its own page, and `aria-current` marks the one you are on.
 * Every target is 40 px tall, and the two labels fit a 375 px screen.
 */
export function WorkspaceSections({ active }: { active: WorkspaceSection }) {
  return (
    <nav aria-label="Workspace sections" className="border-b border-white/20">
      <ul className="flex gap-1">
        {WORKSPACE_SECTIONS.map((section) => {
          const selected = section.id === active;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={selected ? "page" : undefined}
                className={`relative -mb-px flex min-h-10 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset sm:px-4 ${
                  selected
                    ? "border-white text-white"
                    : "border-transparent text-white/70 hover:text-white"
                }`}
              >
                {section.label}
                <LinkPending className="top-0 right-0 size-3.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
