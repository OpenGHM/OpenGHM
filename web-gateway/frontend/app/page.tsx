import { Hero } from "@/components/landing/hero";
import { ChallengeSection } from "@/components/landing/challenge-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { UpdatesSection } from "@/components/landing/updates-section";
import { UseCasesSection } from "@/components/landing/use-cases-section";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { PageBody } from "@/components/layout/page-hero";

export default function HomePage() {
  return (
    <>
      <Hero />
      {/* The Home hero leaves 136 px of band, so the body is pulled up 64 px. */}
      <PageBody className="-mt-16 flex flex-col gap-24">
        <ChallengeSection />
        <FeaturesSection />
        <UpdatesSection />
        <UseCasesSection />
        <CtaSection />
      </PageBody>
      <Footer />
    </>
  );
}
