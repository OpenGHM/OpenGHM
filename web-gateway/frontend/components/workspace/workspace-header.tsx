import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/page-header";
import { WorkspaceSections, type WorkspaceSection } from "./workspace-sections";

/** What each section calls itself and says about itself; only Snapshot drafts has an action. */
const COPY: Record<WorkspaceSection, { title: string; subtitle: string }> = {
  drafts: {
    title: "Snapshot drafts",
    subtitle: "Run a model snapshot with your own settings on Anvil, then publish the results to the Data Repository.",
  },
  data: {
    title: "Snapshots & Inputs",
    subtitle: "What you published. Contents never change; a correction is a new version.",
  },
};

/**
 * The navy band both Workspace sections share: eyebrow, title, one muted line
 * under it, and on the band's bottom edge the section switch with, for
 * Snapshot drafts, its one action beside it. From `xl` the switch and the
 * action sit at the band's right edge, level with the line under the title (the
 * band's column is `relative`, and they are laid over it); below `xl` they are
 * a row under the line.
 */
export function WorkspaceHeader({ section }: { section: WorkspaceSection }) {
  const { title, subtitle } = COPY[section];
  return (
    <PageHeader eyebrow="Workspace" title={title} meta={subtitle}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-4 xl:absolute xl:right-7 xl:bottom-0 xl:justify-end">
        <WorkspaceSections active={section} />
        {section === "drafts" && (
          <Button asChild size="xl" className="shrink-0 shadow-float">
            <Link href="/workspace/new">
              <Plus aria-hidden="true" />
              New snapshot
            </Link>
          </Button>
        )}
      </div>
    </PageHeader>
  );
}
