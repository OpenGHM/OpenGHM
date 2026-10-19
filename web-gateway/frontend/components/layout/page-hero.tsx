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
  /** The mono label above the title; the small dot is drawn for you. */
  eyebrow?: ReactNode;
  /** The muted line under the title. */
  subtitle?: ReactNode;
  /** A trail above the title, e.g. [{ label: "Data Repository", href: "/repository" }, { label: title }]. */
  breadcrumb?: HeroBreadcrumbItem[];
  /** Pills or a short row between the breadcrumb/eyebrow and the title (a kind and its tags). */
  meta?: ReactNode;
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
 * breadcrumb, eyebrow, meta, title, subtitle, actions and any children. It is
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
 * A detail page passes a `breadcrumb`. Every band has the same title size
 * (clamp(28px, 3.4vw, 40px)) and spacing; Home overrides both. A page with no band at
 * all uses `<Header />` (its default `variant="standalone"` is a navy bar).
 */
export function PageHero({
  title,
  eyebrow,
  subtitle,
  breadcrumb,
  meta,
  actions,
  children,
  backgroundImage,
  glow = true,
  overlap = true,
  contentClassName,
  className,
}: PageHeroProps) {
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
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-hero via-hero/85 via-45% to-hero/35"
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
          "gap-[22px] pt-6 lg:pt-10",
          contentClassName,
        )}
      >
        {breadcrumb && breadcrumb.length > 0 && <HeroBreadcrumb items={breadcrumb} />}
        {eyebrow && (
          <p className="flex items-center gap-2.5 font-mono text-xs tracking-[0.06em] text-hero-eyebrow uppercase">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-hero-eyebrow ring-4 ring-hero-eyebrow/20"
            />
            {eyebrow}
          </p>
        )}
        {meta}
        <h1
          className={cn(
            "font-bold text-white",
            "max-w-[1040px] text-[clamp(28px,3.4vw,40px)] leading-[1.12] tracking-[-0.035em] text-pretty",
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className={cn(
              "max-w-[640px] text-base leading-[1.55] text-hero-foreground-muted text-pretty sm:text-[17px]",
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

/** A first crumb up to this long keeps its width; a longer one gives way like the rest. */
const SHORT_CRUMB = 24;

/**
 * The trail on one line. A short first crumb keeps its width; every other one
 * shrinks and ends in an ellipsis (its full label in `title`), so a long name
 * never runs into the next crumb on a phone. The crumbs before the last give
 * way first, so the current page keeps most of its name.
 */
function HeroBreadcrumb({ items }: { items: HeroBreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-[13.5px]">
      <ol className="flex min-w-0 items-center gap-2">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          const keepsWidth = i === 0 && !last && item.label.length <= SHORT_CRUMB;
          return (
            <li
              key={`${i}-${item.label}`}
              className={cn("flex items-center gap-2", keepsWidth ? "shrink-0" : last ? "min-w-0" : "min-w-0 shrink-[4]")}
            >
              {item.href && !last ? (
                <Link
                  href={item.href}
                  title={item.label}
                  className="min-w-0 truncate text-hero-foreground-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  title={item.label}
                  className="min-w-0 truncate text-hero-subtle"
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="shrink-0 text-hero-faint/60">
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
