// Initialize the openghm database with required collections and seed data.
// This script runs automatically on first MongoDB startup via docker-entrypoint-initdb.d.

db = db.getSiblingDB("openghm");

db.createCollection("users");
db.createCollection("jobs");

// Seed users for development (password: admin123 / user123). They back the
// "Dev quick login" buttons on the sign-in page.
//
// Their ids are deliberately NOT the mock-auth identities' (mock-admin-001,
// mock-user-001: MOCK_USER_IDS in web-gateway/backend/app/core/security.py).
// A request with no auth header resolves to mock-user-001 in development, and
// the backend refuses any submit from a mock id (ADR 0024) so that identity
// can never spend the SLURM allocation. Seeding these accounts under those
// ids made the quick-login User unable to run a simulation. Under their own
// ids they are ordinary accounts: email-verified, and the user is permitted
// to run simulations. web-gateway/backend/tests/test_seed_users.py guards
// this. An existing volume still holds the old ids: `just migrate-seed-users`.
db.users.insertMany([
  {
    _id: "dev-admin-001",
    email: "admin@openghm.dev",
    name: "James Carter",
    role: "admin",
    organization: "OpenGHM Dev",
    email_verified: true,
    is_active: true,
    password_hash: "$2b$12$ggwyWe3n1TyyXfRziRMz7.iLbLQJ0YgELN4ihCTa6faIcDrE7T7gK",
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    _id: "dev-user-001",
    email: "user@openghm.dev",
    name: "Mia Johnson",
    role: "user",
    organization: null,
    email_verified: true,
    is_active: true,
    can_run_simulations: true,
    password_hash: "$2b$12$W90rcxJou1XCaqvg6qfoNOl4Sbqpl8a6vFf9uBH4EYYTUCH7tcbsm",
    created_at: new Date(),
    updated_at: new Date(),
  },
]);

db.users.createIndex({ email: 1 }, { unique: true });
// One CILogon identity on one account. Partial, so the many accounts with no
// identity do not collide on a missing value. The gateway declares the same
// index at startup (app/core/account_startup.py); this is the seed's copy.
db.users.createIndex(
  { sso_external_id: 1 },
  { unique: true, partialFilterExpression: { sso_external_id: { $type: "string" } } }
);
db.users.createIndex({ role: 1 });

// Job indexes
db.jobs.createIndex({ user_id: 1, created_at: -1 });
db.jobs.createIndex({ status: 1 });
db.jobs.createIndex({ slurm_job_id: 1 }, { sparse: true });
