import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignInForm } from "./signin-form";

// These log in via real email/password against seeded DB accounts (see
// deploy/local/mongo/init-mongo.js) — not the X-Mock-Role bypass. The accounts
// are ordinary ones: verified, and the User may submit runs. Their ids are
// not the mock-auth identities' (the backend never lets those submit). Staff/guest
// rows are omitted until seeded accounts exist for them.
//
// Read here, server-side, rather than in the client component: this array
// (with its plaintext passwords) then never reaches the client bundle in
// production at all — not even the tree-shaken-out dead code a `NODE_ENV`
// check leaves in a source map. A production build ships an empty list.
const DEV_ACCOUNTS = [
  { label: "Admin", email: "admin@openghm.dev", password: "admin123" },
  { label: "User", email: "user@openghm.dev", password: "user123" },
];

export default function SignInPage() {
  const devAccounts = process.env.NODE_ENV === "development" ? DEV_ACCOUNTS : [];

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md space-y-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to home
        </Link>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Sign in to OpenGHM</CardTitle>
            <CardDescription>
              Enter your email and password to continue
            </CardDescription>
          </CardHeader>
          <SignInForm devAccounts={devAccounts} />
        </Card>
      </div>
    </main>
  );
}
