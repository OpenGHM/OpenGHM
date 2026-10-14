"""Startup steps for the `users` collection that need more than one line.

Run from main.py's lifespan on every start. Nothing is in operation yet
(AGENTS.md rule 1), so existing documents are rewritten in place, and each step
is idempotent and cheap on a collection that is already right: the same
pattern as the `institution` rename there.
"""

import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

# Any ASCII uppercase letter: finds the accounts whose email is not lowercase
# yet without reading the rest.
_HAS_UPPERCASE = {"$regex": "[A-Z]"}


async def lowercase_emails(db) -> int:
    """Lowercases every account's email (requests are lowercased as they come
    in, so an uppercase one stored earlier could never be found again). Returns
    how many accounts changed.

    Accounts that would collide once lowercased (`Kim@x.org` beside `kim@x.org`)
    are left exactly as they are and named in a warning: which of the two is
    the person's real account is not for a startup step to guess.
    """
    spelled: dict[str, list[dict]] = defaultdict(list)
    for doc in await db.users.find({"email": _HAS_UPPERCASE}).to_list(None):
        spelled[doc["email"].lower()].append(doc)

    changed = 0
    for lower, docs in spelled.items():
        holder = await db.users.find_one({"email": lower})
        ids = [d["_id"] for d in docs] + ([holder["_id"]] if holder else [])
        if len(ids) > 1:
            logger.warning(
                "Accounts %s share the email %r once lowercased; left as they are "
                "for an administrator to sort out",
                ", ".join(ids),
                lower,
            )
            continue
        await db.users.update_one({"_id": docs[0]["_id"]}, {"$set": {"email": lower}})
        changed += 1

    if changed:
        logger.info("Lowercased %d account email(s)", changed)
    return changed


async def ensure_sso_identity_index(db) -> None:
    """One CILogon identity on one account, enforced by the database.

    Partial, because most accounts have no identity and a plain unique index
    would let only one of them hold the missing value. `$type: "string"` rather
    than `$exists`: an account that lost its identity can carry a null.
    """
    await db.users.create_index(
        "sso_external_id",
        unique=True,
        partialFilterExpression={"sso_external_id": {"$type": "string"}},
    )
