import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceSections, type WorkspaceSection } from "./workspace-sections";

/** What each section says about itself; only Simulations has an action. */
const COPY: Record<WorkspaceSection, { eyebrow: string; title: string; subtitle: string }> = {
  simulations: {
    eyebrow: "Workspace · Private & unpublished",
    title: "My Simulations",
    subtitle:
      "Working configurations only you can see. Nothing here is a published model snapshot.",
  },
  data: {
    eyebrow: "Workspace · Immutable records",
    title: "My Snapshots & Inputs",
    subtitle:
      "Snapshots and model inputs you published. Their contents never change, and a correction is a new version; visibility decides who can find them.",
  },
};

/**
 * The gradient hero both Workspace sections share: eyebrow, title, subtitle,
 * the section's action if it has one, and the section switch on the bottom
 * edge.
 */
export function WorkspaceHero({ section }: { section: WorkspaceSection }) {
  const { eyebrow, title, subtitle } = COPY[section];
  return (
    <div className="bg-gradient-to-br from-hero to-primary px-4 pt-8 sm:px-6 sm:pt-12 lg:px-10">
      <div className="mx-auto max-w-[1024px]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-white/60 uppercase tracking-wider">
              {eyebrow}
            </p>
            <h1 className="text-3xl font-bold text-white">{title}</h1>
            <p className="mt-2 text-sm text-white/70">{subtitle}</p>
          </div>
          {section === "simulations" && (
            <Button
              asChild
              className="min-h-10 w-fit shrink-0 bg-white text-primary hover:bg-white/90 font-semibold"
            >
              <Link href="/workspace/new">
                <Plus className="mr-1.5 size-4" />
                New Simulation
              </Link>
            </Button>
          )}
        </div>
        <div className="mt-6 sm:mt-8">
          <WorkspaceSections active={section} />
        </div>
      </div>
    </div>
  );
}
