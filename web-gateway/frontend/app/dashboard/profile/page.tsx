import { auth, cilogonConfigured } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { AccountCard } from "@/components/dashboard/account-card";
import { SessionsCard } from "@/components/dashboard/sessions-card";
import { EmailVerificationBanner } from "@/components/dashboard/email-verification-banner";
import { SsoResultToast } from "@/components/dashboard/sso-result-toast";
import { fetchMe, fetchMySessions } from "@/lib/account/actions";
import type { SessionListResponse } from "@/lib/account/types";

const EMPTY_SESSIONS: SessionListResponse = { items: [] };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string | string[] }>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");
  const { sso } = await searchParams;

  const [profile, sessionsResult] = await Promise.allSettled([
    fetchMe(),
    fetchMySessions(),
  ]);

  const userProfile = profile.status === "fulfilled" ? profile.value : null;
  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : EMPTY_SESSIONS;

  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        size="page"
        eyebrow="Account"
        title="My Profile"
        subtitle="Manage your account details, password, and signed-in devices."
      >
        {/* In the band, above where the cards overlap it, so it never sits on
            the band's edge with the cards pressed against it. */}
        {userProfile && !userProfile.email_verified && <EmailVerificationBanner />}
      </PageHero>
      <PageBody className="flex-1 space-y-6">
        {/* The CILogon callback's answer, shown once (lib/auth.ts). */}
        <SsoResultToast result={typeof sso === "string" ? sso : undefined} />
        {userProfile ? (
          <>
            <div className="grid gap-6 md:grid-cols-2">
              <AccountCard profile={userProfile} cilogonEnabled={cilogonConfigured} />
              <SessionsCard sessions={sessions.items} />
            </div>
          </>
        ) : (
          <p className="rounded-card bg-card p-6 text-sm text-destructive shadow-raised">
            Failed to load your profile. Try refreshing.
          </p>
        )}
      </PageBody>
      <Footer />
    </div>
  );
}
