"""The wheel and the sdist must carry the licence, and the copy must not drift.

FSL-1.1-Apache-2.0 has no SPDX identifier, so pyproject.toml declares the licence by file rather
than as an expression, and hatchling can only read a file inside the project directory: therefore
packages/sdk-python/LICENSE.md is a copy of the repository root LICENSE.md. This test is what
keeps the two identical. It skips when pyproject.toml is not on disk, which is the case inside an
installed distribution.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

PACKAGE_DIR = Path(__file__).resolve().parents[1]
PYPROJECT = PACKAGE_DIR / "pyproject.toml"
LICENSE = PACKAGE_DIR / "LICENSE.md"
REPO_LICENSE = PACKAGE_DIR.parents[1] / "LICENSE.md"


def test_pyproject_declares_the_licence_by_file() -> None:
    if not PYPROJECT.exists():
        pytest.skip("pyproject.toml is not part of an installed distribution")
    text = PYPROJECT.read_text()
    assert re.search(r'^license = \{ file = "LICENSE\.md" \}$', text, re.MULTILINE)
    # FSL is not OSI approved: an OSI classifier here would be a false claim.
    assert "License :: OSI Approved" not in text


def test_licence_is_the_repository_licence_byte_for_byte() -> None:
    if not REPO_LICENSE.exists():
        pytest.skip("the repository root is not part of an installed distribution")
    assert LICENSE.read_bytes() == REPO_LICENSE.read_bytes()


def test_licence_is_fsl_with_an_apache_future_licence() -> None:
    text = LICENSE.read_text()
    assert "Functional Source License, Version 1.1" in text
    assert "Grant of Future License" in text
    assert "Apache License, Version 2.0" in text
