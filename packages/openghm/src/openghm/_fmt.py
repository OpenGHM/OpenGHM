"""Number formatting that matches JavaScript ``String(Number)``.

The reference implementation was Node/TS, where ``-110`` (an integer-valued
float from ``Number("-110")``) stringifies as ``"-110"``, not ``"-110.0"``.
Python's ``str(float)`` would emit ``"-110.0"``, which would break byte-parity
with the generated ``.init`` files and the wrapped-script args. ``js_num``
reproduces the JS rule: integer-valued numbers drop the decimal point.
"""

from __future__ import annotations

from numbers import Real


def js_num(x: Real) -> str:
    if isinstance(x, bool):  # bool is an int subclass — guard explicitly
        return "1" if x else "0"
    if isinstance(x, int):
        return str(x)
    f = float(x)
    if f.is_integer():
        return str(int(f))
    return repr(f)
