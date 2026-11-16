"""One cell's time series read chunk by chunk, in parallel, without h5py's serial chunk reads.

h5py reading ``ds[i0:i1, row, col]`` of a chunked dataset fetches and inflates every chunk the
steps touch one after the other, through the range file's 1 MiB blocks: a Global daily year of one
cell (365 chunks of 580 x 1440 cells) fetched 998 MB in 5.8 s. HDF5 can say where each chunk lies
(``get_chunk_info_by_coord``), so :func:`read_cell_series` fetches exactly those byte ranges with
:data:`openghm.output.limits.SERIES_READ_THREADS` threads and inflates them in the threads (``zlib``
releases the GIL): 1.6 s on the same file, the same values.

The fast path is for what WBM writes: a chunked three-dimensional dataset whose only filter is
deflate (or none) and whose type is a plain number. Anything else returns None and the caller reads
through h5py as before.
"""

from __future__ import annotations

import zlib
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from ..errors import OpenghmError
from . import limits
from .netcdf import np
from .source import Source

_DEFLATE_BIT = 1     # filter_mask bit 0: the (only) filter was skipped for this chunk, it is stored raw


def applies(ds) -> bool:
    """Whether :func:`read_cell_series` can read ``ds``: see the module docstring."""
    try:
        if ds.chunks is None or len(ds.shape) != 3 or len(ds.chunks) != 3 or 0 in ds.chunks or 0 in ds.shape:
            return False
        if ds.compression not in (None, "gzip") or ds.shuffle or ds.fletcher32 or ds.scaleoffset is not None:
            return False
        nfilters = ds.id.get_create_plist().get_nfilters()
        if nfilters != (1 if ds.compression == "gzip" else 0):
            return False
        dt = ds.dtype
        if dt.fields is not None or dt.kind not in "iuf" or dt.byteorder not in "<>=|":
            return False
        return hasattr(ds.id, "get_chunk_info_by_coord")
    except (AttributeError, TypeError, ValueError):
        return False


def read_cell_series(source: Source, rel: str, ds, i0: int, i1: int, row: int, col: int,
                     threads: Optional[int] = None) -> Optional["np.ndarray"]:
    """The values of cell ``(row, col)`` for steps ``i0:i1`` of ``ds`` (a dataset of ``rel``), as the
    dataset's dtype, equal to ``ds[i0:i1, row, col]``; None when the fast path does not apply (the
    dataset's layout or filters, or a source that cannot read byte ranges)."""
    if i1 <= i0 or not applies(ds):
        return None
    reader = source.range_reader(rel)
    if reader is None:
        return None
    try:
        return _read(reader, ds, i0, i1, row, col, threads or limits.SERIES_READ_THREADS)
    finally:
        reader.close()


def _read(reader, ds, i0: int, i1: int, row: int, col: int, threads: int) -> "np.ndarray":
    ct, cy, cx = ds.chunks
    dtype = ds.dtype
    expect = ct * cy * cx * dtype.itemsize
    deflate = ds.compression == "gzip"
    r0, c0 = (row // cy) * cy, (col // cx) * cx
    fill = np.array(ds.fillvalue, dtype=dtype)

    # Where each chunk lies, asked serially: the chunk index is small and h5py is not thread-safe.
    chunk_starts = list(range((i0 // ct) * ct, i1, ct))
    infos = [ds.id.get_chunk_info_by_coord((t0, r0, c0)) for t0 in chunk_starts]

    def one(k: int) -> "np.ndarray":
        """The cell's values in chunk ``k`` for the steps of ``i0:i1`` it holds."""
        t0, info = chunk_starts[k], infos[k]
        lo, hi = max(i0, t0) - t0, min(i1, t0 + ct) - t0
        if info is None or info.byte_offset is None:
            return np.full(hi - lo, fill, dtype=dtype)
        raw = reader.read(info.byte_offset, info.size)
        if deflate and not info.filter_mask & _DEFLATE_BIT:
            raw = zlib.decompress(raw)
        if len(raw) != expect:
            raise OpenghmError(f"a chunk of {ds.name} holds {len(raw)} bytes, not the {expect} its shape "
                               f"{ds.chunks} of {dtype} says")
        a = np.frombuffer(raw, dtype=dtype).reshape(ct, cy, cx)
        return a[lo:hi, row - r0, col - c0]

    n = len(chunk_starts)
    if n == 1 or threads <= 1:
        parts: List["np.ndarray"] = [one(k) for k in range(n)]
    else:
        with ThreadPoolExecutor(min(threads, n)) as ex:
            parts = list(ex.map(one, range(n)))
    return np.concatenate(parts).astype(dtype, copy=False)
