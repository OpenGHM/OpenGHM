"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DetailSection } from "@/components/repository/detail-section";
import { Button } from "@/components/ui/button";

/**
 * The Download section when its links could not be had (the backend or the
 * bucket listing failed): the page still renders, and this says why the
 * section is empty instead of leaving it out. "Try again" re-renders the
 * page's server components, which asks for the links once more.
 */
export function DownloadUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <DetailSection title="Download">
      <div role="alert" className="flex flex-col gap-3 rounded-[14px] border border-destructive/25 bg-background p-5">
        <p className="font-medium text-status-failed">Downloads are unavailable right now</p>
        <p className="text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
          The gateway could not get the download links. The rest of this page is unaffected; try again in a moment.
        </p>
        <Button
          variant="outline"
          className="min-h-10 self-start"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          {pending ? "Trying again…" : "Try again"}
        </Button>
      </div>
    </DetailSection>
  );
}
