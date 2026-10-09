import { AdminNav } from "@/components/admin/admin-nav";
import { PageBody, PageHero, type HeroBreadcrumbItem } from "@/components/layout/page-hero";
import { cn } from "@/lib/utils";

/**
 * One admin page: the navy band (the site header, the title, the section nav)
 * and the content under it, which starts inside the band. Every page of the
 * console renders this, so the band carries the title and the nav is the same
 * on all of them.
 */
export function AdminPage({
  title,
  description,
  breadcrumb,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: string;
  breadcrumb?: HeroBreadcrumbItem[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <PageHero size="page" eyebrow="Admin console" title={title} subtitle={description} breadcrumb={breadcrumb}>
        <AdminNav />
      </PageHero>
      <PageBody className={cn("space-y-6", className)}>{children}</PageBody>
    </>
  );
}
