"""The Community page's content (ADR 0034), as the API takes and sends it.

Each kind comes in two shapes. The `*Input` class is what an admin writes and
carries every check (app.services.community_content for the content rules).
The class without the suffix is what is stored and sent back, with plain
types: a stored document is read back as it is, not re-judged by rules that
may have changed since it was written.

Snake_case on the wire; the frontend mirrors these in lib/community/types.ts.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services import community_content as content

ContentState = Literal["draft", "published"]
TutorialKind = Literal["gateway", "notebook", "video", "guide"]
TutorialLevel = Literal["beginner", "intermediate", "advanced"]
PublicationType = Literal["paper", "dataset", "software", "talk"]

Slug = Annotated[str, AfterValidator(content.check_slug)]
IsoDate = Annotated[str, AfterValidator(content.check_iso_date)]
LinkUrl = Annotated[str, AfterValidator(content.check_link_url)]
ImageUrl = Annotated[str, AfterValidator(content.check_image_url)]


def _blank_to_none(value):
    """An emptied text box arrives as "": that means "not set"."""
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _written(**fields) -> ConfigDict:
    # Extra keys are ignored, not refused: an editor may send back the whole
    # document it loaded (id, timestamps, derived status) as the update.
    return ConfigDict(str_strip_whitespace=True, extra="ignore", **fields)


# ---- parts shared by input and output ---------------------------------------


class WorkshopCover(BaseModel):
    model_config = _written()
    url: ImageUrl
    alt: str = Field("", max_length=300)
    caption: str | None = Field(None, max_length=300)

    _blank = field_validator("caption", mode="before")(_blank_to_none)


class WorkshopLink(BaseModel):
    model_config = _written()
    label: str = Field(min_length=1, max_length=80)
    url: LinkUrl


class WorkshopDetail(BaseModel):
    model_config = _written()
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=300)


class WorkshopMaterial(BaseModel):
    model_config = _written()
    name: str = Field(min_length=1, max_length=200)
    url: LinkUrl
    note: str | None = Field(None, max_length=300)

    _blank = field_validator("note", mode="before")(_blank_to_none)


class _Meta(BaseModel):
    id: str
    state: ContentState
    created_at: datetime
    updated_at: datetime
    updated_by: str | None = None


# ---- workshops --------------------------------------------------------------


class WorkshopInput(BaseModel):
    model_config = _written()

    state: ContentState
    slug: Slug
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field("", max_length=500)
    #: The first day.
    date: IsoDate
    end_date: IsoDate | None = None
    #: Shown instead of the formatted date, e.g. "February–March 2027".
    when_label: str | None = Field(None, max_length=100)
    format: str | None = Field(None, max_length=60)
    location: str | None = Field(None, max_length=200)
    cover: WorkshopCover | None = None
    signup: WorkshopLink | None = None
    details: list[WorkshopDetail] = Field(default_factory=list, max_length=20)
    materials: list[WorkshopMaterial] = Field(default_factory=list, max_length=40)
    body: dict | None = None

    _blank = field_validator("end_date", "when_label", "format", "location", mode="before")(
        _blank_to_none
    )

    @field_validator("body")
    @classmethod
    def _body(cls, value: dict | None) -> dict | None:
        return None if value is None else content.validate_rich_text(value)

    @model_validator(mode="after")
    def _end_not_before_start(self):
        if self.end_date is not None and self.end_date < self.date:
            raise ValueError("The last day cannot be before the first day.")
        return self


class Workshop(_Meta):
    slug: str
    title: str
    summary: str
    date: str
    end_date: str | None = None
    when_label: str | None = None
    format: str | None = None
    location: str | None = None
    cover: WorkshopCover | None = None
    signup: WorkshopLink | None = None
    details: list[WorkshopDetail] = []
    materials: list[WorkshopMaterial] = []
    body: dict | None = None
    #: Derived, not stored: "past" once the last day is before today (UTC).
    status: Literal["upcoming", "past"]


class WorkshopCard(_Meta):
    """A workshop as the Community page lists it: no body, materials or details,
    but how many materials there are."""

    slug: str
    title: str
    summary: str
    date: str
    end_date: str | None = None
    when_label: str | None = None
    format: str | None = None
    location: str | None = None
    cover: WorkshopCover | None = None
    signup: WorkshopLink | None = None
    status: Literal["upcoming", "past"]
    material_count: int


# ---- tutorials --------------------------------------------------------------


class TutorialInput(BaseModel):
    model_config = _written()

    state: ContentState
    slug: Slug
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field("", max_length=400)
    kind: TutorialKind
    minutes: int | None = Field(None, ge=1, le=600)
    level: TutorialLevel
    #: Plain text for the card's dark code header; may be "".
    snippet: str = Field("", max_length=600)
    #: None: the kind's default ("Start tutorial", "Open notebook", "Watch video").
    action_label: str | None = Field(None, max_length=60)
    url: LinkUrl | None = None
    body: dict | None = None

    _blank = field_validator("action_label", "url", mode="before")(_blank_to_none)

    @field_validator("body")
    @classmethod
    def _body(cls, value: dict | None) -> dict | None:
        return None if value is None else content.validate_rich_text(value)


class Tutorial(_Meta):
    slug: str
    title: str
    summary: str
    kind: TutorialKind
    minutes: int | None = None
    level: TutorialLevel
    snippet: str = ""
    action_label: str | None = None
    url: str | None = None
    body: dict | None = None
    position: int


class TutorialCard(_Meta):
    """A tutorial as the Community page lists it: no body, but whether it has one."""

    slug: str
    title: str
    summary: str
    kind: TutorialKind
    minutes: int | None = None
    level: TutorialLevel
    snippet: str = ""
    action_label: str | None = None
    url: str | None = None
    position: int
    has_body: bool


class ReorderRequest(BaseModel):
    ids: list[str] = Field(max_length=500)


# ---- news posts -------------------------------------------------------------

NewsTag = Literal["announcement", "platform", "dataset", "event", "other"]
DEFAULT_NEWS_LINK_LABEL = "Read more"


def _news_link(value: str) -> str:
    """A news card's link: http(s):// or a path on this site, not mailto:."""
    value = content.check_link_url(value)
    if value.lower().startswith("mailto:"):
        raise ValueError("Use an http(s):// address or a path that starts with a single '/'.")
    return value


NewsLinkUrl = Annotated[str, AfterValidator(_news_link)]


def _today() -> str:
    return content.utc_today().isoformat()


class NewsCover(BaseModel):
    model_config = _written()
    url: ImageUrl
    alt: str = Field("", max_length=300)


class NewsInput(BaseModel):
    model_config = _written()

    state: ContentState
    slug: Slug
    title: str = Field(min_length=1, max_length=200)
    tag: NewsTag = "other"
    summary: str = Field("", max_length=400)
    cover: NewsCover | None = None
    #: The post's own date, shown on the card; defaults to today (UTC).
    date: IsoDate = Field(default_factory=_today)
    #: The text of the card's link, when it has one.
    link_label: str | None = Field(DEFAULT_NEWS_LINK_LABEL, max_length=80)
    #: Where the card leads when the post has no body of its own.
    link_url: NewsLinkUrl | None = None
    body: dict | None = None

    _blank = field_validator("link_label", "link_url", mode="before")(_blank_to_none)

    @field_validator("body")
    @classmethod
    def _body(cls, value: dict | None) -> dict | None:
        return None if value is None else content.validate_rich_text(value)


class NewsPost(_Meta):
    slug: str
    title: str
    tag: NewsTag = "other"
    summary: str = ""
    cover: NewsCover | None = None
    date: str
    link_label: str | None = None
    link_url: str | None = None
    body: dict | None = None


# ---- bulk actions -----------------------------------------------------------

#: At most this many items in one bulk request.
BULK_MAX = 200

BulkAction = Literal["delete", "publish", "draft"]
_BulkId = Annotated[str, Field(min_length=1, max_length=64)]


def _unique(ids: list[str]) -> list[str]:
    if len(set(ids)) != len(ids):
        raise ValueError("Each item may be listed once.")
    return ids


class BulkRequest(BaseModel):
    """One action for several items of a kind: `delete`, or `publish` and
    `draft`, which only change the state."""

    action: BulkAction
    ids: Annotated[list[_BulkId], Field(min_length=1, max_length=BULK_MAX), AfterValidator(_unique)]


class BulkDeleteRequest(BaseModel):
    ids: Annotated[list[_BulkId], Field(min_length=1, max_length=BULK_MAX), AfterValidator(_unique)]


class BulkResult(BaseModel):
    """What happened to each id: `done` were changed, `missing` no longer exist."""

    done: list[str]
    missing: list[str]


# ---- publications -----------------------------------------------------------


class PublicationInput(BaseModel):
    model_config = _written()

    state: ContentState
    year: int = Field(ge=1900, le=2100)
    type: PublicationType
    title: str = Field(min_length=1, max_length=400)
    authors: str = Field("", max_length=1000)
    venue: str = Field("", max_length=400)
    #: e.g. "DOI".
    link_label: str | None = Field(None, max_length=40)
    link_url: LinkUrl | None = None
    #: None: "<authors> (<year>). <title>. <venue>."
    citation: str | None = Field(None, max_length=2000)

    _blank = field_validator("link_label", "link_url", "citation", mode="before")(_blank_to_none)


class Publication(_Meta):
    year: int
    type: PublicationType
    title: str
    authors: str = ""
    venue: str = ""
    link_label: str | None = None
    link_url: str | None = None
    citation: str | None = None


# ---- settings and files ------------------------------------------------------

DEFAULT_HERO_TITLE = "Learn, publish and work together"
DEFAULT_HERO_INTRO = (
    "Workshops, tutorials and publications from the OpenGHM project, and groups "
    "where researchers discuss the snapshots they run."
)
DEFAULT_GROUPS_TITLE = "Discussion groups"
DEFAULT_GROUPS_INTRO = (
    "Create a group for your lab, course or study region. Share a snapshot or a "
    "snapshot draft into the conversation and others can open it, compare "
    "settings, and start a new run from it."
)


class CommunitySettingsInput(BaseModel):
    model_config = _written()

    hero_title: str = Field(DEFAULT_HERO_TITLE, min_length=1, max_length=200)
    hero_intro: str = Field(DEFAULT_HERO_INTRO, max_length=1000)
    show_groups: bool = True
    groups_title: str = Field(DEFAULT_GROUPS_TITLE, min_length=1, max_length=200)
    groups_intro: str = Field(DEFAULT_GROUPS_INTRO, max_length=1000)


class CommunitySettings(BaseModel):
    hero_title: str = DEFAULT_HERO_TITLE
    hero_intro: str = DEFAULT_HERO_INTRO
    show_groups: bool = True
    groups_title: str = DEFAULT_GROUPS_TITLE
    groups_intro: str = DEFAULT_GROUPS_INTRO
    #: None until an admin saves the settings for the first time.
    updated_at: datetime | None = None
    updated_by: str | None = None


class CommunityFile(BaseModel):
    id: str
    #: `/api/community/files/<id>`, the address content stores.
    url: str
    filename: str
    content_type: str
    size: int
    uploaded_at: datetime


class CommunityPage(BaseModel):
    settings: CommunitySettings
    workshops: list[WorkshopCard]
    tutorials: list[TutorialCard]
    publications: list[Publication]
