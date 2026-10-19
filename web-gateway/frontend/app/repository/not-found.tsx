import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";

/** A snapshot, a model input or a files page that is not in the Data Repository: a wrong id, or one taken down. */
export default function RepositoryNotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Data Repository", href: "/repository" }]}
        title="Not found in the Data Repository"
      />
      <PageBody className="flex-1">
        <div className="space-y-4 rounded-card border border-dashed border-border bg-card px-6 py-12 text-center shadow-raised">
          <p className="text-[15px] text-muted-foreground">
            There is no snapshot or model input at this address. The link may be mistyped, or what it named may have
            been taken down.
          </p>
          <Button asChild className="min-h-10">
            <Link href="/repository">Back to Data Repository</Link>
          </Button>
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
