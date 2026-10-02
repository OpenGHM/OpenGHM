// One-shot, idempotent migration of the two "Dev quick login" seed accounts off
// the mock-auth identities' ids: mock-admin-001 -> dev-admin-001 and
// mock-user-001 -> dev-user-001.
//
// init-mongo.js used to seed those accounts under the very ids in
// web-gateway/backend/app/core/security.py's MOCK_USER_IDS. The backend refuses
// a submit from any such id (ADR 0024: a request with no auth header resolves
// to mock-user-001 in development, so that identity must never spend the SLURM
// allocation), which meant the quick-login User could never run a simulation.
// The seed now uses ids of its own, and marks both accounts email-verified and
// the user as permitted to run simulations.
//
// init-mongo.js only runs against an empty data directory, so a volume seeded
// before this change keeps the old ids until this script is run against it.
//
// For each pair it:
//   1. copies the user document under the new _id, with email_verified,
//      is_active and (user only) can_run_simulations set to true;
//   2. rewrites jobs.user_id and datasets/model_inputs.owner_user_id to the
//      new id;
//   3. deletes the old id's refresh_tokens, because those sessions carry the
//      old `sub` — the user just signs in again;
//   4. deletes the old user document.
// audit_events (actor_id / target_id) and jobs.cancel_requested_by are left
// as they are: they record who did what at the time, and nothing reads them
// back as a join onto users. pending_sso_signups holds no user id.
//
// Ordering. users.email is unique, so the copy cannot sit beside the old
// document under the same email, and standalone mongod has no transactions. A
// plain "delete the old one, then insert the copy" would lose the account if
// the script died between the two. Instead the copy goes in first under a
// placeholder email, the old document is deleted only after the copy and the
// reference rewrites are in, and the real email is put on the copy last. At
// every point the account exists in full in the database, and each step is a
// no-op once done, so re-running after a crash picks up where it stopped.
//
// Safe to run more than once: once an account has moved, the old id matches
// nothing and every step finds nothing to do. A new document that already
// exists is never overwritten, so a flag an administrator has changed since
// stays as they set it.
//
// Local:  just migrate-seed-users

db = db.getSiblingDB("openghm");

const pairs = [
  { from: "mock-admin-001", to: "dev-admin-001", email: "admin@openghm.dev", mayRun: false },
  { from: "mock-user-001", to: "dev-user-001", email: "user@openghm.dev", mayRun: true },
];

// A value no real address can have (.invalid is reserved), derived from the new
// id so a half-finished copy is recognisable and a re-run knows to finish it.
const placeholderEmail = (id) => `migrating-${id}@openghm.invalid`;

for (const pair of pairs) {
  const { from, to, email, mayRun } = pair;
  const report = {};
  const oldDoc = db.users.findOne({ _id: from });
  const newDoc = db.users.findOne({ _id: to });

  if (!oldDoc && !newDoc) {
    print(`${from} -> ${to}: neither user document exists — nothing to migrate.`);
    continue;
  }

  // 1. The new document exists before anything else is touched.
  if (oldDoc && !newDoc) {
    const copy = { ...oldDoc, _id: to, email: placeholderEmail(to), updated_at: new Date() };
    // Legacy single-session fields (see migrate_sessions.js) carry the old session.
    delete copy.refresh_token_hash;
    delete copy.refresh_token_expires_at;
    copy.email_verified = true;
    copy.is_active = true;
    if (mayRun) copy.can_run_simulations = true;
    db.users.insertOne(copy);
    report.users_copied = 1;
  }

  // 2. References. Idempotent by construction: they match on the old id.
  report.jobs = db.jobs.updateMany({ user_id: from }, { $set: { user_id: to } }).modifiedCount;
  report.datasets = db.datasets.updateMany(
    { owner_user_id: from },
    { $set: { owner_user_id: to } }
  ).modifiedCount;
  report.model_inputs = db.model_inputs.updateMany(
    { owner_user_id: from },
    { $set: { owner_user_id: to } }
  ).modifiedCount;

  // 3. Sessions minted for the old id.
  report.refresh_tokens_deleted = db.refresh_tokens.deleteMany({ user_id: from }).deletedCount;

  // 4. Only now does the old document go.
  report.users_deleted = db.users.deleteOne({ _id: from }).deletedCount;

  // 5. The real email goes on the copy last, now that nothing else holds it.
  report.email_restored = db.users.updateOne(
    { _id: to, email: placeholderEmail(to) },
    { $set: { email: email } }
  ).modifiedCount;

  const parts = Object.entries(report).map(([k, v]) => `${k}=${v}`);
  print(`${from} -> ${to}: ${parts.join(", ")}`);
}

// Flag anything still wrong, so it shows up here instead of as a login that
// quietly fails.
for (const pair of pairs) {
  if (db.users.countDocuments({ _id: pair.from }) > 0) {
    print(`⚠️  ${pair.from} still exists.`);
  }
  const left = db.users.findOne({ _id: pair.to }, { email: 1 });
  if (left && left.email !== pair.email) {
    print(`⚠️  ${pair.to} has email ${left.email}, expected ${pair.email}.`);
  }
  for (const [coll, field] of [
    ["jobs", "user_id"],
    ["datasets", "owner_user_id"],
    ["model_inputs", "owner_user_id"],
    ["refresh_tokens", "user_id"],
  ]) {
    const n = db.getCollection(coll).countDocuments({ [field]: pair.from });
    if (n > 0) print(`⚠️  ${n} ${coll} document(s) still have ${field} ${pair.from}.`);
  }
}
