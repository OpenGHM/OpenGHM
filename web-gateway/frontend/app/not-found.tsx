import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";

/** Any address the site has no page for. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHero size="page" breadcrumb={[{ label: "Home", href: "/" }]} title="Page not found" />
      <PageBody className="flex-1">
        <div className="space-y-4 rounded-card border border-dashed border-border bg-card px-6 py-12 text-center shadow-raised">
          <p className="text-[15px] text-muted-foreground">
            There is nothing at this address. The link may be mistyped, or the page may have moved.
          </p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild className="min-h-10">
              <Link href="/">Go to the home page</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-10">
              <Link href="/repository">Browse the Data Repository</Link>
            </Button>
          </div>
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
