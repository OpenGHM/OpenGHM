"use client";

import { Suspense, useEffect, useState } from "react";
import { signIn, getProviders } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent } from "@/components/ui/card";
import { safeCallbackUrl } from "@/lib/auth-redirect";

type DevAccount = { label: string; email: string; password: string };

function SignInFormInner({ devAccounts }: { devAccounts: DevAccount[] }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");
  const reset = searchParams.get("reset");
  // Same-origin relative paths only — never follow an arbitrary URL.
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const [cilogonEnabled, setCilogonEnabled] = useState(false);

  // Checked via the live provider list rather than a NEXT_PUBLIC_ env var:
  // this project's Dockerfile has no build-arg plumbing, so NEXT_PUBLIC_
  // values would be frozen at image-build time and couldn't reflect a
  // CILOGON_CLIENT_ID set later at deploy time. /api/auth/providers is
  // computed by the server on every request from the actual env, so this
  // works correctly however CILogon ends up configured.
  useEffect(() => {
    getProviders().then((providers) => setCilogonEnabled(!!providers?.cilogon));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password.");
    } else {
      router.push(callbackUrl);
    }
    setLoading(false);
  }

  async function handleDevLogin(devEmail: string, devPassword: string) {
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email: devEmail,
      password: devPassword,
      redirect: false,
    });
    if (result?.error) {
      setError("Dev login failed.");
      setLoading(false);
    } else {
      router.push(callbackUrl);
    }
  }

  return (
    <CardContent className="space-y-4">
      {registered && (
        <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">
          Account created successfully. Please sign in.
        </p>
      )}
      {reset && (
        <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">
          Password reset. Please sign in with your new password.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
        </div>
        <p className="text-right text-sm">
          <Link
            href="/auth/forgot-password"
            className="text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-slate-500">or</span>
        </div>
      </div>

      {cilogonEnabled ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={() => signIn("cilogon", { callbackUrl })}
        >
          Sign in with CILogon
        </Button>
      ) : (
        <Button
          variant="outline"
          className="w-full opacity-50 cursor-not-allowed"
          disabled
          title="Not configured — see the private ops repository's external-services.md"
        >
          Sign in with CILogon
        </Button>
      )}

      {devAccounts.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
            Dev quick login
          </p>
          <div className="flex gap-2">
            {devAccounts.map((acc) => (
              <Button
                key={acc.label}
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 border-amber-300 bg-white text-amber-800 hover:bg-amber-100 text-xs"
                disabled={loading}
                onClick={() => handleDevLogin(acc.email, acc.password)}
              >
                {acc.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-sm text-slate-600">
        Don&apos;t have an account?{" "}
        <Link
          href="/auth/register"
          className="font-medium text-primary hover:underline"
        >
          Create one
        </Link>
      </p>
    </CardContent>
  );
}

// A thin client wrapper so the caller (a server component) never needs
// "use client" itself, and useSearchParams() gets the Suspense boundary it requires.
export function SignInForm({ devAccounts }: { devAccounts: DevAccount[] }) {
  return (
    <Suspense fallback={<CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>}>
      <SignInFormInner devAccounts={devAccounts} />
    </Suspense>
  );
}
