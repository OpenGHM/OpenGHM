import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";

export default function TutorialNotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        breadcrumb={[{ label: "Community", href: "/community" }, { label: "Tutorials" }]}
        title="Tutorial not found"
      />
      <PageBody className="flex-1">
        <div className="space-y-4 rounded-card border border-dashed border-border bg-card px-6 py-12 text-center shadow-raised">
          <p className="text-[15px] text-muted-foreground">
            There is no tutorial at this address. It may have been renamed or taken down.
          </p>
          <Button asChild className="min-h-10">
            <Link href="/community?tab=tutorials">See all tutorials</Link>
          </Button>
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
