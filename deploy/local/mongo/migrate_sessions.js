// One-shot, idempotent migration of the single-session refresh token model
// (users.refresh_token_hash / users.refresh_token_expires_at) to the
// per-device refresh_tokens collection introduced with multi-device
// sessions — see web-gateway/backend/app/core/sessions.py.
//
// Without this, everyone signed in at deploy time is silently signed out:
// the new /auth/refresh looks in refresh_tokens, which would be empty.
// Running it carries each live session over so nobody notices the change.
//
// Safe to run more than once: users already migrated no longer have the old
// fields, so the second run finds nothing to move.
//
// Local:  just migrate-sessions
// K8s:    just k8s-migrate-sessions [dev|prod]

db = db.getSiblingDB("openghm");

// Matches the dashed-string form Python's str(uuid.uuid4()) produces, which
// is what every other _id in this database looks like. mongosh's built-in
// UUID() returns a BSON Binary whose toString() is not that, so build it by
// hand. Math.random is fine here: a session id is not a secret (the token
// hash is), it only has to be collision-free.
function uuid4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const now = new Date();
let migrated = 0;
let skippedExpired = 0;

const cursor = db.users.find({ refresh_token_hash: { $type: "string" } });

while (cursor.hasNext()) {
  const user = cursor.next();

  const expiresAt = user.refresh_token_expires_at;
  if (!expiresAt || expiresAt < now) {
    // Already-dead token — nothing worth carrying over; the user would
    // have had to sign in again anyway.
    skippedExpired++;
  } else {
    db.refresh_tokens.insertOne({
      _id: uuid4(),
      user_id: user._id,
      token_hash: user.refresh_token_hash,
      expires_at: expiresAt,
      created_at: now,
      last_used_at: now,
      user_agent: null,
    });
    migrated++;
  }

  db.users.updateOne(
    { _id: user._id },
    { $unset: { refresh_token_hash: "", refresh_token_expires_at: "" } }
  );
}

if (migrated === 0 && skippedExpired === 0) {
  print("No legacy refresh tokens found — nothing to migrate.");
} else {
  print(
    `Migrated ${migrated} live session(s); dropped ${skippedExpired} already-expired token(s).`
  );
}

// Mirrors the indexes web-gateway/backend/main.py creates at startup, so the collection
// is correctly indexed even if the migration runs before the new backend
// image is deployed.
db.refresh_tokens.createIndex({ token_hash: 1 }, { unique: true });
db.refresh_tokens.createIndex({ user_id: 1 });
db.refresh_tokens.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

const leftover = db.users.countDocuments({
  refresh_token_hash: { $exists: true },
});
if (leftover > 0) {
  print(`⚠️  ${leftover} user document(s) still carry refresh_token_hash.`);
}
