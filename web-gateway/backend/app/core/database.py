from datetime import timezone

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.core.config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        # Every datetime the app writes is aware UTC, and BSON stores UTC. Without
        # tz_aware, PyMongo hands them back naive, and a naive datetime
        # serialises without an offset, which a browser reads as local time.
        # With it, everything read from Mongo is aware UTC, so the API's
        # timestamps end in `Z` and aware/naive never mix in a comparison.
        _client = AsyncIOMotorClient(
            settings.MONGODB_URL, tz_aware=True, tzinfo=timezone.utc
        )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.MONGODB_DB_NAME]


async def close_db():
    global _client
    if _client:
        _client.close()
        _client = None
