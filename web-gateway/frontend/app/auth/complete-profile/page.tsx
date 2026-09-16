"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Reached only via a redirect from the CILogon sign-in flow, when the
 * identity provider (ORCID, typically) didn't release an email — see
 * signIn() in web-gateway/frontend/lib/auth.ts. No captcha here: getting this far
 * already required signing in with a real identity provider, a higher bar
 * than anything a captcha adds.
 */
function CompleteProfileForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [linkPending, setLinkPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Missing completion link — please sign in again.");
      return;
    }

    setLoading(true);
    const result = await signIn("sso-complete", {
      completionToken: token,
      email,
      name,
      redirect: false,
    });

    if (result?.code === "link_pending") {
      setLinkPending(true);
      setLoading(false);
      return;
    }
    if (result?.error) {
      setError(
        "This link is invalid, expired, or that email is already registered. Please sign in again."
      );
      setLoading(false);
      return;
    }

    router.push("/");
  }

  if (linkPending) {
    return (
      <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-3">
        That email already has a password-based account. We&apos;ve sent a
        confirmation link to it — click it to link your sign-in methods
        together, then{" "}
        <Link href="/auth/signin" className="font-medium underline">
          sign in
        </Link>
        .
      </p>
    );
  }

  if (!token) {
    return (
      <p className="text-sm text-red-600">
        This link is missing a completion token.{" "}
        <Link href="/auth/signin" className="underline">
          Sign in again
        </Link>
        .
      </p>
    );
  }

  return (
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Finishing sign-in..." : "Continue"}
      </Button>
    </form>
  );
}

export default function CompleteProfilePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>One more step</CardTitle>
          <CardDescription>
            Your identity provider didn&apos;t share an email address with
            us. We&apos;ll send a verification link to whatever you enter
            below.
          </CardDescription>
        </CardHeader>
        <Suspense fallback={<CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>}>
          <CardContent>
            <CompleteProfileForm />
          </CardContent>
        </Suspense>
      </Card>
    </main>
  );
}
