import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The column every Workspace page lays its header and its content in: 1024 px
 * of content at `lg`, with the gutters inside the width so a page on a phone
 * keeps 16 px either side. One class, so the header and what is under it can
 * never drift apart.
 */
export const WORKSPACE_CONTAINER = "mx-auto w-full max-w-[1104px] px-4 sm:px-6 lg:px-10";

/**
 * The draft wizard's column: `WORKSPACE_CONTAINER` until `xl`, where it grows to
 * 1376 px of content so that the 1024 px column the steps keep has the help
 * panel (20 rem and a 2 rem gap) beside it. The wizard's header and its body
 * both use it, so their left edges stay together.
 */
export const WIZARD_CONTAINER = cn(WORKSPACE_CONTAINER, "xl:max-w-[1456px]");

/** The page body under the site header: the repository's light background. */
export const WORKSPACE_MAIN = "flex flex-1 flex-col bg-muted/30";

/** The title the Data Repository page uses, so a Workspace page reads as the same product. */
const TITLE =
  "min-w-0 text-[28px] leading-tight font-semibold tracking-tight break-words text-foreground sm:text-[34px]";

/** The small mono label above a title ("REPOSITORY", "WORKSPACE"). */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 font-mono text-xs tracking-wider text-muted-foreground uppercase">{children}</p>
  );
}

/**
 * "My snapshot drafts / <current>": where a snapshot draft's own page (and the wizard)
 * sits. The first part links to the list; the last is the page, which is the
 * current one and is not a link.
 */
export function DraftBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted-foreground">
      <ol className="flex min-w-0 items-center gap-2">
        <li className="shrink-0">
          <Link
            href="/workspace"
            className="rounded outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            My snapshot drafts
          </Link>
        </li>
        <li aria-hidden="true" className="shrink-0">
          /
        </li>
        <li aria-current="page" className="min-w-0 truncate text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
}

/**
 * The header of a Workspace page, in the Data Repository's light style: an
 * eyebrow or a breadcrumb (`top`), the title with what sits beside it (a
 * status), a muted line under it (`meta`), whatever the page does on the right
 * (`aside`: buttons, a one-line description), and anything that belongs to the
 * header's bottom edge (`children`: the section tabs, the wizard's steps).
 * It brings the page's column; the content under it uses `WORKSPACE_CONTAINER`
 * (`WIZARD_CONTAINER` with `wide`).
 */
export function PageHeader({
  top,
  title,
  badge,
  meta,
  aside,
  wide = false,
  children,
}: {
  top: React.ReactNode;
  title: React.ReactNode;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  aside?: React.ReactNode;
  /** Use the wizard's wider column (`WIZARD_CONTAINER`) from `xl`. */
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn(wide ? WIZARD_CONTAINER : WORKSPACE_CONTAINER, "pt-8 sm:pt-10")}>
      {top}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        {/* From `lg` the title block takes what the actions leave, so a long `meta` line is cut
            with an ellipsis instead of pushing the actions onto a row of their own. */}
        <div className="min-w-0 max-w-full lg:flex-1 lg:basis-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className={TITLE}>{title}</h1>
            {badge}
          </div>
          {meta}
        </div>
        {/* Beside a title with a line under it, the actions line up with the title. */}
        {aside && <div className={cn("max-w-full", meta && "sm:self-start")}>{aside}</div>}
      </div>
      {children}
    </header>
  );
}
