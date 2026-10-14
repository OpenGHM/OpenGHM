"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

const MESSAGES = {
  connected: () => toast.success("CILogon connected. You can now sign in with it."),
  conflict: () =>
    toast.error("That CILogon identity is already connected to another OpenGHM account."),
  failed: () => toast.error("Couldn't connect CILogon. Please try again."),
} as const;

/**
 * Says how connecting CILogon went. The CILogon callback sends the browser back
 * to the profile with `?sso=connected|conflict|failed` (lib/auth.ts); this
 * toasts it once and drops the parameter, so a reload does not toast again.
 */
export function SsoResultToast({ result }: { result: string | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  // Effects run twice in development; one result is one toast.
  const shown = useRef(false);

  useEffect(() => {
    if (!result || !(result in MESSAGES) || shown.current) return;
    shown.current = true;
    MESSAGES[result as keyof typeof MESSAGES]();
    router.replace(pathname, { scroll: false });
  }, [result, router, pathname]);

  return null;
}
