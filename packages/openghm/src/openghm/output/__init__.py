"""Reading a run's WBM output where it is (ADR 0033): ``openghm output inventory`` and ``subset``.

Both read either a simulation's work directory on scratch (``<output_base>/<sim_id>``, ADR 0023) or a
published snapshot's ``wbm_output/`` in the public bucket, over anonymous HTTPS range requests. Both
are short commands for a login node (rule 7); each refuses a call that would read or write more than
:mod:`openghm.output.limits` allows.

* :mod:`.source` folder and snapshot sources; :mod:`.rangefile` the HTTP file h5py reads through;
* :mod:`.mt` the display settings of the run's ``*.MT.csv``; :mod:`.netcdf` reading with h5py and
  writing with h5netcdf; :mod:`.image` ramps and the PNG writer;
* :mod:`.inventory` and :mod:`.subset` the two commands.

Everything needing h5py and numpy (the optional extra ``output``) is imported only by the command
line when it runs an ``output`` command, so the rest of the toolkit stays pure Python. This package
imports neither.
"""
