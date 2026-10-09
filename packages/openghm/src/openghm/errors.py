"""Typed errors for openghm.

Builders raise :class:`OpenghmError` (never call ``sys.exit``) so the library is
safe to embed; the CLI catches it and maps to exit code 2.
"""

from __future__ import annotations


class OpenghmError(Exception):
    """Base error for openghm build/validation failures."""


class ValidationError(OpenghmError):
    """Invalid or missing options."""


class OutputMissing(OpenghmError):
    """``openghm output``: there is no WBM output at the source (no ``wbm_output/<run>/``
    folder, or a snapshot that published none). The CLI exits 3, so a caller can tell "nothing
    there" from a request that is wrong (exit 2)."""
