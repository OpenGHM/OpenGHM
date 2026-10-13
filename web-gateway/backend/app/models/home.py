"""The home page's "Latest Datasets & News" feed (ADR 0034), as the API takes
and sends it.

`HomeUpdatesSettingsInput` is what an admin writes (it carries the checks);
`HomeUpdatesSettings` is what is stored and sent back, with plain types.
Snake_case on the wire; the frontend mirrors these in lib/home/types.ts.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

FeedKind = Literal["news", "workshop", "dataset"]
#: Colours a card's tag pill; the closed list of News posts' tags.
FeedTag = Literal["announcement", "dataset", "event", "other"]
PinReason = Literal["missing", "unpublished", "private"]

DEFAULT_TITLE = "Latest Datasets & News"
DEFAULT_EYEBROW = "What's New"
DEFAULT_COUNT = 3
COUNT_MIN = 1
COUNT_MAX = 12
#: At most this many pinned items.
PINS_MAX = 12


class FeedImage(BaseModel):
    url: str
    alt: str = ""


class FeedCoverage(BaseModel):
    """A dataset's bounding box in degrees, for its map thumbnail."""

    north: float
    south: float
    east: float
    west: float


class FeedItem(BaseModel):
    kind: FeedKind
    id: str
    title: str
    summary: str
    tag: FeedTag
    tag_label: str
    #: None: the frontend shows the kind's own picture.
    image: FeedImage | None = None
    #: A dataset's bounding box; the frontend draws its map when `image` is None.
    coverage: FeedCoverage | None = None
    #: None: the card is not a link.
    href: str | None = None
    link_label: str | None = None
    #: YYYY-MM-DD.
    date: str
    pinned: bool = False


class Pin(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kind: FeedKind
    id: str = Field(min_length=1, max_length=64)


def _unique_pins(pins: list[Pin]) -> list[Pin]:
    if len({(p.kind, p.id) for p in pins}) != len(pins):
        raise ValueError("Each item may be pinned once.")
    return pins


class Sources(BaseModel):
    news: bool = True
    workshops: bool = True
    datasets: bool = True


class HomeUpdatesSettingsInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    title: str = Field(DEFAULT_TITLE, min_length=1, max_length=200)
    eyebrow: str = Field(DEFAULT_EYEBROW, min_length=1, max_length=100)
    count: int = Field(DEFAULT_COUNT, ge=COUNT_MIN, le=COUNT_MAX)
    sources: Sources = Field(default_factory=Sources)
    #: In the order they show, first first.
    pins: Annotated[list[Pin], Field(max_length=PINS_MAX), AfterValidator(_unique_pins)] = []


class HomeUpdatesSettings(BaseModel):
    title: str = DEFAULT_TITLE
    eyebrow: str = DEFAULT_EYEBROW
    count: int = DEFAULT_COUNT
    sources: Sources = Field(default_factory=Sources)
    pins: list[Pin] = []
    #: None until an admin saves the settings for the first time.
    updated_at: datetime | None = None
    updated_by: str | None = None


class PublicSettings(BaseModel):
    """What the home page needs of the settings: no pins, no audit fields."""

    title: str
    eyebrow: str
    count: int
    sources: Sources


class HomeUpdates(BaseModel):
    settings: PublicSettings
    items: list[FeedItem]


class UpdatesArchive(BaseModel):
    """The /news page: the same sources, newest first, no pins and no count."""

    items: list[FeedItem]


class PinStatus(BaseModel):
    """One pin as the admin page lists it: what it points to, or why it does not show."""

    kind: FeedKind
    id: str
    available: bool
    #: Why an unavailable pin does not show; None when it does.
    reason: PinReason | None = None
    #: The item's own title when it still exists, so the row can name it.
    title: str | None = None
    item: FeedItem | None = None


class HomeUpdatesAdmin(BaseModel):
    title: str
    eyebrow: str
    count: int
    sources: Sources
    pins: list[PinStatus]
    updated_at: datetime | None = None
    updated_by: str | None = None


class PinRequest(BaseModel):
    kind: FeedKind
    id: str = Field(min_length=1, max_length=64)
