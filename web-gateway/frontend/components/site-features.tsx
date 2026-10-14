"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SiteFeatures } from "@/lib/features";

const SiteFeaturesContext = createContext<SiteFeatures>({ workspace: true });

/** Hands the root layout's `siteFeatures()` to every client component below it. */
export function SiteFeaturesProvider({ features, children }: { features: SiteFeatures; children: ReactNode }) {
  return <SiteFeaturesContext.Provider value={features}>{children}</SiteFeaturesContext.Provider>;
}

export function useSiteFeatures(): SiteFeatures {
  return useContext(SiteFeaturesContext);
}

/**
 * `children` while the Workspace is on, else `off`: a server component (the
 * home page's buttons, a snapshot's Run button) places a way into the Workspace
 * without reading the setting itself.
 */
export function WhenWorkspace({ children, off }: { children: ReactNode; off: ReactNode }) {
  return useSiteFeatures().workspace ? children : off;
}
