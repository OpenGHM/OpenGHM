import Image from "next/image";
import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { Header } from "@/components/landing/header";
import { cn } from "@/lib/utils";

export interface HeroBreadcrumbItem {
  label: string;
  /** Omit on the last item, which is the current page and is not a link. */
  href?: string;
}

export interface PageHeroProps {
  /** The h1. Plain text or inline markup. */
  title: ReactNode;
  /**
   * `display` (default) is the big title of Home, About and the Repository,
   * clamp(40px, 6vw, 72px). `page` is the smaller one of a detail or workspace
   * page, clamp(28px, 3.4vw, 44px), with the title block closer to the header.
   */
  size?: "display" | "page";
  /** The mono label above the title; the small dot is drawn for you. */
  eyebrow?: ReactNode;
  /** The muted line under the title. */
  subtitle?: ReactNode;
  /** A trail above the title, e.g. [{ label: "Data Repository", href: "/repository" }, { label: title }]. */
  breadcrumb?: HeroBreadcrumbItem[];
  /** Buttons under the title. Use `<Button variant="on-dark">` for the secondary one. */
  actions?: ReactNode;
  /** Anything else in the band (a search box, chips, a timeline), under the actions. */
  children?: ReactNode;
  /** A photo behind the band, darkened by a left-to-right navy gradient (as on Home). */
  backgroundImage?: { src: string; alt?: string };
  /** The soft light in the top-right corner. Default true. */
  glow?: boolean;
  /**
   * Whether the band leaves room for `PageBody` to overlap its bottom edge
   * (120 px of padding). Set false for a band with nothing pulled up into it.
   * Default true.
   */
  overlap?: boolean;
  /** Extra classes for the inner column (e.g. `pt-24` for a taller Home band). */
  contentClassName?: string;
  className?: string;
}

/**
 * The navy band at the top of a page: the site `Header`, then an optional
 * breadcrumb, eyebrow, title, subtitle, actions and any children. It is
 * a server component and carries its own Header, so a page using it does not
 * render `<Header />` itself.
 *
 * Content that follows the band goes in `PageBody`, which pulls it up 72 px so
 * the first white card starts inside the band, as in the design:
 *
 * ```tsx
 * <PageHero
 *   eyebrow="Data Repository"
 *   title="Data Repository"
 *   subtitle="Model snapshots and inputs shared by the OpenGHM community"
 * >
 *   <SearchBox />
 * </PageHero>
 * <PageBody>
 *   <Card>...</Card>
 * </PageBody>
 * <Footer />
 * ```
 *
 * A detail page uses `size="page"` with a `breadcrumb`. A page with no band at
 * all uses `<Header />` (its default `variant="standalone"` is a navy bar).
 */
export function PageHero({
  title,
  size = "display",
  eyebrow,
  subtitle,
  breadcrumb,
  actions,
  children,
  backgroundImage,
  glow = true,
  overlap = true,
  contentClassName,
  className,
}: PageHeroProps) {
  const isDisplay = size === "display";
  return (
    <div
      className={cn(
        "relative overflow-clip bg-hero text-hero-foreground",
        overlap ? "pb-[120px]" : "pb-14",
        className,
      )}
    >
      {backgroundImage && (
        <>
          <Image
            src={backgroundImage.src}
            alt={backgroundImage.alt ?? ""}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-45"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#0b2a3d_0%,rgba(11,42,61,0.85)_45%,rgba(11,42,61,0.35)_100%)]"
          />
        </>
      )}
      <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
      {glow && (
        <div
          aria-hidden="true"
          className="hero-glow pointer-events-none absolute -top-[220px] -right-[160px] size-[620px] rounded-full"
        />
      )}

      <Header variant="overlay" />

      <div
        className={cn(
          "relative mx-auto flex w-full max-w-[1360px] flex-col px-4 sm:px-7",
          isDisplay ? "gap-7 pt-12 lg:pt-16" : "gap-[22px] pt-6 lg:pt-10",
          contentClassName,
        )}
      >
        {breadcrumb && breadcrumb.length > 0 && <HeroBreadcrumb items={breadcrumb} />}
        {eyebrow && (
          <p className="flex items-center gap-2.5 font-mono text-xs tracking-[0.06em] text-hero-eyebrow uppercase">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-hero-eyebrow shadow-[0_0_0_4px_rgba(159,211,230,0.2)]"
            />
            {eyebrow}
          </p>
        )}
        <h1
          className={cn(
            "font-bold text-white",
            isDisplay
              ? "max-w-[880px] text-[clamp(40px,6vw,72px)] leading-[0.98] tracking-[-0.045em] text-balance"
              : "max-w-[1040px] text-[clamp(28px,3.4vw,44px)] leading-[1.12] tracking-[-0.035em] text-pretty",
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className={cn(
              "max-w-[640px] leading-[1.55] text-hero-foreground-muted text-pretty",
              isDisplay ? "text-base sm:text-[19px]" : "text-base sm:text-[17px]",
            )}
          >
            {subtitle}
          </p>
        )}
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
        {children}
      </div>
    </div>
  );
}

function HeroBreadcrumb({ items }: { items: HeroBreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-[13.5px]">
      <ol className="flex min-w-0 items-center gap-2">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className={cn("flex items-center gap-2", last && "min-w-0")}>
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="shrink-0 text-hero-foreground-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className="truncate text-[#9fb3c0]"
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-[#5f7a8b]">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The page content under a `PageHero`: centred, 1360 px at most with 28 px
 * side padding (16 px on a phone), and pulled 72 px up into the band so the
 * first card overlaps it. Renders `<main>` unless `as` says otherwise.
 *
 * - `overlap` (default true): the pull-up. Pair it with the hero's `overlap`;
 *   set both false for a body that starts below the band.
 * - `as`: `"div"` or `"section"` where the page already has a `<main>`.
 */
export function PageBody({
  children,
  overlap = true,
  as,
  className,
}: {
  children: ReactNode;
  overlap?: boolean;
  as?: ElementType;
  className?: string;
}) {
  const Comp = as ?? "main";
  return (
    <Comp
      className={cn(
        "relative mx-auto w-full max-w-[1360px] px-4 pb-24 sm:px-7",
        overlap ? "-mt-[72px]" : "pt-8",
        className,
      )}
    >
      {children}
    </Comp>
  );
}
