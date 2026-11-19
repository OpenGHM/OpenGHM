"use client";

import { SessionProvider } from "next-auth/react";
import { DownloadProvider } from "@/components/download/download-provider";
import { NavigationProgress } from "@/components/navigation-progress";
import { SiteFeaturesProvider } from "@/components/site-features";
import { Toaster } from "@/components/ui/sonner";
import type { SiteFeatures } from "@/lib/features";

export function Providers({ features, children }: { features: SiteFeatures; children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SiteFeaturesProvider features={features}>
        <NavigationProgress />
        <DownloadProvider>{children}</DownloadProvider>
        <Toaster position="top-center" />
      </SiteFeaturesProvider>
    </SessionProvider>
  );
}
