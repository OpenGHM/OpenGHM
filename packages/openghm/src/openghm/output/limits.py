"""What one ``openghm output`` call may read and write, and how its reads are cached.

Every number here is a tuning knob with a measured basis (ADR 0033). The commands run on a login
node, where nothing long may run (rule 7), so a call that would read more than
:data:`MAX_CELLS_READ` or write more than :data:`MAX_NC_BYTES` is refused, with a message, before
the first data block is read.

Basis (Anvil login node, 2026-10-09, Wyoming daily file, 288 x 551 cells, chunks of one time step
over the whole grid, deflate level 1):

* the file on scratch: a 365-day pixel series, 365 chunks of 158,688 cells = 57.9 million cells
  read, took 3.2 s: about 18 million cells per second, all of it inflating whole chunks, because a
  chunk is read whole however small the area asked for is;
* the same file over HTTPS from Anvil S3: one day 0.14 s, 31 days of one pixel 0.36 s (4.9 million
  cells): about 14 million cells per second.

So 400 million cells is about 22 s from scratch and about 30 s over HTTPS, the "under about 30 s"
the call is meant to stay below. "Cells read" counts the chunks a call touches, not the cells it
keeps (:func:`openghm.output.netcdf.cells_read`), which is why a pixel series over a Global daily
year (365 chunks of 835,200 cells = 305 million) fits and a whole-globe year (2.7 billion) does
not. The orchestrator measures Global on Anvil and adjusts these.
"""

from __future__ import annotations

#: Time steps times cells decoded by one call (see the module docstring).
MAX_CELLS_READ = 400_000_000
#: What an ``nc`` subset would hold uncompressed (steps x rows x cols x 4 bytes); the file is
#: smaller (deflate level 1) but is written in a call that also reads, so it is bounded up front.
MAX_NC_BYTES = 1 << 30
#: A map's longest side, and its pixels (RGBA, so four bytes each before ``zlib``).
MAX_IMAGE_SIDE = 4096
MAX_IMAGE_PIXELS = 8_000_000
#: The most an ``nc`` subset holds in memory at once, in bytes: the steps are read and written in
#: blocks of this size.
WRITE_BLOCK_BYTES = 64 << 20

#: Bytes per HTTP range request's block, and how many blocks are kept (least recently used out).
#: Not measured yet: 1 MiB blocks hold one compressed chunk of a small grid in a request or two,
#: 32 of them are 32 MiB of memory. The orchestrator tunes both against Anvil S3.
BLOCK_SIZE = 1 << 20
CACHE_BLOCKS = 32
#: Seconds a socket may stay silent, and how many times a request is tried (transient errors only).
HTTP_TIMEOUT = 60
HTTP_ATTEMPTS = 3
HTTP_BACKOFF = 1.0
