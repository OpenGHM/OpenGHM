import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { WorkshopEditor } from "@/components/admin/community/workshop-editor";

export default function NewWorkshopPage() {
  return (
    <CommunityAdminPage
      title="New workshop"
      description="It stays a draft until you set it to Published."
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Workshops", href: "/admin/community/workshops" },
        { label: "New" },
      ]}
    >
      <WorkshopEditor workshop={null} />
    </CommunityAdminPage>
  );
}
