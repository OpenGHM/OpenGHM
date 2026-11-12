import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { WhenRepository } from "@/components/site-features";
import { Button } from "@/components/ui/button";
import { ComingSoonChip } from "@/components/ui/coming-soon-chip";

/**
 * Home's "Explore Data Repository" button, on the navy band. While the Data
 * Repository is off (lib/features.ts) it is a disabled button marked Coming soon.
 */
export function ExploreRepositoryButton({ className }: { className?: string }) {
  return (
    <WhenRepository
      off={
        <Button variant="on-dark" size="xl" disabled className="disabled:opacity-100">
          <span className="opacity-60">Explore Data Repository</span>
          <ComingSoonChip tone="dark" />
        </Button>
      }
    >
      <Button asChild size="xl" className={className}>
        <Link href="/repository">
          Explore Data Repository
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </WhenRepository>
  );
}
