import Link from "next/link";
import { WhenWorkspace } from "@/components/site-features";
import { Button } from "@/components/ui/button";
import { ComingSoonChip } from "@/components/ui/coming-soon-chip";

/**
 * Home's "Open Workspace" button, on the navy band. While the Workspace is off
 * (lib/features.ts) it is a disabled button marked Coming soon.
 */
export function OpenWorkspaceButton() {
  return (
    <WhenWorkspace
      off={
        <Button variant="on-dark" size="xl" disabled className="disabled:opacity-100">
          <span className="opacity-60">Open Workspace</span>
          <ComingSoonChip tone="dark" />
        </Button>
      }
    >
      <Button asChild variant="on-dark" size="xl">
        <Link href="/workspace">Open Workspace</Link>
      </Button>
    </WhenWorkspace>
  );
}
