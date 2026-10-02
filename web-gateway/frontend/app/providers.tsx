"use client";

import { SessionProvider } from "next-auth/react";
import { NavigationProgress } from "@/components/navigation-progress";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NavigationProgress />
      {children}
      <Toaster position="top-center" richColors />
    </SessionProvider>
  );
}
