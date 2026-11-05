"""The WBM code versions and their status, public like the catalogue."""

from __future__ import annotations

from fastapi import APIRouter

from app.models.wbm_code import WbmCodeResponse, WbmCodeVersion
from app.services import wbm_code

router = APIRouter(prefix="/wbm-code", tags=["wbm-code"])


@router.get("", response_model=WbmCodeResponse)
async def get_wbm_code() -> WbmCodeResponse:
    """Every published WBM code version with its status, the ones a new
    snapshot draft may start from (``current``) and the ``latest`` alias, read
    from ``wbm-code/manifest.json`` and kept for a minute. ``readable`` is false
    (and the lists empty) when the manifest cannot be fetched or parsed."""
    manifest = await wbm_code.get_manifest()
    if manifest is None:
        return WbmCodeResponse(versions=[], current=[], latest=None, readable=False)
    return WbmCodeResponse(
        versions=[
            WbmCodeVersion(
                version=v.version,
                treeHash=v.tree_hash,
                status=v.status,
                published=v.published,
                reason=v.reason,
            )
            for v in manifest.versions.values()
        ],
        current=manifest.current,
        latest=manifest.latest,
        readable=True,
    )
