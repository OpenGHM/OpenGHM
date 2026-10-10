import Link from "next/link";
import { LogIn } from "lucide-react";
import { Footer } from "@/components/landing/footer";
import { PageBody } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/workspace/page-header";
import { signInPath } from "@/lib/auth-redirect";
import type { SignedOutReason } from "@/lib/auth-guard";

/** What the card says for each way of being signed out. */
const COPY: Record<SignedOutReason, { title: string; body: string }> = {
  none: {
    title: "Sign in to use the Workspace",
    body: "The Workspace is where you run model snapshots with your own settings on Anvil and keep your snapshot drafts. Sign in with your account to open it.",
  },
  expired: {
    title: "Your session has ended",
    body: "Sign in again to continue where you left off.",
  },
};

/**
 * What a Workspace page shows to someone who is not signed in, in place of its
 * own content: the navy band, one card that says an account is needed and
 * links to sign-in, and the footer. It is the page itself, not a redirect and
 * not a dialog.
 *
 * `here` is the page's own path with its query (`pathWithQuery()` in
 * lib/auth-redirect.ts), so signing in returns the visitor to the same page.
 * The register page takes no callback, so "Create an account" does not carry
 * one. "Browse the Data Repository" is offered only to a visitor who never
 * signed in; the repository needs no account.
 */
export function SignInRequired({ reason, here }: { reason: SignedOutReason; here: string }) {
  const { title, body } = COPY[reason];
  const signedOutBefore = reason === "expired";
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader eyebrow="Workspace" title="Workspace" />
      <PageBody className="flex-1">
        <section aria-labelledby="sign-in-required-title">
          <Card className="items-center gap-3.5 border-0 px-6 py-14 text-center shadow-raised sm:py-16">
            <span
              aria-hidden="true"
              className="grid size-[52px] place-items-center rounded-2xl bg-secondary text-primary [&_svg]:size-5"
            >
              <LogIn />
            </span>
            <h2 id="sign-in-required-title" className="text-xl font-[650] tracking-[-0.01em] text-foreground">
              {title}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground text-pretty">{body}</p>
            <div className="mt-2 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button asChild size="lg">
                <Link href={signInPath(here)}>{signedOutBefore ? "Sign in again" : "Sign in"}</Link>
              </Button>
              {!signedOutBefore && (
                <Button asChild size="lg" variant="outline">
                  <Link href="/auth/register">Create an account</Link>
                </Button>
              )}
            </div>
            {!signedOutBefore && (
              <Button asChild variant="link" size="sm" className="min-h-10 text-muted-foreground">
                <Link href="/repository">Browse the Data Repository</Link>
              </Button>
            )}
          </Card>
        </section>
      </PageBody>
      <Footer />
    </div>
  );
}
