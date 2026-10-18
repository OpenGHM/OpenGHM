"use client";

import { Suspense, useState } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-loading";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";

function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  // The emailed link carries `set=1` for an account that has no password (one
  // CILogon created): it adds one rather than resetting one.
  const setting = searchParams.get("set") === "1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Missing reset token — use the link from your email.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/public-auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      if (!res.ok) {
        // 422 is the backend refusing the password itself (its list of field
        // errors carries the rule); anything else is the link.
        const rule =
          res.status === 422
            ? ((await res.json().catch(() => null)) as { detail?: { msg?: unknown }[] } | null)
                ?.detail?.[0]?.msg
            : undefined;
        setError(
          typeof rule === "string"
            ? `Password: ${rule}.`
            : "This reset link is invalid or has expired. Request a new one."
        );
        return;
      }

      router.push("/auth/signin?reset=1");
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p className="text-sm text-destructive">
        This link is missing a reset token.{" "}
        <Link href="/auth/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {setting && (
        <p className="text-sm leading-[1.55] text-muted-foreground">
          Your account signs in without a password. Set one to be able to sign in with your email
          too; CILogon keeps working.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="password">{setting ? "Password" : "New password"}</Label>
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
        <Label htmlFor="confirmPassword">Confirm new password</Label>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="xl" className="w-full" disabled={loading}>
        {loading ? (setting ? "Setting..." : "Resetting...") : setting ? "Set password" : "Reset password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      eyebrow="Password"
      title="Set a new password"
      description="This will sign you out everywhere else — choose your password below and sign in again."
    >
      <Suspense fallback={<AuthFormSkeleton />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
