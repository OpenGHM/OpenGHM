"""The Community page's routes (ADR 0034): what the public sees, who may write,
what a write is allowed to contain, and what an upload is allowed to be.

The real routers against the fake Mongo (tests/route_helpers.py) and a fake
GridFS bucket (tests/gridfs_fake.py), through the app's own JWTs.
"""

from __future__ import annotations

import re
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from gridfs_fake import FakeBucket
from route_helpers import FakeDB, token_for

from app.api.v1 import community as community_router
from app.core import audit, authz
from app.core.config import settings
from app.core.roles import Role
from app.services import community_content, community_files

TODAY = date(2026, 10, 10)
ADMIN = token_for("admin-1", Role.ADMIN)
PUBLIC = "/api/v1/community"
ADMIN_URL = "/api/v1/admin/community"
FILE_ID = "0123456789abcdef01234567"


@pytest.fixture
def mongo(monkeypatch) -> FakeDB:
    fake = FakeDB()
    for module in (community_router, audit, authz):
        monkeypatch.setattr(module, "get_db", lambda: fake)
    fake.bucket = FakeBucket()
    monkeypatch.setattr(community_files, "get_bucket", lambda: fake.bucket)
    monkeypatch.setattr(community_content, "utc_today", lambda: TODAY)
    # A developer's local .env turns the X-Mock-Role bypass on; these run as production.
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", False)
    return fake


@pytest.fixture
def http(mongo) -> TestClient:
    app = FastAPI()
    app.include_router(community_router.router, prefix="/api/v1")
    app.include_router(community_router.admin_router, prefix="/api/v1")
    return TestClient(app)


# ---- builders -------------------------------------------------------------------


def paragraph(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def doc(*blocks: dict) -> dict:
    return {"type": "doc", "content": list(blocks)}


def workshop(slug: str = "first-workshop", **over) -> dict:
    body = {
        "state": "published", "slug": slug, "title": "A workshop", "summary": "About it.",
        "date": "2026-12-01", "end_date": None, "when_label": None, "format": "Online",
        "location": None, "cover": None, "signup": None, "details": [],
        "materials": [], "body": None,
    }
    return {**body, **over}


def tutorial(slug: str = "run-your-first-snapshot", **over) -> dict:
    body = {
        "state": "published", "slug": slug, "title": "A tutorial", "summary": "Learn.",
        "kind": "gateway", "minutes": 20, "level": "beginner", "snippet": "",
        "action_label": None, "url": None, "body": None,
    }
    return {**body, **over}


def publication(**over) -> dict:
    body = {
        "state": "published", "year": 2024, "type": "paper", "title": "A paper",
        "authors": "Doe, J.", "venue": "A Journal", "link_label": None, "link_url": None,
        "citation": None,
    }
    return {**body, **over}


def create(http, kind: str, body: dict, headers=ADMIN) -> dict:
    r = http.post(f"{ADMIN_URL}/{kind}", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def audit_actions(mongo: FakeDB) -> list[str]:
    events = sorted(mongo.audit_events.docs.values(), key=lambda e: e["created_at"])
    assert all(e["category"] == "content" for e in events)
    return [e["action"] for e in events]


# ---- public reads ----------------------------------------------------------------


def test_the_page_is_public_and_empty_gives_the_default_settings(http):
    r = http.get(PUBLIC)
    assert r.status_code == 200
    page = r.json()
    assert page["workshops"] == page["tutorials"] == page["publications"] == []
    assert page["settings"]["hero_title"] == "Learn, publish and work together"
    assert page["settings"]["show_groups"] is True
    assert page["settings"]["groups_title"] == "Discussion groups"
    assert page["settings"]["updated_at"] is None


def test_the_public_list_hides_drafts(http):
    create(http, "workshops", workshop("live"))
    create(http, "workshops", workshop("hidden", state="draft"))
    create(http, "tutorials", tutorial("live"))
    create(http, "tutorials", tutorial("hidden", state="draft"))
    create(http, "publications", publication(title="Live"))
    create(http, "publications", publication(title="Hidden", state="draft"))
    page = http.get(PUBLIC).json()
    assert [w["slug"] for w in page["workshops"]] == ["live"]
    assert [t["slug"] for t in page["tutorials"]] == ["live"]
    assert [p["title"] for p in page["publications"]] == ["Live"]


def test_a_draft_has_no_public_detail_page_but_a_published_one_does(http):
    create(http, "workshops", workshop("live", body=doc(paragraph("Hello"))))
    create(http, "workshops", workshop("hidden", state="draft"))
    create(http, "tutorials", tutorial("live", body=doc(paragraph("Steps"))))
    create(http, "tutorials", tutorial("hidden", state="draft"))
    assert http.get(f"{PUBLIC}/workshops/live").json()["body"] == doc(paragraph("Hello"))
    assert http.get(f"{PUBLIC}/tutorials/live").json()["body"] == doc(paragraph("Steps"))
    for kind in ("workshops", "tutorials"):
        r = http.get(f"{PUBLIC}/{kind}/hidden")
        assert r.status_code == 404 and r.json()["detail"]["code"].endswith("_not_found")
        assert http.get(f"{PUBLIC}/{kind}/missing").status_code == 404


def test_the_list_sends_cards_without_bodies_and_says_what_is_there(http):
    create(http, "workshops", workshop(
        "w", body=doc(paragraph("Long text")),
        materials=[{"name": "Slides", "url": "https://example.org/s.pdf", "note": None}],
        details=[{"label": "Computing", "value": "Anvil"}],
    ))
    create(http, "tutorials", tutorial("with", body=doc(paragraph("Steps"))))
    create(http, "tutorials", tutorial("without"))
    page = http.get(PUBLIC).json()
    card = page["workshops"][0]
    assert card["material_count"] == 1
    assert not {"body", "materials", "details"} & card.keys()
    by_slug = {t["slug"]: t for t in page["tutorials"]}
    assert by_slug["with"]["has_body"] is True and by_slug["without"]["has_body"] is False
    assert "body" not in by_slug["with"]


@pytest.mark.parametrize(
    ("start", "end", "status"),
    [
        ("2026-10-11", None, "upcoming"),
        ("2026-10-10", None, "upcoming"),  # today is the last day: still upcoming
        ("2026-10-09", None, "past"),
        ("2026-10-08", "2026-10-10", "upcoming"),  # runs through today
        ("2026-10-08", "2026-10-09", "past"),
        ("2026-10-01", "2026-10-09", "past"),
        ("2027-02-01", "2027-03-31", "upcoming"),
    ],
)
def test_status_is_derived_from_the_last_day_against_today(http, start, end, status):
    w = create(http, "workshops", workshop(date=start, end_date=end))
    assert w["status"] == status
    assert http.get(f"{PUBLIC}/workshops/{w['slug']}").json()["status"] == status
    assert http.get(PUBLIC).json()["workshops"][0]["status"] == status


def test_workshops_list_upcoming_soonest_first_then_past_latest_first(http):
    for slug, start in [
        ("old", "2024-01-01"), ("later", "2027-01-01"), ("recent", "2026-09-01"),
        ("soon", "2026-11-01"),
    ]:
        create(http, "workshops", workshop(slug, date=start))
    assert [w["slug"] for w in http.get(PUBLIC).json()["workshops"]] == [
        "soon", "later", "recent", "old",
    ]


def test_publications_are_newest_year_first_then_by_title(http):
    for year, title in [(2022, "B"), (2024, "Z"), (2022, "A"), (2024, "M")]:
        create(http, "publications", publication(year=year, title=title))
    got = [(p["year"], p["title"]) for p in http.get(PUBLIC).json()["publications"]]
    assert got == [(2024, "M"), (2024, "Z"), (2022, "A"), (2022, "B")]


def test_tutorials_list_in_their_manual_order(http):
    a = create(http, "tutorials", tutorial("a"))
    b = create(http, "tutorials", tutorial("b"))
    c = create(http, "tutorials", tutorial("c"))
    assert [a["position"], b["position"], c["position"]] == [0, 1, 2]
    assert [t["slug"] for t in http.get(PUBLIC).json()["tutorials"]] == ["a", "b", "c"]


# ---- who may write ---------------------------------------------------------------


def test_only_the_admin_role_holds_content_manage():
    from app.core.roles import Permission, has_permission

    assert [r for r in Role if has_permission(r, Permission.CONTENT_MANAGE)] == [Role.ADMIN]


ADMIN_ROUTES = [
    ("get", "/workshops", None),
    ("post", "/workshops", workshop()),
    ("get", "/workshops/x", None),
    ("put", "/workshops/x", workshop()),
    ("delete", "/workshops/x", None),
    ("post", "/workshops/bulk", {"action": "delete", "ids": ["x"]}),
    ("get", "/tutorials", None),
    ("post", "/tutorials", tutorial()),
    ("put", "/tutorials/x", tutorial()),
    ("delete", "/tutorials/x", None),
    ("post", "/tutorials/reorder", {"ids": []}),
    ("post", "/tutorials/bulk", {"action": "publish", "ids": ["x"]}),
    ("get", "/news", None),
    ("post", "/news", {"state": "draft", "slug": "n", "title": "N"}),
    ("get", "/news/x", None),
    ("put", "/news/x", {"state": "draft", "slug": "n", "title": "N"}),
    ("delete", "/news/x", None),
    ("post", "/news/bulk", {"action": "delete", "ids": ["x"]}),
    ("get", "/publications", None),
    ("post", "/publications", publication()),
    ("put", "/publications/x", publication()),
    ("delete", "/publications/x", None),
    ("post", "/publications/bulk", {"action": "draft", "ids": ["x"]}),
    ("get", "/settings", None),
    ("put", "/settings", {}),
    ("get", "/files", None),
    ("delete", f"/files/{FILE_ID}", None),
    ("post", "/files/bulk-delete", {"ids": [FILE_ID]}),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
@pytest.mark.parametrize("role", [Role.GUEST, Role.USER, Role.STAFF])
def test_everyone_but_an_admin_is_403_on_every_admin_route(http, mongo, method, path, body, role):
    r = http.request(method, ADMIN_URL + path, json=body, headers=token_for("someone", role))
    assert r.status_code == 403
    assert "content:manage" in r.json()["detail"]
    assert not any(c.docs for name, c in mongo._collections.items() if name.startswith("community"))


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
def test_an_anonymous_caller_is_401_on_every_admin_route(http, method, path, body):
    assert http.request(method, ADMIN_URL + path, json=body).status_code == 401


def test_an_upload_from_someone_else_is_refused_before_it_is_read(http, mongo):
    r = http.post(
        f"{ADMIN_URL}/files", files={"file": ("a.png", PNG, "image/png")},
        headers=token_for("someone", Role.USER),
    )
    assert r.status_code == 403 and mongo.bucket.files == {} and mongo.bucket.written == 0


def test_public_routes_need_no_token(http):
    assert http.get(PUBLIC).status_code == 200
    assert http.get(f"{PUBLIC}/files/{FILE_ID}").status_code == 404  # not 401


# ---- workshops: create, update, delete, slug ---------------------------------------


def test_create_stamps_the_item_and_audits_it(http, mongo):
    w = create(http, "workshops", workshop())
    assert re.fullmatch(r"[0-9a-f-]{36}", w["id"])
    assert w["updated_by"] == "admin-1"
    assert w["created_at"].endswith("Z") and w["updated_at"].endswith("Z")
    assert w["status"] == "upcoming"
    assert audit_actions(mongo) == ["community.workshop.create"]
    event = next(iter(mongo.audit_events.docs.values()))
    assert event["target_id"] == w["id"] and event["actor_id"] == "admin-1"


def test_a_slug_in_use_is_409_on_create(http, mongo):
    create(http, "workshops", workshop("taken"))
    r = http.post(f"{ADMIN_URL}/workshops", json=workshop("taken", title="Other"), headers=ADMIN)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "slug_taken"
    assert len(mongo.community_workshops.docs) == 1


def test_a_slug_in_use_is_409_on_update_but_keeping_your_own_is_fine(http):
    a = create(http, "workshops", workshop("a"))
    create(http, "workshops", workshop("b"))
    r = http.put(f"{ADMIN_URL}/workshops/{a['id']}", json=workshop("b"), headers=ADMIN)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "slug_taken"
    ok = http.put(f"{ADMIN_URL}/workshops/{a['id']}", json=workshop("a", title="Renamed"), headers=ADMIN)
    assert ok.status_code == 200 and ok.json()["title"] == "Renamed"


def test_workshops_and_tutorials_keep_separate_slug_spaces(http):
    create(http, "workshops", workshop("same"))
    create(http, "tutorials", tutorial("same"))


def test_the_unique_index_is_the_last_word_on_a_slug_race(http, monkeypatch, mongo):
    from pymongo.errors import DuplicateKeyError

    async def refuse(doc):
        raise DuplicateKeyError("E11000 duplicate key error: slug")

    monkeypatch.setattr(mongo.community_workshops, "insert_one", refuse)
    r = http.post(f"{ADMIN_URL}/workshops", json=workshop(), headers=ADMIN)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "slug_taken"


def test_update_replaces_the_fields_keeps_created_and_audits(http, mongo):
    w = create(http, "workshops", workshop("a", location="West Lafayette"))
    r = http.put(
        f"{ADMIN_URL}/workshops/{w['id']}",
        json=workshop("a", title="New title", location=None, state="draft"),
        headers=token_for("admin-2", Role.ADMIN),
    )
    assert r.status_code == 200
    got = r.json()
    assert got["title"] == "New title" and got["location"] is None and got["state"] == "draft"
    assert got["id"] == w["id"] and got["created_at"] == w["created_at"]
    assert got["updated_by"] == "admin-2"
    assert http.get(f"{ADMIN_URL}/workshops/{w['id']}", headers=ADMIN).json() == got
    assert audit_actions(mongo) == ["community.workshop.create", "community.workshop.update"]


def test_an_update_may_send_back_the_whole_document_it_loaded(http):
    w = create(http, "workshops", workshop())
    r = http.put(f"{ADMIN_URL}/workshops/{w['id']}", json={**w, "title": "Edited"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["title"] == "Edited"


def test_missing_ids_are_404_with_a_code(http):
    for kind, body in [("workshops", workshop()), ("tutorials", tutorial()), ("publications", publication())]:
        for method in ("get", "put", "delete"):
            r = http.request(method, f"{ADMIN_URL}/{kind}/nope", json=body if method == "put" else None, headers=ADMIN)
            assert r.status_code == 404, (kind, method)
            assert r.json()["detail"]["code"].endswith("_not_found")


def test_delete_removes_and_audits(http, mongo):
    w = create(http, "workshops", workshop())
    assert http.delete(f"{ADMIN_URL}/workshops/{w['id']}", headers=ADMIN).status_code == 204
    assert mongo.community_workshops.docs == {}
    assert http.get(f"{ADMIN_URL}/workshops", headers=ADMIN).json() == []
    assert audit_actions(mongo) == ["community.workshop.create", "community.workshop.delete"]
    event = [e for e in mongo.audit_events.docs.values() if e["action"].endswith("delete")][0]
    assert event["target_id"] == w["id"]


def test_the_admin_list_has_every_state_newest_date_first(http):
    create(http, "workshops", workshop("a", date="2026-01-01", state="draft"))
    create(http, "workshops", workshop("b", date="2027-01-01"))
    got = http.get(f"{ADMIN_URL}/workshops", headers=ADMIN).json()
    assert [w["slug"] for w in got] == ["b", "a"]
    assert got[1]["state"] == "draft" and "body" in got[1]


# ---- bulk actions ----------------------------------------------------------------

BULK_KINDS = [
    ("workshops", workshop, "workshop", "slug"),
    ("tutorials", tutorial, "tutorial", "slug"),
    ("publications", publication, "publication", "title"),
]


def bulk(http, kind: str, action: str, ids: list[str], headers=ADMIN):
    return http.post(f"{ADMIN_URL}/{kind}/bulk", json={"action": action, "ids": ids}, headers=headers)


def collection_of(mongo: FakeDB, kind: str):
    return getattr(mongo, f"community_{kind}")


def named(kind: str, build, n: int) -> dict:
    """A body for the n-th item: slugs and titles differ, so audits can tell them apart."""
    return build(f"item-{n}", title=f"Item {n}") if kind != "publications" else build(title=f"Item {n}")


@pytest.mark.parametrize(("kind", "build", "noun", "label"), BULK_KINDS)
def test_bulk_delete_removes_each_item_and_audits_each_like_a_single_delete(http, mongo, kind, build, noun, label):
    items = [create(http, kind, named(kind, build, n)) for n in range(3)]
    ids = [i["id"] for i in items]
    r = bulk(http, kind, "delete", ids[:2])
    assert r.status_code == 200
    assert r.json() == {"done": ids[:2], "missing": []}
    assert set(collection_of(mongo, kind).docs) == {ids[2]}
    deletes = [e for e in mongo.audit_events.docs.values() if e["action"] == f"community.{noun}.delete"]
    assert sorted(e["target_id"] for e in deletes) == sorted(ids[:2])
    assert all(e["actor_id"] == "admin-1" and e["category"] == "content" for e in deletes)
    # The detail is what the single route writes: the slug, or a publication's title.
    expected = {i["id"]: i[label] for i in items[:2]}
    assert {e["target_id"]: e["detail"][label] for e in deletes} == expected


@pytest.mark.parametrize(("kind", "build", "noun", "label"), BULK_KINDS)
def test_bulk_publish_and_draft_change_only_the_state_and_who_and_when(http, mongo, kind, build, noun, label):
    drafts = [create(http, kind, {**named(kind, build, n), "state": "draft"}) for n in range(2)]
    ids = [d["id"] for d in drafts]
    before = {i: dict(collection_of(mongo, kind).docs[i]) for i in ids}
    r = bulk(http, kind, "publish", ids)
    assert r.json() == {"done": ids, "missing": []}
    for i in ids:
        after = collection_of(mongo, kind).docs[i]
        assert after["state"] == "published"
        assert after["updated_by"] == "admin-1" and after["updated_at"] >= before[i]["updated_at"]
        assert {k: v for k, v in after.items() if k not in ("state", "updated_at", "updated_by")} == {
            k: v for k, v in before[i].items() if k not in ("state", "updated_at", "updated_by")
        }
    assert bulk(http, kind, "draft", ids[:1]).json() == {"done": ids[:1], "missing": []}
    states = {i: collection_of(mongo, kind).docs[i]["state"] for i in ids}
    assert states == {ids[0]: "draft", ids[1]: "published"}
    # One audit event per item and change, named as a single update is.
    updates = [e for e in mongo.audit_events.docs.values() if e["action"] == f"community.{noun}.update"]
    assert len(updates) == 3
    assert sorted((e["target_id"], e["detail"]["state"]) for e in updates) == sorted(
        [(ids[0], "published"), (ids[1], "published"), (ids[0], "draft")]
    )
    assert all(e["detail"][label] == drafts[ids.index(e["target_id"])][label] for e in updates)


def test_a_published_workshop_goes_on_the_site_and_a_drafted_one_comes_off(http):
    w = create(http, "workshops", workshop("w", state="draft"))
    assert http.get(f"{PUBLIC}/workshops/w").status_code == 404
    bulk(http, "workshops", "publish", [w["id"]])
    assert http.get(f"{PUBLIC}/workshops/w").status_code == 200
    bulk(http, "workshops", "draft", [w["id"]])
    assert http.get(f"{PUBLIC}/workshops/w").status_code == 404


@pytest.mark.parametrize("action", ["delete", "publish", "draft"])
def test_bulk_reports_ids_that_do_not_exist_and_still_does_the_rest(http, mongo, action):
    t = create(http, "tutorials", tutorial("a"))
    r = bulk(http, "tutorials", action, ["nope", t["id"], "gone"])
    assert r.status_code == 200
    assert r.json() == {"done": [t["id"]], "missing": ["nope", "gone"]}
    assert [e["target_id"] for e in mongo.audit_events.docs.values() if e["action"] != "community.tutorial.create"] == [t["id"]]


@pytest.mark.parametrize(
    "body",
    [
        {"action": "archive", "ids": ["a"]},
        {"action": "delete", "ids": []},
        {"action": "delete"},
        {"ids": ["a"]},
        {"action": "delete", "ids": ["a", "a"]},
        {"action": "delete", "ids": [""]},
        {"action": "delete", "ids": [1]},
        {"action": "delete", "ids": [f"id-{n}" for n in range(201)]},
    ],
)
def test_bulk_refuses_a_bad_action_or_ids_and_changes_nothing(http, mongo, body):
    w = create(http, "workshops", workshop())
    r = http.post(f"{ADMIN_URL}/workshops/bulk", json=body, headers=ADMIN)
    assert r.status_code == 422
    assert set(mongo.community_workshops.docs) == {w["id"]}
    assert audit_actions(mongo) == ["community.workshop.create"]


def test_bulk_takes_two_hundred_ids(http):
    ids = [f"id-{n}" for n in range(200)]
    assert bulk(http, "publications", "delete", ids).json() == {"done": [], "missing": ids}


def test_bulk_leaves_other_kinds_alone(http, mongo):
    w = create(http, "workshops", workshop())
    t = create(http, "tutorials", tutorial())
    assert bulk(http, "tutorials", "delete", [w["id"], t["id"]]).json() == {"done": [t["id"]], "missing": [w["id"]]}
    assert set(mongo.community_workshops.docs) == {w["id"]}


# ---- field rules ----------------------------------------------------------------


@pytest.mark.parametrize(
    "over",
    [
        {"slug": "Has Caps"},
        {"slug": "-lead"},
        {"slug": "double--hyphen"},
        {"slug": "x" * 81},
        {"slug": ""},
        {"title": ""},
        {"title": "x" * 201},
        {"summary": "x" * 501},
        {"date": "2026-13-01"},
        {"date": "10/01/2026"},
        {"date": "2026-12-01", "end_date": "2026-11-30"},
        {"state": "archived"},
        {"cover": {"url": "http://example.org/a.jpg", "alt": "", "caption": None}},
        {"cover": {"url": "javascript:alert(1)", "alt": "", "caption": None}},
        {"cover": {"url": "/images/a.jpg", "alt": "", "caption": None}},
        {"signup": {"label": "Sign up", "url": "javascript:alert(1)"}},
        {"signup": {"label": "Sign up", "url": "//evil.example/x"}},
        {"signup": {"label": "", "url": "https://example.org"}},
        {"materials": [{"name": "Slides", "url": "data:text/html,hi", "note": None}]},
        {"materials": [{"name": "Slides", "url": "https://example.org/s.pdf", "note": None}] * 41},
        {"details": [{"label": "A", "value": "B"}] * 21},
    ],
)
def test_a_workshop_with_a_bad_field_is_422_and_nothing_is_stored(http, mongo, over):
    r = http.post(f"{ADMIN_URL}/workshops", json=workshop(**over), headers=ADMIN)
    assert r.status_code == 422, over
    assert mongo.community_workshops.docs == {}


def test_good_links_and_images_are_accepted(http):
    w = create(http, "workshops", workshop(
        cover={"url": "https://dev.openghm.org/images/x.jpg", "alt": "A", "caption": None},
        signup={"label": "Sign up", "url": "mailto:team@example.org"},
        materials=[
            {"name": "Slides", "url": f"/api/community/files/{FILE_ID}", "note": "PDF"},
            {"name": "Video", "url": "http://example.org/v", "note": None},
            {"name": "Page", "url": "/community/tutorials/a", "note": None},
        ],
        end_date="2026-12-03",
    ))
    assert w["end_date"] == "2026-12-03" and len(w["materials"]) == 3


def test_a_field_the_model_no_longer_has_is_ignored_and_not_stored(http, mongo):
    w = create(http, "workshops", workshop(photos=[{"url": "https://example.org/a.jpg", "caption": None}]))
    assert "photos" not in w
    assert "photos" not in mongo.community_workshops.docs[w["id"]]


def test_an_emptied_optional_text_box_means_not_set(http):
    t = create(http, "tutorials", tutorial(action_label="  ", url=""))
    assert t["action_label"] is None and t["url"] is None
    w = create(http, "workshops", workshop(when_label="", format="", location=" ", end_date=""))
    assert w["when_label"] is None and w["format"] is None and w["location"] is None
    assert w["end_date"] is None


@pytest.mark.parametrize(
    "over",
    [
        {"kind": "podcast"},
        {"level": "expert"},
        {"minutes": 0},
        {"minutes": 601},
        {"summary": "x" * 401},
        {"snippet": "x" * 601},
        {"url": "javascript:alert(1)"},
        {"slug": "Bad Slug"},
    ],
)
def test_a_tutorial_with_a_bad_field_is_422(http, mongo, over):
    assert http.post(f"{ADMIN_URL}/tutorials", json=tutorial(**over), headers=ADMIN).status_code == 422
    assert mongo.community_tutorials.docs == {}


@pytest.mark.parametrize(
    "over",
    [
        {"year": 1899},
        {"year": 2101},
        {"type": "poster"},
        {"title": ""},
        {"title": "x" * 401},
        {"authors": "x" * 1001},
        {"link_url": "javascript:alert(1)"},
        {"link_url": "doi.org/x"},
    ],
)
def test_a_publication_with_a_bad_field_is_422(http, mongo, over):
    assert http.post(f"{ADMIN_URL}/publications", json=publication(**over), headers=ADMIN).status_code == 422
    assert mongo.community_publications.docs == {}


def test_a_publication_keeps_a_null_citation_for_the_client_to_compose(http):
    p = create(http, "publications", publication(link_label="DOI", link_url="https://doi.org/10.1/x"))
    assert p["citation"] is None and p["link_url"] == "https://doi.org/10.1/x"
    r = http.put(f"{ADMIN_URL}/publications/{p['id']}", json=publication(citation="Custom."), headers=ADMIN)
    assert r.json()["citation"] == "Custom."


# ---- rich text ----------------------------------------------------------------------


def body_with(*blocks) -> dict:
    return workshop(body=doc(*blocks))


def link(href: str) -> dict:
    return {"type": "paragraph", "content": [
        {"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": href}}]}
    ]}


def image(src: str, **attrs) -> dict:
    return {"type": "image", "attrs": {"src": src, "alt": "A", "title": "Caption", **attrs}}


BAD_BODIES = {
    "javascript link": link("javascript:alert(1)"),
    "mixed-case javascript link": link("JaVaScRiPt:alert(1)"),
    "tab-split javascript link": link("java\tscript:alert(1)"),
    "data link": link("data:text/html;base64,PHNjcmlwdD4="),
    "protocol-relative link": link("//evil.example/x"),
    "backslash link": link("/\\evil.example"),
    "bare host link": link("example.org/page"),
    "empty link": link(""),
    "link without href": {"type": "paragraph", "content": [
        {"type": "text", "text": "x", "marks": [{"type": "link"}]}]},
    "unknown node": {"type": "iframe", "attrs": {"src": "https://example.org"}},
    "html node": {"type": "html", "text": "<script>1</script>"},
    "table": {"type": "table", "content": []},
    "unknown mark": {"type": "paragraph", "content": [
        {"type": "text", "text": "x", "marks": [{"type": "highlight"}]}]},
    "http image": image("http://example.org/a.png"),
    "javascript image": image("javascript:alert(1)"),
    "data image": image("data:image/png;base64,AAAA"),
    "relative image": image("/images/a.png"),
    "image path outside files": image("/api/community/files/../../x"),
    "short file id": image("/api/community/files/abc"),
    "image without src": {"type": "image", "attrs": {"alt": "x"}},
    "heading level 1": {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "x"}]},
    "heading level 4": {"type": "heading", "attrs": {"level": 4}, "content": [{"type": "text", "text": "x"}]},
    "heading without level": {"type": "heading", "content": [{"type": "text", "text": "x"}]},
    "paragraph in a paragraph": {"type": "paragraph", "content": [paragraph("x")]},
    "list item outside a list": {"type": "listItem", "content": [paragraph("x")]},
    "text outside a block": {"type": "text", "text": "loose"},
    "empty text": {"type": "paragraph", "content": [{"type": "text", "text": ""}]},
    "marks inside a code block": {"type": "codeBlock", "content": [
        {"type": "text", "text": "x", "marks": [{"type": "bold"}]}]},
    "content in a rule": {"type": "horizontalRule", "content": [paragraph("x")]},
    "doc inside a doc": {"type": "doc", "content": []},
    "node with no type": {"content": []},
    "node that is a string": "paragraph",
}


@pytest.mark.parametrize("block", BAD_BODIES.values(), ids=BAD_BODIES.keys())
def test_rich_text_that_is_not_allowed_is_422_and_nothing_is_stored(http, mongo, block):
    for kind, body in [
        ("workshops", body_with(block)),
        ("tutorials", tutorial(body=doc(block))),
    ]:
        r = http.post(f"{ADMIN_URL}/{kind}", json=body, headers=ADMIN)
        assert r.status_code == 422, (kind, block)
    assert mongo.community_workshops.docs == {} and mongo.community_tutorials.docs == {}


def test_a_body_that_is_not_a_document_is_422(http):
    for bad in ({"type": "paragraph"}, {"content": []}, [], "text", 5):
        assert http.post(f"{ADMIN_URL}/workshops", json=workshop(body=bad), headers=ADMIN).status_code == 422


def test_an_oversize_body_is_422(http, mongo):
    big = doc(*[paragraph("x" * 1000) for _ in range(600)])  # about 600 KB
    r = http.post(f"{ADMIN_URL}/workshops", json=workshop(body=big), headers=ADMIN)
    assert r.status_code == 422 and "limit" in r.text
    assert mongo.community_workshops.docs == {}
    ok = doc(*[paragraph("x" * 1000) for _ in range(400)])  # about 400 KB
    assert http.post(f"{ADMIN_URL}/workshops", json=workshop(body=ok), headers=ADMIN).status_code == 201


def test_a_body_nested_too_deeply_is_422(http):
    node: dict = paragraph("x")
    for _ in range(40):
        node = {"type": "blockquote", "content": [node]}
    assert http.post(f"{ADMIN_URL}/workshops", json=workshop(body=doc(node)), headers=ADMIN).status_code == 422


def full_document() -> dict:
    """Every node and mark the editor may produce."""
    marked = {"type": "text", "text": "all", "marks": [
        {"type": m} for m in ("bold", "italic", "underline", "strike", "code")
    ] + [{"type": "link", "attrs": {"href": "https://example.org/a?b=c#d"}}]}
    return doc(
        paragraph("Lead"),
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "H2"}]},
        {"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": "H3"}]},
        {"type": "paragraph", "content": [
            marked, {"type": "hardBreak"},
            {"type": "text", "text": "mail", "marks": [{"type": "link", "attrs": {"href": "mailto:a@example.org"}}]},
            {"type": "text", "text": "rel", "marks": [{"type": "link", "attrs": {"href": "/community/x"}}]},
        ]},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [
            paragraph("one"),
            {"type": "orderedList", "attrs": {"start": 3}, "content": [
                {"type": "listItem", "content": [paragraph("nested")]}]},
        ]}]},
        {"type": "blockquote", "content": [paragraph("note")]},
        {"type": "codeBlock", "attrs": {"language": "python"}, "content": [{"type": "text", "text": "x = 1"}]},
        {"type": "horizontalRule"},
        image(f"/api/community/files/{FILE_ID}"),
        image("https://example.org/p.png", alt=None, title=None),
    )


def test_a_full_document_round_trips_unchanged(http):
    d = full_document()
    w = create(http, "workshops", workshop(body=d))
    again = http.get(f"{PUBLIC}/workshops/{w['slug']}").json()["body"]
    assert again["type"] == "doc" and len(again["content"]) == len(d["content"])
    assert again["content"][3]["content"][0]["marks"][5]["attrs"] == {"href": "https://example.org/a?b=c#d"}
    assert again["content"][-2]["attrs"] == {"src": f"/api/community/files/{FILE_ID}", "alt": "A", "title": "Caption"}


def test_what_the_editor_adds_beyond_the_whitelist_is_dropped_not_stored():
    noisy = doc({
        "type": "paragraph", "attrs": {"class": "x", "onclick": "alert(1)"}, "extra": 1,
        "content": [{"type": "text", "text": "x", "marks": [
            {"type": "link", "attrs": {"href": "https://example.org", "target": "_blank", "rel": "x", "class": None}},
        ]}],
    })
    clean = community_content.validate_rich_text(noisy)
    assert clean == doc({"type": "paragraph", "content": [{"type": "text", "text": "x", "marks": [
        {"type": "link", "attrs": {"href": "https://example.org"}}]}]})


def test_an_empty_document_is_allowed_and_has_no_body_to_open(http):
    t = create(http, "tutorials", tutorial("empty", body={"type": "doc", "content": [{"type": "paragraph"}]}))
    assert t["body"]["content"] == [{"type": "paragraph"}]
    t2 = create(http, "tutorials", tutorial("nothing", body={"type": "doc"}))
    cards = {c["slug"]: c["has_body"] for c in http.get(PUBLIC).json()["tutorials"]}
    assert cards["nothing"] is False and t2["body"] == {"type": "doc", "content": []}


# ---- reorder ----------------------------------------------------------------------


def test_reorder_sets_positions_by_index_and_audits(http, mongo):
    ids = [create(http, "tutorials", tutorial(s))["id"] for s in "abc"]
    r = http.post(f"{ADMIN_URL}/tutorials/reorder", json={"ids": [ids[2], ids[0], ids[1]]}, headers=ADMIN)
    assert r.status_code == 204
    got = http.get(f"{ADMIN_URL}/tutorials", headers=ADMIN).json()
    assert [(t["slug"], t["position"]) for t in got] == [("c", 0), ("a", 1), ("b", 2)]
    assert [t["slug"] for t in http.get(PUBLIC).json()["tutorials"]] == ["c", "a", "b"]
    assert audit_actions(mongo)[-1] == "community.tutorial.reorder"


def test_a_tutorial_left_out_of_a_reorder_follows_the_listed_ones(http):
    ids = [create(http, "tutorials", tutorial(s))["id"] for s in "abc"]
    assert http.post(f"{ADMIN_URL}/tutorials/reorder", json={"ids": [ids[2]]}, headers=ADMIN).status_code == 204
    got = http.get(f"{ADMIN_URL}/tutorials", headers=ADMIN).json()
    assert [(t["slug"], t["position"]) for t in got] == [("c", 0), ("a", 1), ("b", 2)]


@pytest.mark.parametrize("ids", [["nope"], ["a", "a"]])
def test_reorder_refuses_unknown_and_repeated_ids_and_changes_nothing(http, ids):
    a = create(http, "tutorials", tutorial("a"))
    create(http, "tutorials", tutorial("b"))
    ids = [a["id"] if i == "a" else i for i in ids]
    r = http.post(f"{ADMIN_URL}/tutorials/reorder", json={"ids": ids}, headers=ADMIN)
    assert r.status_code == 422
    assert [t["slug"] for t in http.get(f"{ADMIN_URL}/tutorials", headers=ADMIN).json()] == ["a", "b"]


def test_a_new_tutorial_goes_last_even_after_a_deletion(http):
    a = create(http, "tutorials", tutorial("a"))
    b = create(http, "tutorials", tutorial("b"))
    http.delete(f"{ADMIN_URL}/tutorials/{a['id']}", headers=ADMIN)
    c = create(http, "tutorials", tutorial("c"))
    assert c["position"] == b["position"] + 1


def test_an_update_keeps_the_position(http):
    create(http, "tutorials", tutorial("a"))
    b = create(http, "tutorials", tutorial("b"))
    r = http.put(f"{ADMIN_URL}/tutorials/{b['id']}", json=tutorial("b", title="Renamed"), headers=ADMIN)
    assert r.json()["position"] == 1 == b["position"]


# ---- settings ----------------------------------------------------------------------


def test_settings_default_until_saved_then_follow_the_admin(http, mongo):
    got = http.get(f"{ADMIN_URL}/settings", headers=ADMIN).json()
    assert got["hero_title"] == "Learn, publish and work together" and got["updated_by"] is None
    r = http.put(
        f"{ADMIN_URL}/settings", headers=ADMIN,
        json={"hero_title": "Hello", "hero_intro": "Intro.", "show_groups": False,
              "groups_title": "Groups", "groups_intro": "Soon."},
    )
    assert r.status_code == 200
    assert r.json()["hero_title"] == "Hello" and r.json()["show_groups"] is False
    assert r.json()["updated_by"] == "admin-1" and r.json()["updated_at"].endswith("Z")
    assert set(mongo.community_settings.docs) == {"community"}
    public = http.get(PUBLIC).json()["settings"]
    assert public["hero_title"] == "Hello" and public["show_groups"] is False
    assert audit_actions(mongo) == ["community.settings.update"]
    assert next(iter(mongo.audit_events.docs.values()))["target_id"] == "community"


def test_saving_settings_twice_keeps_one_document(http, mongo):
    for title in ("One", "Two"):
        http.put(f"{ADMIN_URL}/settings", headers=ADMIN, json={"hero_title": title})
    assert len(mongo.community_settings.docs) == 1
    assert http.get(PUBLIC).json()["settings"]["hero_title"] == "Two"


def test_settings_with_an_empty_title_are_422(http):
    assert http.put(f"{ADMIN_URL}/settings", headers=ADMIN, json={"hero_title": ""}).status_code == 422


# ---- files ------------------------------------------------------------------------------

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.7\n" + b"x" * 64
ZIP = b"PK\x03\x04" + b"\x00" * 64
MiB = 1024 * 1024


def upload(http, name: str, data: bytes, content_type: str | None = None, headers=ADMIN):
    part = (name, data, content_type) if content_type else (name, data)
    return http.post(f"{ADMIN_URL}/files", files={"file": part}, headers=headers)


def test_an_image_is_stored_listed_served_inline_and_deleted(http, mongo):
    r = upload(http, "Photo One.png", PNG, "image/png")
    assert r.status_code == 201, r.text
    f = r.json()
    assert re.fullmatch(r"[0-9a-f]{24}", f["id"]) and f["url"] == f"/api/community/files/{f['id']}"
    assert f["filename"] == "Photo One.png" and f["content_type"] == "image/png"
    assert f["size"] == len(PNG) and f["uploaded_at"].endswith("Z")

    assert http.get(f"{ADMIN_URL}/files", headers=ADMIN).json() == [f]
    got = http.get(f["url"].replace("/api/community", PUBLIC))  # anonymous
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["content-type"] == "image/png"
    assert got.headers["content-disposition"] == 'inline; filename="Photo One.png"'
    assert got.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert got.headers["content-length"] == str(len(PNG))

    assert http.delete(f"{ADMIN_URL}/files/{f['id']}", headers=ADMIN).status_code == 204
    assert http.get(f"{PUBLIC}/files/{f['id']}").status_code == 404
    assert http.get(f"{ADMIN_URL}/files", headers=ADMIN).json() == []
    assert audit_actions(mongo) == ["community.file.upload", "community.file.delete"]
    ev = [e for e in mongo.audit_events.docs.values() if e["action"].endswith("upload")][0]
    assert ev["target_id"] == f["id"] and ev["detail"]["filename"] == "Photo One.png"


def test_bulk_delete_removes_files_audits_each_and_reports_missing(http, mongo):
    a = upload(http, "a.png", PNG).json()
    b = upload(http, "b.png", PNG).json()
    c = upload(http, "c.png", PNG).json()
    other = "f" * 24
    r = http.post(f"{ADMIN_URL}/files/bulk-delete", json={"ids": [a["id"], other, "not-an-id", c["id"]]}, headers=ADMIN)
    assert r.status_code == 200
    assert r.json() == {"done": [a["id"], c["id"]], "missing": [other, "not-an-id"]}
    assert [f["id"] for f in http.get(f"{ADMIN_URL}/files", headers=ADMIN).json()] == [b["id"]]
    assert http.get(f"{PUBLIC}/files/{a['id']}").status_code == 404
    deletes = [e for e in mongo.audit_events.docs.values() if e["action"] == "community.file.delete"]
    assert sorted((e["target_id"], e["detail"]["filename"]) for e in deletes) == [(a["id"], "a.png"), (c["id"], "c.png")]


@pytest.mark.parametrize("body", [{"ids": []}, {}, {"ids": [FILE_ID, FILE_ID]}, {"ids": ["x"] * 2}, {"ids": [str(n) for n in range(201)]}])
def test_bulk_file_delete_refuses_bad_ids_and_deletes_nothing(http, body):
    f = upload(http, "a.png", PNG).json()
    assert http.post(f"{ADMIN_URL}/files/bulk-delete", json=body, headers=ADMIN).status_code == 422
    assert [x["id"] for x in http.get(f"{ADMIN_URL}/files", headers=ADMIN).json()] == [f["id"]]


def test_a_pdf_shows_inline_and_other_files_download(http):
    pdf = upload(http, "slides.PDF", PDF, "application/pdf").json()
    zipped = upload(http, "notebooks.zip", ZIP, "application/x-zip-compressed").json()
    assert pdf["content_type"] == "application/pdf" and zipped["content_type"] == "application/zip"
    assert http.get(pdf["url"].replace("/api/community", PUBLIC)).headers["content-disposition"].startswith("inline;")
    z = http.get(zipped["url"].replace("/api/community", PUBLIC))
    assert z.headers["content-disposition"] == 'attachment; filename="notebooks.zip"'
    assert z.headers["content-type"] == "application/zip"


def test_files_list_newest_first(http):
    first = upload(http, "a.png", PNG).json()
    second = upload(http, "b.png", PNG).json()
    assert [f["id"] for f in http.get(f"{ADMIN_URL}/files", headers=ADMIN).json()] == [second["id"], first["id"]]


def test_a_filename_is_cleaned_of_paths_and_quotes(http):
    assert upload(http, "../../etc/passwd.png", PNG).json()["filename"] == "passwd.png"
    assert upload(http, "C:\\temp\\x.png", PNG).json()["filename"] == "x.png"
    f2 = upload(http, "Résumé figure.png", PNG).json()
    served = http.get(f2["url"].replace("/api/community", PUBLIC))
    assert served.headers["content-disposition"].startswith('inline; filename="R')
    assert "filename*=UTF-8''R%C3%A9sum%C3%A9%20figure.png" in served.headers["content-disposition"]


def test_clean_filename_drops_directories_quotes_controls_and_leading_dots():
    clean = community_files.clean_filename
    assert clean('a"b\x00c\r\n.png') == "abc.png"
    assert clean("/var/x/.hidden.png") == "hidden.png"
    assert clean("") == "" and clean(None) == ""
    long = clean("n" * 500 + ".png")
    assert len(long) == community_files.FILENAME_MAX and long.endswith(".png")


@pytest.mark.parametrize(
    ("name", "data", "declared", "code"),
    [
        ("logo.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", "unsupported_file_type"),
        ("logo.png", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/png", "file_type_mismatch"),
        ("page.html", b"<html><script>1</script></html>", "text/html", "unsupported_file_type"),
        ("run.exe", b"MZ\x90\x00", "application/octet-stream", "unsupported_file_type"),
        ("script.js", b"alert(1)", "text/javascript", "unsupported_file_type"),
        ("noextension", PNG, "image/png", "unsupported_file_type"),
        ("photo.png", PNG, "text/html", "file_type_mismatch"),
        ("photo.png", PNG, "image/svg+xml", "file_type_mismatch"),
        ("photo.jpg", PNG, "image/jpeg", "file_type_mismatch"),
        ("slides.pdf", ZIP, "application/pdf", "file_type_mismatch"),
        ("slides.pptx", PNG, None, "file_type_mismatch"),
        ("data.csv", b"a,b\n\x00\x01\x02", "text/csv", "file_type_mismatch"),
        ("empty.png", b"", "image/png", "file_type_mismatch"),
        ("notes.txt", b"\xff\xfe\x00\x00binary", "text/plain", "file_type_mismatch"),
    ],
)
def test_a_type_that_is_not_allowed_is_415_and_nothing_is_stored(http, mongo, name, data, declared, code):
    r = upload(http, name, data, declared)
    assert r.status_code == 415, r.text
    assert r.json()["detail"]["code"] == code
    assert mongo.bucket.files == {} and mongo.bucket.written == 0
    assert mongo.audit_events.docs == {}


@pytest.mark.parametrize(
    ("name", "data", "declared"),
    [
        ("a.jpg", b"\xff\xd8\xff\xe0" + b"0" * 20, "image/jpeg"),
        ("a.jpeg", b"\xff\xd8\xff\xe1" + b"0" * 20, None),
        ("a.webp", b"RIFF\x10\x00\x00\x00WEBPVP8 ", "image/webp"),
        ("a.gif", b"GIF89a" + b"0" * 20, "image/gif"),
        ("a.ppt", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 20, "application/vnd.ms-powerpoint"),
        ("a.pptx", ZIP, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        ("a.key", ZIP, "application/octet-stream"),
        ("a.docx", ZIP, None),
        ("a.xlsx", ZIP, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("a.csv", "year,tmp\n2000,é\n".encode(), "application/vnd.ms-excel"),
        ("a.gz", b"\x1f\x8b\x08" + b"0" * 20, "application/gzip"),
        ("a.tar", b"0" * 257 + b"ustar\x0000" + b"0" * 20, "application/x-tar"),
        ("a.ipynb", b'{"cells": []}', "application/json"),
        ("a.mp4", b"\x00\x00\x00\x18ftypmp42" + b"0" * 20, "video/mp4"),
        ("a.mov", b"\x00\x00\x00\x14ftypqt  " + b"0" * 20, "video/quicktime"),
        ("a.webm", b"\x1a\x45\xdf\xa3" + b"0" * 20, "video/webm"),
        ("a.txt", b"plain text", "text/plain; charset=utf-8"),
        ("a.md", b"# Title", "text/markdown"),
    ],
)
def test_each_allowed_type_is_accepted(http, name, data, declared):
    assert upload(http, name, data, declared).status_code == 201


def test_a_declared_type_cannot_choose_what_is_served(http):
    # Whatever the client declares within the extension's allowed set, the
    # type served is the extension's own.
    f = upload(http, "table.csv", b"a,b\n", "text/plain").json()
    assert f["content_type"] == "text/csv"


def test_an_upload_that_is_not_multipart_or_has_no_file_is_refused(http):
    r = http.post(f"{ADMIN_URL}/files", content=PNG, headers={**ADMIN, "Content-Type": "image/png"})
    assert r.status_code == 415 and r.json()["detail"]["code"] == "multipart_required"
    r = http.post(f"{ADMIN_URL}/files", data={"note": "hi"}, files={"other": ("a.png", PNG)}, headers=ADMIN)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "file_required"
    r = http.post(f"{ADMIN_URL}/files", data={"file": "just text"}, files={"x": ("a.png", PNG)}, headers=ADMIN)
    assert r.status_code == 422


def test_a_file_at_the_limit_is_stored_and_one_byte_over_is_413_and_removed(http, mongo):
    ok = PNG + b"0" * (25 * MiB - len(PNG))
    assert upload(http, "exact.png", ok).status_code == 201
    assert next(iter(mongo.bucket.files.values())).length == 25 * MiB

    mongo.bucket.files.clear()
    mongo.bucket.written = 0
    r = upload(http, "over.png", ok + b"0")
    assert r.status_code == 413 and r.json()["detail"]["code"] == "file_too_large"
    assert mongo.bucket.files == {} and mongo.bucket.aborted == 1
    assert mongo.bucket.written <= 25 * MiB  # it stopped reading; it did not store it all


def multipart_stream(filename: str, size: int, content_type: str = "image/png"):
    """A body with no Content-Length, sent in chunks."""
    yield (
        f'--xyz\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode()
    yield PNG
    left = size - len(PNG)
    while left > 0:
        step = min(left, MiB)
        yield b"0" * step
        left -= step
    yield b"\r\n--xyz--\r\n"


def test_an_endless_body_without_a_length_is_cut_off_at_the_limit(http, mongo):
    r = http.post(
        f"{ADMIN_URL}/files", content=multipart_stream("huge.png", 60 * MiB),
        headers={**ADMIN, "Content-Type": "multipart/form-data; boundary=xyz"},
    )
    assert r.status_code == 413 and r.json()["detail"]["code"] == "file_too_large"
    assert mongo.bucket.files == {}


def test_a_declared_length_over_the_limit_is_refused_without_reading(http, mongo):
    r = http.post(
        f"{ADMIN_URL}/files", content=b"x",
        headers={**ADMIN, "Content-Type": "multipart/form-data; boundary=xyz", "Content-Length": str(30 * MiB)},
    )
    assert r.status_code == 413


@pytest.mark.parametrize("file_id", ["nope", "0123", "G" * 24, "0123456789ABCDEF01234567", "../etc/passwd"])
def test_a_file_id_that_is_not_24_hex_is_404(http, file_id):
    assert http.get(f"{PUBLIC}/files/{file_id}").status_code == 404
    assert http.delete(f"{ADMIN_URL}/files/{file_id}", headers=ADMIN).status_code == 404


def test_deleting_a_file_that_is_gone_is_404(http):
    r = http.delete(f"{ADMIN_URL}/files/{FILE_ID}", headers=ADMIN)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "file_not_found"


def test_a_large_file_streams_back_whole(http):
    data = PNG + bytes(range(256)) * (3 * MiB // 256)
    f = upload(http, "big.png", data).json()
    assert http.get(f["url"].replace("/api/community", PUBLIC)).content == data
