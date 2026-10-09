import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { AccountCard } from "@/components/dashboard/account-card";
import { SessionsCard } from "@/components/dashboard/sessions-card";
import { EmailVerificationBanner } from "@/components/dashboard/email-verification-banner";
import { fetchMe, fetchMySessions } from "@/lib/account/actions";
import type { SessionListResponse } from "@/lib/account/types";

const EMPTY_SESSIONS: SessionListResponse = { items: [] };

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

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
      />
      <PageBody className="flex-1 space-y-6">
        {userProfile ? (
          <>
            {!userProfile.email_verified && <EmailVerificationBanner />}
            <div className="grid gap-6 md:grid-cols-2">
              <AccountCard profile={userProfile} />
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
