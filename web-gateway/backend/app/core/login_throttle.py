"""Failed password sign-ins, counted so POST /auth/login can refuse a guesser.

One document per failure in `login_failures`, keyed by the attempted email
(lowercased, whether or not an account has it — an unknown address counts like
a wrong password, so the throttle does not say which addresses exist) and,
separately, by the client IP when a trustworthy one is known. A key is blocked
once it has `*_LIMIT` failures inside `WINDOW`. Counting reads `created_at`
rather than trusting the TTL index on `expires_at`, because Mongo's reaper runs
about once a minute. The counters live in Mongo, not in the pod, so a restart
does not hand an attacker a fresh allowance.

A blocked attempt records nothing, so a key holds at most its limit in
documents, and a correct password during the window gets no further than a wrong
one: the check runs before the password is looked at. A correct sign-in clears
its email's failures but not the IP's: one success must not erase what the same
address did to other accounts.

The count-then-insert is not atomic, so a burst of parallel guesses can pass the
limit by about as many as are in flight. bcrypt makes each of those slow, and
the limit is a brake, not a quota.
"""

import ipaddress
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import settings

COLLECTION = "login_failures"

WINDOW = timedelta(minutes=15)
EMAIL_LIMIT = 10
IP_LIMIT = 50

_EMAIL = "email"
_IP = "ip"


def client_ip(x_internal_auth: str | None, x_client_ip: str | None) -> str | None:
    """The address a sign-in came from, as the frontend reports it, or None.

    The backend has no Ingress (docs/architecture/gateway.md §2): its only
    caller is the frontend's server, so the socket peer is always the
    frontend's pod and says nothing about the person. The frontend therefore
    passes the address in `X-Client-IP`, and it is believed only when the
    request also carries `INTERNAL_SERVICE_SECRET` in `X-Internal-Auth`, the
    same proof `POST /auth/sso-login` asks for. Without that proof, or with no
    secret configured, there is no IP: counting by the pod's address would put
    every user in one bucket and let fifty wrong guesses lock everyone out.

    An IPv6 address is keyed by its /64, the smallest block one subscriber
    holds, so rotating through the low bits does not slip the limit.
    """
    secret = settings.INTERNAL_SERVICE_SECRET
    if not secret or not x_internal_auth or not secrets.compare_digest(x_internal_auth, secret):
        return None
    if not x_client_ip:
        return None
    try:
        address = ipaddress.ip_address(x_client_ip.strip())
    except ValueError:
        return None
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def _keys(email: str, ip: str | None) -> list[tuple[str, str, int]]:
    keys = [(_EMAIL, email.strip().lower(), EMAIL_LIMIT)]
    if ip is not None:
        keys.append((_IP, ip, IP_LIMIT))
    return keys


async def blocked_by(db, email: str, ip: str | None) -> str | None:
    """"email" or "ip" when that key has used up its failures, else None."""
    since = datetime.now(timezone.utc) - WINDOW
    for kind, key, limit in _keys(email, ip):
        count = await db[COLLECTION].count_documents(
            {"kind": kind, "key": key, "created_at": {"$gte": since}}
        )
        if count >= limit:
            return kind
    return None


async def record_failure(db, email: str, ip: str | None) -> None:
    now = datetime.now(timezone.utc)
    for kind, key, _limit in _keys(email, ip):
        await db[COLLECTION].insert_one(
            {
                "_id": secrets.token_hex(16),
                "kind": kind,
                "key": key,
                "created_at": now,
                "expires_at": now + WINDOW,
            }
        )


async def clear_email(db, email: str) -> None:
    await db[COLLECTION].delete_many({"kind": _EMAIL, "key": email.strip().lower()})
