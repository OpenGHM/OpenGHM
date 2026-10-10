"""The home page's "Latest Datasets & News" feed (ADR 0034).

Three sources: published news posts, published workshops and the datasets the
catalogue shows. Each becomes a `FeedItem`; the home page takes the pinned
items first, in their pinned order, then the newest of the rest, up to
`settings.count`. A pin shows while its item exists and is published (or, for a
dataset, not private), whether or not its source is switched on; a pin whose
item is gone is skipped here and flagged on the admin page.

What "newest" means differs by source, on purpose: a news post by its own
`date`, a workshop by when it was announced (`created_at`, not the day it
takes place) and a dataset by when the gateway registered it (`registered_at`).
Ties on the day are broken by the time the record was written.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.core.database import get_db
from app.models.home import (
    FeedImage,
    FeedItem,
    FeedKind,
    HomeUpdatesSettings,
    PinReason,
)

# The same collections app.api.v1.community and app.api.v1.repository write.
NEWS = "community_news"
WORKSHOPS = "community_workshops"
DATASETS = "datasets"
SETTINGS = "site_settings"
SETTINGS_ID = "home_updates"

COLLECTIONS: dict[FeedKind, str] = {"news": NEWS, "workshop": WORKSHOPS, "dataset": DATASETS}

#: The /news page shows at most this many items.
ARCHIVE_MAX = 60
#: A card's summary is cut to this many characters.
SUMMARY_MAX = 400
#: The admin picker lists at most this many candidates.
CANDIDATES_MAX = 50
#: How far back, per source, the picker searches.
CANDIDATE_POOL = 200

NEWS_TAG_LABELS = {
    "announcement": "Announcement",
    "platform": "Platform Update",
    "dataset": "New Dataset",
    "event": "Community Event",
    "other": "News",
}

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

#: (day, written at): sorts a feed, newest last.
_Key = tuple[str, datetime]


def _aware(value: object) -> datetime:
    if not isinstance(value, datetime):
        return _EPOCH
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _clip(text: str | None) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= SUMMARY_MAX else text[: SUMMARY_MAX - 1].rstrip() + "…"


def _image(cover: dict | None) -> FeedImage | None:
    return FeedImage(url=cover["url"], alt=cover.get("alt") or "") if cover else None


def news_item(doc: dict) -> tuple[_Key, FeedItem]:
    has_body = bool((doc.get("body") or {}).get("content"))
    href = f"/news/{doc['slug']}" if has_body else doc.get("link_url")
    item = FeedItem(
        kind="news",
        id=doc["_id"],
        title=doc["title"],
        summary=doc.get("summary") or "",
        tag=doc.get("tag") or "other",
        tag_label=NEWS_TAG_LABELS[doc.get("tag") or "other"],
        image=_image(doc.get("cover")),
        href=href or None,
        link_label=(doc.get("link_label") or "Read more") if href else None,
        date=doc["date"],
    )
    return (item.date, _aware(doc.get("created_at"))), item


def workshop_item(doc: dict) -> tuple[_Key, FeedItem]:
    announced = _aware(doc.get("created_at"))
    item = FeedItem(
        kind="workshop",
        id=doc["_id"],
        title=doc["title"],
        summary=doc.get("summary") or "",
        tag="event",
        tag_label=NEWS_TAG_LABELS["event"],
        image=_image(doc.get("cover")),
        href=f"/community/workshops/{doc['slug']}",
        link_label="View workshop",
        date=announced.date().isoformat(),
    )
    return (item.date, announced), item


def dataset_item(doc: dict) -> tuple[_Key, FeedItem]:
    """From a catalogue envelope; the title and description are the metadata's
    `about.name` and `about.description`."""
    about = (doc.get("document") or {}).get("about") or {}
    registered = _aware(doc.get("registered_at"))
    item = FeedItem(
        kind="dataset",
        id=doc["_id"],
        title=about.get("name") or doc["_id"],
        summary=_clip(about.get("description")),
        tag="dataset",
        tag_label=NEWS_TAG_LABELS["dataset"],
        image=None,
        href=f"/repository/{doc['_id']}",
        link_label="Access Data",
        date=registered.date().isoformat(),
    )
    return (item.date, registered), item


_BUILDERS = {"news": news_item, "workshop": workshop_item, "dataset": dataset_item}

def build_item(kind: FeedKind, doc: dict) -> FeedItem:
    """The feed item of a stored document of `kind`."""
    return _BUILDERS[kind](doc)[1]


# A dataset's envelope is big (the whole metadata.json); the feed needs three fields of it.
_DATASET_FIELDS = {"document.about.name": 1, "document.about.description": 1, "registered_at": 1}

#: What shows publicly, per source.
_SHOWN: dict[FeedKind, dict] = {
    "news": {"state": "published"},
    "workshop": {"state": "published"},
    "dataset": {"visibility": {"$ne": "private"}},
}


def unavailable_reason(kind: FeedKind, doc: dict | None) -> PinReason | None:
    """Why an item is not shown publicly, or None when it is."""
    if doc is None:
        return "missing"
    if kind == "dataset":
        return "private" if doc.get("visibility") == "private" else None
    return None if doc.get("state") == "published" else "unpublished"


async def find_item(kind: FeedKind, item_id: str) -> dict | None:
    """The stored document, shown or not."""
    return await get_db()[COLLECTIONS[kind]].find_one({"_id": item_id})


async def _recent(kind: FeedKind, limit: int) -> list[tuple[_Key, FeedItem]]:
    """The newest `limit` publicly shown items of one source, newest first."""
    cursor = get_db()[COLLECTIONS[kind]]
    if kind == "news":
        found = cursor.find(_SHOWN[kind]).sort([("date", -1), ("created_at", -1)])
    elif kind == "workshop":
        found = cursor.find(_SHOWN[kind]).sort("created_at", -1)
    else:
        found = cursor.find(_SHOWN[kind], _DATASET_FIELDS).sort("registered_at", -1)
    docs = await found.limit(limit).to_list(limit)
    return [_BUILDERS[kind](d) for d in docs]


def _enabled(settings: HomeUpdatesSettings) -> list[FeedKind]:
    flags = settings.sources
    return [k for k, on in (("news", flags.news), ("workshop", flags.workshops), ("dataset", flags.datasets)) if on]


def _newest_first(rows: list[tuple[_Key, FeedItem]]) -> list[FeedItem]:
    return [item for _key, item in sorted(rows, key=lambda r: r[0], reverse=True)]


async def load_settings() -> HomeUpdatesSettings:
    doc = await get_db()[SETTINGS].find_one({"_id": SETTINGS_ID})
    return HomeUpdatesSettings.model_validate(doc or {})


async def pinned_items(settings: HomeUpdatesSettings) -> list[FeedItem]:
    """The pins that still show, in pinned order; a dead pin is skipped."""
    shown: list[FeedItem] = []
    for pin in settings.pins:
        doc = await find_item(pin.kind, pin.id)
        if unavailable_reason(pin.kind, doc) is None:
            shown.append(build_item(pin.kind, doc).model_copy(update={"pinned": True}))
    return shown


async def home_feed(settings: HomeUpdatesSettings) -> list[FeedItem]:
    """What the home page shows: the pins, then the newest of the enabled sources, `count` in all."""
    pins = (await pinned_items(settings))[: settings.count]
    taken = {(i.kind, i.id) for i in pins}
    pool: list[tuple[_Key, FeedItem]] = []
    for kind in _enabled(settings):
        # Enough to fill the page even when every pin came from this source.
        pool += await _recent(kind, settings.count + len(settings.pins))
    rest = [i for i in _newest_first(pool) if (i.kind, i.id) not in taken]
    return pins + rest[: settings.count - len(pins)]


async def archive(settings: HomeUpdatesSettings) -> list[FeedItem]:
    """The /news page: the enabled sources, newest first, no pins first."""
    pool: list[tuple[_Key, FeedItem]] = []
    for kind in _enabled(settings):
        pool += await _recent(kind, ARCHIVE_MAX)
    return _newest_first(pool)[:ARCHIVE_MAX]


async def candidates(
    settings: HomeUpdatesSettings, *, q: str | None = None, kind: FeedKind | None = None
) -> list[FeedItem]:
    """What an admin may pin: recent shown items of every source (a source that
    is switched off included: a pin outlives the switch), newest first."""
    pool: list[tuple[_Key, FeedItem]] = []
    for source in ([kind] if kind else list(COLLECTIONS)):
        pool += await _recent(source, CANDIDATE_POOL)
    items = _newest_first(pool)
    needle = (q or "").strip().lower()
    if needle:
        items = [i for i in items if needle in i.title.lower() or needle in i.summary.lower()]
    pinned = {(p.kind, p.id) for p in settings.pins}
    return [
        i.model_copy(update={"pinned": (i.kind, i.id) in pinned}) for i in items[:CANDIDATES_MAX]
    ]
