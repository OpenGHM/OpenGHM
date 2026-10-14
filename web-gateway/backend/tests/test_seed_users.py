"""The local dev seed (deploy/local/mongo/init-mongo.js) and ADR 0024.

The "Dev quick login" accounts must be ordinary accounts. Seeded under a
mock-auth identity's id (MOCK_USER_IDS) they could never submit a run,
because the backend refuses those ids whatever the environment, which is what
keeps the identity a header-less dev request resolves to off the SLURM
allocation. This guards the two from being coupled again.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.security import MOCK_USER_IDS

MONGO_DIR = Path(__file__).resolve().parents[3] / "deploy" / "local" / "mongo"


def _seeded_users() -> dict[str, str]:
    """`_id` -> the source text of that user's seed document."""
    source = (MONGO_DIR / "init-mongo.js").read_text()
    block = source.split("db.users.insertMany([", 1)[1].split("]);", 1)[0]
    # Each document opens with its `_id`; the text up to the next one is its body.
    parts = re.split(r'\n\s*_id:\s*"([^"]+)"', "\n" + block)
    return dict(zip(parts[1::2], parts[2::2]))


def test_the_seed_has_the_two_quick_login_accounts():
    users = _seeded_users()
    assert len(users) == 2
    emails = {re.search(r'email:\s*"([^"]+)"', body).group(1) for body in users.values()}
    assert emails == {"admin@openghm.dev", "user@openghm.dev"}


def test_no_seeded_id_is_a_mock_identity():
    assert not set(_seeded_users()) & MOCK_USER_IDS


@pytest.mark.parametrize("field", ["email_verified", "is_active"])
def test_every_seeded_user_is_verified_and_active(field):
    for user_id, body in _seeded_users().items():
        assert re.search(rf"\b{field}:\s*true\b", body), f"{user_id}: {field}"


def test_the_seeded_user_may_submit_runs():
    (body,) = [b for b in _seeded_users().values() if re.search(r'role:\s*"user"', b)]
    assert re.search(r"\bcan_run_simulations:\s*true\b", body)


def test_the_migration_targets_the_seeded_ids():
    migration = (MONGO_DIR / "migrate_seed_users.js").read_text()
    targets = set(re.findall(r'\bto:\s*"([^"]+)"', migration))
    sources = set(re.findall(r'\bfrom:\s*"([^"]+)"', migration))
    assert targets == set(_seeded_users())
    assert sources <= MOCK_USER_IDS


def test_the_seed_declares_the_same_identity_index_as_the_gateway():
    source = (MONGO_DIR / "init-mongo.js").read_text()
    assert re.search(
        r"db\.users\.createIndex\(\s*\{ sso_external_id: 1 \},\s*"
        r"\{ unique: true, partialFilterExpression: \{ sso_external_id: \{ \$type: \"string\" \} \} \}\s*\)",
        source,
    )
