"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { Recaptcha } from "@/components/auth/recaptcha";

/** The shortest password the form accepts. */
const MIN_PASSWORD_LENGTH = 8;

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  password: "Password",
  name: "Name",
  organization: "Organization",
  recaptcha_token: "CAPTCHA",
};

/**
 * What a refused registration says, from the backend's answer. FastAPI sends
 * `detail` as a string for the refusals the endpoint raises itself (a failed
 * CAPTCHA is a 400 with one) and as a list of `{ loc, msg }` for a request
 * body it rejected (422). 409 (taken) is handled before this is called.
 */
export function registrationError(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return status === 502 ? "Unable to connect to the server. Please try again." : detail.trim();
  }
  if (Array.isArray(detail)) {
    const lines = detail
      .map((item: { loc?: unknown[]; msg?: unknown }) => {
        if (typeof item?.msg !== "string") return null;
        const field = item.loc?.[item.loc.length - 1];
        const label = typeof field === "string" ? FIELD_LABELS[field] : undefined;
        return label ? `${label}: ${item.msg}` : item.msg;
      })
      .filter((line): line is string => line !== null);
    if (lines.length > 0) return lines.join(" ");
  }
  return `Registration failed (error ${status}). Please try again.`;
}

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
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linkPending, setLinkPending] = useState(false);
  const router = useRouter();
  // Shown as soon as the confirm field has been left, and kept current while
  // either field is edited, rather than only after a submit.
  const mismatch = confirmTouched && confirmPassword !== password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      // The message is the one under the confirm field.
      setConfirmTouched(true);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
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
        const body = await res.json().catch(() => null);
        setError(registrationError(res.status, body));
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
              required
              autoComplete="new-password"
              aria-describedby="password-help"
            />
            <p id="password-help" className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => setConfirmTouched(true)}
              required
              autoComplete="new-password"
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? "confirm-password-error" : undefined}
            />
            {mismatch && (
              <p id="confirm-password-error" className="text-xs text-destructive">
                Passwords do not match.
              </p>
            )}
          </div>
          <Recaptcha siteKey={siteKey} onVerify={setRecaptchaToken} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
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
