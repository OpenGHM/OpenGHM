"""Build hook: refuse to build a wheel that would ship without the spec schemas.

``src/openghm/schemas`` is a relative symlink to the repository's top-level
``schemas/`` (AGENTS.md rule 4: one source, no second copy). A build tool that
first copies this directory elsewhere leaves the symlink dangling — pip < 21.3
does exactly that — and hatchling then fails with a bare ``FileNotFoundError``
on the symlink. No build setting can reach the real tree from such a copy (the
copy has no ``../../schemas``), so the only fix is a build that does not copy;
this hook's job is to say so instead of leaving a cryptic traceback.
"""

from __future__ import annotations

import os

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

_MESSAGE = (
    "openghm: {path} does not resolve to the spec schemas. It is a relative "
    "symlink into the repository's top-level schemas/, and this build is running "
    "from a copy of the package directory in which it dangles. pip older than "
    "21.3 copies the source tree before building; upgrade pip and reinstall "
    "(`python -m pip install --upgrade pip`, then `pip install packages/openghm`), "
    "or keep the old pip and pass `--use-feature=in-tree-build`. (On Anvil see the "
    "package README's Install: the module's PYTHONPATH pip shadows an upgraded venv pip.)"
)


class SchemasPresentHook(BuildHookInterface):
    def initialize(self, version, build_data):
        path = os.path.join(self.root, "src", "openghm", "schemas")
        marker = os.path.join(path, "snapshot-spec", "index.json")
        if not os.path.isfile(marker):
            raise RuntimeError(_MESSAGE.format(path=path))
