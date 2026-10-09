"""The display settings a run's ``<ID>.MT.csv`` holds for its output variables.

WBM writes one Magic Table per run: a tab-separated header, then the **output** records (one per
variable and resolution, ``Code_Name`` ending ``_d``, ``_m``, ``_y``, ``_dc``, ``_mc``, ``_yc``),
a blank line, then the input datasets the run read. Only the part before the blank line is read
here. The table lists climatology records whether or not the run wrote them, and its ``File_Path``
is a path inside the container the run used (``(1e20,1e5):/wbm/wbm_output/<ID>/daily/wbm__YEAR_.nc;``);
neither is trusted: what exists is what the output folder holds (:mod:`openghm.output.inventory`),
and the MT only says how to show it.

What is kept, per ``(Var_Name, Time_Series)``:

* ``Units``, ``Var_Scale`` and ``Var_Offset``: the file stores per-day values (``mm/day``) in the
  monthly and yearly files, and the table shows ``mm/month`` with ``Var_Scale`` 30; a displayed
  value is ``stored * Var_Scale + Var_Offset``. An empty scale is 1 and an empty offset 0.
* ``Legend_File``: ``DarkBlue(0:20)``, ``Rainbow(0.1:100000)Log``: the colour ramp's name, the range
  it spans in displayed units, and whether the scale is logarithmic. The ramps' colours are not in
  the table (they live in UNH's EarthAtlas code); :mod:`openghm.output.image` defines ours.
* ``Processing`` (``log:zero``, ``steps=400``, ``noScale``) and ``Round`` (``%.2f``) as written.

Pure standard library.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

#: ``Time_Series`` values of the climatology records, by the kind they describe.
CLIMATOLOGY_SERIES = {"daily_clim": "daily", "monthly_clim": "monthly", "yearly_clim": "yearly"}

_LEGEND = re.compile(r"^\s*([A-Za-z]\w*)\s*\(\s*([^:()\s]+)\s*:\s*([^:()\s]+)\s*\)\s*(Log)?\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class Legend:
    """``DarkBlue(0:20)``: ramp ``DarkBlue`` over 0 to 20 displayed units; ``log`` for ``...Log``."""

    ramp: str
    min: float
    max: float
    log: bool

    def to_dict(self) -> dict:
        return {"ramp": self.ramp, "min": self.min, "max": self.max, "log": self.log}


@dataclass(frozen=True)
class Display:
    """How one variable at one resolution is shown."""

    units: Optional[str]
    scale: float
    offset: float
    legend: Optional[Legend]
    processing: Optional[str]
    round: Optional[str]

    def to_dict(self) -> dict:
        return {
            "units": self.units,
            "scale": self.scale,
            "offset": self.offset,
            "legend": None if self.legend is None else self.legend.to_dict(),
            "processing": self.processing,
            "round": self.round,
        }


def parse_legend(text: str) -> Optional[Legend]:
    """``Legend_File`` as a :class:`Legend`, or None when it is empty or not of that form."""
    m = _LEGEND.match(text or "")
    if not m:
        return None
    try:
        lo, hi = float(m.group(2)), float(m.group(3))
    except ValueError:
        return None
    if not hi > lo:
        return None
    return Legend(ramp=m.group(1), min=lo, max=hi, log=bool(m.group(4)))


def _number(text: str, default: float) -> float:
    try:
        return float(text) if text.strip() else default
    except ValueError:
        return default


def parse(text: str) -> Dict[Tuple[str, str], Display]:
    """The output records of an MT as ``{(Var_Name, Time_Series): Display}``. Rows before the blank
    line that lack a ``Var_Name`` or ``Time_Series`` are skipped; a text without the header yields
    ``{}``."""
    text = text.replace("\r", "")
    head, _, _ = text.partition("\n\n")
    rows = list(csv.reader(io.StringIO(head), delimiter="\t", quoting=csv.QUOTE_NONE))
    if not rows:
        return {}
    cols = {name: i for i, name in enumerate(rows[0])}
    if "Var_Name" not in cols or "Time_Series" not in cols:
        return {}

    def cell(row, name: str) -> str:
        i = cols.get(name)
        return row[i].strip() if i is not None and i < len(row) else ""

    out: Dict[Tuple[str, str], Display] = {}
    for row in rows[1:]:
        var, series = cell(row, "Var_Name"), cell(row, "Time_Series")
        if not var or not series:
            continue
        out[(var, series)] = Display(
            units=cell(row, "Units") or None,
            scale=_number(cell(row, "Var_Scale"), 1.0),
            offset=_number(cell(row, "Var_Offset"), 0.0),
            legend=parse_legend(cell(row, "Legend_File")),
            processing=cell(row, "Processing") or None,
            round=cell(row, "Round") or None,
        )
    return out
