import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";

export default function NewsPostNotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        breadcrumb={[{ label: "Home", href: "/" }, { label: "News", href: "/news" }]}
        title="Post not found"
      />
      <PageBody className="flex-1">
        <div className="space-y-4 rounded-card border border-dashed border-border bg-card px-6 py-12 text-center shadow-raised">
          <p className="text-[15px] text-muted-foreground">
            There is no news post at this address. It may have been renamed or taken down.
          </p>
          <Button asChild className="min-h-10">
            <Link href="/news">See all updates</Link>
          </Button>
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
