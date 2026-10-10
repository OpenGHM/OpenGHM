import { AdminPage } from "@/components/admin/admin-page";
import { CommunitySubNav } from "@/components/admin/community/community-sub-nav";
import type { HeroBreadcrumbItem } from "@/components/layout/page-hero";

/**
 * A page of the Community admin: the admin band, the Community sections as a
 * row of pills, the page's own action beside them (a "New workshop" button),
 * then the content.
 */
export function CommunityAdminPage({
  title,
  description,
  breadcrumb,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: string;
  breadcrumb?: HeroBreadcrumbItem[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AdminPage title={title} description={description} breadcrumb={breadcrumb}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <CommunitySubNav />
        {actions}
      </div>
      {children}
    </AdminPage>
  );
}
