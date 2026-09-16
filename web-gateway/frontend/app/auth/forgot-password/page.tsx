"use client";

import { useState } from "react";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  // Deliberately a single "submitted" state, not success/error — the
  // backend always returns 200 for this endpoint (see
  // web-gateway/backend/app/api/v1/auth.py forgot_password) so an attacker probing
  // emails can't tell a registered address from an unregistered one.
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/public-auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Network failure — still show the generic message. Retrying costs
      // nothing and we don't want to hint at whether the request landed.
    } finally {
      setSubmitted(true);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Enter your account email and we&apos;ll send a reset link
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <p className="text-sm text-slate-700 bg-slate-100 border border-slate-200 rounded px-3 py-3">
              If an account exists for <strong>{email}</strong>, a password
              reset link has been sent. Check your inbox.
            </p>
          ) : (
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending..." : "Send reset link"}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-slate-600">
            <Link
              href="/auth/signin"
              className="font-medium text-primary hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
