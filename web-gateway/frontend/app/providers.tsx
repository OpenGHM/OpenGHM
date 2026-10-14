"use client";

import { SessionProvider } from "next-auth/react";
import { NavigationProgress } from "@/components/navigation-progress";
import { SiteFeaturesProvider } from "@/components/site-features";
import { Toaster } from "@/components/ui/sonner";
import type { SiteFeatures } from "@/lib/features";

export function Providers({ features, children }: { features: SiteFeatures; children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SiteFeaturesProvider features={features}>
        <NavigationProgress />
        {children}
        <Toaster position="top-center" richColors />
      </SiteFeaturesProvider>
    </SessionProvider>
  );
}
