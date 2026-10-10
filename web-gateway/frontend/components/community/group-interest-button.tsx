"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setGroupInterest } from "@/lib/community/actions";
import { signInPath } from "@/lib/auth-redirect";
import { cn } from "@/lib/utils";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[13px] bg-white px-5 py-3 text-[14.5px] font-semibold text-secondary-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-hero-eyebrow focus-visible:outline-none disabled:opacity-70";

/**
 * "Notify me when groups open". Signed out it is a link to sign in that comes
 * back to this page. Signed in it records the interest (and, pressed again,
 * withdraws it) through the `setGroupInterest` server action; the label
 * switches at once and goes back with a toast if the call fails. The button
 * is the only part of the groups preview that is real.
 */
export function GroupInterestButton({
  signedIn,
  interested,
  here,
}: {
  signedIn: boolean;
  interested: boolean;
  /** This page's path and query, for the sign-in link to return to. */
  here: string;
}) {
  const [on, setOn] = useState(interested);
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Link href={signInPath(here)} className={BUTTON}>
        Notify me when groups open
      </Link>
    );
  }

  function toggle() {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const result = await setGroupInterest(next);
      if (result.ok) return;
      setOn(!next);
      toast.error(
        result.reason === "session_expired"
          ? "Your session has expired. Sign in again to be notified."
          : result.reason === "error"
            ? result.message
            : "Could not save this. Try again in a moment.",
      );
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={on ? "Press to stop emails about groups" : undefined}
        className={cn(BUTTON, on && "text-success")}
      >
        {pending && <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />}
        {on ? "We will email you ✓" : "Notify me when groups open"}
      </button>
      <p role="status" className="sr-only">
        {on ? "You will get an email when groups open." : ""}
      </p>
    </>
  );
}
