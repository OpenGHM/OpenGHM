# ADR 0035 — CILogon is ordinary single sign-on: a matching email connects, a connected identity signs in

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-15 |
| **Affects** | [`../architecture/authentication.md`](../architecture/authentication.md) (§3, §4) |

## Context

The gateway signs people in with an email and password, or with CILogon, an
OIDC broker in front of many identity providers (Purdue, ORCID, Google and
others). CILogon had never run against the real provider until 2026-10-14.
Running it locally showed what the code did:

- The session took its name, email and id from the CILogon profile rather than
  from the account the backend had signed in. So the header named the identity
  while every page showed the account. This was a defect.
- A first sign-in linked the identity to the account with the same email, or
  created an account. One account holds one identity (`sso_provider`,
  `sso_external_id`), with no index on `sso_external_id`.
- Email is the account's unique key, but only its domain was lowercased, and
  lookups were exact. So an address typed with a capital letter neither
  matched nor collided.
- `POST /auth/forgot-password` mailed only accounts that have a password. An
  account created by CILogon had no way back in if its identity provider went
  away.

We then designed a fuller model:

- many identities per account;
- a "new account or existing?" page on every first sign-in;
- a password confirmation before linking on a matching email;
- self-service and admin account merges.

That design covers people who end up with two accounts. It also makes CILogon
behave unlike any other single sign-on a user has met. For a gateway with a
handful of users, the cost of its corner cases outweighed the cases it closed.
It is recorded under *Alternatives not taken*.

## Decision

**CILogon behaves like "Sign in with Google" on an ordinary website.**

1. **A connected identity signs in to its account.** The session's name, email
   and id are the account's, taken from the backend's answer. The identity's
   profile never supplies them. The address the identity gave is kept as
   `sso_email`, refreshed on each sign-in, and shown on the profile so the
   owner can see which identity is connected.
2. **An unknown identity whose email matches an account is connected to it and
   signs in.** The provider's assertion of the address is trusted, as an
   ordinary site trusts Google's. There are two exceptions:
   - A deactivated account is refused.
   - An account already connected to a different identity is refused (409).
     The person signs in with the identity that is connected.

   If the matched account's email was **not verified**, connecting it also
   removes the account's password and ends its sessions. An unverified account
   may have been registered by someone else with the owner's address. The
   owner, who has just proved the address through their identity provider,
   sets a password again through forgot-password if they want one.
3. **An unknown identity with no matching account creates one.** Its email
   counts as verified. A provider that releases no email goes through
   `complete-profile`, as before.
4. **An identity is connected to an account with another email from the
   profile.** A signed-in user presses Connect CILogon. The CILogon login is
   forced with `prompt=login`, so a CILogon session someone else left in the
   browser is not what gets connected. The request is bound to the account
   that made it. An identity already held by another account is refused, and
   nothing is merged: an admin sorts out a person with two accounts.
5. **One identity per account, one account per identity.** A unique index on
   `sso_external_id` enforces the second half in the database.
6. **No account is stranded.** CILogon can be disconnected only while the
   account has a password. Forgot-password mails any active account that has
   a password or a verified email, so an account created by CILogon can get a
   password.
7. **Emails are lowercased** wherever they are stored or looked up. Existing
   accounts are rewritten once. Two accounts that would collide are left as
   they are and logged, for an admin to resolve.

## Consequences

- Signing in with CILogon needs no extra step, and nobody is asked for a
  password to link.
- Trust in the address rests on the identity providers behind CILogon.
  Institutional providers manage their addresses, and Google's are verified.
  A provider that asserted an address it never checked could take over the
  account with that address. Ordinary sites with Google sign-in accept the
  same risk.
- A person who registered with a personal address and later chooses "Sign in
  with CILogon" with an institutional one gets a second account. They can
  avoid that by connecting from the profile. Once it has happened, an admin
  resolves it; there is no self-service merge.
- A second identity for the same person, such as ORCID beside Purdue with the
  same address, is refused rather than added. If that turns out to be common,
  supporting several identities per account is the change to make.

## Alternatives not taken

- **An account holding many identities, a first-sign-in choice page, password
  confirmation before linking, and account merges.** These close every way a
  person can end up with two accounts. They also add a page, a merge procedure
  that touches every collection keyed by a user id, and behaviour no user
  expects from single sign-on. The work was started and set aside, and is kept
  in a git stash, not in the code.
- **Refusing to link on a matching email.** That would make every person who
  registered first create a duplicate, or connect by hand, before CILogon
  works for them.
