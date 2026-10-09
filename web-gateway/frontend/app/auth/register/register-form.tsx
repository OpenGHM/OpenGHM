"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { Recaptcha } from "@/components/auth/recaptcha";

/**
 * The form half of /auth/register. Split out of page.tsx so the site key can
 * be read from server env there and handed down as a prop: it is public by
 * design (it is embedded in the page), but a NEXT_PUBLIC_ variable is inlined
 * at `next build`, which would tie one image to one environment's key.
 *
 * An empty `siteKey` means the Recaptcha component renders nothing and
 * registration proceeds without a captcha — matching
 * web-gateway/backend/app/services/recaptcha.py's skip-when-unconfigured
 * behavior.
 */
export function RegisterForm({ siteKey }: { siteKey: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linkPending, setLinkPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (siteKey && !recaptchaToken) {
      setError("Please complete the CAPTCHA.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/public-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          organization: organization.trim() || null,
          recaptcha_token: recaptchaToken,
        }),
      });

      if (res.status === 409) {
        setError("An account with this email already exists.");
        return;
      }
      if (!res.ok) {
        setError("Registration failed. Please try again.");
        return;
      }

      const data = (await res.json()) as { status?: string };
      if (data.status === "link_pending") {
        // That email already belongs to a CILogon/SSO-only account — the
        // backend staged this password rather than applying it immediately
        // (see web-gateway/backend/app/api/v1/auth.py's confirm-link mechanism) and
        // emailed a confirmation link instead of creating a session.
        setLinkPending(true);
        return;
      }

      router.push("/auth/signin?registered=1");
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Create account"
      title="Create an account"
      description="Join OpenGHM Gateway to access data and tools"
      backToHome
    >
      {linkPending ? (
        <AuthNotice tone="success">
          That email already has a CILogon sign-in on this account.
          We&apos;ve sent a confirmation link to it — click it to add a
          password sign-in option, then{" "}
          <Link href="/auth/signin" className="font-medium underline">
            sign in
          </Link>
          .
        </AuthNotice>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              required
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organization">Organization (optional)</Label>
            <Input
              id="organization"
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Purdue University"
              autoComplete="organization"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </div>
          <Recaptcha siteKey={siteKey} onVerify={setRecaptchaToken} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="xl" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>
      )}

      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/auth/signin"
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
