"""Colouring a map and writing it as a PNG, with nothing but numpy and ``zlib``.

**The colours are ours.** An MT names a ramp and a range (``DarkBlue(0:20)``); the ramps' definitions
live in UNH's EarthAtlas code, which is private. :data:`RAMPS` is our approximation, one place, for
the families the MT files of the published snapshots use:

========== ================================================================ =======================
Ramp       Low to high                                                      Used for
========== ================================================================ =======================
DarkBlue   near-white, light blue, blue, dark navy (ColorBrewer Blues)       runoff, glacier melt
DarkRed    near-white, pink, red, dark red (Reds)                            fractions (tracking)
DarkGreen  near-white, light green, green, dark green (Greens)               (not in the MTs yet)
Rainbow    violet, blue, cyan, green, yellow, orange, red                    discharge, temperature
RainbowBR  blue, cyan, green, yellow, red                                    (not in the MTs yet)
RainbowRB  red, yellow, green, cyan, blue (BR reversed)                      soil moisture, irrigation
========== ================================================================ =======================

A name not in the table is drawn with ``Rainbow`` and reported (``rampUsed``). A value is shown as
``stored * Var_Scale + Var_Offset`` against the legend's range; ``Log`` legends use the base-10
logarithm of value and range, and a value of zero or less is left transparent (the MT's ``log:zero``
processing asks for the zeros to be treated apart; transparency draws a river map as rivers).
Fill, NaN and cells outside the grid are transparent.
"""

from __future__ import annotations

import struct
import zlib
from typing import Dict, List, Optional, Tuple

try:
    import numpy as np
except ImportError:  # the `output` extra is not installed
    np = None  # type: ignore[assignment]

Stops = List[Tuple[float, Tuple[int, int, int]]]

RAMPS: Dict[str, Stops] = {
    "DarkBlue": [(0.0, (247, 251, 255)), (0.25, (198, 219, 239)), (0.5, (107, 174, 214)),
                 (0.75, (33, 113, 181)), (1.0, (8, 48, 107))],
    "DarkRed": [(0.0, (255, 245, 240)), (0.25, (252, 187, 161)), (0.5, (251, 106, 74)),
                (0.75, (203, 24, 29)), (1.0, (103, 0, 13))],
    "DarkGreen": [(0.0, (247, 252, 245)), (0.25, (199, 233, 192)), (0.5, (116, 196, 118)),
                  (0.75, (35, 139, 69)), (1.0, (0, 68, 27))],
    "Rainbow": [(0.0, (75, 0, 130)), (1 / 6, (0, 0, 255)), (2 / 6, (0, 200, 255)), (3 / 6, (0, 200, 0)),
                (4 / 6, (255, 255, 0)), (5 / 6, (255, 127, 0)), (1.0, (255, 0, 0))],
    "RainbowBR": [(0.0, (0, 0, 255)), (0.25, (0, 255, 255)), (0.5, (0, 255, 0)),
                  (0.75, (255, 255, 0)), (1.0, (255, 0, 0))],
}
RAMPS["RainbowRB"] = [(1.0 - t, c) for t, c in reversed(RAMPS["RainbowBR"])]
#: The ramp for a name that is not in :data:`RAMPS`.
FALLBACK_RAMP = "Rainbow"
LEVELS = 256


def resolve_ramp(name: str) -> Tuple[str, bool]:
    """``(ramp used, whether it is the one asked for)``; names are matched without regard to case."""
    for known in RAMPS:
        if known.lower() == name.lower():
            return known, True
    return FALLBACK_RAMP, False


def lut(ramp: str):
    """A ``(256, 3)`` uint8 table of the ramp's colours, linear between its stops."""
    stops = RAMPS[ramp]
    xs = np.array([t for t, _ in stops])
    pts = np.linspace(0.0, 1.0, LEVELS)
    return np.stack([np.interp(pts, xs, [c[k] for _, c in stops]) for k in range(3)], axis=1).round().astype(np.uint8)


def legend_colors(ramp: str, n: int = 9) -> List[str]:
    """``n`` evenly spaced colours of the ramp as ``#rrggbb``, for a legend bar."""
    table = lut(ramp)
    return ["#%02x%02x%02x" % tuple(table[int(round(i * (LEVELS - 1) / (n - 1)))]) for i in range(n)]


def colorize(values, valid, lo: float, hi: float, log: bool, ramp: str):
    """RGBA (uint8, ``(rows, cols, 4)``) of displayed ``values`` where ``valid``, transparent elsewhere.

    The value is placed on the ramp by ``(v - lo) / (hi - lo)`` (``log10`` of all three when ``log``) and
    clipped to the ramp's ends. With ``log``, a value of zero or less is transparent.
    """
    v = np.asarray(values, dtype=np.float64)
    ok = valid & np.isfinite(v)
    if log:
        ok &= v > 0
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (np.log10(np.where(ok, v, 1.0)) - np.log10(lo)) / (np.log10(hi) - np.log10(lo))
    else:
        t = (np.where(ok, v, lo) - lo) / (hi - lo)
    idx = np.clip(np.floor(t * (LEVELS - 1) + 0.5), 0, LEVELS - 1).astype(np.intp)
    rgba = np.empty(v.shape + (4,), dtype=np.uint8)
    rgba[..., :3] = lut(ramp)[idx]
    rgba[..., 3] = np.where(ok, 255, 0).astype(np.uint8)
    return rgba


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png_bytes(rgba) -> bytes:
    """An 8-bit RGBA PNG of a ``(rows, cols, 4)`` uint8 array (no filtering, ``zlib`` level 6)."""
    h, w, _ = rgba.shape
    raw = np.zeros((h, 1 + 4 * w), dtype=np.uint8)
    raw[:, 1:] = rgba.reshape(h, 4 * w)
    return (b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(raw.tobytes(), 6))
            + _chunk(b"IEND", b""))
