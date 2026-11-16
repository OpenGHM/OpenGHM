import { DetailSection } from "@/components/repository/detail-section";
import { Skeleton } from "@/components/ui/skeleton";

/** What the Output card shows before it can read the URL it keeps its view in. */
export function OutputSkeleton() {
  return (
    <DetailSection title="Output">
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-[460px] w-full rounded-xl" />
      </div>
    </DetailSection>
  );
}
