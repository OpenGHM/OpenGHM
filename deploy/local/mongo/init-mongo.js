// Initialize the openghm database with required collections and seed data.
// This script runs automatically on first MongoDB startup via docker-entrypoint-initdb.d.

db = db.getSiblingDB("openghm");

db.createCollection("users");
db.createCollection("jobs");
db.createCollection("catalog");

// Seed users for development (password: admin123 / user123)
db.users.insertMany([
  {
    _id: "mock-admin-001",
    email: "admin@openghm.dev",
    name: "James Carter",
    role: "admin",
    organization: "OpenGHM Dev",
    password_hash: "$2b$12$ggwyWe3n1TyyXfRziRMz7.iLbLQJ0YgELN4ihCTa6faIcDrE7T7gK",
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    _id: "mock-user-001",
    email: "user@openghm.dev",
    name: "Mia Johnson",
    role: "user",
    organization: null,
    password_hash: "$2b$12$W90rcxJou1XCaqvg6qfoNOl4Sbqpl8a6vFf9uBH4EYYTUCH7tcbsm",
    created_at: new Date(),
    updated_at: new Date(),
  },
]);

db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ role: 1 });

// Job indexes
db.jobs.createIndex({ user_id: 1, created_at: -1 });
db.jobs.createIndex({ status: 1 });
db.jobs.createIndex({ slurm_job_id: 1 }, { sparse: true });
