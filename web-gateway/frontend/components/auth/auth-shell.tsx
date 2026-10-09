import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The page every /auth route is: the navy band with its dot texture and glow
 * filling the viewport, the white logo at the top, and the form in one white
 * card. `eyebrow` is the mono label over the title; `backToHome` adds the way
 * out under the card for the two pages a visitor opens from the header.
 */
export function AuthShell({
  eyebrow,
  title,
  description,
  backToHome = false,
  children,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  backToHome?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-clip bg-hero px-3 pt-8 pb-12 sm:px-4 text-hero-foreground sm:pt-12">
      <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute -top-[220px] -right-[160px] size-[620px] rounded-full"
      />

      <Link
        href="/"
        className="relative rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
      >
        <Image
          src="/images/logo_dark_new.webp"
          alt="OpenGHM Logo"
          width={400}
          height={147}
          className="h-14 w-auto sm:h-16"
          priority
        />
      </Link>

      <div className="relative mt-8 w-full max-w-[440px] sm:mt-10">
        <div className="rounded-panel bg-card p-5 text-card-foreground shadow-raised sm:p-8">
          <p className="flex items-center gap-2.5 font-mono text-xs tracking-[0.06em] text-primary uppercase">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" />
            {eyebrow}
          </p>
          <h1 className="mt-4 text-[26px] leading-[1.15] font-bold tracking-[-0.03em] text-balance">{title}</h1>
          <p className="mt-2 text-sm leading-[1.55] text-muted-foreground text-pretty">{description}</p>
          <div className="mt-6">{children}</div>
        </div>
        {backToHome && (
          <Link
            href="/"
            className="mt-5 inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm text-hero-foreground-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
          >
            ← Back to home
          </Link>
        )}
      </div>
    </main>
  );
}

const NOTICE_TONES = {
  success: "border-success/25 bg-success/10 text-success",
  neutral: "border-border bg-muted text-foreground",
} as const;

/** A short result message inside the card: a confirmation, or what to do next. */
export function AuthNotice({
  tone,
  children,
  className,
}: {
  tone: keyof typeof NOTICE_TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("rounded-xl border px-3.5 py-3 text-sm leading-[1.55]", NOTICE_TONES[tone], className)}>
      {children}
    </p>
  );
}
