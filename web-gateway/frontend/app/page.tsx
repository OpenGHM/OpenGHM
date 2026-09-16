import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { ChallengeSection } from "@/components/landing/challenge-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { UpdatesSection } from "@/components/landing/updates-section";
import { UseCasesSection } from "@/components/landing/use-cases-section";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";

export default function HomePage() {
  return (
    <>
      <Header />
      <Hero />
      <ChallengeSection />
      <FeaturesSection />
      <UpdatesSection />
      <UseCasesSection />
      <CtaSection />
      <Footer />
    </>
  );
}
