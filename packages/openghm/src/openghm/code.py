"""The tree hash of WBM code — ``openghm code hash`` and the checks that compare it.

A snapshot pins the WBM code it runs by tree hash in ``uses.modelCode.treeHash``
(ADR 0032). The recipe (ADR 0008, ADR 0032):

- take every regular file under ``model/`` and ``utilities/``, as a path relative to
  the tree's root (``model/wbm.pl``), skipping any path with an ``_Inline`` directory
  in it (``_Inline`` is what perl compiles at run time; it is not the code);
- sort the paths bytewise;
- write one line per file, ``<sha256 hex>  <path>\\n``;
- the tree hash is the sha256 of those lines, lowercase hex.

It equals the shell pipeline ``find model utilities -type f -not -path '*/_Inline/*'
-print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`` run in the tree's root.
Like ``find -type f``, a symlink is not a regular file and is not hashed, and a
symlinked directory is not entered.

Two ways in, one recipe: :func:`tree_hash` hashes a folder on disk, and
:func:`tree_hash_of_sums` computes the same value from the per-file sha256 that a
``SHA256SUMS`` already lists, which is how ``snapshot publish`` checks the code it
would copy server-side without downloading it.

Stdlib only; Python 3.9 (Anvil).
"""

from __future__ import annotations

import collections.abc
import hashlib
import os
from typing import Dict, Iterable, List, Mapping, Tuple, Union

from .errors import OpenghmError

#: The top-level directories that make up the code, in the order the recipe names them.
CODE_DIRS = ("model", "utilities")

#: A directory of this name, anywhere below ``model/`` or ``utilities/``, is left out.
EXCLUDED_DIR = "_Inline"

_CHUNK = 1024 * 1024


def counts(rel: str) -> bool:
    """Whether a tree-relative ``/`` path takes part in the hash: it is under
    :data:`CODE_DIRS` and has no :data:`EXCLUDED_DIR` directory in it."""
    parts = rel.split("/")
    return len(parts) > 1 and parts[0] in CODE_DIRS and EXCLUDED_DIR not in parts[1:-1]


def _check_path(rel: str) -> None:
    # sha256sum escapes a name holding a backslash or a newline, so the recipe's text for it is
    # not the plain line; refuse rather than hash something the shell pipeline would not.
    if "\\" in rel or "\n" in rel:
        raise OpenghmError(f"{rel!r} has a backslash or a newline in its path; it cannot be tree-hashed")


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def tree_hash_of_sums(sums: Union[Mapping[str, str], Iterable[Tuple[str, str]]]) -> str:
    """The tree hash from ``{relpath: sha256}`` (a parsed ``SHA256SUMS``, or any listing).

    Entries that do not count (:func:`counts`) are ignored, so the whole of a snapshot's
    ``SHA256SUMS`` can be passed in.
    """
    items = sums.items() if isinstance(sums, collections.abc.Mapping) else sums
    entries: List[Tuple[bytes, str, str]] = []
    for rel, sha in items:
        if not counts(rel):
            continue
        _check_path(rel)
        entries.append((rel.encode("utf-8", "surrogateescape"), rel, sha))
    entries.sort()
    text = "".join(f"{sha}  {rel}\n" for _key, rel, sha in entries)
    return hashlib.sha256(text.encode("utf-8", "surrogateescape")).hexdigest()


def code_file_hashes(root: Union[str, "os.PathLike[str]"]) -> Dict[str, str]:
    """``{relpath: sha256}`` of the regular files that make up the code under ``root``.

    Raises :class:`OpenghmError` when ``model/`` or ``utilities/`` is not a directory there.
    """
    root = os.fspath(root)
    for d in CODE_DIRS:
        if not os.path.isdir(os.path.join(root, d)):
            raise OpenghmError(f"{os.path.join(root, d)} is not a directory: no WBM code to hash")
    out: Dict[str, str] = {}
    for d in CODE_DIRS:
        for dirpath, dirnames, filenames in os.walk(os.path.join(root, d)):   # symlinked dirs are not entered
            dirnames[:] = [n for n in dirnames if n != EXCLUDED_DIR]
            for name in filenames:
                full = os.path.join(dirpath, name)
                if os.path.islink(full) or not os.path.isfile(full):
                    continue
                rel = os.path.relpath(full, root).replace(os.sep, "/")
                if counts(rel):
                    out[rel] = _sha256_file(full)
    return out


def tree_hash(root: Union[str, "os.PathLike[str]"]) -> str:
    """The tree hash of the WBM code in ``root`` (the folder holding ``model/`` and ``utilities/``)."""
    return tree_hash_of_sums(code_file_hashes(root))


def mismatch_message(what: str, actual: str, pinned: str) -> str:
    """The one sentence every check uses for a tree that is not the pinned code."""
    return (f"{what} has WBM code with tree hash {actual}, but metadata.json pins "
            f"uses.modelCode.treeHash {pinned}")
