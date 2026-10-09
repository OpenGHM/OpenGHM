import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/page-header";
import { WorkspaceSections, type WorkspaceSection } from "./workspace-sections";

/** What each section calls itself; only Snapshot drafts has an action, and only Snapshots & Inputs a line of explanation. */
const COPY: Record<WorkspaceSection, { title: string; subtitle?: string }> = {
  drafts: { title: "Snapshot drafts" },
  data: {
    title: "Snapshots & Inputs",
    subtitle: "What you published. Contents never change; a correction is a new version.",
  },
};

/**
 * The navy band both Workspace sections share: eyebrow, title, one muted line
 * under it (Snapshots & Inputs), and on the band's bottom edge the section switch
 * with, for Snapshot drafts, its one action beside it.
 */
export function WorkspaceHeader({ section }: { section: WorkspaceSection }) {
  const { title, subtitle } = COPY[section];
  return (
    <PageHeader eyebrow="Workspace" title={title} meta={subtitle}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <WorkspaceSections active={section} />
        {section === "drafts" && (
          <Button asChild size="xl" className="shrink-0">
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
