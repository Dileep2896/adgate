"""`adgate.__version__` and the version hatchling publishes must be the same string.

Nothing generates one from the other: pyproject.toml is what ends up on PyPI and __version__ is
what a caller reads at runtime, and the release procedure in CONTRIBUTING.md bumps both by hand
(changesets versions the npm packages only, never this one). This test is the guard that makes
"by hand" safe. It skips when pyproject.toml is not on disk, which is the case inside an
installed sdist.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import adgate

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_version_matches_pyproject() -> None:
    if not PYPROJECT.exists():
        pytest.skip("pyproject.toml is not part of an installed distribution")
    match = re.search(r'^version = "([^"]+)"$', PYPROJECT.read_text(), re.MULTILINE)
    assert match is not None, "pyproject.toml has no top level version"
    assert adgate.__version__ == match.group(1)
