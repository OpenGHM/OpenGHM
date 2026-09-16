import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/landing/header";
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

  if (!userProfile) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1 bg-slate-50 px-10 py-12">
          <div className="mx-auto max-w-[1024px]">
            <p className="text-sm text-red-600">Failed to load your profile. Try refreshing.</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 bg-slate-50 px-10 py-12">
        <div className="mx-auto max-w-[1024px] space-y-6">
          {!userProfile.email_verified && <EmailVerificationBanner />}
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
            <p className="text-sm text-slate-500">
              Manage your account details, password, and signed-in devices.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <AccountCard profile={userProfile} />
            <SessionsCard sessions={sessions.items} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
