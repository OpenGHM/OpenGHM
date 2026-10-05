import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow, PageHeader } from "@/components/workspace/page-header";
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
 * The header both Workspace sections share, in the Data Repository's light
 * style: eyebrow, title, the section's action or one muted line on the right,
 * and the section switch on the bottom edge.
 */
export function WorkspaceHeader({ section }: { section: WorkspaceSection }) {
  const { title, subtitle } = COPY[section];
  return (
    <PageHeader
      top={<Eyebrow>Workspace</Eyebrow>}
      title={title}
      aside={
        section === "drafts" ? (
          <Button asChild className="min-h-10 w-fit shrink-0 font-semibold">
            <Link href="/workspace/new">
              <Plus aria-hidden="true" />
              New snapshot
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )
      }
    >
      <div className="mt-6 sm:mt-7">
        <WorkspaceSections active={section} />
      </div>
    </PageHeader>
  );
}
