// One-shot, idempotent migration of the legacy PascalCase role set to the
// current lowercase set: Admin -> admin, PowerUser -> staff, User -> user,
// Guest -> guest.
//
// docker-entrypoint-initdb.d scripts (init-mongo.js) only run against an
// empty data directory, so any volume/PVC created before this rename keeps
// its old role strings until this script is run against it explicitly.
//
// Safe to run more than once: users already on the new lowercase values are
// left untouched by each updateMany (no matching documents).
//
// Local:  just migrate-roles
// K8s:    just k8s-migrate-roles [dev|prod]

db = db.getSiblingDB("openghm");

const mapping = {
  Admin: "admin",
  PowerUser: "staff",
  User: "user",
  Guest: "guest",
};

let totalMatched = 0;
let totalModified = 0;

for (const [oldRole, newRole] of Object.entries(mapping)) {
  const result = db.users.updateMany(
    { role: oldRole },
    { $set: { role: newRole, updated_at: new Date() } }
  );
  totalMatched += result.matchedCount;
  totalModified += result.modifiedCount;
  if (result.matchedCount > 0) {
    print(`  ${oldRole} -> ${newRole}: ${result.modifiedCount} document(s)`);
  }
}

if (totalMatched === 0) {
  print("No legacy-role user documents found — nothing to migrate.");
} else {
  print(`Migrated ${totalModified}/${totalMatched} legacy-role document(s).`);
}

// Flag anything that isn't one of the four canonical roles, so a stray value
// shows up in the migration output instead of surfacing later as a 500 in
// the backend's own startup integrity check (see web-gateway/backend/main.py).
const canonical = ["admin", "staff", "user", "guest"];
const stray = db.users.countDocuments({ role: { $nin: canonical } });
if (stray > 0) {
  print(`⚠️  ${stray} user document(s) still have a non-canonical role value.`);
}
