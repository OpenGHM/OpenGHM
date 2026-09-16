import { RegisterForm } from "./register-form";

// Read at request time, not build time. Without this the page prerenders as
// static and bakes in whatever RECAPTCHA_SITE_KEY the *builder* had — the same
// build-time capture that NEXT_PUBLIC_ does, which is the thing this split
// exists to avoid.
export const dynamic = "force-dynamic";

/**
 * Server wrapper: reads the reCAPTCHA site key at request time and hands it to
 * the client form. Deliberately NOT a NEXT_PUBLIC_ variable — those are
 * inlined by `next build`, and this project promotes one built image from dev
 * to prod (`just promote-frontend`), so a build-time key could only ever be
 * correct in one of them.
 *
 * Unset is a valid configuration, not a blank to fill in later: the form then
 * renders no captcha and the backend skips verification. See
 * devdocs/reference/external-services.md.
 */
export default function RegisterPage() {
  return <RegisterForm siteKey={process.env.RECAPTCHA_SITE_KEY ?? ""} />;
}
