// One-shot, idempotent migration of `datasets`/`model_inputs` from the flat
// shape ("the document is the spec's metadata.json, plus _id") to the
// envelope shape mission 2026-09-23-catalogue-envelope introduced:
//
//   { _id, document: {…the spec document, verbatim, no _id inside it…},
//     owner_user_id, visibility, registered_at }
//
// `_id` is unchanged (still mirrors the spec's own `id`); everything else
// that was previously a top-level field moves under `document` untouched.
// Every migrated document is written `owner_user_id: null`,
// `visibility: "public"` — the same values the write path has always used
// (spec.md, out of scope: no behaviour change) — and `registered_at: now`,
// since nothing recorded when the document was actually registered before
// this.
//
// Safe to run more than once: a document that already has a `document` key
// is left alone (matched by neither updateMany below).
//
// Local:  just migrate-catalogue-envelope
//
// No k8s/cluster recipe yet (unlike migrate-roles/migrate-sessions) — no
// real deployment holds `datasets`/`model_inputs` documents predating this
// mission (Next item 3, ops/missions/README.md: the three staged snapshots
// on Anvil are blocked on Anvil maintenance and are not registered in any
// cluster Mongo yet). Add one the same way if that changes.

db = db.getSiblingDB("openghm");

function migrateCollection(name) {
  const now = new Date();
  const flatDocs = db[name].find({ document: { $exists: false } }).toArray();

  if (flatDocs.length === 0) {
    print(`${name}: no flat-shape documents found — nothing to migrate.`);
    return;
  }

  let migrated = 0;
  for (const flat of flatDocs) {
    const id = flat._id;
    const spec = Object.assign({}, flat);
    delete spec._id;

    db[name].replaceOne(
      { _id: id },
      {
        _id: id,
        document: spec,
        owner_user_id: null,
        visibility: "public",
        registered_at: now,
      }
    );
    migrated++;
  }
  print(`${name}: migrated ${migrated} document(s) to the envelope shape.`);
}

migrateCollection("datasets");
migrateCollection("model_inputs");

// Flag anything that still isn't in the envelope shape, same convention as
// migrate_roles.js's canonical-role check — surfaces a partial or failed
// migration here rather than as a KeyError in
// app.models.repository.from_metadata_json later.
for (const name of ["datasets", "model_inputs"]) {
  const stray = db[name].countDocuments({ document: { $exists: false } });
  if (stray > 0) {
    print(`⚠️  ${name}: ${stray} document(s) still lack a 'document' field.`);
  }
}
