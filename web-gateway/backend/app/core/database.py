from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.core.config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGODB_URL)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.MONGODB_DB_NAME]


async def close_db():
    global _client
    if _client:
        _client.close()
        _client = None
