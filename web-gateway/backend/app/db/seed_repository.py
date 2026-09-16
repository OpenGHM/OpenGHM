"""Seed the datasets collection — clears existing docs and inserts fresh seed data."""
import uuid

from app.core.database import get_db


def _slug_to_id(slug: str) -> str:
    """Derive a stable 32-hex hash ID from a human-readable slug.

    Uses UUID v5 (SHA-1 of NAMESPACE_DNS + slug) so the result is
    deterministic: same slug always produces the same hash, making
    re-seeding idempotent and avoiding orphaned job references.
    """
    return uuid.uuid5(uuid.NAMESPACE_DNS, slug).hex

_ADMIN_CONFORMS_TO = [
    "https://schema.org/Dataset",
    "http://www.hydroshare.org/terms/CompositeResource",
]

_ADMIN_META_COMMON = {
    "metadataStandard": "HydroShare-WBM-Hybrid (Simulation)",
    "metadataVersion": "1.0.0",
    "conformsTo": _ADMIN_CONFORMS_TO,
    "applicationContext": "OpenGHM Scientific Gateway",
}

_V1_CREATORS = [
    {"name": "Danielle Grogan", "email": "danielle.grogan@unh.edu"},
    {"name": "Shan Zuidema", "email": "shan.zuidema@unh.edu"},
]

_V1_RELATED_LINKS = [
    {
        "type": "hsterms:isDescribedBy",
        "roleName": "Primary Publication",
        "url": "https://gmd.copernicus.org/articles/15/7287/2022/",
        "doi": None,
        "description": "Primary publication describing the model methodology.",
    }
]

_V1_ACTIVE_PROCESSES_GLOBAL = [
    "Irrigation water re-use tracking",
    "Reservoirs",
    "Irrigated Crops",
    "Primary water source tracking",
    "Runoff from Glaciated Areas",
]

_V1_ACTIVE_PROCESSES_WYOMING = [
    "Reservoirs",
    "Runoff from Glaciated Areas",
    "Source water tracking by land area",
    "Irrigation water re-use tracking",
    "Irrigated Crops",
    "Primary water source tracking",
]

_V1_VARIABLES = [
    {"name": "runoff", "unitText": "mm/day", "standardName": None},
    {"name": "runoff_ps", "unitText": "fraction", "standardName": None},
    {"name": "runoff_pu", "unitText": "fraction", "standardName": None},
    {"name": "runoff_pr", "unitText": "fraction", "standardName": None},
    {"name": "runoff_pg", "unitText": "fraction", "standardName": None},
    {"name": "irrRunoff", "unitText": "mm/day", "standardName": None},
    {"name": "glMelt", "unitText": "m3/sec", "standardName": None},
    {"name": "discharge", "unitText": "m3/sec", "standardName": None},
    {"name": "discharge_ps", "unitText": "fraction", "standardName": None},
    {"name": "discharge_pu", "unitText": "fraction", "standardName": None},
    {"name": "discharge_pr", "unitText": "fraction", "standardName": None},
    {"name": "soilMoist", "unitText": "mm", "standardName": None},
    {"name": "soilMoist_ps", "unitText": "fraction", "standardName": None},
    {"name": "soilMoist_pg", "unitText": "fraction", "standardName": None},
    {"name": "soilMoist_pr", "unitText": "fraction", "standardName": None},
    {"name": "soilMoist_pu", "unitText": "fraction", "standardName": None},
    {"name": "grdWater", "unitText": "mm", "standardName": None},
    {"name": "grndWater_ps", "unitText": "fraction", "standardName": None},
    {"name": "grndWater_pu", "unitText": "fraction", "standardName": None},
    {"name": "grndWater_pr", "unitText": "fraction", "standardName": None},
    {"name": "grndWater_pg", "unitText": "fraction", "standardName": None},
    {"name": "irrigationGross", "unitText": "mm/day", "standardName": None},
    {"name": "GrossIrr_ps", "unitText": "fraction", "standardName": None},
    {"name": "GrossIrr_pu", "unitText": "fraction", "standardName": None},
    {"name": "GrossIrr_pr", "unitText": "fraction", "standardName": None},
    {"name": "GrossIrr_pg", "unitText": "fraction", "standardName": None},
    {"name": "irrigationFlow", "unitText": "mm/day", "standardName": None},
    {"name": "IrrFlow_mm_ps", "unitText": "mm/day", "standardName": None},
    {"name": "IrrFlow_mm_pg", "unitText": "mm/day", "standardName": None},
    {"name": "IrrFlow_mm_pr", "unitText": "mm/day", "standardName": None},
    {"name": "IrrFlow_mm_pu", "unitText": "mm/day", "standardName": None},
    {"name": "irrigationGrwt", "unitText": "mm/day", "standardName": None},
    {"name": "IrrGrwt_mm_ps", "unitText": "mm/day", "standardName": None},
    {"name": "IrrGrwt_mm_pg", "unitText": "mm/day", "standardName": None},
    {"name": "IrrGrwt_mm_pr", "unitText": "mm/day", "standardName": None},
    {"name": "IrrGrwt_mm_pu", "unitText": "mm/day", "standardName": None},
    {"name": "irrigationExtra", "unitText": "mm/day", "standardName": None},
    {"name": "etIrrCrops", "unitText": "mm/day", "standardName": None},
    {"name": "etIrrCrops_mm_ps", "unitText": "mm/day", "standardName": None},
    {"name": "etIrrCrops_mm_pg", "unitText": "mm/day", "standardName": None},
    {"name": "etIrrCrops_mm_pr", "unitText": "mm/day", "standardName": None},
    {"name": "etIrrCrops_mm_pu", "unitText": "mm/day", "standardName": None},
    {"name": "runoff_pst", "unitText": "fraction", "standardName": None},
    {"name": "runoff_irr", "unitText": "fraction", "standardName": None},
    {"name": "runoff_rlt", "unitText": "fraction", "standardName": None},
    {"name": "discharge_pst", "unitText": "fraction", "standardName": None},
    {"name": "discharge_irr", "unitText": "fraction", "standardName": None},
    {"name": "discharge_rlt", "unitText": "fraction", "standardName": None},
    {"name": "grndWater_pst", "unitText": "fraction", "standardName": None},
    {"name": "grndWater_irr", "unitText": "fraction", "standardName": None},
    {"name": "grndWater_rlt", "unitText": "fraction", "standardName": None},
]

_V1_VARIABLES_WYOMING = _V1_VARIABLES + [
    {"name": "dischMsk", "unitText": "fraction", "standardName": None},
    {"name": "runoffMsk", "unitText": "fraction", "standardName": None},
    {"name": "grndWtMsk", "unitText": "fraction", "standardName": None},
]

# ── Dataset 1: WBM v2.0.0 tutorial snapshot ───────────────────────────────────

WBM_V2_TUTORIAL: dict = {
    "_id": _slug_to_id("wbm_storage_v2.0.0"),
    "slug": "wbm_storage_v2.0.0",
    "datasetType": "snapshot",
    "title": "WBM v2.0.0 simulation as tutorial: [Global] [2000-2001]",
    "description": "A simple WBM simulation that was used in 2023 user community WBM workshop",
    "creators": [
        {"name": "Danielle Grogan", "email": "danielle.grogan@unh.edu"},
        {"name": "Shan Zuidema", "email": "shan.zuidema@unh.edu"},
        {"name": "Alex Prusevich", "email": "alex.proussevitch@unh.edu"},
    ],
    "license": "GPL-3.0",
    "licenseUrl": "https://www.gnu.org/licenses/gpl-3.0.en.html",
    "keywords": ["Water Balance Model", "Global Hydrologic Model", "2.0.0", "global"],
    "tag": "tutorial",
    "relatedLinks": [
        {
            "type": "hsterms:isDescribedBy",
            "roleName": "Primary Publication",
            "url": "https://gmd.copernicus.org/articles/15/7287/2022/",
            "doi": None,
            "description": "Primary publication describing the model methodology.",
        }
    ],
    "yearPublished": None,
    "spatialResolution": "5 arc-minute",
    "spatialResolutionDegrees": 5 / 60,
    "spatialCoverage": {
        "box": "21.75 -127.8334 57.1667 -60.5834",
        "northlimit": 57.1667,
        "southlimit": 21.75,
        "eastlimit": -60.5834,
        "westlimit": -127.8334,
        "units": "Decimal degrees",
        "projection": "epsg:4326",
        "riverNetworkSource": "hyd_5m_CONUS_mississippi_patched.asc",
        "majorRivers": None,
    },
    "temporalCoverage": "2001-01-01/2001-12-31",
    "temporalResolution": None,
    "datasetVersion": None,
    "format": "NetCDF",
    "fileSize": "N/A",
    "lastUpdated": "2026-05-05T19:34:07Z",
    "adminMetadata": {
        "generatedAt": "2026-02-24T16:45:00Z",
        "lastUpdated": "2026-05-05T19:34:07Z",
        **_ADMIN_META_COMMON,
    },
    # snapshot-specific
    "softwareVersion": "WBM v2.0.0",
    "isBasedOn": "https://s3.anvil.rcac.purdue.edu/openghm/containers/wbm_opensource_v2.0.0.sif",
    "spinupPeriod": "2000-01-01/2000-12-31",
    "processesOn": [],
    "activeProcesses": ["Evaporation from Open Water"],
    "variablesMeasured": [
        {"name": "runoff", "unitText": "mm/day", "standardName": None},
        {"name": "discharge", "unitText": "m3/sec", "standardName": None},
        {"name": "streamAge", "unitText": "days", "standardName": None},
    ],
    "recommendedComputeSetting": ["16", "15:00"],
}

# ── Dataset 2: WBM v1.0.0 Global tracking ────────────────────────────────────

WBM_V1_GLOBAL: dict = {
    "_id": _slug_to_id("wbm_global_v1.0.0"),
    "slug": "wbm_global_v1.0.0",
    "datasetType": "snapshot",
    "title": "WBM v1.0.0 Global_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionalit': [Global] [2000-2001]",
    "description": "A WBM global simulation for 2022 model documentation paper.",
    "creators": _V1_CREATORS,
    "license": "GPL-3.0",
    "licenseUrl": "https://www.gnu.org/licenses/gpl-3.0.en.html",
    "keywords": ["Water Balance Model", "Global Hydrologic Model", "1.0.0", "global", "Global_tracking"],
    "tag": "publication",
    "relatedLinks": _V1_RELATED_LINKS,
    "yearPublished": None,
    "spatialResolution": "5 arc-minute",
    "spatialResolutionDegrees": 5 / 60,
    "spatialCoverage": {
        "box": "-90.0 -180.0 90.0 180.0",
        "northlimit": 90.0,
        "southlimit": -90.0,
        "eastlimit": 180.0,
        "westlimit": -180.0,
        "units": "Decimal degrees",
        "projection": "epsg:4326",
        "riverNetworkSource": None,
        "majorRivers": None,
    },
    "temporalCoverage": "2000-01-01/2009-12-31",
    "temporalResolution": None,
    "datasetVersion": None,
    "format": "NetCDF",
    "fileSize": "N/A",
    "lastUpdated": "2026-05-05T19:47:36Z",
    "adminMetadata": {
        "generatedAt": "2026-02-24T16:45:00Z",
        "lastUpdated": "2026-05-05T19:47:36Z",
        **_ADMIN_META_COMMON,
    },
    # snapshot-specific
    "softwareVersion": "WBM v1.0.0",
    "isBasedOn": "https://s3.anvil.rcac.purdue.edu/openghm/containers/wbm_opensource_v1.0.0.sif",
    "spinupPeriod": "2000-01-01/2004-12-31",
    "processesOn": [],
    "activeProcesses": _V1_ACTIVE_PROCESSES_GLOBAL,
    "variablesMeasured": _V1_VARIABLES,
    "recommendedComputeSetting": ["64", "111:30:00"],
}

# ── Dataset 3: WBM v1.0.0 Wyoming tracking ───────────────────────────────────

WBM_V1_WYOMING: dict = {
    "_id": _slug_to_id("wbm_wyoming_v1.0.0"),
    "slug": "wbm_wyoming_v1.0.0",
    "datasetType": "snapshot",
    "title": "WBM v1.0.0 Wyoming_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionalit': [Global] [2000-2001]",
    "description": "A WBM global simulation for 2022 model documentation paper.",
    "creators": _V1_CREATORS,
    "license": "GPL-3.0",
    "licenseUrl": "https://www.gnu.org/licenses/gpl-3.0.en.html",
    "keywords": ["Water Balance Model", "Global Hydrologic Model", "1.0.0", "global", "Wyoming_tracking"],
    "tag": "publication",
    "relatedLinks": _V1_RELATED_LINKS,
    "yearPublished": None,
    "spatialResolution": "5 arc-minute",
    "spatialResolutionDegrees": 5 / 60,
    "spatialCoverage": {
        "box": "28.9166 -123.75 52.9167 -77.8333",
        "northlimit": 52.9167,
        "southlimit": 28.9166,
        "eastlimit": -77.8333,
        "westlimit": -123.75,
        "units": "Decimal degrees",
        "projection": "epsg:4326",
        "riverNetworkSource": "Wyoming_05min_flwdir.asc",
        "majorRivers": None,
    },
    "temporalCoverage": "2000-01-01/2009-12-31",
    "temporalResolution": None,
    "datasetVersion": None,
    "format": "NetCDF",
    "fileSize": "N/A",
    "lastUpdated": "2026-05-05T19:42:18Z",
    "adminMetadata": {
        "generatedAt": "2026-02-24T16:45:00Z",
        "lastUpdated": "2026-05-05T19:42:18Z",
        **_ADMIN_META_COMMON,
    },
    # snapshot-specific
    "softwareVersion": "WBM v1.0.0",
    "isBasedOn": "https://s3.anvil.rcac.purdue.edu/openghm/containers/wbm_opensource_v1.0.0.sif",
    "spinupPeriod": "2000-01-01/2004-12-31",
    "processesOn": [],
    "activeProcesses": _V1_ACTIVE_PROCESSES_WYOMING,
    "variablesMeasured": _V1_VARIABLES_WYOMING,
    "recommendedComputeSetting": ["64", "4:30:00"],
}

_SEEDS = [WBM_V2_TUTORIAL, WBM_V1_GLOBAL, WBM_V1_WYOMING]


async def seed_datasets() -> None:
    """Clear the datasets collection and insert fresh seed data."""
    db = get_db()
    coll = db["datasets"]
    await coll.delete_many({})
    await coll.insert_many(_SEEDS)
