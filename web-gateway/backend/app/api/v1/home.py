"""The home page's "Latest Snapshots & News" section (ADR 0034).

Two routers. `router` (`/home`) is anonymous: the feed the home page shows and
the longer list behind "View all updates". `admin_router` (`/admin/home`) needs
`content:manage` (admin only): the section's settings and pins, and the list of
items an admin may pin. Every write is audit-logged in the `content` category.
The news posts themselves are written in app.api.v1.community.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.api.v1.community import _audit, _changes, _content_manager, _error, _not_found
from app.core.database import get_db
from app.models.home import (
    PINS_MAX,
    FeedItem,
    FeedKind,
    HomeUpdates,
    HomeUpdatesAdmin,
    HomeUpdatesSettings,
    HomeUpdatesSettingsInput,
    Pin,
    PinRequest,
    PinStatus,
    PublicSettings,
    UpdatesArchive,
)
from app.models.user import TokenPayload
from app.services import home_feed

router = APIRouter(prefix="/home", tags=["home"])
admin_router = APIRouter(prefix="/admin/home", tags=["home-admin"])


# ---- public -----------------------------------------------------------------


@router.get("/updates", response_model=HomeUpdates)
async def get_updates():
    """The cards of the home page: pinned items first, then the newest, `count` in all."""
    settings = await home_feed.load_settings()
    return HomeUpdates(
        settings=PublicSettings(
            title=settings.title,
            eyebrow=settings.eyebrow,
            count=settings.count,
            sources=settings.sources,
        ),
        items=await home_feed.home_feed(settings),
    )


@router.get("/updates/all", response_model=UpdatesArchive)
async def get_all_updates():
    """The /news page: the same sources, newest first, without the count limit."""
    return UpdatesArchive(items=await home_feed.archive(await home_feed.load_settings()))


# ---- admin ------------------------------------------------------------------


async def _admin_view(settings: HomeUpdatesSettings) -> HomeUpdatesAdmin:
    """The settings with each pin looked up: shown, or why it is not."""
    pins: list[PinStatus] = []
    for pin in settings.pins:
        doc = await home_feed.find_item(pin.kind, pin.id)
        reason = home_feed.unavailable_reason(pin.kind, doc)
        item = None
        title = None
        if doc is not None:
            built = home_feed.build_item(pin.kind, doc)
            title = built.title
            if reason is None:
                item = built.model_copy(update={"pinned": True})
        pins.append(
            PinStatus(
                kind=pin.kind, id=pin.id, available=reason is None, reason=reason, title=title, item=item
            )
        )
    return HomeUpdatesAdmin(
        title=settings.title,
        eyebrow=settings.eyebrow,
        count=settings.count,
        sources=settings.sources,
        pins=pins,
        updated_at=settings.updated_at,
        updated_by=settings.updated_by,
    )


async def _save(user: TokenPayload, fields: dict) -> HomeUpdatesSettings:
    await get_db()[home_feed.SETTINGS].update_one(
        {"_id": home_feed.SETTINGS_ID}, {"$set": _changes(user, fields)}, upsert=True
    )
    return await home_feed.load_settings()


@admin_router.get("/settings", response_model=HomeUpdatesAdmin)
async def get_settings(_user: TokenPayload = Depends(_content_manager)):
    return await _admin_view(await home_feed.load_settings())


@admin_router.put("/settings", response_model=HomeUpdatesAdmin)
async def put_settings(
    body: HomeUpdatesSettingsInput, user: TokenPayload = Depends(_content_manager)
):
    """Save the section's words, count, sources and pins. A pin must point to an
    item that exists (a draft is allowed: the admin page flags it); 422 otherwise."""
    for pin in body.pins:
        if await home_feed.find_item(pin.kind, pin.id) is None:
            raise _error(
                422, "unknown_pin", f"The pinned {pin.kind} '{pin.id}' no longer exists. Remove the pin."
            )
    saved = await _save(user, body.model_dump())
    await _audit(
        user, "home.settings.update", home_feed.SETTINGS_ID,
        count=body.count, sources=body.sources.model_dump(),
        pins=[f"{p.kind}:{p.id}" for p in body.pins],
    )
    return await _admin_view(saved)


@admin_router.get("/candidates", response_model=list[FeedItem])
async def get_candidates(
    q: str | None = Query(default=None, max_length=200),
    kind: Literal["news", "workshop", "dataset"] | None = None,
    _user: TokenPayload = Depends(_content_manager),
):
    """Recent items an admin may pin, newest first, from every source."""
    return await home_feed.candidates(await home_feed.load_settings(), q=q, kind=kind)


@admin_router.post("/pins", response_model=HomeUpdatesAdmin)
async def add_pin(body: PinRequest, user: TokenPayload = Depends(_content_manager)):
    """Pin an item at the end of the pins. Pinning what is pinned changes nothing."""
    if await home_feed.find_item(body.kind, body.id) is None:
        raise _not_found(body.kind)
    settings = await home_feed.load_settings()
    if any(p.kind == body.kind and p.id == body.id for p in settings.pins):
        return await _admin_view(settings)
    if len(settings.pins) >= PINS_MAX:
        raise _error(409, "pins_full", f"At most {PINS_MAX} items can be pinned. Unpin one first.")
    pins = [*settings.pins, Pin(kind=body.kind, id=body.id)]
    saved = await _save(user, {"pins": [p.model_dump() for p in pins]})
    await _audit(user, "home.pin.add", f"{body.kind}:{body.id}")
    return await _admin_view(saved)


@admin_router.delete("/pins/{kind}/{item_id}", response_model=HomeUpdatesAdmin)
async def remove_pin(
    kind: FeedKind, item_id: str, user: TokenPayload = Depends(_content_manager)
):
    """Unpin an item, whether or not it still exists. Unpinning what is not pinned changes nothing."""
    settings = await home_feed.load_settings()
    pins = [p for p in settings.pins if not (p.kind == kind and p.id == item_id)]
    if len(pins) == len(settings.pins):
        return await _admin_view(settings)
    saved = await _save(user, {"pins": [p.model_dump() for p in pins]})
    await _audit(user, "home.pin.remove", f"{kind}:{item_id}")
    return await _admin_view(saved)
