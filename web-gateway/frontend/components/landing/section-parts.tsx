import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The mono label above a section title. `tone="dark"` is for a navy panel. */
export function SectionEyebrow({
  children,
  tone = "light",
  className,
}: {
  children: ReactNode;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-xs tracking-[0.06em] uppercase",
        tone === "dark" ? "text-hero-eyebrow" : "text-primary",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** The h2 of a Home or About section. */
export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-[clamp(32px,4vw,46px)] leading-[1.05] font-bold tracking-[-0.035em] text-balance",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/**
 * The dotted texture of a navy panel: 1 px dots every 22 px. Put it first in a
 * `relative overflow-hidden` panel; `fade` thins it out to the right.
 */
export function PanelDots({ alpha, fade = false }: { alpha: number; fade?: boolean }) {
  const style: CSSProperties = {
    backgroundImage: `radial-gradient(color-mix(in srgb, var(--hero-foreground) ${alpha * 100}%, transparent) 1px, transparent 1px)`,
    backgroundSize: "22px 22px",
    ...(fade && {
      maskImage: "linear-gradient(90deg, black, transparent 70%)",
      WebkitMaskImage: "linear-gradient(90deg, black, transparent 70%)",
    }),
  };
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={style} />;
}
