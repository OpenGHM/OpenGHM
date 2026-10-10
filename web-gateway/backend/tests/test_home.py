"""The home page's "Latest Datasets & News" section (ADR 0034): the news posts
an admin writes, the feed the home page shows (what is in it, in what order,
what a pin does), who may change it, and what is audited.

The real routers against the fake Mongo (tests/route_helpers.py), through the
app's own JWTs.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from route_helpers import FakeDB, token_for

from app.api.v1 import community as community_router
from app.api.v1 import home as home_router
from app.core import audit, authz
from app.core.config import settings
from app.core.roles import Role
from app.services import community_content, home_feed

TODAY = date(2026, 10, 10)
ADMIN = token_for("admin-1", Role.ADMIN)
PUBLIC = "/api/v1/home"
ADMIN_HOME = "/api/v1/admin/home"
ADMIN_NEWS = "/api/v1/admin/community/news"


def at(day: str, hour: int = 12) -> datetime:
    y, m, d = map(int, day.split("-"))
    return datetime(y, m, d, hour, tzinfo=timezone.utc)


@pytest.fixture
def mongo(monkeypatch) -> FakeDB:
    fake = FakeDB()
    for module in (community_router, home_feed, audit, authz):
        monkeypatch.setattr(module, "get_db", lambda: fake)
    # home.py reads the database through the feed service and the community helpers.
    monkeypatch.setattr(home_router, "get_db", lambda: fake)
    monkeypatch.setattr(community_content, "utc_today", lambda: TODAY)
    # A developer's local .env turns the X-Mock-Role bypass on; these run as production.
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", False)
    return fake


@pytest.fixture
def http(mongo) -> TestClient:
    app = FastAPI()
    for router in (
        community_router.router, community_router.admin_router,
        home_router.router, home_router.admin_router,
    ):
        app.include_router(router, prefix="/api/v1")
    return TestClient(app)


# ---- builders ---------------------------------------------------------------------


def news(mongo, slug: str, day: str, **over) -> str:
    doc = {
        "_id": f"n-{slug}", "state": "published", "slug": slug, "title": f"News {slug}",
        "tag": "platform", "summary": "Summary.", "cover": None, "date": day,
        "link_label": "Read more", "link_url": None, "body": None,
        "created_at": at(day), "updated_at": at(day), "updated_by": "admin-1",
    }
    doc.update(over)
    mongo.community_news.docs[doc["_id"]] = doc
    return doc["_id"]


def workshop(mongo, slug: str, announced: str, **over) -> str:
    doc = {
        "_id": f"w-{slug}", "state": "published", "slug": slug, "title": f"Workshop {slug}",
        "summary": "A workshop.", "date": "2027-01-01", "cover": None,
        "created_at": at(announced), "updated_at": at(announced),
    }
    doc.update(over)
    mongo.community_workshops.docs[doc["_id"]] = doc
    return doc["_id"]


def dataset(mongo, ident: str, registered: str, **over) -> str:
    doc = {
        "_id": ident,
        "document": {"id": ident, "about": {"name": f"Dataset {ident}", "description": "Describes it."}},
        "owner_user_id": None, "visibility": "public", "registered_at": at(registered),
    }
    doc.update(over)
    mongo.datasets.docs[ident] = doc
    return ident


def configure(http, **over) -> dict:
    body = {
        "title": "Latest Datasets & News", "eyebrow": "What's New", "count": 3,
        "sources": {"news": True, "workshops": True, "datasets": True}, "pins": [],
    }
    r = http.put(f"{ADMIN_HOME}/settings", json={**body, **over}, headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


def feed(http) -> list[dict]:
    r = http.get(f"{PUBLIC}/updates")
    assert r.status_code == 200
    return r.json()["items"]


def ids(items: list[dict]) -> list[str]:
    return [i["id"] for i in items]


def audit_actions(mongo: FakeDB) -> list[str]:
    events = sorted(mongo.audit_events.docs.values(), key=lambda e: e["created_at"])
    assert all(e["category"] == "content" for e in events)
    return [e["action"] for e in events]


# ---- the feed -------------------------------------------------------------------


def test_the_feed_is_public_and_empty_gives_the_defaults(http):
    r = http.get(f"{PUBLIC}/updates")
    assert r.status_code == 200
    assert r.json() == {
        "settings": {
            "title": "Latest Datasets & News", "eyebrow": "What's New", "count": 3,
            "sources": {"news": True, "workshops": True, "datasets": True},
        },
        "items": [],
    }


def test_by_default_the_newest_of_all_three_sources_show_newest_first(http, mongo):
    news(mongo, "a", "2026-10-01")
    news(mongo, "b", "2026-10-08")
    workshop(mongo, "x", "2026-10-05")
    dataset(mongo, "ds-1", "2026-10-03")
    dataset(mongo, "ds-2", "2026-09-01")
    assert ids(feed(http)) == ["n-b", "w-x", "ds-1"]


def test_each_source_has_its_own_date_tag_link_and_picture(http, mongo):
    news(mongo, "a", "2026-10-08", cover={"url": "https://example.org/c.png", "alt": "Cover"})
    workshop(mongo, "x", "2026-10-07", cover={"url": "https://example.org/w.png", "alt": "", "caption": None})
    dataset(mongo, "ds-1", "2026-10-06")
    n, w, d = feed(http)
    assert (n["kind"], n["tag"], n["tag_label"], n["date"]) == ("news", "platform", "Platform Update", "2026-10-08")
    assert n["image"] == {"url": "https://example.org/c.png", "alt": "Cover"}
    assert (w["kind"], w["tag"], w["tag_label"], w["href"]) == (
        "workshop", "event", "Community Event", "/community/workshops/x",
    )
    assert w["date"] == "2026-10-07" and w["image"]["url"] == "https://example.org/w.png"
    assert (d["kind"], d["tag"], d["tag_label"], d["href"]) == (
        "dataset", "dataset", "New Dataset", "/repository/ds-1",
    )
    assert (d["title"], d["summary"], d["date"], d["image"]) == (
        "Dataset ds-1", "Describes it.", "2026-10-06", None,
    )
    assert all(i["pinned"] is False for i in (n, w, d))


def test_a_workshop_is_dated_by_when_it_was_announced_not_by_the_day_it_is_held(http, mongo):
    workshop(mongo, "x", "2026-09-01", date="2027-06-01")
    news(mongo, "a", "2026-09-15")
    assert ids(feed(http)) == ["n-a", "w-x"]
    assert feed(http)[1]["date"] == "2026-09-01"


@pytest.mark.parametrize(
    ("extra", "href", "label"),
    [
        ({}, None, None),
        ({"link_url": "https://example.org/changelog"}, "https://example.org/changelog", "Read more"),
        ({"link_url": "/repository", "link_label": "Browse"}, "/repository", "Browse"),
        ({"link_url": "https://example.org/x", "link_label": None}, "https://example.org/x", "Read more"),
        # A body gives the post a page of its own, and that wins over the address.
        (
            {"body": {"type": "doc", "content": [{"type": "paragraph"}]}, "link_url": "https://example.org/x"},
            "/news/p", "Read more",
        ),
    ],
)
def test_a_news_card_leads_to_its_page_or_its_link_or_nowhere(http, mongo, extra, href, label):
    news(mongo, "p", "2026-10-01", **extra)
    (item,) = feed(http)
    assert (item["href"], item["link_label"]) == (href, label)


def test_a_long_dataset_description_is_cut_for_the_card(http, mongo):
    dataset(mongo, "ds-1", "2026-10-01")
    mongo.datasets.docs["ds-1"]["document"]["about"]["description"] = "word " * 200
    (item,) = feed(http)
    assert len(item["summary"]) <= 400 and item["summary"].endswith("…")


def test_only_published_and_public_items_show(http, mongo):
    news(mongo, "draft", "2026-10-09", state="draft")
    workshop(mongo, "draft", "2026-10-09", state="draft")
    dataset(mongo, "private", "2026-10-09", visibility="private")
    news(mongo, "live", "2026-10-01")
    assert ids(feed(http)) == ["n-live"]
    assert ids(http.get(f"{PUBLIC}/updates/all").json()["items"]) == ["n-live"]


def test_a_dataset_without_a_visibility_is_shown(http, mongo):
    dataset(mongo, "old", "2026-10-01")
    del mongo.datasets.docs["old"]["visibility"]
    assert ids(feed(http)) == ["old"]


def test_the_count_limits_the_feed(http, mongo):
    for n in range(1, 8):
        news(mongo, str(n), f"2026-10-0{n}")
    assert len(feed(http)) == 3
    configure(http, count=5)
    assert ids(feed(http)) == ["n-7", "n-6", "n-5", "n-4", "n-3"]
    configure(http, count=1)
    assert ids(feed(http)) == ["n-7"]


def test_a_source_that_is_off_adds_nothing(http, mongo):
    news(mongo, "a", "2026-10-03")
    workshop(mongo, "x", "2026-10-02")
    dataset(mongo, "ds-1", "2026-10-01")
    configure(http, sources={"news": True, "workshops": False, "datasets": True})
    assert ids(feed(http)) == ["n-a", "ds-1"]
    configure(http, sources={"news": False, "workshops": False, "datasets": True})
    assert ids(feed(http)) == ["ds-1"]
    configure(http, sources={"news": False, "workshops": False, "datasets": False})
    assert feed(http) == []


def test_pinned_items_come_first_in_their_order_even_when_older(http, mongo):
    news(mongo, "new", "2026-10-09")
    news(mongo, "mid", "2026-10-05")
    news(mongo, "old", "2026-01-01")
    dataset(mongo, "ds-old", "2025-01-01")
    configure(http, pins=[{"kind": "dataset", "id": "ds-old"}, {"kind": "news", "id": "n-old"}])
    got = feed(http)
    assert ids(got) == ["ds-old", "n-old", "n-new"]
    assert [i["pinned"] for i in got] == [True, True, False]


def test_a_pin_is_not_listed_twice(http, mongo):
    news(mongo, "new", "2026-10-09")
    news(mongo, "mid", "2026-10-05")
    configure(http, count=2, pins=[{"kind": "news", "id": "n-new"}])
    assert ids(feed(http)) == ["n-new", "n-mid"]


def test_a_pin_shows_although_its_source_is_off(http, mongo):
    news(mongo, "a", "2026-10-09")
    workshop(mongo, "x", "2026-10-01")
    configure(
        http, pins=[{"kind": "workshop", "id": "w-x"}],
        sources={"news": True, "workshops": False, "datasets": False},
    )
    assert ids(feed(http)) == ["w-x", "n-a"]


def test_pins_beyond_the_count_are_cut_and_nothing_else_shows(http, mongo):
    for n in range(1, 4):
        news(mongo, str(n), f"2026-10-0{n}")
    configure(
        http, count=2,
        pins=[{"kind": "news", "id": f"n-{n}"} for n in (1, 2, 3)],
    )
    assert ids(feed(http)) == ["n-1", "n-2"]


def test_a_pin_whose_item_was_deleted_or_unpublished_is_skipped_silently(http, mongo):
    news(mongo, "gone", "2026-10-01")
    news(mongo, "hidden", "2026-10-01")
    dataset(mongo, "secret", "2026-10-01")
    news(mongo, "live", "2026-10-02")
    news(mongo, "other", "2026-09-01")
    configure(http, pins=[
        {"kind": "news", "id": "n-gone"}, {"kind": "news", "id": "n-hidden"},
        {"kind": "dataset", "id": "secret"}, {"kind": "news", "id": "n-live"},
    ])
    del mongo.community_news.docs["n-gone"]
    mongo.community_news.docs["n-hidden"]["state"] = "draft"
    mongo.datasets.docs["secret"]["visibility"] = "private"
    got = feed(http)
    # The live pin first, then the newest of the rest fills the page.
    assert ids(got) == ["n-live", "n-other"]
    assert got[0]["pinned"] is True


def test_ties_on_the_day_go_to_the_later_written_record(http, mongo):
    news(mongo, "first", "2026-10-01", created_at=at("2026-10-01", 9))
    news(mongo, "second", "2026-10-01", created_at=at("2026-10-01", 15))
    assert ids(feed(http)) == ["n-second", "n-first"]


def test_all_updates_is_newest_first_capped_and_ignores_pins_and_count(http, mongo):
    for n in range(1, 10):
        news(mongo, str(n), f"2026-10-0{n}")
    workshop(mongo, "x", "2026-10-09", created_at=at("2026-10-09", 23))
    configure(http, count=2, pins=[{"kind": "news", "id": "n-1"}])
    items = http.get(f"{PUBLIC}/updates/all").json()["items"]
    assert ids(items)[:3] == ["w-x", "n-9", "n-8"] and len(items) == 10
    assert all(i["pinned"] is False for i in items)
    for n in range(10, 80):
        news(mongo, f"p{n}", "2026-09-01")
    assert len(http.get(f"{PUBLIC}/updates/all").json()["items"]) == 60


def test_all_updates_honours_the_source_switches(http, mongo):
    news(mongo, "a", "2026-10-03")
    dataset(mongo, "ds-1", "2026-10-01")
    configure(http, sources={"news": True, "workshops": True, "datasets": False})
    assert ids(http.get(f"{PUBLIC}/updates/all").json()["items"]) == ["n-a"]


# ---- settings -----------------------------------------------------------------------


def test_the_settings_are_saved_and_read_back(http, mongo):
    saved = configure(http, title="  News  ", eyebrow="Fresh", count=5,
                      sources={"news": True, "workshops": False, "datasets": True})
    assert (saved["title"], saved["eyebrow"], saved["count"]) == ("News", "Fresh", 5)
    assert saved["sources"] == {"news": True, "workshops": False, "datasets": True}
    assert saved["updated_by"] == "admin-1" and saved["updated_at"]
    assert http.get(f"{ADMIN_HOME}/settings", headers=ADMIN).json() == saved
    public = http.get(f"{PUBLIC}/updates").json()["settings"]
    assert (public["title"], public["eyebrow"], public["count"]) == ("News", "Fresh", 5)
    assert "pins" not in public
    assert mongo.site_settings.docs["home_updates"]["count"] == 5


def test_the_settings_default_before_anyone_saves_them(http):
    r = http.get(f"{ADMIN_HOME}/settings", headers=ADMIN).json()
    assert (r["title"], r["eyebrow"], r["count"], r["pins"], r["updated_at"]) == (
        "Latest Datasets & News", "What's New", 3, [], None,
    )


@pytest.mark.parametrize(
    "bad",
    [
        {"count": 0}, {"count": 13}, {"title": ""}, {"title": "x" * 201}, {"eyebrow": ""},
        {"sources": {"news": "maybe"}},
        {"pins": [{"kind": "page", "id": "x"}]},
        {"pins": [{"kind": "news", "id": "a"}, {"kind": "news", "id": "a"}]},
        {"pins": [{"kind": "news", "id": f"n{i}"} for i in range(13)]},
    ],
)
def test_invalid_settings_are_422_and_nothing_is_saved(http, mongo, bad):
    r = http.put(f"{ADMIN_HOME}/settings", json=bad, headers=ADMIN)
    assert r.status_code == 422
    assert not mongo.site_settings.docs


def test_saving_a_pin_that_does_not_exist_is_422(http, mongo):
    news(mongo, "a", "2026-10-01")
    r = http.put(
        f"{ADMIN_HOME}/settings", headers=ADMIN,
        json={"pins": [{"kind": "news", "id": "n-a"}, {"kind": "dataset", "id": "nope"}]},
    )
    assert r.status_code == 422 and r.json()["detail"]["code"] == "unknown_pin"
    assert not mongo.site_settings.docs


def test_the_admin_view_flags_pins_that_do_not_show(http, mongo):
    news(mongo, "live", "2026-10-01")
    news(mongo, "draft", "2026-10-01", state="draft")
    news(mongo, "gone", "2026-10-01")
    dataset(mongo, "secret", "2026-10-01")
    configure(http, pins=[
        {"kind": "news", "id": "n-live"}, {"kind": "news", "id": "n-draft"},
        {"kind": "news", "id": "n-gone"}, {"kind": "dataset", "id": "secret"},
    ])
    del mongo.community_news.docs["n-gone"]
    mongo.datasets.docs["secret"]["visibility"] = "private"
    pins = http.get(f"{ADMIN_HOME}/settings", headers=ADMIN).json()["pins"]
    assert [(p["id"], p["available"], p["reason"], p["title"]) for p in pins] == [
        ("n-live", True, None, "News live"),
        ("n-draft", False, "unpublished", "News draft"),
        ("n-gone", False, "missing", None),
        ("secret", False, "private", "Dataset secret"),
    ]
    assert pins[0]["item"]["pinned"] is True and pins[1]["item"] is None


# ---- pin routes ---------------------------------------------------------------------


def test_pins_are_added_at_the_end_and_removed(http, mongo):
    news(mongo, "a", "2026-10-01")
    workshop(mongo, "x", "2026-10-01")
    r = http.post(f"{ADMIN_HOME}/pins", json={"kind": "workshop", "id": "w-x"}, headers=ADMIN)
    assert r.status_code == 200
    r = http.post(f"{ADMIN_HOME}/pins", json={"kind": "news", "id": "n-a"}, headers=ADMIN)
    assert [p["id"] for p in r.json()["pins"]] == ["w-x", "n-a"]
    assert ids(feed(http))[:2] == ["w-x", "n-a"]
    r = http.delete(f"{ADMIN_HOME}/pins/workshop/w-x", headers=ADMIN)
    assert [p["id"] for p in r.json()["pins"]] == ["n-a"]
    assert audit_actions(mongo) == ["home.pin.add", "home.pin.add", "home.pin.remove"]


def test_pinning_twice_or_unpinning_what_is_not_pinned_changes_nothing(http, mongo):
    news(mongo, "a", "2026-10-01")
    for _ in range(2):
        http.post(f"{ADMIN_HOME}/pins", json={"kind": "news", "id": "n-a"}, headers=ADMIN)
    assert len(mongo.site_settings.docs["home_updates"]["pins"]) == 1
    http.delete(f"{ADMIN_HOME}/pins/news/other", headers=ADMIN)
    assert len(mongo.site_settings.docs["home_updates"]["pins"]) == 1
    assert audit_actions(mongo) == ["home.pin.add"]


def test_a_pin_keeps_the_other_settings(http, mongo):
    news(mongo, "a", "2026-10-01")
    configure(http, count=7, title="Mine")
    http.post(f"{ADMIN_HOME}/pins", json={"kind": "news", "id": "n-a"}, headers=ADMIN)
    saved = http.get(f"{ADMIN_HOME}/settings", headers=ADMIN).json()
    assert (saved["count"], saved["title"]) == (7, "Mine")


def test_pinning_what_does_not_exist_is_404_and_a_full_list_is_409(http, mongo):
    r = http.post(f"{ADMIN_HOME}/pins", json={"kind": "dataset", "id": "nope"}, headers=ADMIN)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "dataset_not_found"
    for n in range(13):
        news(mongo, str(n), "2026-10-01")
    for n in range(12):
        assert http.post(f"{ADMIN_HOME}/pins", json={"kind": "news", "id": f"n-{n}"}, headers=ADMIN).status_code == 200
    r = http.post(f"{ADMIN_HOME}/pins", json={"kind": "news", "id": "n-12"}, headers=ADMIN)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "pins_full"


def test_a_dead_pin_can_still_be_removed(http, mongo):
    news(mongo, "a", "2026-10-01")
    configure(http, pins=[{"kind": "news", "id": "n-a"}])
    del mongo.community_news.docs["n-a"]
    r = http.delete(f"{ADMIN_HOME}/pins/news/n-a", headers=ADMIN)
    assert r.status_code == 200 and r.json()["pins"] == []


# ---- candidates -----------------------------------------------------------------------


def test_candidates_list_shown_items_of_every_source_newest_first(http, mongo):
    news(mongo, "a", "2026-10-03")
    news(mongo, "draft", "2026-10-09", state="draft")
    workshop(mongo, "x", "2026-10-02")
    dataset(mongo, "ds-1", "2026-10-01")
    dataset(mongo, "secret", "2026-10-09", visibility="private")
    configure(http, pins=[{"kind": "dataset", "id": "ds-1"}],
              sources={"news": False, "workshops": False, "datasets": False})
    r = http.get(f"{ADMIN_HOME}/candidates", headers=ADMIN)
    assert ids(r.json()) == ["n-a", "w-x", "ds-1"]
    assert [i["pinned"] for i in r.json()] == [False, False, True]


def test_candidates_filter_by_text_and_kind(http, mongo):
    news(mongo, "alpha", "2026-10-03", title="Alpine release")
    workshop(mongo, "x", "2026-10-02", title="Rivers workshop")
    dataset(mongo, "ds-1", "2026-10-01")
    got = lambda **q: ids(http.get(f"{ADMIN_HOME}/candidates", params=q, headers=ADMIN).json())  # noqa: E731
    assert got(q="ALPINE") == ["n-alpha"]
    assert got(kind="workshop") == ["w-x"]
    assert got(q="describes") == ["ds-1"]
    assert got(q="rivers", kind="news") == []
    assert http.get(f"{ADMIN_HOME}/candidates", params={"kind": "page"}, headers=ADMIN).status_code == 422


# ---- who may write ----------------------------------------------------------------------

NEWS_BODY = {"state": "draft", "slug": "n", "title": "N"}
ADMIN_ROUTES = [
    ("get", f"{ADMIN_HOME}/settings", None),
    ("put", f"{ADMIN_HOME}/settings", {}),
    ("get", f"{ADMIN_HOME}/candidates", None),
    ("post", f"{ADMIN_HOME}/pins", {"kind": "news", "id": "x"}),
    ("delete", f"{ADMIN_HOME}/pins/news/x", None),
    ("get", ADMIN_NEWS, None),
    ("post", ADMIN_NEWS, NEWS_BODY),
    ("put", f"{ADMIN_NEWS}/x", NEWS_BODY),
    ("delete", f"{ADMIN_NEWS}/x", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
@pytest.mark.parametrize("role", [Role.GUEST, Role.USER, Role.STAFF])
def test_everyone_but_an_admin_is_403_on_every_admin_route(http, mongo, method, path, body, role):
    r = http.request(method, path, json=body, headers=token_for("someone", role))
    assert r.status_code == 403
    assert "content:manage" in r.json()["detail"]
    assert not mongo.site_settings.docs and not mongo.community_news.docs


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
def test_an_anonymous_caller_is_401_on_every_admin_route(http, method, path, body):
    assert http.request(method, path, json=body).status_code == 401


# ---- news posts ---------------------------------------------------------------------------


def post(slug: str = "v2-released", **over) -> dict:
    body = {
        "state": "published", "slug": slug, "title": "Python API v2.0 Released", "tag": "platform",
        "summary": "Faster.", "cover": None, "date": "2026-10-10", "link_label": "Read more",
        "link_url": None, "body": None,
    }
    return {**body, **over}


def create_news(http, **over) -> dict:
    r = http.post(ADMIN_NEWS, json=post(**over), headers=ADMIN)
    assert r.status_code == 201, r.text
    return r.json()


def doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def test_a_news_post_is_created_read_updated_and_deleted(http, mongo):
    made = create_news(http)
    assert made["tag"] == "platform" and made["created_at"] and made["updated_by"] == "admin-1"
    assert http.get(f"{ADMIN_NEWS}/{made['id']}", headers=ADMIN).json() == made
    assert [p["id"] for p in http.get(ADMIN_NEWS, headers=ADMIN).json()] == [made["id"]]
    r = http.put(f"{ADMIN_NEWS}/{made['id']}", json=post(title="Changed", tag="event"), headers=ADMIN)
    assert (r.json()["title"], r.json()["tag"]) == ("Changed", "event")
    assert http.delete(f"{ADMIN_NEWS}/{made['id']}", headers=ADMIN).status_code == 204
    assert http.get(f"{ADMIN_NEWS}/{made['id']}", headers=ADMIN).status_code == 404
    assert audit_actions(mongo) == ["community.news.create", "community.news.update", "community.news.delete"]


def test_a_post_defaults_to_todays_date_and_the_read_more_link(http):
    made = http.post(ADMIN_NEWS, json={"state": "draft", "slug": "n", "title": "N"}, headers=ADMIN).json()
    assert (made["date"], made["tag"], made["link_label"], made["link_url"]) == (
        "2026-10-10", "other", "Read more", None,
    )


def test_the_admin_list_is_newest_date_first(http):
    create_news(http, slug="a", date="2026-01-01")
    create_news(http, slug="b", date="2026-03-01")
    create_news(http, slug="c", date="2026-02-01")
    assert [p["slug"] for p in http.get(ADMIN_NEWS, headers=ADMIN).json()] == ["b", "c", "a"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("slug", "Not A Slug"), ("slug", ""), ("title", ""), ("title", "x" * 201),
        ("tag", "gossip"), ("summary", "x" * 401), ("date", "2026-13-40"), ("date", "yesterday"),
        ("link_url", "javascript:alert(1)"), ("link_url", "//evil.example"),
        ("link_url", "mailto:a@example.org"), ("link_label", "x" * 81),
        ("cover", {"url": "http://example.org/c.png", "alt": ""}),
        ("cover", {"url": "javascript:alert(1)", "alt": ""}),
        ("body", {"type": "doc", "content": [{"type": "script"}]}),
    ],
)
def test_invalid_news_is_422_and_stores_nothing(http, mongo, field, value):
    r = http.post(ADMIN_NEWS, json=post(**{field: value}), headers=ADMIN)
    assert r.status_code == 422
    assert not mongo.community_news.docs


def test_blank_optional_text_means_not_set(http):
    made = create_news(http, link_url="  ", link_label="")
    assert made["link_url"] is None and made["link_label"] is None


def test_a_slug_is_unique(http):
    first = create_news(http, slug="same")
    r = http.post(ADMIN_NEWS, json=post("same"), headers=ADMIN)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "slug_taken"
    other = create_news(http, slug="other")
    r = http.put(f"{ADMIN_NEWS}/{other['id']}", json=post("same"), headers=ADMIN)
    assert r.status_code == 409
    assert http.put(f"{ADMIN_NEWS}/{first['id']}", json=post("same"), headers=ADMIN).status_code == 200


def test_a_post_with_a_body_has_a_public_page_and_a_draft_or_bodyless_one_does_not(http):
    create_news(http, slug="with", body=doc("Hello"))
    create_news(http, slug="without")
    create_news(http, slug="draft", state="draft", body=doc("Secret"))
    r = http.get("/api/v1/community/news/with")
    assert r.status_code == 200 and r.json()["body"] == doc("Hello")
    for slug in ("without", "draft", "missing"):
        r = http.get(f"/api/v1/community/news/{slug}")
        assert r.status_code == 404 and r.json()["detail"]["code"] == "news_not_found"


def test_news_bulk_actions_change_state_and_delete_and_are_audited(http, mongo):
    a = create_news(http, slug="a", state="draft")
    b = create_news(http, slug="b", state="draft")
    r = http.post(f"{ADMIN_NEWS}/bulk", json={"action": "publish", "ids": [a["id"], "nope"]}, headers=ADMIN)
    assert r.json() == {"done": [a["id"]], "missing": ["nope"]}
    assert mongo.community_news.docs[a["id"]]["state"] == "published"
    http.post(f"{ADMIN_NEWS}/bulk", json={"action": "draft", "ids": [a["id"]]}, headers=ADMIN)
    assert mongo.community_news.docs[a["id"]]["state"] == "draft"
    http.post(f"{ADMIN_NEWS}/bulk", json={"action": "delete", "ids": [a["id"], b["id"]]}, headers=ADMIN)
    assert not mongo.community_news.docs
    assert audit_actions(mongo) == (
        ["community.news.create"] * 2 + ["community.news.update"] * 2 + ["community.news.delete"] * 2
    )


def test_every_settings_write_is_audited_with_the_pins(http, mongo):
    news(mongo, "a", "2026-10-01")
    configure(http, count=4, pins=[{"kind": "news", "id": "n-a"}])
    (event,) = mongo.audit_events.docs.values()
    assert event["action"] == "home.settings.update" and event["actor_id"] == "admin-1"
    assert event["detail"]["count"] == 4 and event["detail"]["pins"] == ["news:n-a"]
