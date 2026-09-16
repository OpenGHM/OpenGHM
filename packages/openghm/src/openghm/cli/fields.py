"""Declarative field specs for the interactive wizard.

One spec drives three things: the prompt asked, the reconstruction of the
equivalent ``openghm`` command, and the options handed to the core builders.
``key`` matches the core option name (snake_case, so ``Field.key`` is a valid
``*Options`` keyword); ``flag`` is the CLI flag for the reconstructed command;
``desc`` is a one-line explanation shown above the prompt.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

# kind: "text" | "number" | "select" | "confirm" | "ids"


@dataclass
class Field:
    kind: str
    flag: str  # CLI flag, e.g. "--net"
    key: str  # core opts key, e.g. "net"
    message: str
    #: One-line explanation shown above the prompt.
    desc: Optional[str] = None
    placeholder: Optional[str] = None
    required: bool = False
    #: Validate that a host path exists (skipped for /data,/work container paths).
    exists_check: bool = False
    #: select options: [{"value":..., "label":..., "hint":...}]
    options: Optional[List[dict]] = None
    initial: Optional[str] = None


VERBOSE = Field(
    kind="confirm", flag="--verbose", key="verbose",
    message="Verbose script output?",
    desc="Print the script's detailed progress output.",
)

# ---- network preclip --------------------------------------------------------
PRECLIP_REQUIRED: List[Field] = [
    Field("text", "--net", "net", "Input network file (--net)",
          "Flow-direction network to clip (GeoTIFF or ASCII grid).", required=True, exists_check=True),
    Field("text", "--output", "output", "Output file (--output, under /work)",
          "Where to write the clipped network (a /work path).", required=True),
    Field("number", "--lon-min", "lon_min", "Rectangle lon min",
          "Western longitude edge of the clip box (degrees).", required=True),
    Field("number", "--lon-max", "lon_max", "Rectangle lon max",
          "Eastern longitude edge of the clip box (degrees).", required=True),
    Field("number", "--lat-min", "lat_min", "Rectangle lat min",
          "Southern latitude edge of the clip box (degrees).", required=True),
    Field("number", "--lat-max", "lat_max", "Rectangle lat max",
          "Northern latitude edge of the clip box (degrees).", required=True),
]
PRECLIP_ADVANCED: List[Field] = [
    Field("text", "--basin-id", "basin_id", "Basin ID file (--basin-id)",
          "Optional basin-ID raster to tag cells by basin.", exists_check=True),
    Field("confirm", "--trim-nodata", "trim_nodata", "Trim nodata margins?",
          "Crop empty nodata margins around the result."),
    VERBOSE,
]

# ---- network subset (rectangle mode) ---------------------------------------
SUBSET_RECT_REQUIRED: List[Field] = [
    Field("text", "--net", "net", "Input network file (--net)",
          "Flow-direction network to subset (GeoTIFF or ASCII grid).", required=True, exists_check=True),
    Field("text", "--output", "output", "Output file (--output, under /work)",
          "Where to write the subset network (a /work path).", required=True),
    Field("number", "--lon-min", "lon_min", "Rectangle lon min",
          "Western longitude edge of the box (degrees).", required=True),
    Field("number", "--lon-max", "lon_max", "Rectangle lon max",
          "Eastern longitude edge of the box (degrees).", required=True),
    Field("number", "--lat-min", "lat_min", "Rectangle lat min",
          "Southern latitude edge of the box (degrees).", required=True),
    Field("number", "--lat-max", "lat_max", "Rectangle lat max",
          "Northern latitude edge of the box (degrees).", required=True),
]
SUBSET_RECT_ADVANCED: List[Field] = [
    Field("confirm", "--trim-nodata", "trim_nodata", "Trim nodata margins?",
          "Crop empty nodata margins around the result."),
    Field("confirm", "--inscribe", "inscribe", "Inscribe (vs superscribe)?",
          "Keep whole basins inside the box, not ones it merely touches."),
    Field("text", "--basin-id", "basin_id", "Basin ID file (--basin-id)",
          "Optional basin-ID raster to tag cells by basin.", exists_check=True),
    VERBOSE,
]

# ---- network subset (shapefile/polygon mode) -------------------------------
SUBSET_SHP_REQUIRED: List[Field] = [
    Field("text", "--net", "net", "Input network file (--net)",
          "Flow-direction network to subset (GeoTIFF or ASCII grid).", required=True, exists_check=True),
    Field("text", "--output", "output", "Output file (--output, under /work)",
          "Where to write the subset network (a /work path).", required=True),
    Field("text", "--shapefile", "shapefile", "Shapefile (--shapefile)",
          "Polygon shapefile defining the area to keep.", required=True, exists_check=True),
    Field("text", "--id-field", "id_field", "Shapefile ID attribute (--id-field)",
          "Attribute column that holds each polygon's ID.", required=True),
    Field("ids", "--ids", "ids", "Polygon IDs (comma-separated)",
          "Which polygon IDs from that column to keep.", required=True),
]
SUBSET_SHP_ADVANCED: List[Field] = [
    Field("text", "--proj", "proj", "Projection (--proj)",
          "Reproject the shapefile to this CRS first.", placeholder="epsg:4326"),
    Field("confirm", "--trim-nodata", "trim_nodata", "Trim nodata margins?",
          "Crop empty nodata margins around the result."),
    Field("confirm", "--inscribe", "inscribe", "Inscribe polygon?",
          "Keep only cells fully inside the polygon."),
    Field("confirm", "--continuous", "continuous", "Continuous polygon?",
          "Treat the selected polygons as one connected region."),
    VERBOSE,
]

# ---- spatial ----------------------------------------------------------------
SPATIAL_REQUIRED: List[Field] = [
    Field("text", "--mt", "mt", "Magic Table CSV (--mt)",
          "CSV listing datasets and their in-container file paths.", required=True, exists_check=True),
    Field("text", "--data", "data_code", "Dataset code (--data DATA_CODE)",
          "Which dataset (DataID) from the Magic Table to aggregate.", required=True),
    Field("text", "--mask", "mask_code", "Mask code(s) (--mask MASK[+MASK2])",
          "Polygon mask(s) to aggregate over; join several with +.", required=True),
]
SPATIAL_ADVANCED: List[Field] = [
    Field("text", "--output", "output", "Output NetCDF (--output, under /work)",
          "NetCDF output path (a /work path)."),
    Field("text", "--key-file", "key_file", "Mask cache .msk (--key-file; auto if blank)",
          "Mask cache file; auto-set under /work when left blank."),
    Field("text", "--start", "start", "Start date (--start YYYY-MM-DD)",
          "Only aggregate records on or after this date."),
    Field("text", "--end", "end", "End date (--end YYYY-MM-DD)",
          "Only aggregate records on or before this date."),
    Field("select", "--method", "method", "Aggregation method",
          "How cell values combine within each polygon.", initial="mean", options=[
              {"value": "mean", "label": "mean", "hint": "area-weighted average"},
              {"value": "sum", "label": "sum", "hint": "cumulative (-c)"},
          ]),
    Field("text", "--out-type", "out_type", "Output type (byte|short|long|float|double)",
          "Numeric type stored in the output NetCDF."),
    Field("number", "--scale", "scale", "Scale (--scale / -scl)",
          "Multiply output values by this factor."),
    Field("number", "--offset", "offset", "Offset (--offset / -off)",
          "Add this constant to output values."),
    Field("number", "--weight", "weight", "Constant weight (--weight / -na)",
          "Use a constant cell weight instead of area weighting."),
    Field("number", "--mask-res", "mask_res", "Mask pixel resolution (--mask-res / -tr)",
          "Resolution (degrees) to rasterize the mask at."),
    Field("text", "--metadata", "metadata", "Metadata NAME:UNITS:FORMAT (--metadata)",
          "Override the output variable's name/units/format."),
    Field("confirm", "--remove", "remove", "Remove existing output first (-rm)?",
          "Delete any existing output before writing."),
    Field("confirm", "--zero-id", "zero_id", "Allow polygon ID 0 (-z)?",
          "Treat polygon ID 0 as valid, not as nodata."),
    VERBOSE,
]

# ---- temporal ---------------------------------------------------------------
TEMPORAL_REQUIRED: List[Field] = [
    Field("text", "--mt", "mt", "Magic Table CSV (--mt)",
          "CSV listing datasets and their in-container file paths.", required=True, exists_check=True),
    Field("text", "--src", "src_code", "Source code (--src SRC_DATA_CODE)",
          "Source dataset (DataID) to aggregate from.", required=True),
    Field("text", "--dst", "dst_code", "Destination code (--dst DST_DATA_CODE)",
          "Destination dataset (DataID) to write.", required=True),
]
TEMPORAL_ADVANCED: List[Field] = [
    Field("text", "--start", "start", "Start date (--start YYYY-MM-DD)",
          "Only process records on or after this date."),
    Field("text", "--end", "end", "End date (--end YYYY-MM-DD)",
          "Only process records on or before this date."),
    Field("select", "--method", "method", "Aggregation method",
          "How source records combine into each output period.", options=[
              {"value": "mean", "label": "mean", "hint": "-a 0"},
              {"value": "sum", "label": "sum", "hint": "-a 1"},
              {"value": "category", "label": "category", "hint": "-a 2"},
          ]),
    Field("number", "--scale", "scale", "Scale (--scale / -so SCALE)",
          "Multiply output values by this factor."),
    Field("number", "--offset", "offset", "Offset (--offset / -so _ OFFSET)",
          "Add this constant to output values."),
    Field("text", "--out-type", "out_type", "Output type (byte|short|long|float|double)",
          "Numeric type stored in the output NetCDF."),
    Field("number", "--patch", "patch", "Patch nodata value (--patch / -p)",
          "Fill missing cells with this nodata value."),
    Field("text", "--metadata", "metadata", "Metadata NAME:UNITS:FORMAT (--metadata)",
          "Override the output variable's name/units/format."),
    Field("confirm", "--trim", "trim", "Trim incomplete start/end records (-trim)?",
          "Drop incomplete periods at the start and end."),
    Field("confirm", "--push-dates", "push_dates", "Push destination dates (-pd)?",
          "Shift output timestamps to the end of each period."),
    Field("confirm", "--no-datacube-check", "no_datacube_check", "Skip DataCube field check (-ndc)?",
          "Skip the DataCube field-consistency check."),
    Field("confirm", "--nc3", "nc3", "Classic NetCDF v3 output (-nc3)?",
          "Write classic NetCDF-3 instead of NetCDF-4."),
    Field("confirm", "--remove", "remove", "Remove existing output first (-rm)?",
          "Delete any existing output before writing."),
    VERBOSE,
]
