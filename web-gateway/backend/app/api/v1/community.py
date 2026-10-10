"""The Community page and the news posts: its public routes and the admin routes that write it
(ADR 0034).

Two routers in one module. `router` (`/community`) is anonymous: published
content and uploaded files. `admin_router` (`/admin/community`)
needs `content:manage` (admin only) and audit-logs every write under the
`content` category, with the item's id as the target.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from app.core.audit import AuditCategory, log_event
from app.core.authz import require_permission
from app.core.database import get_db
from app.core.roles import Permission
from app.models.community import (
    BulkDeleteRequest,
    BulkRequest,
    BulkResult,
    CommunityFile,
    CommunityPage,
    CommunitySettings,
    CommunitySettingsInput,
    NewsInput,
    NewsPost,
    Publication,
    PublicationInput,
    ReorderRequest,
    Tutorial,
    TutorialCard,
    TutorialInput,
    Workshop,
    WorkshopCard,
    WorkshopInput,
)
from app.models.user import TokenPayload
from app.services import community_content, community_files

router = APIRouter(prefix="/community", tags=["community"])
admin_router = APIRouter(prefix="/admin/community", tags=["community-admin"])

WORKSHOPS = "community_workshops"
TUTORIALS = "community_tutorials"
PUBLICATIONS = "community_publications"
NEWS = "community_news"
SETTINGS = "community_settings"
SETTINGS_ID = "community"

_content_manager = require_permission(Permission.CONTENT_MANAGE)


def _error(status: int, code: str, message: str) -> HTTPException:
    """`detail = {"code", "message"}`, the shape app.core.authz._refuse uses."""
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _not_found(what: str) -> HTTPException:
    return _error(404, f"{what}_not_found", f"There is no such {what}.")


# ---- documents <-> models ---------------------------------------------------


def _with_id(doc: dict) -> dict:
    return {**doc, "id": doc["_id"]}


def _workshop(doc: dict) -> Workshop:
    status = community_content.workshop_status(doc["date"], doc.get("end_date"))
    return Workshop.model_validate({**_with_id(doc), "status": status})


def _workshop_card(doc: dict) -> WorkshopCard:
    status = community_content.workshop_status(doc["date"], doc.get("end_date"))
    return WorkshopCard.model_validate(
        {
            **_with_id(doc),
            "status": status,
            "material_count": len(doc.get("materials") or []),
        }
    )


def _tutorial(doc: dict) -> Tutorial:
    return Tutorial.model_validate(_with_id(doc))


def _tutorial_card(doc: dict) -> TutorialCard:
    return TutorialCard.model_validate({**_with_id(doc), "has_body": _has_content(doc.get("body"))})


def _has_content(body: dict | None) -> bool:
    return bool(body and body.get("content"))


def _news(doc: dict) -> NewsPost:
    return NewsPost.model_validate(_with_id(doc))


def _settings(doc: dict | None) -> CommunitySettings:
    return CommunitySettings.model_validate(doc or {})


def _now() -> datetime:
    # To the millisecond, which is all BSON keeps: the response to a create is
    # then the same as a later read.
    now = datetime.now(timezone.utc)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


async def _audit(user: TokenPayload, action: str, target_id: str | None, **detail: Any) -> None:
    await log_event(
        action,
        actor_id=user.sub,
        actor_email=user.email,
        target_id=target_id,
        detail=detail or None,
        category=AuditCategory.CONTENT,
    )


# ---- public -----------------------------------------------------------------


@router.get("", response_model=CommunityPage)
async def get_community():
    """Everything the page shows: published items only, bodies left out.

    Workshops come upcoming first (soonest first), then past (latest first);
    the client splits them by `status`.
    """
    db = get_db()
    no_body = {"body": 0}
    workshops = [
        _workshop_card(d)
        async for d in db[WORKSHOPS].find({"state": "published"}, no_body)
    ]
    upcoming = sorted((w for w in workshops if w.status == "upcoming"), key=lambda w: w.date)
    past = sorted((w for w in workshops if w.status == "past"), key=lambda w: w.date, reverse=True)

    tutorial_docs = await db[TUTORIALS].find({"state": "published"}).sort("position", 1).to_list(None)
    publication_docs = (
        await db[PUBLICATIONS].find({"state": "published"}).to_list(None)
    )
    publications = sorted(
        (Publication.model_validate(_with_id(d)) for d in publication_docs),
        key=lambda p: p.title,
    )
    publications.sort(key=lambda p: p.year, reverse=True)

    return CommunityPage(
        settings=_settings(await db[SETTINGS].find_one({"_id": SETTINGS_ID})),
        workshops=upcoming + past,
        tutorials=[_tutorial_card(d) for d in tutorial_docs],
        publications=publications,
    )


@router.get("/workshops/{slug}", response_model=Workshop)
async def get_workshop(slug: str):
    doc = await get_db()[WORKSHOPS].find_one({"slug": slug, "state": "published"})
    if doc is None:
        raise _not_found("workshop")
    return _workshop(doc)


@router.get("/tutorials/{slug}", response_model=Tutorial)
async def get_tutorial(slug: str):
    doc = await get_db()[TUTORIALS].find_one({"slug": slug, "state": "published"})
    if doc is None:
        raise _not_found("tutorial")
    return _tutorial(doc)


@router.get("/news/{slug}", response_model=NewsPost)
async def get_news(slug: str):
    """A published post that has a body; one without has no page of its own."""
    doc = await get_db()[NEWS].find_one({"slug": slug, "state": "published"})
    if doc is None or not _has_content(doc.get("body")):
        raise _not_found("news")
    return _news(doc)


@router.get("/files/{file_id}")
async def download_file(file_id: str):
    """The bytes of an uploaded file. A file's id is unguessable and its bytes
    never change, so the response is cacheable forever; images and PDFs are
    shown in place, everything else is a download."""
    stored = await community_files.open_file(file_id)
    if stored is None:
        raise _not_found("file")
    info = community_files.describe(stored)
    return StreamingResponse(
        community_files.stream_chunks(stored),
        media_type=info["content_type"],
        headers={
            "Content-Length": str(info["size"]),
            "Content-Disposition": community_files.content_disposition(
                info["filename"], community_files.is_inline(info["content_type"])
            ),
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---- admin: bulk actions -------------------------------------------------------


async def _bulk(
    user: TokenPayload, body: BulkRequest, collection: str, kind: str, label: str
) -> BulkResult:
    """Apply `body.action` to each id, one at a time, and audit each one as the
    single-item route does (`community.<kind>.delete`, or `.update` for a state
    change; `label` is the field the audit detail names the item by). An id with
    no item is reported in `missing` and does not stop the rest."""
    done: list[str] = []
    missing: list[str] = []
    for item_id in body.ids:
        doc = await get_db()[collection].find_one({"_id": item_id})
        if doc is None:
            missing.append(item_id)
            continue
        if body.action == "delete":
            await get_db()[collection].delete_one({"_id": item_id})
            await _audit(user, f"community.{kind}.delete", item_id, **{label: doc[label]})
        else:
            state = "published" if body.action == "publish" else "draft"
            await get_db()[collection].update_one(
                {"_id": item_id}, {"$set": _changes(user, {"state": state})}
            )
            await _audit(user, f"community.{kind}.update", item_id, **{label: doc[label]}, state=state)
        done.append(item_id)
    return BulkResult(done=done, missing=missing)


@admin_router.post("/workshops/bulk", response_model=BulkResult)
async def bulk_workshops(body: BulkRequest, user: TokenPayload = Depends(_content_manager)):
    return await _bulk(user, body, WORKSHOPS, "workshop", "slug")


@admin_router.post("/tutorials/bulk", response_model=BulkResult)
async def bulk_tutorials(body: BulkRequest, user: TokenPayload = Depends(_content_manager)):
    return await _bulk(user, body, TUTORIALS, "tutorial", "slug")


@admin_router.post("/news/bulk", response_model=BulkResult)
async def bulk_news(body: BulkRequest, user: TokenPayload = Depends(_content_manager)):
    return await _bulk(user, body, NEWS, "news", "slug")


@admin_router.post("/publications/bulk", response_model=BulkResult)
async def bulk_publications(body: BulkRequest, user: TokenPayload = Depends(_content_manager)):
    return await _bulk(user, body, PUBLICATIONS, "publication", "title")


# ---- admin: workshops and tutorials (both have a unique slug) ----------------


async def _slug_taken(collection: str, slug: str, own_id: str | None) -> bool:
    query: dict = {"slug": slug}
    if own_id is not None:
        query["_id"] = {"$ne": own_id}
    return await get_db()[collection].find_one(query) is not None


def _slug_conflict() -> HTTPException:
    return _error(409, "slug_taken", "Another item already uses that slug. Choose a different one.")


async def _insert(collection: str, doc: dict) -> None:
    """Insert, turning the unique index's refusal of a slug into 409 (the check
    before it is not atomic)."""
    try:
        await get_db()[collection].insert_one(doc)
    except DuplicateKeyError:
        raise _slug_conflict() from None


async def _update(collection: str, item_id: str, fields: dict) -> None:
    try:
        await get_db()[collection].update_one({"_id": item_id}, {"$set": fields})
    except DuplicateKeyError:
        raise _slug_conflict() from None


def _new_document(user: TokenPayload, fields: dict) -> dict:
    now = _now()
    return {
        "_id": str(uuid.uuid4()),
        **fields,
        "created_at": now,
        "updated_at": now,
        "updated_by": user.sub,
    }


def _changes(user: TokenPayload, fields: dict) -> dict:
    return {**fields, "updated_at": _now(), "updated_by": user.sub}


@admin_router.get("/workshops", response_model=list[Workshop])
async def list_workshops(_user: TokenPayload = Depends(_content_manager)):
    docs = await get_db()[WORKSHOPS].find({}).sort("date", -1).to_list(None)
    return [_workshop(d) for d in docs]


@admin_router.post("/workshops", status_code=201, response_model=Workshop)
async def create_workshop(body: WorkshopInput, user: TokenPayload = Depends(_content_manager)):
    fields = body.model_dump()
    if await _slug_taken(WORKSHOPS, body.slug, None):
        raise _slug_conflict()
    doc = _new_document(user, fields)
    await _insert(WORKSHOPS, doc)
    await _audit(user, "community.workshop.create", doc["_id"], slug=body.slug, state=body.state)
    return _workshop(doc)


@admin_router.get("/workshops/{item_id}", response_model=Workshop)
async def get_workshop_admin(item_id: str, _user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[WORKSHOPS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("workshop")
    return _workshop(doc)


@admin_router.put("/workshops/{item_id}", response_model=Workshop)
async def update_workshop(
    item_id: str, body: WorkshopInput, user: TokenPayload = Depends(_content_manager)
):
    if await get_db()[WORKSHOPS].find_one({"_id": item_id}) is None:
        raise _not_found("workshop")
    if await _slug_taken(WORKSHOPS, body.slug, item_id):
        raise _slug_conflict()
    await _update(WORKSHOPS, item_id, _changes(user, body.model_dump()))
    await _audit(user, "community.workshop.update", item_id, slug=body.slug, state=body.state)
    return _workshop(await get_db()[WORKSHOPS].find_one({"_id": item_id}))


@admin_router.delete("/workshops/{item_id}", status_code=204)
async def delete_workshop(item_id: str, user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[WORKSHOPS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("workshop")
    await get_db()[WORKSHOPS].delete_one({"_id": item_id})
    await _audit(user, "community.workshop.delete", item_id, slug=doc["slug"])
    return Response(status_code=204)


@admin_router.get("/tutorials", response_model=list[Tutorial])
async def list_tutorials(_user: TokenPayload = Depends(_content_manager)):
    docs = await get_db()[TUTORIALS].find({}).sort("position", 1).to_list(None)
    return [_tutorial(d) for d in docs]


@admin_router.post("/tutorials", status_code=201, response_model=Tutorial)
async def create_tutorial(body: TutorialInput, user: TokenPayload = Depends(_content_manager)):
    if await _slug_taken(TUTORIALS, body.slug, None):
        raise _slug_conflict()
    last = await get_db()[TUTORIALS].find({}).sort("position", -1).limit(1).to_list(1)
    position = last[0]["position"] + 1 if last else 0
    doc = _new_document(user, {**body.model_dump(), "position": position})
    await _insert(TUTORIALS, doc)
    await _audit(user, "community.tutorial.create", doc["_id"], slug=body.slug, state=body.state)
    return _tutorial(doc)


@admin_router.post("/tutorials/reorder", status_code=204)
async def reorder_tutorials(
    body: ReorderRequest, user: TokenPayload = Depends(_content_manager)
):
    """Set the manual order: the listed tutorials take positions 0, 1, 2…, and
    any tutorial left out follows them in its current order, so a client with a
    stale list never leaves two tutorials at the same position."""
    docs = await get_db()[TUTORIALS].find({}).sort("position", 1).to_list(None)
    known = {d["_id"] for d in docs}
    if len(set(body.ids)) != len(body.ids):
        raise _error(422, "duplicate_ids", "Each tutorial may be listed once.")
    unknown = [i for i in body.ids if i not in known]
    if unknown:
        raise _error(422, "unknown_ids", f"No such tutorial: {unknown[0]}.")
    order = body.ids + [d["_id"] for d in docs if d["_id"] not in set(body.ids)]
    current = {d["_id"]: d.get("position") for d in docs}
    for position, item_id in enumerate(order):
        if current[item_id] != position:
            await get_db()[TUTORIALS].update_one({"_id": item_id}, {"$set": {"position": position}})
    await _audit(user, "community.tutorial.reorder", None, ids=order)
    return Response(status_code=204)


@admin_router.get("/tutorials/{item_id}", response_model=Tutorial)
async def get_tutorial_admin(item_id: str, _user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[TUTORIALS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("tutorial")
    return _tutorial(doc)


@admin_router.put("/tutorials/{item_id}", response_model=Tutorial)
async def update_tutorial(
    item_id: str, body: TutorialInput, user: TokenPayload = Depends(_content_manager)
):
    if await get_db()[TUTORIALS].find_one({"_id": item_id}) is None:
        raise _not_found("tutorial")
    if await _slug_taken(TUTORIALS, body.slug, item_id):
        raise _slug_conflict()
    await _update(TUTORIALS, item_id, _changes(user, body.model_dump()))
    await _audit(user, "community.tutorial.update", item_id, slug=body.slug, state=body.state)
    return _tutorial(await get_db()[TUTORIALS].find_one({"_id": item_id}))


@admin_router.delete("/tutorials/{item_id}", status_code=204)
async def delete_tutorial(item_id: str, user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[TUTORIALS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("tutorial")
    await get_db()[TUTORIALS].delete_one({"_id": item_id})
    await _audit(user, "community.tutorial.delete", item_id, slug=doc["slug"])
    return Response(status_code=204)


# ---- admin: news posts -------------------------------------------------------


@admin_router.get("/news", response_model=list[NewsPost])
async def list_news(_user: TokenPayload = Depends(_content_manager)):
    docs = await get_db()[NEWS].find({}).sort([("date", -1), ("created_at", -1)]).to_list(None)
    return [_news(d) for d in docs]


@admin_router.post("/news", status_code=201, response_model=NewsPost)
async def create_news(body: NewsInput, user: TokenPayload = Depends(_content_manager)):
    if await _slug_taken(NEWS, body.slug, None):
        raise _slug_conflict()
    doc = _new_document(user, body.model_dump())
    await _insert(NEWS, doc)
    await _audit(user, "community.news.create", doc["_id"], slug=body.slug, state=body.state)
    return _news(doc)


@admin_router.get("/news/{item_id}", response_model=NewsPost)
async def get_news_admin(item_id: str, _user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[NEWS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("news")
    return _news(doc)


@admin_router.put("/news/{item_id}", response_model=NewsPost)
async def update_news(
    item_id: str, body: NewsInput, user: TokenPayload = Depends(_content_manager)
):
    if await get_db()[NEWS].find_one({"_id": item_id}) is None:
        raise _not_found("news")
    if await _slug_taken(NEWS, body.slug, item_id):
        raise _slug_conflict()
    await _update(NEWS, item_id, _changes(user, body.model_dump()))
    await _audit(user, "community.news.update", item_id, slug=body.slug, state=body.state)
    return _news(await get_db()[NEWS].find_one({"_id": item_id}))


@admin_router.delete("/news/{item_id}", status_code=204)
async def delete_news(item_id: str, user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[NEWS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("news")
    await get_db()[NEWS].delete_one({"_id": item_id})
    await _audit(user, "community.news.delete", item_id, slug=doc["slug"])
    return Response(status_code=204)


# ---- admin: publications -----------------------------------------------------


@admin_router.get("/publications", response_model=list[Publication])
async def list_publications(_user: TokenPayload = Depends(_content_manager)):
    docs = await get_db()[PUBLICATIONS].find({}).to_list(None)
    docs.sort(key=lambda d: d["title"])
    docs.sort(key=lambda d: d["year"], reverse=True)
    return [Publication.model_validate(_with_id(d)) for d in docs]


@admin_router.post("/publications", status_code=201, response_model=Publication)
async def create_publication(
    body: PublicationInput, user: TokenPayload = Depends(_content_manager)
):
    doc = _new_document(user, body.model_dump())
    await get_db()[PUBLICATIONS].insert_one(doc)
    await _audit(user, "community.publication.create", doc["_id"], title=body.title, state=body.state)
    return Publication.model_validate(_with_id(doc))


@admin_router.get("/publications/{item_id}", response_model=Publication)
async def get_publication_admin(item_id: str, _user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[PUBLICATIONS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("publication")
    return Publication.model_validate(_with_id(doc))


@admin_router.put("/publications/{item_id}", response_model=Publication)
async def update_publication(
    item_id: str, body: PublicationInput, user: TokenPayload = Depends(_content_manager)
):
    if await get_db()[PUBLICATIONS].find_one({"_id": item_id}) is None:
        raise _not_found("publication")
    await get_db()[PUBLICATIONS].update_one(
        {"_id": item_id}, {"$set": _changes(user, body.model_dump())}
    )
    await _audit(user, "community.publication.update", item_id, title=body.title, state=body.state)
    doc = await get_db()[PUBLICATIONS].find_one({"_id": item_id})
    return Publication.model_validate(_with_id(doc))


@admin_router.delete("/publications/{item_id}", status_code=204)
async def delete_publication(item_id: str, user: TokenPayload = Depends(_content_manager)):
    doc = await get_db()[PUBLICATIONS].find_one({"_id": item_id})
    if doc is None:
        raise _not_found("publication")
    await get_db()[PUBLICATIONS].delete_one({"_id": item_id})
    await _audit(user, "community.publication.delete", item_id, title=doc["title"])
    return Response(status_code=204)


# ---- admin: settings ----------------------------------------------------------


@admin_router.get("/settings", response_model=CommunitySettings)
async def get_settings(_user: TokenPayload = Depends(_content_manager)):
    return _settings(await get_db()[SETTINGS].find_one({"_id": SETTINGS_ID}))


@admin_router.put("/settings", response_model=CommunitySettings)
async def put_settings(
    body: CommunitySettingsInput, user: TokenPayload = Depends(_content_manager)
):
    await get_db()[SETTINGS].update_one(
        {"_id": SETTINGS_ID}, {"$set": _changes(user, body.model_dump())}, upsert=True
    )
    await _audit(user, "community.settings.update", SETTINGS_ID)
    return _settings(await get_db()[SETTINGS].find_one({"_id": SETTINGS_ID}))


# ---- admin: files --------------------------------------------------------------


@admin_router.post(
    "/files",
    status_code=201,
    response_model=CommunityFile,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            },
        }
    },
)
async def upload_file(
    request: Request, user: TokenPayload = Depends(_content_manager)
):
    """Store one file (multipart field `file`, at most 25 MiB). 413 over the
    limit, 415 for a type that is not allowed or a file that is not what its
    name says. The body is read here and not by FastAPI so the limit applies
    while it arrives."""
    try:
        upload = await community_files.read_upload(request)
        try:
            stored = await community_files.store_upload(upload, user.sub)
        finally:
            await upload.close()
    except community_files.UploadRefused as exc:
        raise _error(exc.status, exc.code, exc.message) from exc
    await _audit(
        user, "community.file.upload", stored["id"],
        filename=stored["filename"], size=stored["size"],
    )
    return stored


@admin_router.get("/files", response_model=list[CommunityFile])
async def list_files(_user: TokenPayload = Depends(_content_manager)):
    return await community_files.list_files()


@admin_router.delete("/files/{file_id}", status_code=204)
async def delete_file(file_id: str, user: TokenPayload = Depends(_content_manager)):
    stored = await community_files.open_file(file_id)
    if stored is None:
        raise _not_found("file")
    info = community_files.describe(stored)
    await community_files.delete_file(file_id)
    await _audit(user, "community.file.delete", file_id, filename=info["filename"])
    return Response(status_code=204)


@admin_router.post("/files/bulk-delete", response_model=BulkResult)
async def bulk_delete_files(body: BulkDeleteRequest, user: TokenPayload = Depends(_content_manager)):
    """Delete each listed file, audited as `community.file.delete`; an id with
    no file is reported in `missing`."""
    done: list[str] = []
    missing: list[str] = []
    for file_id in body.ids:
        stored = await community_files.open_file(file_id)
        if stored is None:
            missing.append(file_id)
            continue
        info = community_files.describe(stored)
        if not await community_files.delete_file(file_id):
            missing.append(file_id)
            continue
        await _audit(user, "community.file.delete", file_id, filename=info["filename"])
        done.append(file_id)
    return BulkResult(done=done, missing=missing)
