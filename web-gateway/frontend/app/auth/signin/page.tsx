import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "./signin-form";

// These log in via real email/password against seeded DB accounts (see
// deploy/local/mongo/init-mongo.js) — not the X-Mock-Role bypass. The accounts
// are ordinary ones: verified, and the User may run simulations. Their ids are
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
    <AuthShell
      eyebrow="Sign in"
      title="Sign in to OpenGHM"
      description="Enter your email and password to continue"
      backToHome
    >
      <SignInForm devAccounts={devAccounts} />
    </AuthShell>
  );
}
