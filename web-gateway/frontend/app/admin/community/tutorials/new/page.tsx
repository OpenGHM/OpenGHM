import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { TutorialEditor } from "@/components/admin/community/tutorial-editor";

export default function NewTutorialPage() {
  return (
    <CommunityAdminPage
      title="New tutorial"
      description="It stays a draft until you set it to Published, and joins the end of the list."
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Tutorials", href: "/admin/community/tutorials" },
        { label: "New" },
      ]}
    >
      <TutorialEditor tutorial={null} />
    </CommunityAdminPage>
  );
}
